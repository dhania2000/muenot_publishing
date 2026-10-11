/**
 * @file lib/alt-text/batch-retry.ts
 * @module Publishing · Alt Text
 * @kind Server-side library
 * @summary Phase 2 Task 14 — manual retry of failed batch images (all eligible, or one image).
 * @usedBy app/api/alt-text/batches/[id]/retry-failed, app/api/alt-text/batches/[id]/assets/[assetId]/retry
 *
 * Guarantees:
 * - Only failed, never-generated images whose persisted error code is retryable are reset.
 * - Unsafe/quarantined/missing files, permanent failures, unclassified failures and exhausted
 *   images are skipped with a reason; nothing is silently retried.
 * - Work is scheduled on the batch's EXISTING durable job (same idempotency key); no second job.
 * - Row locks in the store make double clicks and concurrent users idempotent.
 * - Governance/model availability is re-checked before anything changes; credits are re-checked
 *   by the processor per image (Awaiting Credits hold, never a billable surprise).
 */
import "server-only"
import { AiError } from "@/lib/ai/governance-core"
import type { PermissionScope } from "@/lib/permission-model"
import { ALT_TEXT_BATCH_JOB_TYPE, altTextBatchIdempotencyKey } from "./batch-job"
import { assetScanVerdict, resolveBatchModel, type BatchActor } from "./batch-submission"
import { aiErrorToFailure } from "./generate"
import {
  RETRY_BATCH_STATUSES,
  RETRY_BLOCKER_MESSAGES,
  maxImageAttemptsFromEnv,
  retryBlocker,
  type RetryBlocker,
} from "./retry-policy"
import { getAssetRefs, getBatch, retryFailedBatchAssets, type AssetRef, type BatchStatus } from "./store"

export type RetryFailure = { ok: false; status: number; code: string; error: string; details?: Record<string, unknown> }
export type RetrySkip = { id: number; reason: RetryBlocker; message: string }
export type RetrySuccess = {
  ok: true
  body: {
    success: true
    batchId: string
    status: BatchStatus
    acceptedCount: number
    acceptedIds: number[]
    skippedCount: number
    skipped: RetrySkip[]
    skippedByReason: Partial<Record<RetryBlocker, number>>
  }
}

export type RetryDeps = {
  resolveModel?: (actor: BatchActor) => Promise<unknown>
  scan?: typeof assetScanVerdict
  maxAttempts?: number
}

const fail = (status: number, code: string, error: string, details?: Record<string, unknown>): RetryFailure => ({ ok: false, status, code, error, ...(details ? { details } : {}) })
const NOT_FOUND = (what = "Batch") => fail(404, "NOT_FOUND", `${what} not found.`)
const SCAN_CONCURRENCY = 8

function withinScope(scope: PermissionScope, userId: number, a: Pick<AssetRef, "createdBy" | "reviewerId">) {
  if (scope === "all") return true
  if (scope === "added") return a.createdBy === userId
  if (scope === "owned") return a.reviewerId === userId
  if (scope === "both") return a.createdBy === userId || a.reviewerId === userId
  return false
}

async function scanBlockers(refs: AssetRef[], tenantId: number, scan: typeof assetScanVerdict) {
  const blocked = new Map<number, RetryBlocker>()
  for (let i = 0; i < refs.length; i += SCAN_CONCURRENCY) {
    const chunk = refs.slice(i, i + SCAN_CONCURRENCY)
    const verdicts = await Promise.all(chunk.map((r) => scan(r, tenantId)))
    // A pending scan is not a blocker: the processor holds the image until it clears.
    chunk.forEach((r, j) => {
      if (verdicts[j] === "unsafe" || verdicts[j] === "quarantined" || verdicts[j] === "missing") blocked.set(r.id, "UNSAFE_FILE")
    })
  }
  return blocked
}

/** Retries every eligible failed image in the batch, or exactly one image when `assetId` is given. */
export async function retryBatchFailures(
  batchId: string,
  actor: BatchActor,
  opts: { assetId?: number } = {},
  deps: RetryDeps = {},
): Promise<RetrySuccess | RetryFailure> {
  const batch = await getBatch(batchId)
  if (!batch) return NOT_FOUND()
  if (actor.updateScope !== "all" && batch.createdBy !== actor.userId && batch.submittedBy !== actor.userId) return NOT_FOUND()
  if (batch.status === "cancelled" || batch.status === "cancel_requested") return fail(409, "BATCH_CANCELLED", "A cancelled batch cannot be retried.", { status: batch.status })
  if (!RETRY_BATCH_STATUSES.has(batch.status)) return fail(409, "BATCH_NOT_RETRYABLE", "This batch has not been submitted for processing.", { status: batch.status })

  const single = opts.assetId != null
  const refs = (await getAssetRefs(single ? { ids: [opts.assetId!] } : { batchId })).filter((r) => r.batchId === batchId)
  if (single && !refs.length) return NOT_FOUND("Image")

  const preBlocked = new Map<number, RetryBlocker>()
  const inScope: AssetRef[] = []
  for (const r of refs) {
    if (withinScope(actor.updateScope, actor.userId, r)) inScope.push(r)
    else preBlocked.set(r.id, "OUT_OF_SCOPE")
  }
  // Foreign-scope images are indistinguishable from missing ones for a single retry.
  if (single && !inScope.length) return NOT_FOUND("Image")

  const failedRefs = inScope.filter((r) => r.status === "failed")
  if (!failedRefs.length) {
    if (single) return fail(409, "NOT_FAILED", RETRY_BLOCKER_MESSAGES.NOT_FAILED)
    return fail(409, "NO_FAILED_IMAGES", "This batch has no failed images to retry.")
  }

  try {
    await (deps.resolveModel ?? resolveBatchModel)(actor)
  } catch (err) {
    if (err instanceof AiError) {
      const f = aiErrorToFailure(err)
      return fail(f.status, f.code, f.error, f.details)
    }
    throw err
  }

  for (const [id, reason] of await scanBlockers(failedRefs, actor.tenantId, deps.scan ?? assetScanVerdict)) preBlocked.set(id, reason)

  const maxAttempts = deps.maxAttempts ?? maxImageAttemptsFromEnv()
  const res = await retryFailedBatchAssets(
    batchId,
    { type: ALT_TEXT_BATCH_JOB_TYPE, idempotencyKey: altTextBatchIdempotencyKey(batchId) },
    {
      assetIds: single ? [opts.assetId!] : undefined,
      allowedStatuses: RETRY_BATCH_STATUSES,
      blocker: (c) => preBlocked.get(c.id) ?? retryBlocker(c, maxAttempts),
    },
  )
  if (res.state === "not_found") return NOT_FOUND()
  if (res.state === "job_unavailable") return fail(409, "JOB_UNAVAILABLE", "This batch has no processing job to resume. Submit the images in a new batch.")
  if (res.state === "not_eligible") {
    return res.status === "cancelled" || res.status === "cancel_requested"
      ? fail(409, "BATCH_CANCELLED", "A cancelled batch cannot be retried.", { status: res.status })
      : fail(409, "BATCH_NOT_RETRYABLE", "This batch cannot be retried in its current state.", { status: res.status })
  }

  const skipped: RetrySkip[] = res.skipped.map((s) => {
    const reason = s.reason as RetryBlocker
    return { id: s.id, reason, message: RETRY_BLOCKER_MESSAGES[reason] ?? "This image cannot be retried." }
  })
  if (single && !res.accepted.length) {
    const s = skipped[0]
    return s ? fail(409, s.reason, s.message) : fail(409, "NOT_FAILED", RETRY_BLOCKER_MESSAGES.NOT_FAILED)
  }
  const skippedByReason: Partial<Record<RetryBlocker, number>> = {}
  for (const s of skipped) skippedByReason[s.reason] = (skippedByReason[s.reason] ?? 0) + 1
  // Out-of-scope rows are invisible to this user; never echo their ids.
  const visibleSkipped = skipped.filter((s) => s.reason !== "OUT_OF_SCOPE")

  return {
    ok: true,
    body: {
      success: true,
      batchId,
      status: res.status,
      acceptedCount: res.accepted.length,
      acceptedIds: res.accepted,
      skippedCount: visibleSkipped.length,
      skipped: visibleSkipped,
      skippedByReason: Object.fromEntries(Object.entries(skippedByReason).filter(([k]) => k !== "OUT_OF_SCOPE")),
    },
  }
}
