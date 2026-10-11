/**
 * @file lib/alt-text/bulk-upload.ts
 * @module Publishing · Alt Text
 * @kind Client-safe library
 * @summary Phase 2 Task 6 — bounded-concurrency upload queue that sends Task 3 validated images one
 *   per request to the existing POST /api/alt-text/upload. Framework-free so scheduling, retry and
 *   cancellation rules are unit-testable. Server responses are the only source of asset IDs.
 */
import type { ApiResult } from "./client"
import type { BulkImageItem } from "./bulk-queue"
import type { BatchInfo, ImageOverride } from "./batch-settings"
import { buildBatchConfiguration, resolveEffectiveSettings } from "./batch-settings"
import type { GenerationSettings } from "./core"
import type { UploadedAsset } from "./upload"

export const BULK_UPLOAD_CONCURRENCY = 3
export const BULK_UPLOAD_MAX_ATTEMPTS = 3
const BASE_BACKOFF_MS = 1000
const MAX_BACKOFF_MS = 30_000

export type UploadStatus = "ready" | "uploading" | "uploaded" | "scan_pending" | "failed" | "cancelled"

export interface UploadEntry {
  localId: string
  file: File
  hash: string | null
  filename: string
  size: number
  /** Task 3 local verdict — kept separate from the server outcome. Only "valid" entries are queued. */
  validationStatus: BulkImageItem["status"]
  uploadStatus: UploadStatus
  assetId: number | null
  error?: string
  errorCode?: string
  attempts: number
}

export type Uploader = (file: File, signal: AbortSignal) => Promise<ApiResult<UploadedAsset>>

const TRANSIENT_STATUS = new Set([0, 408, 429, 500, 502, 503, 504])
const PERMANENT_CODES = new Set(["ABORTED"])
export const isTransientUploadError = (status: number, code: string) => TRANSIENT_STATUS.has(status) && !PERMANENT_CODES.has(code)
const isConfirmed = (s: UploadStatus) => s === "uploaded" || s === "scan_pending"

type EngineOptions = {
  upload: Uploader
  onChange: (entries: UploadEntry[]) => void
  concurrency?: number
  maxAttempts?: number
  baseDelayMs?: number
  schedule?: (fn: () => void, ms: number) => unknown
}

export function createBulkUploadEngine({
  upload,
  onChange,
  concurrency = BULK_UPLOAD_CONCURRENCY,
  maxAttempts = BULK_UPLOAD_MAX_ATTEMPTS,
  baseDelayMs = BASE_BACKOFF_MS,
  schedule = (fn, ms) => setTimeout(fn, ms),
}: EngineOptions) {
  const entries = new Map<string, UploadEntry>()
  /** Survives local removal so re-adding identical bytes reuses the confirmed asset. */
  const confirmedByHash = new Map<string, { assetId: number; uploadStatus: UploadStatus }>()
  const queue: string[] = []
  const controllers = new Map<string, AbortController>()
  const tokens = new Map<string, number>()
  let active = 0
  let pausedUntil = 0
  let wakeScheduled = false
  let accepting = false

  const emit = () => onChange(Array.from(entries.values()))
  const set = (id: string, patch: Partial<UploadEntry>) => {
    const current = entries.get(id)
    if (current) entries.set(id, { ...current, ...patch })
  }
  const enqueue = (id: string) => {
    if (!queue.includes(id)) queue.push(id)
  }

  function wakeAt(ms: number) {
    if (wakeScheduled) return
    wakeScheduled = true
    schedule(() => {
      wakeScheduled = false
      pump()
    }, ms)
  }

  async function run(id: string) {
    const entry = entries.get(id)!
    const token = (tokens.get(id) ?? 0) + 1
    tokens.set(id, token)
    const controller = new AbortController()
    controllers.set(id, controller)
    const attempts = entry.attempts + 1
    set(id, { uploadStatus: "uploading", error: undefined, errorCode: undefined, attempts })
    emit()

    const result = await upload(entry.file, controller.signal)
    controllers.delete(id)
    if (tokens.get(id) !== token || !entries.has(id)) return

    if (result.ok) {
      const uploadStatus: UploadStatus = result.data.scanStatus === "pending" ? "scan_pending" : "uploaded"
      set(id, { uploadStatus, assetId: result.data.id })
      if (entry.hash) confirmedByHash.set(entry.hash, { assetId: result.data.id, uploadStatus })
      return
    }
    const { status, code, message, details } = result.error
    if (code === "ABORTED") {
      set(id, { uploadStatus: "cancelled", errorCode: code, error: "Cancelled. The server may already have saved this image — retrying reuses it safely." })
      return
    }
    if (accepting && isTransientUploadError(status, code) && attempts < maxAttempts) {
      const retryAfter = typeof details?.retryAfter === "number" ? details.retryAfter * 1000 : 0
      const delay = Math.min(MAX_BACKOFF_MS, Math.max(retryAfter, baseDelayMs * 2 ** (attempts - 1)))
      if (status === 429) pausedUntil = Math.max(pausedUntil, Date.now() + delay)
      set(id, { uploadStatus: "ready", errorCode: code, error: `${message} Retrying…` })
      schedule(() => {
        if (!accepting || entries.get(id)?.uploadStatus !== "ready") return
        enqueue(id)
        pump()
      }, delay)
      return
    }
    set(id, { uploadStatus: "failed", errorCode: code, error: message })
  }

  function pump() {
    if (!accepting) return
    const wait = pausedUntil - Date.now()
    if (wait > 0) return wakeAt(wait)
    while (active < concurrency && queue.length) {
      const id = queue.shift()!
      if (entries.get(id)?.uploadStatus !== "ready") continue
      active++
      void run(id).finally(() => {
        active--
        emit()
        pump()
      })
    }
  }

  return {
    /** Mirrors the local queue: only Task 3 "valid" items become upload entries; removed items are dropped locally only. */
    sync(items: BulkImageItem[]) {
      const live = new Set<string>()
      let changed = false
      for (const item of items) {
        if (item.status !== "valid") continue
        live.add(item.id)
        if (entries.has(item.id)) continue
        const known = item.hash ? confirmedByHash.get(item.hash) : undefined
        entries.set(item.id, {
          localId: item.id,
          file: item.file,
          hash: item.hash ?? null,
          filename: item.name,
          size: item.size,
          validationStatus: item.status,
          uploadStatus: known?.uploadStatus ?? "ready",
          assetId: known?.assetId ?? null,
          attempts: 0,
        })
        changed = true
      }
      for (const id of entries.keys()) {
        if (live.has(id)) continue
        controllers.get(id)?.abort()
        entries.delete(id)
        changed = true
      }
      if (changed) emit()
    },
    start() {
      accepting = true
      for (const entry of entries.values()) if (entry.uploadStatus === "ready") enqueue(entry.localId)
      emit()
      pump()
    },
    retry(ids?: string[]) {
      const targets = ids ?? Array.from(entries.keys())
      for (const id of targets) {
        const entry = entries.get(id)
        if (!entry || (entry.uploadStatus !== "failed" && entry.uploadStatus !== "cancelled")) continue
        set(id, { uploadStatus: "ready", error: undefined, errorCode: undefined, attempts: 0 })
      }
      this.start()
    },
    /** Client-side only: stops scheduling and aborts in-flight requests; confirmed assets are kept. */
    cancel() {
      accepting = false
      queue.length = 0
      for (const entry of entries.values()) if (entry.uploadStatus === "ready") set(entry.localId, { uploadStatus: "cancelled", error: "Not uploaded — cancelled before sending." })
      for (const controller of controllers.values()) controller.abort()
      emit()
    },
    get running() {
      return accepting && (active > 0 || Array.from(entries.values()).some((e) => e.uploadStatus === "ready" || e.uploadStatus === "uploading"))
    },
    snapshot: () => Array.from(entries.values()),
  }
}

export type UploadSummary = Record<"total" | "uploaded" | "uploading" | "pending" | "failed" | "scanPending" | "cancelled", number>

export function summarizeUploads(entries: UploadEntry[]): UploadSummary {
  const s: UploadSummary = { total: entries.length, uploaded: 0, uploading: 0, pending: 0, failed: 0, scanPending: 0, cancelled: 0 }
  for (const e of entries) {
    if (e.uploadStatus === "uploaded") s.uploaded++
    else if (e.uploadStatus === "scan_pending") s.scanPending++
    else if (e.uploadStatus === "uploading") s.uploading++
    else if (e.uploadStatus === "failed") s.failed++
    else if (e.uploadStatus === "cancelled") s.cancelled++
    else s.pending++
  }
  return s
}

/** Task 7 input: one entry per server-confirmed asset, with Task 4 effective settings. */
export type UploadedBatchAsset = {
  localId: string
  assetId: number
  hash: string | null
  uploadStatus: Extract<UploadStatus, "uploaded" | "scan_pending">
  override: ImageOverride | null
  effectiveSettings: GenerationSettings
}

export function buildUploadedAssets(entries: UploadEntry[], defaults: GenerationSettings, overrides: Record<string, ImageOverride>) {
  const uploaded: UploadedBatchAsset[] = []
  for (const e of entries) {
    if (!isConfirmed(e.uploadStatus) || e.assetId == null) continue
    const override = overrides[e.localId] ?? null
    uploaded.push({
      localId: e.localId,
      assetId: e.assetId,
      hash: e.hash,
      uploadStatus: e.uploadStatus as UploadedBatchAsset["uploadStatus"],
      override,
      effectiveSettings: resolveEffectiveSettings(defaults, override ?? undefined),
    })
  }
  /** Scan-pending assets exist server-side but are not yet cleared for AI processing. */
  return { uploaded, readyToSubmit: uploaded.filter((a) => a.uploadStatus === "uploaded"), awaitingScan: uploaded.filter((a) => a.uploadStatus === "scan_pending") }
}

/** Body for POST /api/alt-text/batches — mirrors parseCreateBatchRequest in batch-submission.ts. */
export type CreateBatchPayload = {
  name: string
  description: string | null
  assetIds: number[]
  settings: GenerationSettings
  overrides: Record<string, ImageOverride>
}

export type BatchSubmissionPlan = { ok: true; payload: CreateBatchPayload; fingerprint: string } | { ok: false; reason: string }

const plural = (n: number, one: string, many: string) => `${n} image${n === 1 ? ` ${one}` : `s ${many}`}`

/**
 * Builds the create-batch request only when every valid image has a server asset ID that has
 * cleared scanning, and batch info, defaults and per-image overrides all validate. Overrides are
 * re-keyed from local IDs to server asset IDs. The fingerprint scopes the idempotency key.
 */
export function planBatchSubmission(
  validIds: readonly string[],
  entries: UploadEntry[],
  info: BatchInfo,
  defaults: GenerationSettings,
  overrides: Record<string, ImageOverride>,
): BatchSubmissionPlan {
  if (!validIds.length) return { ok: false, reason: "Add at least one valid image." }
  const config = buildBatchConfiguration(info, defaults, validIds, overrides)
  const batchError = config.errors.batch.name ?? config.errors.batch.description
  if (batchError) return { ok: false, reason: batchError }
  if (Object.keys(config.errors.settings).length) return { ok: false, reason: "Fix the common generation settings before starting." }
  const invalidImages = Object.keys(config.errors.images).length
  if (invalidImages) return { ok: false, reason: `${plural(invalidImages, "has", "have")} invalid custom settings.` }

  const byId = new Map(entries.map((e) => [e.localId, e]))
  const assetIds: number[] = []
  const assetOverrides: Record<string, ImageOverride> = {}
  let notUploaded = 0
  let scanPending = 0
  for (const id of validIds) {
    const e = byId.get(id)
    if (e?.uploadStatus === "scan_pending" && e.assetId != null) scanPending++
    else if (!e || e.uploadStatus !== "uploaded" || e.assetId == null) notUploaded++
    else {
      assetIds.push(e.assetId)
      if (config.overrides[id]) assetOverrides[String(e.assetId)] = config.overrides[id]
    }
  }
  if (notUploaded) return { ok: false, reason: `${plural(notUploaded, "is", "are")} not uploaded yet. Upload them before starting processing.` }
  if (scanPending) return { ok: false, reason: `${plural(scanPending, "is", "are")} awaiting the security scan. Processing can start once scanning finishes.` }
  if (new Set(assetIds).size !== assetIds.length) return { ok: false, reason: "Some images resolve to the same uploaded file. Remove the duplicates before starting." }

  const payload: CreateBatchPayload = {
    name: config.batchName,
    description: config.description || null,
    assetIds,
    settings: config.settings,
    overrides: assetOverrides,
  }
  return { ok: true, payload, fingerprint: JSON.stringify(payload) }
}
