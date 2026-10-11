/**
 * @file lib/alt-text/document-upload-queue.ts
 * @module Publishing · Alt Text
 * @kind Browser-safe library (framework-free)
 * @summary Phase 3 Task 3 — bounded-concurrency document upload queue. Each selected
 *   entry is uploaded once; duplicate starts are ignored, failed uploads retry
 *   individually, and removing an entry aborts its in-flight request.
 */
import type { ApiError, ApiResult } from "./client"
import { DOCUMENT_UPLOAD_LIMITS, type DocumentUploadReference } from "./document-upload-contract"

export type DocumentUploadState =
  | { phase: "queued" }
  | { phase: "uploading"; progress: number | null }
  | { phase: "uploaded"; reference: DocumentUploadReference }
  | { phase: "failed"; code: string; error: string }
  | { phase: "rejected"; code: string; error: string }

export type UploadFn = (file: File, onProgress: (percent: number) => void, signal: AbortSignal) => Promise<ApiResult<DocumentUploadReference>>

/** Errors the same bytes will always hit again; everything else (network, quota, rate limit, 5xx) is retryable. */
const PERMANENT_CODES = new Set([
  "UNSUPPORTED_TYPE",
  "LEGACY_FORMAT",
  "EMPTY_FILE",
  "FILE_TOO_LARGE",
  "CONTENT_MISMATCH",
  "INVALID_DOCUMENT",
  "ENCRYPTED_DOCUMENT",
  "MACROS_NOT_ALLOWED",
  "ACTIVE_CONTENT",
  "UNSAFE_ARCHIVE",
  "ARCHIVE_TOO_LARGE",
])

export function classifyUploadError(e: ApiError): "failed" | "rejected" {
  return PERMANENT_CODES.has(e.code) ? "rejected" : "failed"
}

const MIB = 1024 * 1024

/** Selection-level ceilings checked before any upload starts. */
export function selectionLimitError(files: { size: number }[]): string | null {
  if (files.length > DOCUMENT_UPLOAD_LIMITS.maxFiles) return `Select up to ${DOCUMENT_UPLOAD_LIMITS.maxFiles} documents at a time.`
  const total = files.reduce((n, f) => n + f.size, 0)
  if (total > DOCUMENT_UPLOAD_LIMITS.maxSelectionMb * MIB)
    return `The selected documents total more than ${DOCUMENT_UPLOAD_LIMITS.maxSelectionMb} MB. Remove some documents and try again.`
  return null
}

export function createDocumentUploadQueue(opts: {
  upload: UploadFn
  onChange: (states: ReadonlyMap<string, DocumentUploadState>) => void
  concurrency?: number
}) {
  const concurrency = Math.max(1, opts.concurrency ?? DOCUMENT_UPLOAD_LIMITS.maxConcurrentUploads)
  const states = new Map<string, DocumentUploadState>()
  const waiting: { id: string; file: File }[] = []
  const controllers = new Map<string, AbortController>()
  let active = 0

  const emit = () => opts.onChange(new Map(states))
  const set = (id: string, state: DocumentUploadState) => {
    states.set(id, state)
    emit()
  }

  async function run(id: string, file: File) {
    const controller = new AbortController()
    controllers.set(id, controller)
    active++
    set(id, { phase: "uploading", progress: null })
    let res: ApiResult<DocumentUploadReference>
    try {
      res = await opts.upload(
        file,
        (progress) => {
          if (controllers.get(id) === controller) set(id, { phase: "uploading", progress })
        },
        controller.signal,
      )
    } catch {
      // A throwing transport must not leak the concurrency slot or strand the entry in "uploading".
      res = { ok: false, error: { status: 0, code: "NETWORK_ERROR", message: "The upload was interrupted. Check your connection and retry." } }
    }
    active--
    if (controllers.get(id) === controller) {
      controllers.delete(id)
      if (res.ok) set(id, { phase: "uploaded", reference: res.data })
      else set(id, { phase: classifyUploadError(res.error), code: res.error.code, error: res.error.message })
    }
    pump()
  }

  function pump() {
    while (active < concurrency && waiting.length) {
      const next = waiting.shift()!
      void run(next.id, next.file)
    }
  }

  /** Queue entries that have not started, or whose previous attempt failed. Returns the ids actually queued. */
  function enqueue(items: { id: string; file: File }[]): string[] {
    const queued: string[] = []
    for (const item of items) {
      const phase = states.get(item.id)?.phase
      if (phase && phase !== "failed") continue
      states.set(item.id, { phase: "queued" })
      waiting.push(item)
      queued.push(item.id)
    }
    if (queued.length) emit()
    pump()
    return queued
  }

  /** Drop an entry: removes it from the wait list and aborts its request if one is in flight. */
  function forget(id: string) {
    const idx = waiting.findIndex((w) => w.id === id)
    if (idx >= 0) waiting.splice(idx, 1)
    const controller = controllers.get(id)
    controllers.delete(id)
    controller?.abort()
    if (states.delete(id)) emit()
  }

  function forgetAll() {
    waiting.length = 0
    for (const c of controllers.values()) c.abort()
    controllers.clear()
    states.clear()
    emit()
  }

  return { enqueue, forget, forgetAll, get: (id: string) => states.get(id), get activeCount() { return active } }
}

export type DocumentUploadQueue = ReturnType<typeof createDocumentUploadQueue>
