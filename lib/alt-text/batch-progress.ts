/**
 * @file lib/alt-text/batch-progress.ts
 * @module Publishing · Alt Text
 * @kind Server-side library
 * @summary Phase 2 Task 11 — read-only batch progress and per-image status for polling clients.
 * @usedBy app/api/alt-text/batches/[id]/progress, app/api/alt-text/batches/[id]/assets
 *
 * Every number comes from persisted asset rows (one SQL aggregate); job state is read from the
 * existing background-job row. Nothing here enqueues work, claims assets or calls AI.
 */
import "server-only"
import { ALT_TEXT_BATCH_JOB_TYPE, altTextBatchIdempotencyKey } from "./batch-job"
import type { HistoryActor, HistoryFailure } from "./history"
import { RETRY_BLOCKER_MESSAGES, classifyFailureCode, maxImageAttemptsFromEnv, retryBlocker, type FailureCategory } from "./retry-policy"
import { BATCH_COMPLETED_ASSET_STATUSES, getBatchProgressRecord, listBatchAssetStatuses, type BatchProgressRecord, type BatchStatus } from "./store"

export const BATCH_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Suggested client poll interval while a batch is active (Task 12). */
export const PROGRESS_POLL_INTERVAL_MS = 4000

export type ProgressCounts = { total: number; pending: number; processing: number; completed: number; failed: number }
/** "deferred": job waiting on credits/rate limits/processor; "stalled": active batch with no live worker; "settling": all images terminal, batch status not yet finalized; "out_of_sync": terminal batch whose images were reset (e.g. retry). */
export type SyncState = "idle" | "active" | "deferred" | "stalled" | "settling" | "out_of_sync" | "settled"

export type BatchProgressView = {
  success: true
  batchId: string
  name: string
  status: BatchStatus
  syncState: SyncState
  isActive: boolean
  total: number
  pending: number
  blockedPending: number
  processing: number
  staleProcessing: number
  completed: number
  failed: number
  cancelled: number
  other: number
  progressPercent: number
  successPercent: number
  jobStatus: string | null
  createdAt: string
  submittedAt: string | null
  startedAt: string | null
  completedAt: string | null
  lastUpdatedAt: string
  pollIntervalMs: number | null
}

const fail = (status: number, code: string, error: string): HistoryFailure => ({ ok: false, status, code, error })
const NOT_FOUND = () => fail(404, "NOT_FOUND", "Batch not found.")
// Transition states keep polling until the worker converges them; `paused` is stable.
const ACTIVE = new Set<BatchStatus>(["queued", "processing", "pause_requested", "cancel_requested"])
const TERMINAL = new Set<BatchStatus>(["completed", "partially_completed", "failed", "cancelled"])
const TERMINAL_JOB = new Set(["completed", "failed", "dead_letter", "cancelled"])

const pct = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 1000) / 10 : 0)

/** Progress = terminal images / total; Success = completed / total. Failed images are processed, never successful. */
export function computeProgress(c: ProgressCounts) {
  const terminal = c.completed + c.failed
  return { progressPercent: pct(terminal, c.total), successPercent: pct(c.completed, c.total), other: Math.max(0, c.total - c.pending - c.processing - c.completed - c.failed) }
}

export function deriveSyncState(r: Pick<BatchProgressRecord, "status" | "counts" | "job">): SyncState {
  const { status, counts: c, job } = r
  const allTerminal = c.total > 0 && c.pending === 0 && c.processing === 0
  if (status === "draft" || status === "paused") return "idle"
  if (TERMINAL.has(status)) {
    // Cancelled/failed jobs legitimately leave pending images; only success states must match the records.
    return (status === "completed" || status === "partially_completed") && !allTerminal ? "out_of_sync" : "settled"
  }
  if (allTerminal) return "settling"
  if (!job || TERMINAL_JOB.has(job.status) || job.leaseExpired) return "stalled"
  if (job.status === "queued" && job.deferred) return "deferred"
  if (job.status === "running" && c.processing > 0 && c.processing === c.staleProcessing) return "stalled"
  return "active"
}

export function toProgressView(r: BatchProgressRecord): BatchProgressView {
  const c = r.counts
  const syncState = deriveSyncState(r)
  const isActive = ACTIVE.has(r.status)
  const candidates = [r.updatedAt, r.assetsUpdatedAt, r.job?.updatedAt].filter((v): v is string => Boolean(v))
  return {
    success: true,
    batchId: r.id,
    name: r.name,
    status: r.status,
    syncState,
    isActive,
    total: c.total,
    pending: c.pending,
    blockedPending: c.blocked,
    processing: c.processing,
    staleProcessing: c.staleProcessing,
    completed: c.completed,
    failed: c.failed,
    cancelled: c.cancelled ?? 0,
    ...computeProgress(c),
    jobStatus: r.job?.status ?? null,
    createdAt: r.createdAt,
    submittedAt: r.submittedAt,
    startedAt: r.job?.startedAt ?? null,
    completedAt: TERMINAL.has(r.status) ? (r.job?.completedAt ?? null) : null,
    lastUpdatedAt: candidates.reduce((a, b) => (b > a ? b : a)),
    pollIntervalMs: isActive ? PROGRESS_POLL_INTERVAL_MS : null,
  }
}

export const ownsBatch = (actor: HistoryActor, r: Pick<BatchProgressRecord, "createdBy" | "submittedBy">) =>
  actor.viewScope === "all" || r.createdBy === actor.userId || r.submittedBy === actor.userId

async function loadVisibleBatch(batchId: string, actor: HistoryActor) {
  const record = await getBatchProgressRecord(batchId, { type: ALT_TEXT_BATCH_JOB_TYPE, idempotencyKey: altTextBatchIdempotencyKey(batchId) })
  // Unknown, foreign-tenant and out-of-scope batches are indistinguishable.
  return record && ownsBatch(actor, record) ? record : null
}

export async function readBatchProgress(batchId: string, actor: HistoryActor): Promise<{ ok: true; body: BatchProgressView } | HistoryFailure> {
  if (!BATCH_ID_PATTERN.test(batchId)) return fail(400, "INVALID_BATCH_ID", "Invalid batch identifier.")
  const record = await loadVisibleBatch(batchId, actor)
  if (!record) return NOT_FOUND()
  return { ok: true, body: toProgressView(record) }
}

const STATUS_FILTERS: Record<string, readonly string[]> = {
  pending: ["uploaded"],
  processing: ["processing"],
  completed: BATCH_COMPLETED_ASSET_STATUSES,
  failed: ["failed"],
  in_review: ["in_review"],
  approved: ["approved"],
  rejected: ["rejected"],
}
const MAX_PAGE_SIZE = 100

export type BatchAssetsQuery = { page: number; pageSize: number; status?: string }

export function parseBatchAssetsQuery(sp: URLSearchParams): { ok: true; value: BatchAssetsQuery } | HistoryFailure {
  const page = sp.get("page") ?? "1"
  const pageSize = sp.get("pageSize") ?? "25"
  if (!/^\d{1,6}$/.test(page) || Number(page) < 1) return fail(400, "INVALID_QUERY", "page must be a positive integer.")
  if (!/^\d{1,3}$/.test(pageSize) || Number(pageSize) < 1 || Number(pageSize) > MAX_PAGE_SIZE) return fail(400, "INVALID_QUERY", `pageSize must be between 1 and ${MAX_PAGE_SIZE}.`)
  const status = sp.get("status") || undefined
  if (status && !STATUS_FILTERS[status]) return fail(400, "INVALID_QUERY", `status must be one of: ${Object.keys(STATUS_FILTERS).join(", ")}.`)
  return { ok: true, value: { page: Number(page), pageSize: Number(pageSize), status } }
}

const progressStatus = (s: string) =>
  s === "uploaded" ? "pending" : s === "processing" ? "processing" : s === "failed" ? "failed" : BATCH_COMPLETED_ASSET_STATUSES.includes(s) ? "completed" : "other"

export type BatchAssetStatusView = {
  id: number
  fileName: string
  classification: string | null
  status: string
  progressStatus: "pending" | "processing" | "completed" | "failed" | "other"
  shortAltPreview: string | null
  previewUrl: string
  startedAt: string | null
  completedAt: string | null
  failureReason: string | null
  blockedReason: string | null
  /** Failed images only; scan safety is re-checked by the retry endpoint. */
  failureCategory: FailureCategory | null
  attempts: number
  retryable: boolean
  retryBlockedReason: string | null
  updatedAt: string
}

export type BatchAssetStatusList = { success: true; batchId: string; items: BatchAssetStatusView[]; total: number; page: number; pageSize: number }

export async function readBatchAssets(batchId: string, q: BatchAssetsQuery, actor: HistoryActor): Promise<{ ok: true; body: BatchAssetStatusList } | HistoryFailure> {
  if (!BATCH_ID_PATTERN.test(batchId)) return fail(400, "INVALID_BATCH_ID", "Invalid batch identifier.")
  if (!(await loadVisibleBatch(batchId, actor))) return NOT_FOUND()
  const scope = actor.viewScope
  const owner = scope === "added" || scope === "owned" || scope === "both" ? { userId: actor.userId, match: scope } : undefined
  if (scope !== "all" && !owner) return NOT_FOUND()
  const maxAttempts = maxImageAttemptsFromEnv()
  const { items, total } = await listBatchAssetStatuses(batchId, {
    statuses: q.status ? STATUS_FILTERS[q.status] : undefined,
    limit: q.pageSize,
    offset: (q.page - 1) * q.pageSize,
    owner,
  })
  return {
    ok: true,
    body: {
      success: true,
      batchId,
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: items.map((a) => {
        const failed = a.status === "failed"
        const blocker = failed ? retryBlocker(a, maxAttempts) : null
        return {
        id: a.id,
        fileName: a.fileName,
        classification: a.classification,
        status: a.status,
        progressStatus: progressStatus(a.status),
        shortAltPreview: a.shortAltPreview,
        previewUrl: `/api/alt-text/assets/${a.id}/image`,
        // Per-image start/finish times are not persisted; never synthesized.
        startedAt: null,
        completedAt: null,
        failureReason: a.status === "failed" ? a.errorMessage : null,
        blockedReason: a.status === "uploaded" ? a.errorMessage : null,
        failureCategory: failed ? classifyFailureCode(a.errorCode) : null,
        attempts: a.attempts,
        retryable: failed && blocker === null,
        retryBlockedReason: blocker ? RETRY_BLOCKER_MESSAGES[blocker] : null,
        updatedAt: a.updatedAt,
        }
      }),
    },
  }
}
