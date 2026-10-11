/**
 * @file lib/alt-text/batch-dashboard.ts
 * @module Publishing · Alt Text
 * @kind Client-safe library
 * @summary Phase 2 Task 12 — polling, backoff and label helpers for the live batch dashboard.
 *   Contracts are the Task 11 progress/assets responses; no values are derived beyond display labels.
 */
import type { BatchAssetStatusList, BatchProgressView } from "./batch-progress"
import type { BatchStatus } from "./store"

export type { BatchAssetStatusList, BatchAssetStatusView, BatchProgressView } from "./batch-progress"

export const BATCH_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const DEFAULT_POLL_MS = 5000
export const MAX_BACKOFF_MS = 60_000
export const MAX_ERROR_RETRIES = 6
/** Filters accepted by GET /api/alt-text/batches/[id]/assets. Filename search is not supported by the API. */
export const ASSET_FILTERS = { all: "All statuses", pending: "Pending", processing: "Processing", completed: "Completed", failed: "Failed" } as const
export type AssetFilter = keyof typeof ASSET_FILTERS

export const BATCH_STATUS_LABELS: Record<BatchStatus, string> = {
  draft: "Draft",
  queued: "Queued",
  processing: "Processing",
  pause_requested: "Pause requested",
  paused: "Paused",
  cancel_requested: "Cancel requested",
  completed: "Completed",
  partially_completed: "Partially completed",
  failed: "Failed",
  cancelled: "Cancelled",
}

export const TERMINAL_BATCH_STATUSES: readonly BatchStatus[] = ["completed", "partially_completed", "failed", "cancelled"]
export const isTerminalBatch = (s: BatchStatus) => TERMINAL_BATCH_STATUSES.includes(s)

export const progressUrl = (batchId: string) => `/api/alt-text/batches/${encodeURIComponent(batchId)}/progress`
export function assetsUrl(batchId: string, page: number, pageSize: number, filter: AssetFilter) {
  const sp = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
  if (filter !== "all") sp.set("status", filter)
  return `/api/alt-text/batches/${encodeURIComponent(batchId)}/assets?${sp}`
}

export class BatchApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message)
    this.name = "BatchApiError"
  }
}

const FALLBACK: Record<number, string> = {
  401: "Your session has expired. Sign in again.",
  403: "You do not have permission to view this batch.",
  404: "Batch not found.",
  429: "Too many requests. Live refresh slowed down.",
}

export async function fetchBatchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, { credentials: "same-origin", cache: "no-store", signal })
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw new BatchApiError(0, "ABORTED", "Request cancelled.")
    throw new BatchApiError(0, "NETWORK_ERROR", "Network error. Check your connection.")
  }
  const body = (await res.json().catch(() => null)) as { success?: boolean; code?: string; error?: string } | null
  if (res.ok && body?.success === true) return body as T
  const retryAfter = Number(res.headers.get("Retry-After"))
  throw new BatchApiError(
    res.status,
    body?.code ?? `HTTP_${res.status}`,
    body?.error || FALLBACK[res.status] || "The progress service is temporarily unavailable.",
    Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : null,
  )
}

/** Client errors that a retry cannot fix. */
export const isPermanentError = (e: BatchApiError) => e.code === "ABORTED" || [400, 401, 403, 404].includes(e.status)

/** Bounded exponential backoff; honours Retry-After for 429. Returns null when retries should stop. */
export function errorRetryDelay(e: BatchApiError, retryCount: number, baseMs = DEFAULT_POLL_MS): number | null {
  if (isPermanentError(e) || retryCount > MAX_ERROR_RETRIES) return null
  const exp = Math.min(MAX_BACKOFF_MS, baseMs * 2 ** Math.max(0, retryCount - 1))
  return Math.min(MAX_BACKOFF_MS, Math.max(exp, e.retryAfterMs ?? 0))
}

/** Poll only while the server says the batch is active; terminal/draft batches stop. */
export const pollInterval = (view: BatchProgressView | undefined) =>
  view && view.isActive && !isTerminalBatch(view.status) ? (view.pollIntervalMs ?? DEFAULT_POLL_MS) : 0

export type ProgressSegments = { completedPct: number; failedPct: number; remaining: number }
/** Bar segments from backend counts. Success and failure are separate; remaining = pending + processing + other. */
export function progressSegments(v: Pick<BatchProgressView, "total" | "completed" | "failed">): ProgressSegments {
  const pct = (n: number) => (v.total > 0 ? (n / v.total) * 100 : 0)
  return { completedPct: pct(v.completed), failedPct: pct(v.failed), remaining: Math.max(0, v.total - v.completed - v.failed) }
}

export type SyncNotice = { tone: "info" | "warning" | "error"; title: string; message: string } | null
export function syncNotice(v: BatchProgressView): SyncNotice {
  if (v.total === 0) return { tone: "info", title: "Empty batch", message: "This batch has no images." }
  switch (v.syncState) {
    case "deferred":
      return { tone: "warning", title: "Waiting to resume", message: "Processing is deferred (AI credits, rate limits or worker capacity). Progress resumes automatically." }
    case "stalled":
      return { tone: "warning", title: "Worker progress is stale", message: "No active worker has reported progress recently. Counts below are the last persisted values." }
    case "settling":
      return { tone: "info", title: "Finalizing", message: "All images are processed; the batch status is being finalized." }
    case "out_of_sync":
      return { tone: "warning", title: "Status out of sync", message: "Image records changed after the batch finished (for example, a retry)." }
  }
  if (v.status === "failed" && v.completed === 0 && v.failed > 0) return { tone: "error", title: "All images failed", message: "No image was processed successfully. Review the error reasons below." }
  if (v.status === "partially_completed") return { tone: "warning", title: "Partially completed", message: `${v.failed} image${v.failed === 1 ? "" : "s"} failed. Retry Failed becomes available in a later release.` }
  return null
}

export const totalPages = (list: Pick<BatchAssetStatusList, "total" | "pageSize"> | undefined) =>
  list ? Math.max(1, Math.ceil(list.total / list.pageSize)) : 1
