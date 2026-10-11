/**
 * @file lib/alt-text/batch-job.ts
 * @module Publishing · Alt Text
 * @kind Server-side library
 * @summary Phase 2 Task 8 — `alt_text.batch_processing` handler for the durable background queue.
 * @usedBy lib/background-jobs.ts (JOB_HANDLERS, afterSettle), lib/alt-text/batch-submission.ts
 *
 * Guarantees:
 * - The payload is a batch reference only; tenant comes from the persisted job row and
 *   every read runs inside that tenant's scope, so a job can never reach another tenant.
 * - No AI calls and no credits here. The Task 9 processor (batch-processor.ts) is passed in by
 *   the queue handler; without one the job is deferred (retry budget untouched), never completed.
 * - Permanent problems (missing/ineligible batch) fail fast with a 4xx-classified error so
 *   the existing retry policy dead-letters them instead of retrying.
 */
import "server-only"
import { JobDeferredError } from "@/lib/job-retry-policy"
import { runForTenant } from "@/lib/tenant-scope"
import type { GenerationSettings } from "./core"
import { BATCH_HOLD_STATUSES, finalizeBatchFromAssets, getAssetRefs, getBatch, markBatchProcessing, settleBatchControl, settleBatchFromJob } from "./store"

export const ALT_TEXT_BATCH_JOB_TYPE = "alt_text.batch_processing" as const
export const ALT_TEXT_BATCH_CHUNK_SIZE = 10
export const AWAITING_PROCESSOR_DELAY_SECONDS = 600
// `processing` is included so stale claims are recovered; claimForGeneration enforces the lease.
const ELIGIBLE_ASSET_STATUSES = new Set(["uploaded", "processing"])

export const altTextBatchIdempotencyKey = (batchId: string) => `alt-text-batch:${batchId}`
export const altTextBatchConcurrencyKey = (tenantId: number) => `${ALT_TEXT_BATCH_JOB_TYPE}:t${tenantId}`

export type AltTextBatchJobRef = { id: number; tenant_id: number; attempts: number }

/** Everything Task 9 needs; asset storage keys stay server-side and are re-resolved per image. */
export type AltTextBatchPlan = {
  jobId: number
  tenantId: number
  batchId: string
  attempt: number
  settings: GenerationSettings
  assetIds: number[]
  chunks: number[][]
}

export type AltTextBatchProcessor = (plan: AltTextBatchPlan, ctx: { signal: AbortSignal }) => Promise<Record<string, unknown>>

let registeredProcessor: AltTextBatchProcessor | null = null

/** Task 9 registers the per-image processor here. */
export function registerAltTextBatchProcessor(processor: AltTextBatchProcessor | null) {
  registeredProcessor = processor
}

export class AltTextBatchJobError extends Error {
  readonly status: number
  constructor(readonly code: string, status = 422) {
    super(code)
    this.name = "AltTextBatchJobError"
    this.status = status
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export async function runAltTextBatchJob(
  payload: { batchId: string },
  ctx: { job: AltTextBatchJobRef; signal: AbortSignal },
  deps: { processor?: AltTextBatchProcessor | null } = {},
): Promise<Record<string, unknown>> {
  if (!Number.isSafeInteger(ctx.job.tenant_id) || ctx.job.tenant_id <= 0) throw new AltTextBatchJobError("TENANT_REQUIRED", 400)
  return runForTenant({ tenantId: ctx.job.tenant_id }, async () => {
    const batch = await getBatch(payload.batchId)
    if (!batch) throw new AltTextBatchJobError("BATCH_NOT_FOUND", 404)
    if (isHoldStatus(batch.status)) return applyBatchControl(payload.batchId)
    // Cancel settled before the job ran again: finish the job quietly instead of dead-lettering it.
    if (batch.status === "cancelled") return { controlled: true, batchStatus: "cancelled" }
    if (batch.status !== "queued" && batch.status !== "processing") throw new AltTextBatchJobError("BATCH_NOT_ELIGIBLE", 409)

    const refs = await getAssetRefs({ batchId: payload.batchId })
    const assetIds = refs.filter((r) => ELIGIBLE_ASSET_STATUSES.has(r.status)).map((r) => r.id)
    if (!assetIds.length) {
      // Redelivery after every image finished (e.g. worker died before settling): rebuild state from records.
      if (batch.status === "processing") {
        const settled = await finalizeBatchFromAssets(payload.batchId)
        return { recovered: true, batchStatus: settled?.status ?? batch.status }
      }
      throw new AltTextBatchJobError("NO_ELIGIBLE_ASSETS", 422)
    }

    const plan: AltTextBatchPlan = {
      jobId: ctx.job.id,
      tenantId: ctx.job.tenant_id,
      batchId: payload.batchId,
      attempt: ctx.job.attempts,
      settings: batch.settings,
      assetIds,
      chunks: chunk(assetIds, ALT_TEXT_BATCH_CHUNK_SIZE),
    }

    const processor = deps.processor === undefined ? registeredProcessor : deps.processor
    if (!processor) throw new JobDeferredError("ALT_TEXT_PROCESSOR_UNAVAILABLE", AWAITING_PROCESSOR_DELAY_SECONDS)

    await markBatchProcessing(payload.batchId)
    return processor(plan, { signal: ctx.signal })
  })
}

/** Keeps the batch consistent with terminal job outcomes; completion is owned by the Task 9 processor. */
export async function onAltTextBatchJobSettled(job: AltTextBatchJobRef & { payload: unknown }, status: string) {
  const batchId = (job.payload as { batchId?: unknown })?.batchId
  if (typeof batchId !== "string" || job.tenant_id <= 0) return
  const target = status === "cancelled" ? "cancelled" : status === "failed" || status === "dead_letter" ? "failed" : null
  if (!target) return
  await runForTenant({ tenantId: job.tenant_id }, async () => {
    // A requested cancel still finalizes as a cancel; a pause with no live job can never resume.
    const control = await settleBatchControl(batchId)
    if (control?.status === "cancel_requested" || control?.status === "cancelled") return
    await settleBatchFromJob(batchId, target)
  })
}

export const PAUSED_RECHECK_SECONDS = 3600
export const CONTROL_SETTLE_RETRY_SECONDS = 30
const HOLD = new Set<string>(BATCH_HOLD_STATUSES)
export const isHoldStatus = (s: string) => HOLD.has(s)

/**
 * Worker-side safe boundary: converges a persisted pause/cancel. Paused batches park the existing
 * job (deferral never consumes retry budget) until Resume wakes it; a still-settling request is
 * re-checked shortly so a crashed worker can never leave the batch stuck.
 */
export async function applyBatchControl(batchId: string): Promise<Record<string, unknown>> {
  const result = await settleBatchControl(batchId)
  if (!result) throw new AltTextBatchJobError("BATCH_NOT_FOUND", 404)
  if (result.status === "paused") throw new JobDeferredError("ALT_TEXT_BATCH_PAUSED", PAUSED_RECHECK_SECONDS)
  if (result.status === "pause_requested" || result.status === "cancel_requested") throw new JobDeferredError("ALT_TEXT_BATCH_CONTROL_SETTLING", CONTROL_SETTLE_RETRY_SECONDS)
  if (result.status === "queued" || result.status === "processing") throw new JobDeferredError("ALT_TEXT_BATCH_RESUMED", CONTROL_SETTLE_RETRY_SECONDS)
  return { controlled: true, batchStatus: result.status }
}
