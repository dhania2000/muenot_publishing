/**
 * @file lib/alt-text/document-upload.ts
 * @module Publishing · Alt Text
 * @kind Server-side library
 * @summary Phase 3 Task 3 — single PDF/PPTX/DOCX intake: limits, structural validation,
 *   private tenant storage via the storage facade (file_objects row + async scan +
 *   quarantine), duplicate-safe retries, and tenant/owner-scoped status lookup.
 *   Task 4: every accepted upload is registered in alt_text_documents (create-or-find on
 *   the upload id) before success is reported; a failed registration removes new bytes.
 * @usedBy app/api/alt-text/documents/upload/route.ts, app/api/alt-text/documents/[uploadId]/route.ts
 */
import "server-only"
import { createHash, randomUUID } from "node:crypto"
import { deleteFile, uploadFile } from "@/lib/storage"
import { checkStorageQuota } from "@/lib/storage/storage-quota"
import { listFileMetadata, type FileObject } from "@/lib/storage/file-metadata"
import { getScanForFile } from "@/lib/storage/file-scanning"
import { getUploadLimits, validateUploadContent } from "@/lib/settings/uploads"
import { DOCUMENT_FORMATS, getExtension, type DocumentKind } from "./document-queue"
import { DOCUMENT_UPLOAD_LIMITS, deriveDocumentSecurity, type DocumentUploadReference } from "./document-upload-contract"
import { persistUploadedDocument, syncDocumentForUpload } from "./document-service"
import { validateDocumentBytes, type DocumentValidationCode } from "./document-validation"
import { safeDisplayName } from "./upload"

export const DOCUMENT_MODULE = "publishing"
export const DOCUMENT_ENTITY_TYPE = "alt_text_document"
export const DOCUMENT_STORAGE_PREFIX = "alt-text/documents"

const MIB = 1024 * 1024
const STORAGE_UNAVAILABLE = "Upload failed. Check the connected storage configuration."
const NEUTRAL_MIME = new Set(["", "application/octet-stream", "application/zip", "application/x-zip-compressed"])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** How many of the caller's recent document rows are checked for an identical retry. */
const DUPLICATE_LOOKBACK = 200

export type DocumentUploadFailure = {
  ok: false
  status: 400 | 409 | 413 | 415 | 422 | 429 | 500 | 503
  code: string
  error: string
}

const fail = (status: DocumentUploadFailure["status"], code: string, error: string): DocumentUploadFailure => ({ ok: false, status, code, error })

const VALIDATION_STATUS: Record<DocumentValidationCode, DocumentUploadFailure["status"]> = {
  INVALID_DOCUMENT: 400,
  CONTENT_MISMATCH: 415,
  ENCRYPTED_DOCUMENT: 422,
  MACROS_NOT_ALLOWED: 422,
  ACTIVE_CONTENT: 422,
  UNSAFE_ARCHIVE: 422,
  ARCHIVE_TOO_LARGE: 413,
}

const isKind = (ext: string): ext is DocumentKind => ext in DOCUMENT_FORMATS

function toIso(value: unknown): string {
  const d = value instanceof Date ? value : new Date(String(value ?? ""))
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
}

export function toDocumentReference(
  file: FileObject,
  scan: Parameters<typeof deriveDocumentSecurity>[0],
  documentId: number | null = null,
): DocumentUploadReference {
  const filename = file.filename ?? "document"
  return {
    uploadId: String(file.entityId),
    documentId,
    storageReferenceId: file.fileRef,
    filename,
    extension: getExtension(filename),
    mimeType: file.mimeType ?? "application/octet-stream",
    size: file.size,
    uploadStatus: "uploaded",
    ...deriveDocumentSecurity(scan),
    uploadedAt: toIso(file.createdAt),
  }
}

/** The caller's identical (server-hashed) document in this tenant, so a retried request reuses it. */
async function findOwnedDuplicate(userId: number, checksum: string): Promise<FileObject | null> {
  const rows = await listFileMetadata({ module: DOCUMENT_MODULE, entityType: DOCUMENT_ENTITY_TYPE, limit: DUPLICATE_LOOKBACK })
  return rows.find((f) => f.ownerId === userId && f.checksum === checksum && f.uploadStatus === "completed" && f.entityId) ?? null
}

export async function processDocumentUpload(
  file: File,
  actor: { userId: number },
): Promise<{ ok: true; document: DocumentUploadReference; reused: boolean } | DocumentUploadFailure> {
  const limits = await getUploadLimits()
  const maxBytes = Math.min(DOCUMENT_UPLOAD_LIMITS.maxFileMb * MIB, limits.maxBytes)
  const maxMb = Math.floor((maxBytes / MIB) * 10) / 10
  const filename = safeDisplayName(file.name)
  const ext = getExtension(filename)

  if (ext === "doc" || ext === "ppt") return fail(415, "LEGACY_FORMAT", `Legacy .${ext} files are not supported. Save the file as .${ext}x and try again.`)
  if (!isKind(ext)) return fail(415, "UNSUPPORTED_TYPE", "Only PDF, PPTX and DOCX documents are supported.")
  if (file.size <= 0) return fail(400, "EMPTY_FILE", "The file is empty.")
  if (file.size > maxBytes) return fail(413, "FILE_TOO_LARGE", `Documents must be ${maxMb} MB or smaller.`)
  const mime = DOCUMENT_FORMATS[ext].mime
  const declared = (file.type || "").toLowerCase().split(";")[0].trim()
  if (!NEUTRAL_MIME.has(declared) && declared !== mime) return fail(415, "CONTENT_MISMATCH", `The file type does not match a .${ext} document.`)
  if (limits.extensions.length > 0 && !limits.extensions.includes(ext)) {
    return fail(415, "UNSUPPORTED_TYPE", `.${ext} uploads are not allowed by your storage settings.`)
  }

  const bytes = Buffer.from(await file.arrayBuffer())
  if (bytes.length === 0) return fail(400, "EMPTY_FILE", "The file is empty.")
  const validation = validateDocumentBytes(bytes, ext)
  if (!validation.ok) return fail(VALIDATION_STATUS[validation.code], validation.code, validation.message)

  const stored = new File([bytes], filename, { type: mime })
  const contentError = await validateUploadContent(stored)
  if (contentError) return fail(415, "UNSUPPORTED_TYPE", contentError)

  const checksum = createHash("sha256").update(bytes).digest("hex")
  const existing = await findOwnedDuplicate(actor.userId, checksum)
  if (existing) {
    // The bytes are already stored under a known reference, so a persistence failure keeps them;
    // the next retry re-links the same upload id (create-or-find), which also backfills Task 3 uploads.
    const scan = await getScanForFile(existing.id)
    const persisted = await persistUploadedDocument(existing, actor, checksum, scan)
    if (!persisted.ok) return persisted
    return { ok: true, document: toDocumentReference(existing, scan, persisted.document.id), reused: true }
  }

  const quota = await checkStorageQuota(bytes.length)
  if (!quota.allowed) return fail(413, "STORAGE_QUOTA_EXCEEDED", quota.reason)

  const uploadId = randomUUID()
  const up = await uploadFile(`${DOCUMENT_STORAGE_PREFIX}/${actor.userId}/${uploadId}.${ext}`, stored, {
    skipValidation: true,
    metadata: {
      module: DOCUMENT_MODULE,
      entityType: DOCUMENT_ENTITY_TYPE,
      entityId: uploadId,
      ownerId: actor.userId,
      classification: "confidential",
    },
  })
  if (!up.ok) {
    return up.error === STORAGE_UNAVAILABLE
      ? fail(503, "STORAGE_UNAVAILABLE", "Document storage is temporarily unavailable. Please try again.")
      : fail(429, "UPLOAD_LIMIT", up.error)
  }
  if (!up.result.file) {
    // Without a file_objects row there is no scan/quarantine record, so the bytes must not remain.
    await deleteFile(up.result.key).catch((err) => console.error("[alt-text/documents] cleanup failed", err instanceof Error ? err.name : "unknown"))
    return fail(503, "SCAN_UNAVAILABLE", "The security scan could not be scheduled. Please try again.")
  }
  const persisted = await persistUploadedDocument(up.result.file, actor, checksum, null)
  if (!persisted.ok) {
    // Never report success without a record, and never leave unreferenced bytes behind.
    await deleteFile(up.result.key).catch((err) => console.error("[alt-text/documents] cleanup failed", err instanceof Error ? err.name : "unknown"))
    return persisted
  }
  return { ok: true, document: toDocumentReference(up.result.file, null, persisted.document.id), reused: false }
}

/**
 * Tenant-scoped (via the storage facade) lookup by upload id. Non-owners only see
 * the document when their alt text view scope is `all`; otherwise it is a 404.
 */
export async function getDocumentUpload(uploadId: string, actor: { userId: number; canViewAll: boolean }): Promise<DocumentUploadReference | null> {
  if (!UUID_RE.test(uploadId)) return null
  const [file] = await listFileMetadata({ module: DOCUMENT_MODULE, entityType: DOCUMENT_ENTITY_TYPE, entityId: uploadId, limit: 1 })
  if (!file) return null
  if (!actor.canViewAll && file.ownerId !== actor.userId) return null
  const scan = await getScanForFile(file.id)
  const record = await syncDocumentForUpload(uploadId, deriveDocumentSecurity(scan).securityStatus)
  return toDocumentReference(file, scan, record?.id ?? null)
}
