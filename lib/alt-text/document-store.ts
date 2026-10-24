/**
 * @file lib/alt-text/document-store.ts
 * @module Publishing · Alt Text
 * @kind Server-side data access
 * @summary Phase 3 Task 4 — tenant-scoped persistence for alt_text_documents and
 *   alt_text_document_images. Schema comes from ensureAltTextSchema(); every statement
 *   is parameterized and filters by tenant_id. Status changes are guarded in SQL so
 *   concurrent writers cannot apply an invalid transition.
 */
import "server-only"
import type { PoolConnection } from "mysql2/promise"
import type { ResultSetHeader, RowDataPacket } from "mysql2"
import { query, withTransaction } from "@/lib/db"
import { currentTenantId } from "@/lib/tenant-scope"
import { ensureAltTextSchema, projectExists } from "./store"
import type { DocumentSecurityStatus } from "./document-upload-contract"
import {
  DOCUMENT_IMAGE_PAGE_MAX,
  DOCUMENT_LIST_LIMITS,
  IMAGE_EXTRACTION_STATUSES,
  SOURCE_METADATA_MAX_JSON,
  canTransitionExtraction,
  isDocumentType,
  isExtractionReady,
  isExtractionStatus,
  isProcessingStatus,
  isSecurityStatus,
  isSourceLocator,
  processingPredecessors,
  securityPredecessors,
  type DocumentExtractionCounts,
  type DocumentImageRecord,
  type DocumentImageSourceMetadata,
  type DocumentRecord,
  type DocumentRecordProcessingStatus,
  type DocumentType,
  type ImageExtractionStatus,
} from "./document-records"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SHA256_RE = /^[0-9a-f]{64}$/
const MAX_POSITION_JSON = 4096

export type DocumentStoreErrorCode =
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "INVALID_PROJECT"
  | "INVALID_ASSET"
  | "INVALID_TRANSITION"
  | "DOCUMENT_NOT_CLEAN"
  | "DOCUMENT_NOT_EXTRACTING"
  | "CONFLICT"

export type StoreFailure = { ok: false; code: DocumentStoreErrorCode; message: string }
const fail = (code: DocumentStoreErrorCode, message: string): StoreFailure => ({ ok: false, code, message })

export const isPositiveId = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0
const isNullablePositiveInt = (v: unknown) => v == null || isPositiveId(v)
const tid = () => currentTenantId()

/** Owner scope for non-`all` viewers; `null` means tenant-wide. */
export type DocumentOwnerScope = { uploadedBy: number } | null

const toIso = (v: unknown) => {
  const d = v instanceof Date ? v : new Date(String(v ?? ""))
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString()
}

type DocumentDbRow = RowDataPacket & {
  id: number
  project_id: number | null
  upload_reference_id: string
  file_object_id: number
  private_storage_reference: string
  original_filename: string
  document_type: string
  mime_type: string
  file_size_bytes: number | string
  upload_status: string
  security_scan_status: string
  processing_status: string
  uploaded_by: number
  created_at: Date | string
  updated_at: Date | string
  extracted_image_count?: number | string | null
}

export type StoredDocument = DocumentRecord & { fileObjectId: number }

export function toDocumentRecord(row: DocumentDbRow): StoredDocument {
  const securityStatus = isSecurityStatus(row.security_scan_status) ? row.security_scan_status : "held"
  const processingStatus = isProcessingStatus(row.processing_status) ? row.processing_status : "failed"
  return {
    id: Number(row.id),
    uploadId: row.upload_reference_id,
    storageReferenceId: row.private_storage_reference,
    fileObjectId: Number(row.file_object_id),
    projectId: row.project_id == null ? null : Number(row.project_id),
    filename: row.original_filename,
    documentType: (isDocumentType(row.document_type) ? row.document_type : "pdf") as DocumentType,
    mimeType: row.mime_type,
    size: Number(row.file_size_bytes),
    uploadStatus: "uploaded",
    securityStatus,
    processingStatus,
    extractionReady: isExtractionReady({ securityStatus, processingStatus }),
    extractedImageCount: Number(row.extracted_image_count ?? 0),
    uploadedBy: Number(row.uploaded_by),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  }
}

/** Derived from actual mapping rows; zero until extraction (Task 5+) inserts them. */
const EXTRACTED_COUNT_SQL =
  "(SELECT COUNT(*) FROM alt_text_document_images i WHERE i.tenant_id = d.tenant_id AND i.document_id = d.id AND i.extraction_status = 'extracted') AS extracted_image_count"

const DOCUMENT_COLUMNS =
  "d.id, d.project_id, d.upload_reference_id, d.file_object_id, d.private_storage_reference, d.original_filename, d.document_type, d.mime_type, d.file_size_bytes, d.upload_status, d.security_scan_status, d.processing_status, d.uploaded_by, d.created_at, d.updated_at"

function ownerClause(scope: DocumentOwnerScope): { sql: string; params: number[] } {
  return scope ? { sql: " AND d.uploaded_by = ?", params: [scope.uploadedBy] } : { sql: "", params: [] }
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export type CreateDocumentInput = {
  uploadId: string
  fileObjectId: number
  storageReferenceId: string
  filename: string
  documentType: DocumentType
  mimeType: string
  size: number
  checksum: string | null
  securityStatus: DocumentSecurityStatus
  projectId: number | null
  uploadedBy: number
}

/**
 * Create-or-find the document for a server-verified upload. Idempotent on
 * (tenant_id, upload_reference_id): a retried upload response returns the same id.
 */
export async function createDocument(input: CreateDocumentInput): Promise<{ ok: true; document: StoredDocument; created: boolean } | StoreFailure> {
  if (!UUID_RE.test(input.uploadId)) return fail("INVALID_INPUT", "Invalid upload reference.")
  if (!isPositiveId(input.fileObjectId) || !isPositiveId(input.uploadedBy)) return fail("INVALID_INPUT", "Invalid upload owner or file.")
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(input.storageReferenceId)) return fail("INVALID_INPUT", "Invalid storage reference.")
  if (!isDocumentType(input.documentType)) return fail("INVALID_INPUT", "Unsupported document type.")
  if (!Number.isSafeInteger(input.size) || input.size <= 0) return fail("INVALID_INPUT", "Invalid document size.")
  if (!input.filename || input.filename.length > 255) return fail("INVALID_INPUT", "Invalid filename.")
  if (input.checksum != null && !SHA256_RE.test(input.checksum)) return fail("INVALID_INPUT", "Invalid checksum.")
  if (!isSecurityStatus(input.securityStatus)) return fail("INVALID_INPUT", "Invalid security status.")
  if (!isNullablePositiveInt(input.projectId)) return fail("INVALID_PROJECT", "The project could not be found.")

  await ensureAltTextSchema()
  if (input.projectId != null && !(await projectExists(input.projectId))) return fail("INVALID_PROJECT", "The project could not be found.")

  const tenantId = tid()
  const res = await query<ResultSetHeader>(
    `INSERT INTO alt_text_documents
       (tenant_id, project_id, upload_reference_id, file_object_id, private_storage_reference, original_filename,
        document_type, mime_type, file_size_bytes, file_checksum, upload_status, security_scan_status, processing_status, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploaded', ?, 'pending', ?)
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
    [
      tenantId, input.projectId, input.uploadId.toLowerCase(), input.fileObjectId, input.storageReferenceId, input.filename,
      input.documentType, input.mimeType.slice(0, 120), input.size, input.checksum, input.securityStatus, input.uploadedBy,
    ],
  )
  const document = await getDocument(Number(res.insertId), null)
  if (!document) return fail("NOT_FOUND", "The document could not be found.")
  // A unique-key hit must be the same server-verified upload, never another user's or file's record.
  if (document.uploadId !== input.uploadId.toLowerCase() || document.uploadedBy !== input.uploadedBy || document.fileObjectId !== input.fileObjectId) {
    return fail("CONFLICT", "The upload reference is already registered to another document.")
  }
  return { ok: true, document, created: res.affectedRows === 1 }
}

export async function getDocument(id: number, scope: DocumentOwnerScope): Promise<StoredDocument | null> {
  if (!isPositiveId(id)) return null
  await ensureAltTextSchema()
  const owner = ownerClause(scope)
  const rows = await query<DocumentDbRow[]>(
    `SELECT ${DOCUMENT_COLUMNS}, ${EXTRACTED_COUNT_SQL} FROM alt_text_documents d WHERE d.tenant_id = ? AND d.id = ?${owner.sql} LIMIT 1`,
    [tid(), id, ...owner.params],
  )
  return rows[0] ? toDocumentRecord(rows[0]) : null
}

export async function getDocumentByUploadId(uploadId: string, scope: DocumentOwnerScope): Promise<StoredDocument | null> {
  if (!UUID_RE.test(uploadId)) return null
  await ensureAltTextSchema()
  const owner = ownerClause(scope)
  const rows = await query<DocumentDbRow[]>(
    `SELECT ${DOCUMENT_COLUMNS}, ${EXTRACTED_COUNT_SQL} FROM alt_text_documents d WHERE d.tenant_id = ? AND d.upload_reference_id = ?${owner.sql} LIMIT 1`,
    [tid(), uploadId.toLowerCase(), ...owner.params],
  )
  return rows[0] ? toDocumentRecord(rows[0]) : null
}

export async function listDocuments(
  filter: { page: number; pageSize: number; projectId?: number | null },
  scope: DocumentOwnerScope,
): Promise<{ documents: StoredDocument[]; total: number }> {
  const pageSize = Math.min(Math.max(1, Math.trunc(filter.pageSize) || DOCUMENT_LIST_LIMITS.defaultPageSize), DOCUMENT_LIST_LIMITS.maxPageSize)
  const page = Math.max(1, Math.trunc(filter.page) || 1)
  await ensureAltTextSchema()
  const owner = ownerClause(scope)
  let where = `d.tenant_id = ?${owner.sql}`
  const params: unknown[] = [tid(), ...owner.params]
  if (filter.projectId != null) {
    where += " AND d.project_id = ?"
    params.push(filter.projectId)
  }
  const [rows, count] = await Promise.all([
    query<DocumentDbRow[]>(
      `SELECT ${DOCUMENT_COLUMNS}, ${EXTRACTED_COUNT_SQL} FROM alt_text_documents d WHERE ${where} ORDER BY d.created_at DESC, d.id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize],
    ),
    query<(RowDataPacket & { total: number | string })[]>(`SELECT COUNT(*) AS total FROM alt_text_documents d WHERE ${where}`, params),
  ])
  return { documents: rows.map(toDocumentRecord), total: Number(count[0]?.total ?? 0) }
}

/**
 * Mirror the storage scanner's verdict. Applied only from a valid predecessor, so a
 * quarantined document can never be flipped back to clean (or extraction-ready).
 */
export async function updateDocumentSecurityStatus(id: number, next: DocumentSecurityStatus): Promise<boolean> {
  if (!isPositiveId(id) || !isSecurityStatus(next)) return false
  const from = securityPredecessors(next)
  if (from.length === 0) return false
  await ensureAltTextSchema()
  const res = await query<ResultSetHeader>(
    `UPDATE alt_text_documents SET security_scan_status = ? WHERE tenant_id = ? AND id = ? AND security_scan_status IN (${from.map(() => "?").join(", ")})`,
    [next, tid(), id, ...from],
  )
  return res.affectedRows > 0
}

/** Document-level extraction lifecycle (used by Task 5+ workers). Never implies AI generation. */
export async function updateDocumentStatus(
  id: number,
  next: DocumentRecordProcessingStatus,
  error: { code: string; message: string } | null = null,
): Promise<{ ok: true } | StoreFailure> {
  if (!isPositiveId(id) || !isProcessingStatus(next)) return fail("INVALID_INPUT", "Invalid document status.")
  const from = processingPredecessors(next)
  if (from.length === 0) return fail("INVALID_TRANSITION", `A document cannot move to ${next}.`)
  await ensureAltTextSchema()
  const tenantId = tid()
  const requireClean = next === "extracting"
  const res = await query<ResultSetHeader>(
    `UPDATE alt_text_documents
        SET processing_status = ?, last_error_code = ?, last_error_message = ?,
            processed_at = CASE WHEN ? = 'extracted' THEN CURRENT_TIMESTAMP ELSE processed_at END
      WHERE tenant_id = ? AND id = ? AND processing_status IN (${from.map(() => "?").join(", ")})${requireClean ? " AND security_scan_status = 'clean'" : ""}`,
    [next, error?.code.slice(0, 64) ?? null, error?.message.slice(0, 500) ?? null, next, tenantId, id, ...from],
  )
  if (res.affectedRows > 0) return { ok: true }
  const current = await getDocument(id, null)
  if (!current) return fail("NOT_FOUND", "The document could not be found.")
  if (requireClean && current.securityStatus !== "clean") return fail("DOCUMENT_NOT_CLEAN", "The document has not passed the security scan.")
  return fail("INVALID_TRANSITION", `A ${current.processingStatus} document cannot move to ${next}.`)
}

/** An `extracting` claim older than this is treated as an interrupted run and may be reclaimed. */
export const EXTRACTION_STALE_SECONDS = 15 * 60

/**
 * Atomically claim a document for extraction (the per-document lock). Succeeds from
 * pending / failed / partially_extracted, or from a stale `extracting` claim left by an
 * interrupted run. A live claim by another request returns CONFLICT.
 */
export async function claimDocumentExtraction(id: number): Promise<{ ok: true } | StoreFailure> {
  if (!isPositiveId(id)) return fail("NOT_FOUND", "The document could not be found.")
  const from = processingPredecessors("extracting")
  await ensureAltTextSchema()
  const res = await query<ResultSetHeader>(
    `UPDATE alt_text_documents
        SET processing_status = 'extracting', last_error_code = NULL, last_error_message = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ? AND id = ? AND security_scan_status = 'clean'
        AND (processing_status IN (${from.map(() => "?").join(", ")})
             OR (processing_status = 'extracting' AND updated_at < (CURRENT_TIMESTAMP - INTERVAL ? SECOND)))`,
    [tid(), id, ...from, EXTRACTION_STALE_SECONDS],
  )
  if (res.affectedRows > 0) return { ok: true }
  const current = await getDocument(id, null)
  if (!current) return fail("NOT_FOUND", "The document could not be found.")
  if (current.securityStatus !== "clean") return fail("DOCUMENT_NOT_CLEAN", "The document has not passed the security scan.")
  if (current.processingStatus === "extracting") return fail("CONFLICT", "Extraction is already running for this document.")
  return fail("INVALID_TRANSITION", `A ${current.processingStatus} document cannot be extracted again.`)
}

/** Persisted occurrence counts by extraction status (the source of truth for summaries). */
export async function countDocumentImages(documentId: number): Promise<DocumentExtractionCounts> {
  const counts: DocumentExtractionCounts = { total: 0, pending: 0, extracted: 0, failed: 0, unsupported: 0 }
  if (!isPositiveId(documentId)) return counts
  await ensureAltTextSchema()
  const rows = await query<(RowDataPacket & { extraction_status: string; n: number | string })[]>(
    "SELECT extraction_status, COUNT(*) AS n FROM alt_text_document_images WHERE tenant_id = ? AND document_id = ? GROUP BY extraction_status",
    [tid(), documentId],
  )
  for (const r of rows) {
    const n = Number(r.n)
    counts.total += n
    if ((IMAGE_EXTRACTION_STATUSES as readonly string[]).includes(r.extraction_status)) counts[r.extraction_status as ImageExtractionStatus] += n
  }
  return counts
}

/**
 * Server-only: storage key of a binary already stored for this document with the same hash.
 * Dedupe is scoped to one document (hence one tenant) so no cross-tenant sharing can occur.
 */
export async function findDocumentMediaStorageKey(documentId: number, mediaSha256: string): Promise<string | null> {
  if (!isPositiveId(documentId) || !SHA256_RE.test(mediaSha256)) return null
  await ensureAltTextSchema()
  const rows = await query<(RowDataPacket & { storage_key: string })[]>(
    `SELECT a.storage_key FROM alt_text_document_images i
       JOIN alt_text_assets a ON a.tenant_id = i.tenant_id AND a.id = i.alt_text_asset_id
      WHERE i.tenant_id = ? AND i.document_id = ? AND i.media_sha256 = ? AND i.extraction_status = 'extracted'
      ORDER BY i.id LIMIT 1`,
    [tid(), documentId, mediaSha256],
  )
  return rows[0]?.storage_key ?? null
}

// ---------------------------------------------------------------------------
// Image occurrence mappings (contracts for Tasks 5–8; nothing is pre-populated)
// ---------------------------------------------------------------------------

export type ImageDbRow = RowDataPacket & {
  id: number
  document_id: number
  alt_text_asset_id: number | null
  asset_status: string | null
  source_locator: string
  occurrence_index: number
  page_number: number | null
  slide_number: number | null
  image_relationship_id: string | null
  image_position_json: unknown
  is_decorative: number | boolean
  media_sha256: string | null
  source_metadata_json: unknown
  extraction_status: string
  extraction_error_code: string | null
  extraction_error_message: string | null
  context_status?: string | null
  context_confidence?: string | null
  context_analyzed_at?: Date | string | null
  created_at: Date | string
  updated_at: Date | string
}

const CONTEXT_STATUS_VALUES = ["analyzed", "unavailable", "failed"] as const
const CONTEXT_CONFIDENCE_VALUES = ["high", "medium", "low", "unavailable"] as const
const oneOf = <T extends string>(values: readonly T[], v: unknown): T | null => (typeof v === "string" && (values as readonly string[]).includes(v) ? (v as T) : null)

function parsePosition(v: unknown): Record<string, unknown> | null {
  if (v == null) return null
  if (typeof v === "object") return v as Record<string, unknown>
  try {
    const parsed = JSON.parse(String(v))
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function toDocumentImageRecord(row: ImageDbRow): DocumentImageRecord {
  return {
    id: Number(row.id),
    documentId: Number(row.document_id),
    altTextAssetId: row.alt_text_asset_id == null ? null : Number(row.alt_text_asset_id),
    assetStatus: row.asset_status ?? null,
    sourceLocator: row.source_locator,
    occurrenceIndex: Number(row.occurrence_index),
    pageNumber: row.page_number == null ? null : Number(row.page_number),
    slideNumber: row.slide_number == null ? null : Number(row.slide_number),
    imageRelationshipId: row.image_relationship_id,
    imagePosition: parsePosition(row.image_position_json),
    isDecorative: Number(row.is_decorative) === 1,
    mediaSha256: row.media_sha256,
    sourceMetadata: parsePosition(row.source_metadata_json) as DocumentImageSourceMetadata | null,
    extractionStatus: isExtractionStatus(row.extraction_status) ? row.extraction_status : "failed",
    extractionErrorCode: row.extraction_error_code,
    extractionErrorMessage: row.extraction_error_message,
    contextStatus: oneOf(CONTEXT_STATUS_VALUES, row.context_status),
    contextConfidence: oneOf(CONTEXT_CONFIDENCE_VALUES, row.context_confidence),
    contextAnalyzedAt: row.context_analyzed_at ? toIso(row.context_analyzed_at) : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  }
}

const IMAGE_SELECT = `SELECT i.id, i.document_id, i.alt_text_asset_id, a.status AS asset_status, i.source_locator, i.occurrence_index,
       i.page_number, i.slide_number, i.image_relationship_id, i.image_position_json, i.is_decorative, i.media_sha256,
       i.source_metadata_json, i.extraction_status, i.extraction_error_code, i.extraction_error_message,
       i.context_status, i.context_confidence, i.context_analyzed_at, i.created_at, i.updated_at
  FROM alt_text_document_images i
  LEFT JOIN alt_text_assets a ON a.tenant_id = i.tenant_id AND a.id = i.alt_text_asset_id`

/** Occurrences of one document in document order. Caller must have authorized the document. */
export async function getDocumentImages(documentId: number, page: { limit?: number; offset?: number } = {}): Promise<DocumentImageRecord[]> {
  if (!isPositiveId(documentId)) return []
  const limit = Math.min(Math.max(1, Math.trunc(page.limit ?? 100)), DOCUMENT_IMAGE_PAGE_MAX)
  const offset = Math.max(0, Math.trunc(page.offset ?? 0))
  await ensureAltTextSchema()
  const rows = await query<ImageDbRow[]>(
    `${IMAGE_SELECT} WHERE i.tenant_id = ? AND i.document_id = ? ORDER BY i.occurrence_index, i.id LIMIT ? OFFSET ?`,
    [tid(), documentId, limit, offset],
  )
  return rows.map(toDocumentImageRecord)
}

export type CreateDocumentImageInput = {
  sourceLocator: string
  occurrenceIndex: number
  pageNumber?: number | null
  slideNumber?: number | null
  imageRelationshipId?: string | null
  imagePosition?: Record<string, unknown> | null
  isDecorative?: boolean
  mediaSha256?: string | null
  sourceMetadata?: DocumentImageSourceMetadata | null
  altTextAssetId?: number | null
  extractionStatus?: ImageExtractionStatus
  extractionError?: { code: string; message: string } | null
}

function validateSourceMetadata(m: unknown): { ok: true; json: string | null } | StoreFailure {
  if (m == null) return { ok: true, json: null }
  if (typeof m !== "object" || Array.isArray(m)) return fail("INVALID_INPUT", "sourceMetadata must be an object.")
  const json = JSON.stringify(m)
  return json.length > SOURCE_METADATA_MAX_JSON ? fail("INVALID_INPUT", "sourceMetadata is too large.") : { ok: true, json }
}

function validatePosition(p: unknown): { ok: true; json: string | null } | StoreFailure {
  if (p == null) return { ok: true, json: null }
  if (typeof p !== "object" || Array.isArray(p)) return fail("INVALID_INPUT", "imagePosition must be an object.")
  const json = JSON.stringify(p)
  return json.length > MAX_POSITION_JSON ? fail("INVALID_INPUT", "imagePosition is too large.") : { ok: true, json }
}

async function lockRows<T>(conn: PoolConnection, sql: string, params: unknown[]): Promise<T[]> {
  const [rows] = await conn.query(sql, params)
  return rows as T[]
}

async function assetBelongsToTenant(conn: PoolConnection, tenantId: number, assetId: number) {
  const rows = await lockRows<{ id: number }>(conn, "SELECT id FROM alt_text_assets WHERE tenant_id = ? AND id = ? LOCK IN SHARE MODE", [tenantId, assetId])
  return rows.length > 0
}

/**
 * Register one image occurrence while the document is being extracted. Idempotent on
 * (document_id, source_locator): an extraction retry returns the existing row unchanged.
 */
export async function createDocumentImageMapping(
  documentId: number,
  input: CreateDocumentImageInput,
): Promise<{ ok: true; image: DocumentImageRecord; created: boolean } | StoreFailure> {
  if (!isPositiveId(documentId)) return fail("NOT_FOUND", "The document could not be found.")
  if (!isSourceLocator(input.sourceLocator)) return fail("INVALID_INPUT", "Invalid source locator.")
  if (!Number.isSafeInteger(input.occurrenceIndex) || input.occurrenceIndex < 0) return fail("INVALID_INPUT", "Invalid occurrence index.")
  if (!isNullablePositiveInt(input.pageNumber) || !isNullablePositiveInt(input.slideNumber)) return fail("INVALID_INPUT", "Invalid page or slide number.")
  if (input.imageRelationshipId != null && (typeof input.imageRelationshipId !== "string" || input.imageRelationshipId.length > 255)) {
    return fail("INVALID_INPUT", "Invalid image relationship id.")
  }
  if (input.mediaSha256 != null && !SHA256_RE.test(input.mediaSha256)) return fail("INVALID_INPUT", "Invalid media hash.")
  const status = input.extractionStatus ?? "pending"
  if (!isExtractionStatus(status)) return fail("INVALID_INPUT", "Invalid extraction status.")
  const assetId = input.altTextAssetId ?? null
  if (assetId != null && !isPositiveId(assetId)) return fail("INVALID_ASSET", "The alt text asset could not be found.")
  if (assetId != null && status !== "extracted") return fail("INVALID_TRANSITION", "Only extracted images can be linked to an alt text asset.")
  const position = validatePosition(input.imagePosition)
  if (!position.ok) return position
  const metadata = validateSourceMetadata(input.sourceMetadata)
  if (!metadata.ok) return metadata

  await ensureAltTextSchema()
  const tenantId = tid()
  const outcome = await withTransaction(async (conn) => {
    const [doc] = await lockRows<{ security_scan_status: string; processing_status: string }>(
      conn,
      "SELECT security_scan_status, processing_status FROM alt_text_documents WHERE tenant_id = ? AND id = ? FOR UPDATE",
      [tenantId, documentId],
    )
    if (!doc) return fail("NOT_FOUND", "The document could not be found.")
    if (doc.security_scan_status !== "clean") return fail("DOCUMENT_NOT_CLEAN", "The document has not passed the security scan.")
    if (doc.processing_status !== "extracting") return fail("DOCUMENT_NOT_EXTRACTING", "Images can only be mapped while the document is being extracted.")
    if (assetId != null && !(await assetBelongsToTenant(conn, tenantId, assetId))) return fail("INVALID_ASSET", "The alt text asset could not be found.")
    const [res] = await conn.query<ResultSetHeader>(
      `INSERT INTO alt_text_document_images
         (tenant_id, document_id, alt_text_asset_id, source_locator, occurrence_index, page_number, slide_number,
          image_relationship_id, image_position_json, is_decorative, media_sha256, source_metadata_json, extraction_status,
          extraction_error_code, extraction_error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
      [
        tenantId, documentId, assetId, input.sourceLocator, input.occurrenceIndex, input.pageNumber ?? null, input.slideNumber ?? null,
        input.imageRelationshipId ?? null, position.json, input.isDecorative ? 1 : 0, input.mediaSha256 ?? null, metadata.json, status,
        input.extractionError?.code.slice(0, 64) ?? null, input.extractionError?.message.slice(0, 500) ?? null,
      ],
    )
    return { ok: true as const, id: Number(res.insertId), created: res.affectedRows === 1 }
  })
  if (!outcome.ok) return outcome
  const rows = await query<ImageDbRow[]>(`${IMAGE_SELECT} WHERE i.tenant_id = ? AND i.document_id = ? AND i.id = ? LIMIT 1`, [tenantId, documentId, outcome.id])
  if (!rows[0]) return fail("NOT_FOUND", "The image mapping could not be found.")
  return { ok: true, image: toDocumentImageRecord(rows[0]), created: outcome.created }
}

export type UpdateDocumentImageInput = {
  altTextAssetId?: number | null
  extractionStatus?: ImageExtractionStatus
  extractionError?: { code: string; message: string } | null
  isDecorative?: boolean
  imagePosition?: Record<string, unknown> | null
  /** Set once the occurrence's media binary has been read (Task 5). */
  mediaSha256?: string | null
}

/** Update one occurrence. The (tenant, document, image) triple is verified under a row lock. */
export async function updateDocumentImageMapping(
  documentId: number,
  imageId: number,
  patch: UpdateDocumentImageInput,
): Promise<{ ok: true; image: DocumentImageRecord } | StoreFailure> {
  if (!isPositiveId(documentId) || !isPositiveId(imageId)) return fail("NOT_FOUND", "The image mapping could not be found.")
  if (patch.extractionStatus !== undefined && !isExtractionStatus(patch.extractionStatus)) return fail("INVALID_INPUT", "Invalid extraction status.")
  if (patch.altTextAssetId !== undefined && !isNullablePositiveInt(patch.altTextAssetId)) return fail("INVALID_ASSET", "The alt text asset could not be found.")
  if (patch.mediaSha256 != null && !SHA256_RE.test(patch.mediaSha256)) return fail("INVALID_INPUT", "Invalid media hash.")
  const position = patch.imagePosition === undefined ? null : validatePosition(patch.imagePosition)
  if (position && !position.ok) return position

  await ensureAltTextSchema()
  const tenantId = tid()
  const outcome = await withTransaction(async (conn): Promise<{ ok: true } | StoreFailure> => {
    const [row] = await lockRows<{ extraction_status: string; alt_text_asset_id: number | null }>(
      conn,
      "SELECT extraction_status, alt_text_asset_id FROM alt_text_document_images WHERE tenant_id = ? AND document_id = ? AND id = ? FOR UPDATE",
      [tenantId, documentId, imageId],
    )
    if (!row) return fail("NOT_FOUND", "The image mapping could not be found.")
    const current = isExtractionStatus(row.extraction_status) ? row.extraction_status : "failed"
    const nextStatus = patch.extractionStatus ?? current
    if (!canTransitionExtraction(current, nextStatus)) return fail("INVALID_TRANSITION", `An ${current} image cannot move to ${nextStatus}.`)
    const nextAsset = patch.altTextAssetId === undefined ? row.alt_text_asset_id : patch.altTextAssetId
    if (nextAsset != null && nextStatus !== "extracted") return fail("INVALID_TRANSITION", "Only extracted images can be linked to an alt text asset.")
    if (patch.altTextAssetId != null && !(await assetBelongsToTenant(conn, tenantId, patch.altTextAssetId))) {
      return fail("INVALID_ASSET", "The alt text asset could not be found.")
    }
    const sets: string[] = []
    const params: unknown[] = []
    if (patch.extractionStatus !== undefined) sets.push("extraction_status = ?"), params.push(nextStatus)
    if (patch.altTextAssetId !== undefined) sets.push("alt_text_asset_id = ?"), params.push(patch.altTextAssetId)
    if (patch.isDecorative !== undefined) sets.push("is_decorative = ?"), params.push(patch.isDecorative ? 1 : 0)
    if (position) sets.push("image_position_json = ?"), params.push(position.json)
    if (patch.mediaSha256 !== undefined) sets.push("media_sha256 = ?"), params.push(patch.mediaSha256)
    if (patch.extractionError !== undefined) {
      sets.push("extraction_error_code = ?", "extraction_error_message = ?")
      params.push(patch.extractionError?.code.slice(0, 64) ?? null, patch.extractionError?.message.slice(0, 500) ?? null)
    } else if (nextStatus === "extracted") {
      sets.push("extraction_error_code = NULL", "extraction_error_message = NULL")
    }
    if (sets.length > 0) {
      await conn.query(`UPDATE alt_text_document_images SET ${sets.join(", ")} WHERE tenant_id = ? AND document_id = ? AND id = ?`, [
        ...params, tenantId, documentId, imageId,
      ])
    }
    return { ok: true }
  })
  if (!outcome.ok) return outcome
  const rows = await query<ImageDbRow[]>(`${IMAGE_SELECT} WHERE i.tenant_id = ? AND i.document_id = ? AND i.id = ? LIMIT 1`, [tenantId, documentId, imageId])
  if (!rows[0]) return fail("NOT_FOUND", "The image mapping could not be found.")
  return { ok: true, image: toDocumentImageRecord(rows[0]) }
}

// ---------------------------------------------------------------------------
// Phase 3 Task 9: per-occurrence document context (stored on the mapping row)
// ---------------------------------------------------------------------------

/** Generous ceiling over CONTEXT_LIMITS.maxJsonBytes; the builder already enforces its own budget. */
export const CONTEXT_MAX_JSON = 24_576

export type StoredImageContext = {
  imageId: number
  status: "analyzed" | "unavailable" | "failed" | null
  confidence: "high" | "medium" | "low" | "unavailable" | null
  version: number | null
  analyzedAt: string | null
  context: unknown
}

/** One occurrence (by id) of an already-authorized document. */
export async function getDocumentImage(documentId: number, imageId: number): Promise<DocumentImageRecord | null> {
  if (!isPositiveId(documentId) || !isPositiveId(imageId)) return null
  await ensureAltTextSchema()
  const rows = await query<ImageDbRow[]>(`${IMAGE_SELECT} WHERE i.tenant_id = ? AND i.document_id = ? AND i.id = ? LIMIT 1`, [tid(), documentId, imageId])
  return rows[0] ? toDocumentImageRecord(rows[0]) : null
}

export async function getDocumentImageContext(documentId: number, imageId: number): Promise<StoredImageContext | null> {
  if (!isPositiveId(documentId) || !isPositiveId(imageId)) return null
  await ensureAltTextSchema()
  const rows = await query<(RowDataPacket & { id: number; context_json: unknown; context_status: string | null; context_confidence: string | null; context_version: number | null; context_analyzed_at: Date | string | null })[]>(
    `SELECT id, context_json, context_status, context_confidence, context_version, context_analyzed_at
       FROM alt_text_document_images WHERE tenant_id = ? AND document_id = ? AND id = ? LIMIT 1`,
    [tid(), documentId, imageId],
  )
  const r = rows[0]
  if (!r) return null
  return {
    imageId: Number(r.id),
    status: oneOf(CONTEXT_STATUS_VALUES, r.context_status),
    confidence: oneOf(CONTEXT_CONFIDENCE_VALUES, r.context_confidence),
    version: r.context_version == null ? null : Number(r.context_version),
    analyzedAt: r.context_analyzed_at ? toIso(r.context_analyzed_at) : null,
    context: parsePosition(r.context_json),
  }
}

export type SaveImageContextInput = {
  imageId: number
  status: "analyzed" | "unavailable" | "failed"
  confidence: "high" | "medium" | "low" | "unavailable"
  version: number
  context: Record<string, unknown> | null
}

/**
 * Overwrite the context of the given occurrences in one transaction. Keyed on
 * (tenant, document, image) so a re-analysis replaces — never duplicates — a context, and never
 * touches extraction state, source metadata (existing alt text) or the linked AI asset.
 */
export async function saveDocumentImageContexts(documentId: number, entries: SaveImageContextInput[]): Promise<{ ok: true; saved: number } | StoreFailure> {
  if (!isPositiveId(documentId)) return fail("NOT_FOUND", "The document could not be found.")
  const prepared: { id: number; json: string | null; status: string; confidence: string; version: number }[] = []
  for (const e of entries) {
    if (!isPositiveId(e.imageId) || !oneOf(CONTEXT_STATUS_VALUES, e.status) || !oneOf(CONTEXT_CONFIDENCE_VALUES, e.confidence)) return fail("INVALID_INPUT", "Invalid context entry.")
    const json = e.context == null ? null : JSON.stringify(e.context)
    if (json && json.length > CONTEXT_MAX_JSON) return fail("INVALID_INPUT", "Context is too large.")
    prepared.push({ id: e.imageId, json, status: e.status, confidence: e.confidence, version: e.version })
  }
  if (prepared.length === 0) return { ok: true, saved: 0 }
  await ensureAltTextSchema()
  const tenantId = tid()
  const saved = await withTransaction(async (conn) => {
    let n = 0
    for (const p of prepared) {
      const [res] = await conn.query<ResultSetHeader>(
        `UPDATE alt_text_document_images
            SET context_json = ?, context_status = ?, context_confidence = ?, context_version = ?, context_analyzed_at = CURRENT_TIMESTAMP
          WHERE tenant_id = ? AND document_id = ? AND id = ?`,
        [p.json, p.status, p.confidence, p.version, tenantId, documentId, p.id],
      )
      n += res.affectedRows
    }
    return n
  })
  return { ok: true, saved }
}
