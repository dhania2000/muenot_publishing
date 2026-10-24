/**
 * @file lib/alt-text/client.ts
 * @module Publishing · Alt Text
 * @kind Browser API client
 * @summary Typed wrappers for the existing /api/alt-text upload, generate, edit and export routes.
 *   Contracts mirror lib/alt-text/{upload,generate,history,export}.ts — no tenant ids or storage paths are sent.
 */
import type { CreateBatchPayload } from "./bulk-upload"
import type { AltTextResult, GenerationSettings } from "./core"
import type { DocumentImageContext } from "./document-context"
import { imageListSearchParams, type ImageListQuery, type ImageMutationRequest, type ImageMutationResponse } from "./document-image-review"
import type { DocumentPreparationProgress } from "./document-preparation-contract"
import type { DocumentRecord } from "./document-records"
import type { DocumentUploadReference } from "./document-upload-contract"
import type { ExportFormat } from "./export"
import type { AltTextAssetView } from "./history"
import type { UploadedAsset } from "./upload"

export type ApiError = { status: number; code: string; message: string; details?: Record<string, unknown> }
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError }

export type GenerateResponse = {
  success: true
  assetId: number
  status: string
  replayed: boolean
  version: number
  result: Pick<AltTextResult, "classification" | "shortAlt" | "longDescription" | "extractedText" | "warnings" | "treatment">
  usage: { requestId: string | null; model: string; creditsReserved: number; creditsCharged: number | null; status: string }
}

export type EditPayload = { expectedVersion: number; shortAlt?: string; longDescription?: string }

const CREDIT_CODES = /BUDGET_EXCEEDED|TOKEN_LIMIT_EXCEEDED|INSUFFICIENT/

const FALLBACK_MESSAGES: Record<number, string> = {
  400: "The request was invalid.",
  401: "Your session has expired. Sign in again.",
  402: "Not enough AI credits to generate alt text.",
  403: "You do not have permission to perform this action.",
  404: "The image could not be found.",
  409: "This image changed on the server.",
  413: "The file is too large.",
  415: "This file type is not supported.",
  429: "Too many requests. Please wait and try again.",
  500: "Something went wrong on the server. Please try again.",
  503: "The service is temporarily unavailable. Please try again.",
}

export function isCreditError(e: ApiError) {
  return e.status === 402 || CREDIT_CODES.test(e.code)
}

export function isPermissionError(e: ApiError) {
  return e.status === 401 || e.status === 403
}

export function toApiError(status: number, body: unknown): ApiError {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {}
  const code = typeof b.code === "string" ? b.code : status === 0 ? "NETWORK_ERROR" : `HTTP_${status}`
  const message =
    typeof b.error === "string" && b.error
      ? b.error
      : status === 0
        ? "Network error. Check your connection and try again."
        : (FALLBACK_MESSAGES[status] ?? "The request failed.")
  const { success: _s, error: _e, code: _c, ...details } = b
  return { status, code, message, ...(Object.keys(details).length ? { details } : {}) }
}

async function readJson(res: Response) {
  try {
    return await res.json()
  } catch {
    return null
  }
}

async function requestJson<T>(url: string, init: RequestInit): Promise<ApiResult<T>> {
  let res: Response
  try {
    res = await fetch(url, { credentials: "same-origin", ...init })
  } catch {
    return { ok: false, error: toApiError(0, null) }
  }
  const body = await readJson(res)
  if (!res.ok || !body || (body as { success?: unknown }).success !== true) return { ok: false, error: toApiError(res.status, body) }
  return { ok: true, data: body as T }
}

/** Multipart upload via XHR so real byte progress can be reported. */
export function uploadAltTextImage(
  file: File,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
  options?: { reuseExisting?: boolean; timeoutMs?: number },
): Promise<ApiResult<UploadedAsset>> {
  return xhrUpload<UploadedAsset>("/api/alt-text/upload", "asset", file, onProgress, signal, options)
}

/** Single-document upload (PDF/PPTX/DOCX) with real byte progress. Identical retries reuse the stored document server-side. */
export function uploadAltTextDocument(file: File, onProgress?: (percent: number) => void, signal?: AbortSignal, options?: { timeoutMs?: number }) {
  return xhrUpload<DocumentUploadReference>("/api/alt-text/documents/upload", "document", file, onProgress, signal, options)
}

export const documentStatusUrl = (uploadId: string) => `/api/alt-text/documents/${encodeURIComponent(uploadId)}`

export const DOCUMENT_LIST_PREFIX = "/api/alt-text/documents?"
export const documentListUrl = (page: number, pageSize: number) =>
  `${DOCUMENT_LIST_PREFIX}${new URLSearchParams({ page: String(page), pageSize: String(pageSize) })}`

function xhrUpload<T>(
  url: string,
  field: "asset" | "document",
  file: File,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
  options?: { reuseExisting?: boolean; timeoutMs?: number },
): Promise<ApiResult<T>> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve({ ok: false, error: { status: 0, code: "ABORTED", message: "Upload cancelled." } })
    const xhr = new XMLHttpRequest()
    const form = new FormData()
    form.append("file", file)
    if (options?.reuseExisting) form.append("reuseExisting", "1")
    xhr.open("POST", url)
    xhr.withCredentials = true
    if (options?.timeoutMs) xhr.timeout = options.timeoutMs
    xhr.ontimeout = () => resolve({ ok: false, error: { status: 0, code: "TIMEOUT", message: "The upload timed out." } })
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => {
      let body: unknown = null
      try {
        body = JSON.parse(xhr.responseText)
      } catch {}
      const payload = (body as Record<string, T | undefined> | null)?.[field]
      if (xhr.status >= 200 && xhr.status < 300 && payload) resolve({ ok: true, data: payload })
      else {
        const error = toApiError(xhr.status, body)
        const retryAfter = Number(xhr.getResponseHeader("Retry-After"))
        resolve({ ok: false, error: Number.isFinite(retryAfter) && retryAfter > 0 ? { ...error, details: { ...error.details, retryAfter } } : error })
      }
    }
    xhr.onerror = () => resolve({ ok: false, error: toApiError(0, null) })
    xhr.onabort = () => resolve({ ok: false, error: { status: 0, code: "ABORTED", message: "Upload cancelled." } })
    signal?.addEventListener("abort", () => xhr.abort(), { once: true })
    xhr.send(form)
  })
}

export const documentReviewImagesUrl = (documentId: number, q: Partial<ImageListQuery>) =>
  `/api/alt-text/documents/${documentId}/images?${imageListSearchParams(q)}`

export const documentSelectionSnapshotUrl = (documentId: number) => `/api/alt-text/documents/${documentId}/images/selection`

/** Persisted selection / source-review update. Resolves only with the server-confirmed outcome. */
export function updateDocumentImages(documentId: number, body: ImageMutationRequest) {
  return requestJson<ImageMutationResponse>(`/api/alt-text/documents/${documentId}/images`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

export const documentDetailUrl = (documentId: number) => `/api/alt-text/documents/${documentId}`

export type DocumentDetailResponse = { success: true; document: DocumentRecord; preparation: DocumentPreparationProgress }

/** Enqueue (or reuse) the durable preparation job. Resolves once the queue accepted it (HTTP 202). */
export function startDocumentPreparation(documentId: number) {
  return requestJson<{ success: true; jobId: number; created: boolean; preparation: DocumentPreparationProgress }>(
    `/api/alt-text/documents/${documentId}/process`,
    { method: "POST" },
  )
}

export function cancelDocumentPreparation(documentId: number) {
  return requestJson<{ success: true; result: "cancelled" | "cancel_requested"; jobId: number; preparation: DocumentPreparationProgress }>(
    `/api/alt-text/documents/${documentId}/process`,
    { method: "DELETE" },
  )
}

export const documentImageContextUrl = (documentId: number, imageId: number) =>
  `/api/alt-text/documents/${documentId}/context?${new URLSearchParams({ imageId: String(imageId) })}`

export type ContextAnalysisResponse = {
  success: true
  summary: { analyzed: number; unavailable: number; failed: number; total: number }
  context?: DocumentImageContext | null
}

/** GET response of the context endpoint (stored context only; reading never runs analysis). */
export type DocumentImageContextResponse = {
  success: true
  imageId: number
  status: "analyzed" | "unavailable" | "failed" | "not_analyzed"
  analyzedAt: string | null
  stale: boolean
  context: DocumentImageContext | null
}

export function analyzeDocumentContext(documentId: number, imageId?: number) {
  return requestJson<ContextAnalysisResponse>(`/api/alt-text/documents/${documentId}/context`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(imageId != null ? { imageId } : {}),
  })
}

export function newRequestId() {
  return `alt-${crypto.randomUUID().replace(/-/g, "")}`.slice(0, 40)
}

export function generateAltText(assetId: number, settings: GenerationSettings, requestId: string) {
  return requestJson<GenerateResponse>("/api/alt-text/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assetId, settings, requestId }),
  })
}

export type CreateBatchResponse = {
  success: true
  replayed: boolean
  batch: { id: string; name: string; status: string; totalImages: number; createdAt: string }
}

export type SubmitBatchResponse = {
  success: true
  batchId: string
  jobId: number | null
  submissionStatus: "queued"
  acceptedImageCount: number
  message: string
}

/** Matches IDEMPOTENCY_KEY in batch-submission.ts (8–80 chars of [A-Za-z0-9_-]). */
export function newIdempotencyKey() {
  return `batch-${crypto.randomUUID().replace(/-/g, "")}`
}

export function createAltTextBatch(payload: CreateBatchPayload, idempotencyKey: string) {
  return requestJson<CreateBatchResponse>("/api/alt-text/batches", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(payload),
  })
}

export function submitAltTextBatch(batchId: string) {
  return requestJson<SubmitBatchResponse>(`/api/alt-text/batches/${encodeURIComponent(batchId)}/submit`, { method: "POST" })
}

export type DocumentGenerationResponse = {
  success: true
  documentId: number
  batchId: string
  jobId: number | null
  replayed: boolean
  submissionStatus: "queued"
  acceptedImageCount: number
  skippedImageCount: number
  message: string
}

/** Queue alt text generation for the document's selected, eligible occurrences (Phase 2 batch, HTTP 202). */
export function generateDocumentAltText(documentId: number, idempotencyKey: string, settings?: GenerationSettings) {
  return requestJson<DocumentGenerationResponse>(`/api/alt-text/documents/${documentId}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(settings ? { settings } : {}),
  })
}

export function describeBatchError(e: ApiError): string {
  if (e.code === "NO_ELIGIBLE_IMAGES") return "Select at least one eligible image before generating alt text."
  if (e.code === "ALREADY_QUEUED") return "Some selected images are already queued in another generation batch."
  if (e.code === "DOCUMENT_NOT_CLEAN") return "This document has not passed the security scan."
  if (e.code === "ASSETS_NOT_CLEARED") return "Some images have not passed the security scan yet. Wait for scanning to finish, then retry."
  if (isCreditError(e)) return "Not enough AI credits to process this batch. Add credits or reduce the batch size, then retry."
  if (e.status === 401) return "Your session has expired. Sign in again, then retry."
  if (isPermissionError(e)) return e.message || "You do not have permission to process this batch."
  if (e.code === "RATE_LIMITED") return "Too many requests. Please wait a moment and retry."
  return e.message
}

export function getAltTextAsset(assetId: number) {
  return requestJson<{ success: true; asset: AltTextAssetView }>(`/api/alt-text/assets/${assetId}`, { method: "GET", cache: "no-store" })
}

export const isScanPending = (e: ApiError) => e.code === "SCAN_PENDING"

export function saveAltTextEdit(assetId: number, payload: EditPayload) {
  return requestJson<{ success: true; asset: AltTextAssetView }>(`/api/alt-text/assets/${assetId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
}

export function isVersionConflict(e: ApiError) {
  return e.status === 409 && e.code === "VERSION_CONFLICT"
}

/** Thrown by the SWR fetcher so components receive the mapped ApiError. */
export class AltTextApiError extends Error {
  constructor(readonly apiError: ApiError) {
    super(apiError.message)
    this.name = "AltTextApiError"
  }
}

export async function altTextFetcher<T>(url: string): Promise<T> {
  const r = await requestJson<T>(url, { method: "GET" })
  if (!r.ok) throw new AltTextApiError(r.error)
  return r.data
}

export type HistorySort = "newest" | "oldest"
export type HistoryQuery = { page: number; pageSize: number; search?: string; status?: string; classification?: string; sort: HistorySort }

/** Builds the GET /api/alt-text/assets URL using only parameters the backend supports. */
export function historyListUrl(q: HistoryQuery) {
  const sp = new URLSearchParams({ page: String(q.page), pageSize: String(q.pageSize), sort: q.sort })
  const search = q.search?.trim()
  if (search) sp.set("search", search.slice(0, 200))
  if (q.status) sp.set("status", q.status)
  if (q.classification) sp.set("classification", q.classification)
  return `/api/alt-text/assets?${sp}`
}

export const assetUrl = (id: number) => `/api/alt-text/assets/${id}`
export const assetVersionsUrl = (id: number) => `/api/alt-text/assets/${id}/versions`
/** SWR key matcher for every cached Alt Text asset request (list, detail, versions). */
export const isAltTextAssetKey = (key: unknown) => typeof key === "string" && key.startsWith("/api/alt-text/assets")

export function altTextImageUrl(assetId: number) {
  return `/api/alt-text/assets/${assetId}/image`
}

function filenameFrom(disposition: string | null, fallback: string) {
  const match = disposition?.match(/filename="?([^";]+)"?/i)
  return match?.[1] ?? fallback
}

/** Fetches the export as a Blob; the caller triggers the download only on success. */
export async function fetchAltTextExport(assetId: number, format: ExportFormat): Promise<ApiResult<{ blob: Blob; filename: string }>> {
  let res: Response
  try {
    res = await fetch(`/api/alt-text/export?assetId=${assetId}&format=${format}`, { credentials: "same-origin" })
  } catch {
    return { ok: false, error: toApiError(0, null) }
  }
  if (!res.ok) return { ok: false, error: toApiError(res.status, await readJson(res)) }
  const blob = await res.blob()
  return { ok: true, data: { blob, filename: filenameFrom(res.headers.get("content-disposition"), `alt-text-${assetId}.${format}`) } }
}

export function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
