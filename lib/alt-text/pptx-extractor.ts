/**
 * @file lib/alt-text/pptx-extractor.ts
 * @module Publishing · Alt Text
 * @kind Server-side library
 * @summary Phase 3 Task 5 — synchronous PPTX image extraction. Re-checks the document's
 *   security verdict, claims the per-document lock, reads the private original, turns every
 *   picture occurrence into an `alt_text_document_images` row and (for JPEG/PNG/WEBP) a regular
 *   Alt Text asset. Never generates AI text, never approves anything and never modifies the
 *   original PPTX. Safe to repeat: finished occurrences are skipped, failed ones retried.
 * @usedBy app/api/alt-text/documents/[uploadId]/extract/route.ts
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
import type { DocumentExtractionCounts, DocumentImageRecord, DocumentImageSourceMetadata, DocumentRecord, DocumentRecordProcessingStatus } from "./document-records"
import { getDocumentForExtraction, toPublicDocument } from "./document-service"
import {
  claimDocumentExtraction,
  countDocumentImages,
  createDocumentImageMapping,
  findDocumentMediaStorageKey,
  getDocument,
  updateDocumentImageMapping,
  updateDocumentStatus,
  type DocumentOwnerScope,
  type StoredDocument,
} from "./document-store"
import { classifyMedia } from "./media-format"
import { PptxPackageError, readPptxPackage, type PptxNotExtracted, type PptxOccurrence, type PptxPackage } from "./pptx-package"
import { ALT_TEXT_STORAGE_PREFIX, ALT_TEXT_UPLOAD_MAX_MB, hasCompleteImageStructure, safeDisplayName } from "./upload"
import { createAsset, deleteAsset, getSettings } from "./store"

const MIB = 1024 * 1024

/** Synchronous ceiling. Larger work belongs to the background queue (a later task). */
export const PPTX_SYNC_LIMITS = { maxDocumentBytes: 25 * MIB, concurrency: 3 } as const

export type ExtractionSummary = {
  document: DocumentRecord
  /** True when the document was already fully processed and nothing was re-run. */
  alreadyProcessed: boolean
  totalSlides: number | null
  counts: DocumentExtractionCounts
  notExtracted: PptxNotExtracted | null
  /** Occurrences that could not even be recorded (rare; e.g. a database error). */
  unrecorded: number
}

export type ExtractionFailure = { ok: false; status: 404 | 409 | 413 | 415 | 422 | 500 | 503; code: string; error: string }

const fail = (status: ExtractionFailure["status"], code: string, error: string): ExtractionFailure => ({ ok: false, status, code, error })
const NOT_FOUND = () => fail(404, "NOT_FOUND", "The document could not be found.")
const NOT_CLEAN = () => fail(409, "DOCUMENT_NOT_CLEAN", "The document has not passed the security scan.")

const logName = (err: unknown) => (err instanceof Error ? err.name : "unknown")

async function readBody(body: unknown, cap: number): Promise<Buffer | null> {
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

function sourceMetadataFor(o: PptxOccurrence, detectedFormat: string | null): DocumentImageSourceMetadata {
  return {
    shapeId: o.shapeId,
    name: o.name,
    title: o.title,
    originalDescription: o.description,
    mediaPart: o.mediaPart,
    detectedFormat,
    groupPath: o.groupPath,
    slideRelationshipId: o.slideRelationshipId,
  }
}

type RunContext = {
  doc: StoredDocument
  pkg: PptxPackage
  maxImageBytes: number
  language: string
  audience: string
  /** Within-run dedupe of identical media so concurrent occurrences upload once. */
  stored: Map<string, Promise<string | null>>
}

async function storeMedia(ctx: RunContext, bytes: Buffer, sha: string, mimeType: string, ext: string, filename: string): Promise<string | null> {
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

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }

async function processOccurrence(ctx: RunContext, o: PptxOccurrence): Promise<boolean> {
  const created = await createDocumentImageMapping(ctx.doc.id, {
    sourceLocator: o.sourceLocator,
    occurrenceIndex: o.occurrenceIndex,
    slideNumber: o.slideNumber,
    imageRelationshipId: o.mediaRelationshipId,
    isDecorative: o.decorative === true,
    sourceMetadata: sourceMetadataFor(o, null),
    extractionStatus: "pending",
  })
  if (!created.ok) {
    console.error("[alt-text/extract] occurrence not recorded", created.code)
    return false
  }
  const image = created.image
  if (image.extractionStatus === "extracted" || image.extractionStatus === "unsupported") return true

  const finish = (status: "failed" | "unsupported", code: string, message: string, extra: { mediaSha256?: string } = {}) =>
    updateDocumentImageMapping(ctx.doc.id, image.id, { extractionStatus: status, extractionError: { code, message }, ...extra }).then(() => true)

  if (o.problem) return finish(o.problem.status, o.problem.code, o.problem.message)
  if (!o.mediaPart) return finish("failed", "MISSING_MEDIA", "The image file is missing from the presentation.")

  let bytes: Buffer
  try {
    bytes = ctx.pkg.readMedia(o.mediaPart, ctx.maxImageBytes)
  } catch (err) {
    if (err instanceof PptxPackageError && err.code === "MEDIA_TOO_LARGE") return finish("unsupported", "IMAGE_TOO_LARGE", `Images must be ${Math.floor(ctx.maxImageBytes / MIB)} MB or smaller.`)
    if (err instanceof PptxPackageError && err.code === "MISSING_MEDIA") return finish("failed", "MISSING_MEDIA", err.message)
    return finish("failed", "INVALID_IMAGE", "The embedded image is damaged.")
  }
  if (bytes.length === 0) return finish("failed", "INVALID_IMAGE", "The embedded image is empty.")

  const sha = createHash("sha256").update(bytes).digest("hex")
  const decision = classifyMedia(bytes)
  if (!decision.ok) {
    await updateDocumentImageMapping(ctx.doc.id, image.id, { mediaSha256: sha })
    return finish("unsupported", decision.code, decision.message)
  }

  const label = `${ctx.doc.filename.replace(/\.pptx$/i, "")} - slide ${o.slideNumber} - ${o.name ?? `image ${o.occurrenceIndex + 1}`}`
  const filename = safeDisplayName(`${label}.${EXT[decision.mimeType]}`)
  const validation = validateImage({ type: decision.mimeType, size: bytes.length, name: filename }, bytes, ctx.maxImageBytes / MIB)
  if (!validation.ok) return finish("unsupported", "IMAGE_LIMITS", validation.error, { mediaSha256: sha })
  if (!hasCompleteImageStructure(bytes, decision.mimeType)) return finish("failed", "INVALID_IMAGE", "The embedded image is incomplete or corrupt.", { mediaSha256: sha })

  let pending = ctx.stored.get(sha)
  if (!pending) {
    pending = storeMedia(ctx, bytes, sha, decision.mimeType, EXT[decision.mimeType], filename)
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
      mimeType: decision.mimeType,
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

async function runPool<T>(items: T[], size: number, worker: (item: T) => Promise<void>) {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await worker(items[next++])
  }))
}

async function summarize(doc: StoredDocument, extra: Omit<ExtractionSummary, "document" | "counts">): Promise<{ ok: true; summary: ExtractionSummary }> {
  const [fresh, counts] = await Promise.all([getDocument(doc.id, null), countDocumentImages(doc.id)])
  return { ok: true, summary: { document: toPublicDocument(fresh ?? doc), counts, ...extra } }
}

/** Fail the run with a document-level error (status is left retryable as `failed`). */
async function failRun(doc: StoredDocument, f: ExtractionFailure): Promise<ExtractionFailure> {
  await updateDocumentStatus(doc.id, "failed", { code: f.code, message: f.error }).catch((err) => console.error("[alt-text/extract] status update failed", logName(err)))
  return f
}

export async function extractPptxImages(documentId: number, scope: DocumentOwnerScope): Promise<{ ok: true; summary: ExtractionSummary } | ExtractionFailure> {
  const doc = await getDocumentForExtraction(documentId, scope)
  if (!doc) return NOT_FOUND()
  if (doc.documentType !== "pptx") return fail(415, "UNSUPPORTED_DOCUMENT_TYPE", "Only PowerPoint (PPTX) extraction is available. PDF and Word support is coming later.")
  if (doc.securityStatus !== "clean") return NOT_CLEAN()
  if (doc.processingStatus === "extracted" || doc.processingStatus === "unsupported") {
    return summarize(doc, { alreadyProcessed: true, totalSlides: null, notExtracted: null, unrecorded: 0 })
  }
  if (doc.size > PPTX_SYNC_LIMITS.maxDocumentBytes) {
    return fail(413, "REQUIRES_BACKGROUND_PROCESSING", "This presentation is too large to extract now. Background processing is not available yet.")
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

  try {
    let object: Awaited<ReturnType<typeof downloadFile>>
    try {
      object = await downloadFile(file.objectKey)
    } catch (err) {
      console.error("[alt-text/extract] storage read failed", logName(err))
      return failRun(doc, fail(503, "STORAGE_UNAVAILABLE", "Document storage is temporarily unavailable. Please try again."))
    }
    const bytes = await readBody(object?.body, PPTX_SYNC_LIMITS.maxDocumentBytes)
    if (!bytes || bytes.length !== doc.size) return failRun(doc, fail(422, "INVALID_DOCUMENT", "The stored document could not be read."))
    if (file.checksum && createHash("sha256").update(bytes).digest("hex") !== file.checksum) {
      return failRun(doc, fail(422, "INTEGRITY_MISMATCH", "The stored document does not match the uploaded original."))
    }

    let pkg: PptxPackage
    try {
      pkg = readPptxPackage(bytes)
    } catch (err) {
      if (err instanceof PptxPackageError) {
        const status = err.code === "TOO_MANY_IMAGES" ? 413 : 422
        return failRun(doc, fail(status, err.code === "TOO_MANY_IMAGES" ? "REQUIRES_BACKGROUND_PROCESSING" : err.code, err.message))
      }
      throw err
    }

    const [settings, limits] = await Promise.all([getSettings(), getUploadLimits()])
    const ctx: RunContext = {
      doc,
      pkg,
      maxImageBytes: Math.min(settings.maxFileMb * MIB, ALT_TEXT_UPLOAD_MAX_MB * MIB, limits.maxBytes),
      language: settings.defaultLanguage,
      audience: settings.defaultAudience,
      stored: new Map(),
    }
    let unrecorded = 0
    await runPool(pkg.occurrences, PPTX_SYNC_LIMITS.concurrency, async (o) => {
      const recorded = await processOccurrence(ctx, o).catch((err) => {
        console.error("[alt-text/extract] occurrence failed", logName(err))
        return false
      })
      if (!recorded) unrecorded++
    })

    const counts = await countDocumentImages(doc.id)
    const next = unrecorded > 0 && counts.extracted > 0 ? "partially_extracted" : unrecorded > 0 ? "failed" : deriveDocumentProcessingStatus(counts)
    const error =
      next === "extracted" ? null : { code: "EXTRACTION_INCOMPLETE", message: `${counts.extracted} of ${counts.total + unrecorded} images extracted.` }
    const updated = await updateDocumentStatus(doc.id, next, error)
    if (!updated.ok) console.error("[alt-text/extract] final status not saved", updated.code)
    return summarize(doc, { alreadyProcessed: false, totalSlides: pkg.totalSlides, notExtracted: pkg.notExtracted, unrecorded })
  } catch (err) {
    console.error("[alt-text/extract] extraction failed", logName(err))
    return failRun(doc, fail(500, "EXTRACTION_FAILED", "Extraction failed. Please try again."))
  }
}

export type { DocumentImageRecord }
