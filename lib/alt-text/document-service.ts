/**
 * @file lib/alt-text/document-service.ts
 * @module Publishing · Alt Text
 * @kind Server-side library
 * @summary Phase 3 Task 4 — links Task 3 uploads (file_objects + file_security_scans) to
 *   persisted alt_text_documents rows. Creates the record for a server-verified upload,
 *   mirrors the storage scanner's verdict into security_scan_status, and serves the
 *   tenant/owner-scoped list + detail reads. Never reads document bytes.
 * @usedBy lib/alt-text/document-upload.ts, app/api/alt-text/documents/route.ts, app/api/alt-text/documents/[uploadId]/route.ts
 */
import "server-only"
import type { FileObject } from "@/lib/storage/file-metadata"
import { getScanForFile } from "@/lib/storage/file-scanning"
import type { PermissionScope } from "@/lib/permission-model"
import { getExtension } from "./document-queue"
import { deriveDocumentSecurity, type DocumentSecurityStatus } from "./document-upload-contract"
import {
  createDocument,
  getDocument,
  getDocumentByUploadId,
  listDocuments,
  updateDocumentSecurityStatus,
  type DocumentOwnerScope,
  type StoreFailure,
  type StoredDocument,
} from "./document-store"
import { isDocumentType, isExtractionReady, type DocumentRecord } from "./document-records"

/** Mirrored verdicts that the scanner may still change; `quarantined` is terminal. */
const UNSETTLED: ReadonlySet<DocumentSecurityStatus> = new Set(["scanning", "held"])

/** Non-`all` viewers only see their own uploads (same rule as the Task 3 status endpoint). */
export const ownerScopeFor = (actor: { userId: number; viewScope: PermissionScope;exportScope?:PermissionScope }): DocumentOwnerScope =>
  actor.viewScope === "all" && (actor.exportScope===undefined||actor.exportScope==="all") ? null : { uploadedBy: actor.userId }

/** Strip internal identifiers (file_objects.id) before returning a record to clients. */
export function toPublicDocument(doc: StoredDocument): DocumentRecord {
  const { fileObjectId: _internal, ...rest } = doc
  return rest
}

/** Apply the scanner's verdict through the guarded transition; a refused transition keeps the stored value. */
export async function mirrorSecurityStatus(doc: StoredDocument, next: DocumentSecurityStatus): Promise<StoredDocument> {
  if (doc.securityStatus === next) return doc
  if (!(await updateDocumentSecurityStatus(doc.id, next))) return doc
  return { ...doc, securityStatus: next, extractionReady: isExtractionReady({ securityStatus: next, processingStatus: doc.processingStatus }) }
}

async function refreshSecurity(doc: StoredDocument, force = false): Promise<StoredDocument> {
  if (!force && !UNSETTLED.has(doc.securityStatus)) return doc
  if (doc.securityStatus === "quarantined") return doc
  const scan = await getScanForFile(doc.fileObjectId)
  return mirrorSecurityStatus(doc, deriveDocumentSecurity(scan).securityStatus)
}

export type PersistDocumentFailure = { ok: false; status: 409 | 500 | 503; code: string; error: string }

/**
 * Create-or-find the document row for a server-verified file_objects row. Every value
 * comes from the storage facade (never the client), and the scan verdict is the real
 * one (`null` = no scan recorded yet → scanning).
 */
export async function persistUploadedDocument(
  file: FileObject,
  actor: { userId: number },
  checksum: string | null,
  scan: Parameters<typeof deriveDocumentSecurity>[0],
): Promise<{ ok: true; document: StoredDocument; created: boolean } | PersistDocumentFailure> {
  const documentType = getExtension(file.filename ?? "")
  if (!file.entityId || !isDocumentType(documentType) || file.ownerId !== actor.userId) {
    return { ok: false, status: 500, code: "PERSISTENCE_FAILED", error: "The uploaded document could not be registered." }
  }
  const security = deriveDocumentSecurity(scan).securityStatus
  let res: { ok: true; document: StoredDocument; created: boolean } | StoreFailure
  try {
    res = await createDocument({
      uploadId: String(file.entityId),
      fileObjectId: file.id,
      storageReferenceId: file.fileRef,
      filename: file.filename ?? `document.${documentType}`,
      documentType,
      mimeType: file.mimeType ?? "application/octet-stream",
      size: file.size,
      checksum: checksum ?? file.checksum ?? null,
      securityStatus: security,
      projectId: null,
      uploadedBy: actor.userId,
    })
  } catch (err) {
    console.error("[alt-text/documents] persistence failed", err instanceof Error ? err.name : "unknown")
    return { ok: false, status: 503, code: "PERSISTENCE_FAILED", error: "The document could not be saved. Please try again." }
  }
  if (!res.ok) {
    return res.code === "CONFLICT"
      ? { ok: false, status: 409, code: "CONFLICT", error: res.message }
      : { ok: false, status: 500, code: "PERSISTENCE_FAILED", error: "The uploaded document could not be registered." }
  }
  // A retried upload finds the existing row; bring its mirrored verdict up to date.
  const document = res.created ? res.document : await mirrorSecurityStatus(res.document, security)
  return { ok: true, document, created: res.created }
}

/** Mirror a freshly derived verdict onto the record of an upload id (used by the Task 3 status poll). */
export async function syncDocumentForUpload(uploadId: string, security: DocumentSecurityStatus): Promise<StoredDocument | null> {
  const doc = await getDocumentByUploadId(uploadId, null)
  return doc ? mirrorSecurityStatus(doc, security) : null
}

export async function listDocumentRecords(
  filter: { page: number; pageSize: number; projectId?: number | null },
  scope: DocumentOwnerScope,
): Promise<{ documents: DocumentRecord[]; total: number }> {
  const { documents, total } = await listDocuments(filter, scope)
  // Bounded by the page size; only rows whose scan is still unsettled are looked up.
  const refreshed = await Promise.all(documents.map((d) => refreshSecurity(d)))
  return { documents: refreshed.map(toPublicDocument), total }
}

/** Server-only: authorized document with a freshly re-derived scan verdict (keeps file_objects.id). */
export async function getDocumentForExtraction(id: number, scope: DocumentOwnerScope): Promise<StoredDocument | null> {
  const doc = await getDocument(id, scope)
  return doc ? refreshSecurity(doc, true) : null
}

export async function getDocumentRecord(id: number, scope: DocumentOwnerScope): Promise<DocumentRecord | null> {
  const doc = await getDocument(id, scope)
  return doc ? toPublicDocument(await refreshSecurity(doc, true)) : null
}
