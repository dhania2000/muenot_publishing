/**
 * @file lib/alt-text/document-extraction-run.ts
 * @module Publishing · Alt Text
 * @kind Server-side library
 * @summary Phase 3 — format-independent parts of a synchronous document extraction run, shared
 *   by the PPTX (Task 5) and PDF (Task 7) extractors: security re-check, per-document claim,
 *   bounded private download with checksum verification, media storage with within-run and
 *   per-document dedupe, Alt Text asset creation/linking, worker pool and status finalisation.
 */
import "server-only"
import { createHash, randomUUID } from "node:crypto"
import { deleteFile, downloadFile, uploadFile } from "@/lib/storage"
import { getFileById } from "@/lib/storage/file-metadata"
import { getScanForFile } from "@/lib/storage/file-scanning"
import { keyBelongsToTenant } from "@/lib/storage/keys"
import { getUploadLimits } from "@/lib/settings/uploads"
import { currentTenantId } from "@/lib/tenant-scope"
import { validateImage } from "./core"
import { deriveDocumentSecurity } from "./document-upload-contract"
import type { DocumentExtractionCounts, DocumentImageRecord, DocumentRecord, DocumentRecordProcessingStatus, DocumentType } from "./document-records"
import { getDocumentForExtraction, toPublicDocument } from "./document-service"
import {
  claimDocumentExtraction,
  countDocumentImages,
  findDocumentMediaStorageKey,
  getDocument,
  updateDocumentImageMapping,
  updateDocumentStatus,
  type DocumentOwnerScope,
  type StoredDocument,
} from "./document-store"
import type { PdfExtractionReport } from "./pdf-package"
import type { PptxNotExtracted } from "./pptx-package"
import { ALT_TEXT_STORAGE_PREFIX, ALT_TEXT_UPLOAD_MAX_MB, hasCompleteImageStructure, safeDisplayName } from "./upload"
import { createAsset, deleteAsset, getSettings } from "./store"

export const MIB = 1024 * 1024

export type ExtractionSummary = {
  document: DocumentRecord
  /** True when the document was already fully processed and nothing was re-run. */
  alreadyProcessed: boolean
  totalSlides: number | null
  /** PDF page count (null for presentations or when nothing was re-run). */
  totalPages?: number | null
  counts: DocumentExtractionCounts
  notExtracted: PptxNotExtracted | null
  /** PDF-only: tagging, vector-only pages and parser limitations encountered. */
  pdfReport?: PdfExtractionReport | null
  /** Occurrences that could not even be recorded (rare; e.g. a database error). */
  unrecorded: number
}

export type ExtractionFailure = { ok: false; status: 404 | 409 | 413 | 415 | 422 | 500 | 503; code: string; error: string }
export type ExtractionResult = { ok: true; summary: ExtractionSummary } | ExtractionFailure

export const fail = (status: ExtractionFailure["status"], code: string, error: string): ExtractionFailure => ({ ok: false, status, code, error })
const NOT_FOUND = () => fail(404, "NOT_FOUND", "The document could not be found.")
const NOT_CLEAN = () => fail(409, "DOCUMENT_NOT_CLEAN", "The document has not passed the security scan.")

export const logName = (err: unknown) => (err instanceof Error ? err.name : "unknown")

export async function readBody(body: unknown, cap: number): Promise<Buffer | null> {
  if (!body) return null
  if (body instanceof ReadableStream) {
    const reader = body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > cap) {
        await reader.cancel().catch(() => {})
        return null
      }
      chunks.push(value)
    }
    return Buffer.concat(chunks)
  }
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body as Uint8Array)
  return buf.length > cap ? null : buf
}

/** Final document status derived only from persisted occurrence counts. */
export function deriveDocumentProcessingStatus(c: DocumentExtractionCounts): DocumentRecordProcessingStatus {
  if (c.total === 0) return "extracted"
  if (c.pending > 0 || c.failed > 0) return c.extracted > 0 ? "partially_extracted" : "failed"
  if (c.extracted === 0) return "unsupported"
  return c.unsupported > 0 ? "partially_extracted" : "extracted"
}

export async function summarize(doc: StoredDocument, extra: Omit<ExtractionSummary, "document" | "counts">): Promise<{ ok: true; summary: ExtractionSummary }> {
  const [fresh, counts] = await Promise.all([getDocument(doc.id, null), countDocumentImages(doc.id)])
  return { ok: true, summary: { document: toPublicDocument(fresh ?? doc), counts, ...extra } }
}

/** Fail the run with a document-level error (status is left retryable as `failed`). */
export async function failRun(doc: StoredDocument, f: ExtractionFailure): Promise<ExtractionFailure> {
  await updateDocumentStatus(doc.id, "failed", { code: f.code, message: f.error }).catch((err) => console.error("[alt-text/extract] status update failed", logName(err)))
  return f
}

export type OpenedDocument =
  | { ok: true; kind: "claimed"; doc: StoredDocument; bytes: Buffer }
  | { ok: true; kind: "done"; doc: StoredDocument }
  | ExtractionFailure

/**
 * Authorise, re-check security, claim the per-document lock and read the verified original.
 * After `claimed`, the caller owns the run and must finalise it (or call failRun).
 */
export async function openDocumentForExtraction(
  documentId: number,
  scope: DocumentOwnerScope,
  type: DocumentType,
  opts: { maxDocumentBytes: number; noun: string },
): Promise<OpenedDocument> {
  const doc = await getDocumentForExtraction(documentId, scope)
  if (!doc) return NOT_FOUND()
  if (doc.documentType !== type) return fail(415, "UNSUPPORTED_DOCUMENT_TYPE", `This document is not a ${type.toUpperCase()} file.`)
  if (doc.securityStatus !== "clean") return NOT_CLEAN()
  if (doc.processingStatus === "extracted" || doc.processingStatus === "unsupported") return { ok: true, kind: "done", doc }
  if (doc.size > opts.maxDocumentBytes) {
    return fail(413, "REQUIRES_BACKGROUND_PROCESSING", `This ${opts.noun} is too large to extract now. Background processing is not available yet.`)
  }

  const file = await getFileById(doc.fileObjectId)
  if (!file || file.fileRef !== doc.storageReferenceId || file.uploadStatus === "deleted" || !keyBelongsToTenant(file.objectKey, currentTenantId())) return NOT_FOUND()
  if (deriveDocumentSecurity(await getScanForFile(file.id)).securityStatus !== "clean") return NOT_CLEAN()

  const claim = await claimDocumentExtraction(doc.id)
  if (!claim.ok) {
    if (claim.code === "CONFLICT") return fail(409, "EXTRACTION_IN_PROGRESS", claim.message)
    if (claim.code === "DOCUMENT_NOT_CLEAN") return NOT_CLEAN()
    if (claim.code === "NOT_FOUND") return NOT_FOUND()
    return fail(409, "INVALID_STATE", claim.message)
  }

  let object: Awaited<ReturnType<typeof downloadFile>>
  try {
    object = await downloadFile(file.objectKey)
  } catch (err) {
    console.error("[alt-text/extract] storage read failed", logName(err))
    return failRun(doc, fail(503, "STORAGE_UNAVAILABLE", "Document storage is temporarily unavailable. Please try again."))
  }
  const bytes = await readBody(object?.body, opts.maxDocumentBytes).catch(() => null)
  if (!bytes || bytes.length !== doc.size) return failRun(doc, fail(422, "INVALID_DOCUMENT", "The stored document could not be read."))
  if (file.checksum && createHash("sha256").update(bytes).digest("hex") !== file.checksum) {
    return failRun(doc, fail(422, "INTEGRITY_MISMATCH", "The stored document does not match the uploaded original."))
  }
  return { ok: true, kind: "claimed", doc, bytes }
}

/**
 * Phase 3 Task 9: read the verified private original without claiming the extraction lock
 * (context analysis only reads; it never changes document or occurrence extraction state).
 */
export async function readVerifiedOriginal(doc: StoredDocument, maxDocumentBytes: number): Promise<{ ok: true; bytes: Buffer } | ExtractionFailure> {
  if (doc.size > maxDocumentBytes) return fail(413, "REQUIRES_BACKGROUND_PROCESSING", "This document is too large to analyze now.")
  const file = await getFileById(doc.fileObjectId)
  if (!file || file.fileRef !== doc.storageReferenceId || file.uploadStatus === "deleted" || !keyBelongsToTenant(file.objectKey, currentTenantId())) return NOT_FOUND()
  if (deriveDocumentSecurity(await getScanForFile(file.id)).securityStatus !== "clean") return NOT_CLEAN()
  let object: Awaited<ReturnType<typeof downloadFile>>
  try {
    object = await downloadFile(file.objectKey)
  } catch (err) {
    console.error("[alt-text/context] storage read failed", logName(err))
    return fail(503, "STORAGE_UNAVAILABLE", "Document storage is temporarily unavailable. Please try again.")
  }
  const bytes = await readBody(object?.body, maxDocumentBytes).catch(() => null)
  if (!bytes || bytes.length !== doc.size) return fail(422, "INVALID_DOCUMENT", "The stored document could not be read.")
  if (file.checksum && createHash("sha256").update(bytes).digest("hex") !== file.checksum) {
    return fail(422, "INTEGRITY_MISMATCH", "The stored document does not match the uploaded original.")
  }
  return { ok: true, bytes }
}

export type RunSettings = {
  doc: StoredDocument
  maxImageBytes: number
  language: string
  audience: string
  /** Within-run dedupe of identical media so concurrent occurrences upload once. */
  stored: Map<string, Promise<string | null>>
}

export async function loadRunSettings(doc: StoredDocument): Promise<RunSettings> {
  const [settings, limits] = await Promise.all([getSettings(), getUploadLimits()])
  return {
    doc,
    maxImageBytes: Math.min(settings.maxFileMb * MIB, ALT_TEXT_UPLOAD_MAX_MB * MIB, limits.maxBytes),
    language: settings.defaultLanguage,
    audience: settings.defaultAudience,
    stored: new Map(),
  }
}

async function storeMedia(ctx: RunSettings, bytes: Uint8Array, sha: string, mimeType: string, ext: string, filename: string): Promise<string | null> {
  const existing = await findDocumentMediaStorageKey(ctx.doc.id, sha)
  if (existing) return existing
  const path = `${ALT_TEXT_STORAGE_PREFIX}/${ctx.doc.uploadedBy}/${randomUUID()}.${ext}`
  const up = await uploadFile(path, new File([new Uint8Array(bytes)], filename, { type: mimeType }), {
    skipValidation: true,
    metadata: { module: "publishing", entityType: "alt_text_asset", ownerId: ctx.doc.uploadedBy, classification: "confidential" },
  })
  if (!up.ok) return null
  if (!up.result.file) {
    await deleteFile(up.result.key).catch((err) => console.error("[alt-text/extract] cleanup failed", logName(err)))
    return null
  }
  return up.result.key
}

export const IMAGE_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }

export type FinishOccurrence = (status: "failed" | "unsupported", code: string, message: string, extra?: { mediaSha256?: string }) => Promise<boolean>

export function occurrenceFinisher(doc: StoredDocument, image: DocumentImageRecord): FinishOccurrence {
  return (status, code, message, extra = {}) =>
    updateDocumentImageMapping(doc.id, image.id, { extractionStatus: status, extractionError: { code, message }, ...extra }).then(() => true)
}

/**
 * Validate a pipeline-ready image (JPEG/PNG/WEBP), store it once per run/document, create the
 * regular Alt Text asset and link it to the occurrence. Never generates or approves alt text.
 */
export async function persistOccurrenceImage(
  ctx: RunSettings,
  image: DocumentImageRecord,
  input: { bytes: Uint8Array; mimeType: "image/jpeg" | "image/png" | "image/webp"; label: string },
): Promise<boolean> {
  const finish = occurrenceFinisher(ctx.doc, image)
  const { bytes, mimeType } = input
  const sha = createHash("sha256").update(bytes).digest("hex")
  const filename = safeDisplayName(`${input.label}.${IMAGE_EXT[mimeType]}`)
  const validation = validateImage({ type: mimeType, size: bytes.length, name: filename }, bytes, ctx.maxImageBytes / MIB)
  if (!validation.ok) return finish("unsupported", "IMAGE_LIMITS", validation.error, { mediaSha256: sha })
  if (!hasCompleteImageStructure(bytes, mimeType)) return finish("failed", "INVALID_IMAGE", "The embedded image is incomplete or corrupt.", { mediaSha256: sha })

  let pending = ctx.stored.get(sha)
  if (!pending) {
    pending = storeMedia(ctx, bytes, sha, mimeType, IMAGE_EXT[mimeType], filename)
    ctx.stored.set(sha, pending)
  }
  const key = await pending.catch((err) => {
    console.error("[alt-text/extract] storage write failed", logName(err))
    return null
  })
  if (!key) {
    ctx.stored.delete(sha)
    return finish("failed", "STORAGE_ERROR", "The image could not be stored. Retry extraction.", { mediaSha256: sha })
  }

  let assetId: number
  try {
    assetId = await createAsset({
      projectId: ctx.doc.projectId,
      batchId: null,
      fileName: filename,
      mimeType,
      sizeBytes: bytes.length,
      storageKey: key,
      storageUrl: key,
      context: "",
      language: ctx.language,
      audience: ctx.audience,
      createdBy: ctx.doc.uploadedBy,
    })
  } catch (err) {
    console.error("[alt-text/extract] asset creation failed", logName(err))
    return finish("failed", "ASSET_ERROR", "The image could not be saved. Retry extraction.", { mediaSha256: sha })
  }

  const linked = await updateDocumentImageMapping(ctx.doc.id, image.id, { extractionStatus: "extracted", altTextAssetId: assetId, extractionError: null, mediaSha256: sha })
  if (!linked.ok) {
    await deleteAsset(assetId).catch((err) => console.error("[alt-text/extract] asset cleanup failed", logName(err)))
    return finish("failed", "ASSET_ERROR", "The image could not be linked. Retry extraction.", { mediaSha256: sha })
  }
  return true
}

export async function runPool<T>(items: T[], size: number, worker: (item: T) => Promise<void>) {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) await worker(items[next++])
    }),
  )
}

/** Persist the final document status from real occurrence counts and return the summary. */
export async function finalizeRun(doc: StoredDocument, unrecorded: number, extra: Omit<ExtractionSummary, "document" | "counts" | "alreadyProcessed" | "unrecorded">) {
  const counts = await countDocumentImages(doc.id)
  const next = unrecorded > 0 && counts.extracted > 0 ? "partially_extracted" : unrecorded > 0 ? "failed" : deriveDocumentProcessingStatus(counts)
  const error = next === "extracted" ? null : { code: "EXTRACTION_INCOMPLETE", message: `${counts.extracted} of ${counts.total + unrecorded} images extracted.` }
  const updated = await updateDocumentStatus(doc.id, next, error)
  if (!updated.ok) console.error("[alt-text/extract] final status not saved", updated.code)
  return summarize(doc, { alreadyProcessed: false, unrecorded, ...extra })
}
