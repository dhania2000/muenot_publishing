/**
 * @file lib/alt-text/document-image-review-store.ts
 * @module Publishing · Alt Text
 * @kind Server-only data access
 * @summary Phase 3 Task 10 — filtered/paginated occurrence listing, readiness summary, persisted
 *   selection and source-review updates on the existing alt_text_document_images rows. Every
 *   query is tenant- and document-scoped and parameterized; the caller has already verified
 *   document ownership. Eligibility is enforced inside the UPDATE so concurrent asset changes
 *   cannot mark an ineligible occurrence as selected.
 */
import "server-only"
import type { ResultSetHeader, RowDataPacket } from "mysql2"
import { query } from "@/lib/db"
import { currentTenantId } from "@/lib/tenant-scope"
import { ensureAltTextSchema } from "./store"
import { toDocumentImageRecord, type ImageDbRow } from "./document-store"
import { isDocumentType, type DocumentType } from "./document-records"
import {
  GENERATABLE_ASSET_STATUSES,
  PIPELINE_MIME_TYPES,
  SELECTION_SNAPSHOT_MAX,
  assessEligibility,
  existingAltText,
  isReviewStatus,
  type DocumentImageSelectionItem,
  type ImageListQuery,
  type ReadinessSummary,
  type ReviewImageRecord,
  type ReviewStatus,
} from "./document-image-review"

const tid = () => currentTenantId()
const list = (values: readonly string[]) => values.map((v) => `'${v.replace(/'/g, "")}'`).join(", ")

const FROM = `FROM alt_text_document_images i
  JOIN alt_text_documents d ON d.tenant_id = i.tenant_id AND d.id = i.document_id
  LEFT JOIN alt_text_assets a ON a.tenant_id = i.tenant_id AND a.id = i.alt_text_asset_id`

/** Mirrors assessEligibility(). Constants only — no user input is interpolated. */
export const ELIGIBLE_SQL = `(d.security_scan_status = 'clean' AND i.extraction_status = 'extracted' AND a.id IS NOT NULL
  AND a.mime_type IN (${list(PIPELINE_MIME_TYPES)}) AND a.status IN (${list(GENERATABLE_ASSET_STATUSES)}))`

const jsonText = (path: string) =>
  `COALESCE(JSON_TYPE(JSON_EXTRACT(i.source_metadata_json, '${path}')) = 'STRING' AND CHAR_LENGTH(TRIM(JSON_UNQUOTE(JSON_EXTRACT(i.source_metadata_json, '${path}')))) > 0, 0)`
/** Mirrors existingAltText(). */
export const HAS_ALT_SQL = `(${jsonText("$.originalDescription")} OR ${jsonText("$.pdf.structure.actualText")} OR ${jsonText("$.pdf.structure.markedContentAlt")})`

/** Mirrors contextState(). */
const CONTEXT_SQL: Record<NonNullable<ImageListQuery["context"]>, string> = {
  not_analyzed: "i.context_status IS NULL",
  needs_review: "(i.context_status = 'failed' OR (i.context_status = 'analyzed' AND i.context_confidence = 'low') OR (i.context_status = 'analyzed' AND i.context_confidence IS NULL))",
  unavailable: "(i.context_status = 'unavailable' OR (i.context_status = 'analyzed' AND i.context_confidence = 'unavailable'))",
  ready: "(i.context_status = 'analyzed' AND i.context_confidence IN ('high', 'medium'))",
}

const SELECTED_SQL = `(i.selected_for_processing = 1 AND ${ELIGIBLE_SQL})`

const SORT_SQL: Record<ImageListQuery["sort"], string> = {
  document: "i.occurrence_index ASC, i.id ASC",
  location: "COALESCE(i.slide_number, i.page_number) IS NULL, COALESCE(i.slide_number, i.page_number) ASC, i.occurrence_index ASC, i.id ASC",
  newest: "i.created_at DESC, i.id DESC",
  oldest: "i.created_at ASC, i.id ASC",
}

const SEARCH_FIELDS = [
  "LOWER(i.source_locator)",
  "LOWER(d.original_filename)",
  "LOWER(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(i.source_metadata_json, '$.name')), ''))",
  "LOWER(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(i.source_metadata_json, '$.title')), ''))",
  "LOWER(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(i.source_metadata_json, '$.mediaPart')), ''))",
  "LOWER(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(i.source_metadata_json, '$.pdf.resourceName')), ''))",
]

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)

export function buildImageWhere(documentId: number, q: Omit<ImageListQuery, "page" | "pageSize" | "sort">): { sql: string; params: unknown[] } {
  const parts = ["i.tenant_id = ?", "i.document_id = ?"]
  const params: unknown[] = [tid(), documentId]
  if (q.extraction) {
    parts.push("i.extraction_status = ?")
    params.push(q.extraction)
  }
  if (q.alt) parts.push(q.alt === "has" ? HAS_ALT_SQL : `NOT ${HAS_ALT_SQL}`)
  if (q.context) parts.push(CONTEXT_SQL[q.context])
  if (q.selection) parts.push(q.selection === "selected" ? SELECTED_SQL : `NOT ${SELECTED_SQL}`)
  if (q.mediaSha256) {
    parts.push("i.media_sha256 = ?")
    params.push(q.mediaSha256)
  }
  if (q.search) {
    const like = `%${escapeLike(q.search.toLowerCase())}%`
    parts.push(`(${SEARCH_FIELDS.map((f) => `${f} LIKE ?`).join(" OR ")})`)
    params.push(...SEARCH_FIELDS.map(() => like))
  }
  return { sql: parts.join(" AND "), params }
}

type ReviewDbRow = ImageDbRow & {
  original_filename: string
  document_type: string
  security_scan_status: string
  asset_exists: number | null
  asset_mime_type: string | null
  selected_for_processing: number | boolean | null
  selection_updated_at: Date | string | null
  review_status: string | null
  reviewed_at: Date | string | null
  context_version: number | null
  duplicate_count: number | string | null
}

const iso = (v: Date | string | null) => {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function toReviewImageRecord(row: ReviewDbRow): ReviewImageRecord {
  const base = toDocumentImageRecord(row)
  const duplicateCount = base.mediaSha256 ? Math.max(1, Number(row.duplicate_count ?? 1)) : null
  const eligibility = assessEligibility({
    documentSecurityStatus: row.security_scan_status,
    extractionStatus: base.extractionStatus,
    altTextAssetId: base.altTextAssetId,
    assetExists: Number(row.asset_exists ?? 0) === 1,
    assetMimeType: row.asset_mime_type,
    assetStatus: base.assetStatus,
    contextStatus: base.contextStatus,
    contextConfidence: base.contextConfidence,
    hasExistingAlt: existingAltText(base) != null,
    isDecorative: base.isDecorative,
    duplicateCount: duplicateCount ?? 1,
  })
  const selectionStored = Number(row.selected_for_processing ?? 0) === 1
  return {
    ...base,
    documentFilename: row.original_filename,
    documentType: (isDocumentType(row.document_type) ? row.document_type : "pdf") as DocumentType,
    assetMimeType: row.asset_mime_type,
    selected: selectionStored && eligibility.eligible,
    selectionStored,
    selectionUpdatedAt: iso(row.selection_updated_at),
    reviewStatus: isReviewStatus(row.review_status) ? row.review_status : "not_reviewed",
    reviewedAt: iso(row.reviewed_at),
    duplicateCount,
    contextVersion: row.context_version == null ? null : Number(row.context_version),
    eligibility,
  }
}

const REVIEW_COLUMNS = `i.id, i.document_id, i.alt_text_asset_id, a.status AS asset_status, i.source_locator, i.occurrence_index,
  i.page_number, i.slide_number, i.image_relationship_id, i.image_position_json, i.is_decorative, i.media_sha256,
  i.source_metadata_json, i.extraction_status, i.extraction_error_code, i.extraction_error_message,
  i.context_status, i.context_confidence, i.context_analyzed_at, i.context_version, i.created_at, i.updated_at,
  d.original_filename, d.document_type, d.security_scan_status,
  (a.id IS NOT NULL) AS asset_exists, a.mime_type AS asset_mime_type,
  i.selected_for_processing, i.selection_updated_at, i.review_status, i.reviewed_at,
  COALESCE(dup.n, 1) AS duplicate_count`

/** Duplicate counts come from one grouped derived table per page — no per-row (N+1) queries. */
const DUP_JOIN = `LEFT JOIN (
    SELECT media_sha256, COUNT(*) AS n FROM alt_text_document_images
     WHERE tenant_id = ? AND document_id = ? AND media_sha256 IS NOT NULL GROUP BY media_sha256
  ) dup ON dup.media_sha256 = i.media_sha256`

export async function listReviewImages(documentId: number, q: ImageListQuery): Promise<{ images: ReviewImageRecord[]; total: number }> {
  await ensureAltTextSchema()
  const where = buildImageWhere(documentId, q)
  const [rows, count] = await Promise.all([
    query<ReviewDbRow[]>(
      `SELECT ${REVIEW_COLUMNS} ${FROM} ${DUP_JOIN} WHERE ${where.sql} ORDER BY ${SORT_SQL[q.sort]} LIMIT ? OFFSET ?`,
      [tid(), documentId, ...where.params, q.pageSize, (q.page - 1) * q.pageSize],
    ),
    query<(RowDataPacket & { total: number | string })[]>(`SELECT COUNT(*) AS total ${FROM} WHERE ${where.sql}`, where.params),
  ])
  return { images: rows.map(toReviewImageRecord), total: Number(count[0]?.total ?? 0) }
}

export async function getReviewImage(documentId: number, imageId: number): Promise<ReviewImageRecord | null> {
  await ensureAltTextSchema()
  const rows = await query<ReviewDbRow[]>(`SELECT ${REVIEW_COLUMNS} ${FROM} ${DUP_JOIN} WHERE i.tenant_id = ? AND i.document_id = ? AND i.id = ? LIMIT 1`, [
    tid(),
    documentId,
    tid(),
    documentId,
    imageId,
  ])
  return rows[0] ? toReviewImageRecord(rows[0]) : null
}

const n = (v: unknown) => Number(v ?? 0)

export async function getReadinessSummary(documentId: number): Promise<ReadinessSummary> {
  await ensureAltTextSchema()
  const [counts, dups] = await Promise.all([
    query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(i.extraction_status = 'extracted'), 0) AS extracted,
              COALESCE(SUM(${ELIGIBLE_SQL}), 0) AS eligible,
              COALESCE(SUM(${SELECTED_SQL}), 0) AS selected,
              COALESCE(SUM(${HAS_ALT_SQL}), 0) AS with_alt,
              COALESCE(SUM(i.extraction_status IN ('failed', 'unsupported')), 0) AS unsupported_failed,
              COALESCE(SUM(i.extraction_status = 'extracted' AND i.review_status <> 'reviewed'), 0) AS needing_review,
              COALESCE(SUM(i.review_status = 'needs_attention'), 0) AS needs_attention
         ${FROM} WHERE i.tenant_id = ? AND i.document_id = ?`,
      [tid(), documentId],
    ),
    query<RowDataPacket[]>(
      `SELECT COUNT(*) AS binaries, COALESCE(SUM(g.n > 1), 0) AS dup_groups, COALESCE(SUM(CASE WHEN g.n > 1 THEN g.n ELSE 0 END), 0) AS dup_occurrences
         FROM (SELECT media_sha256, COUNT(*) AS n FROM alt_text_document_images
                WHERE tenant_id = ? AND document_id = ? AND media_sha256 IS NOT NULL GROUP BY media_sha256) g`,
      [tid(), documentId],
    ),
  ])
  const c = counts[0] ?? {}
  const g = dups[0] ?? {}
  return {
    totalOccurrences: n(c.total),
    extractedOccurrences: n(c.extracted),
    eligibleOccurrences: n(c.eligible),
    selectedOccurrences: n(c.selected),
    withExistingAlt: n(c.with_alt),
    unsupportedOrFailed: n(c.unsupported_failed),
    needingReview: n(c.needing_review),
    needsAttention: n(c.needs_attention),
    duplicateBinaryGroups: n(g.dup_groups),
    duplicateOccurrences: n(g.dup_occurrences),
    uniqueBinaries: n(g.binaries),
  }
}

export type MutationOutcome = { applied: number[]; ineligible: number[]; notFound: number[]; changed: number }

const placeholders = (ids: number[]) => ids.map(() => "?").join(", ")

/** Classify the requested ids after a write; reporting only — the write itself was atomic. */
async function classify(documentId: number, ids: number[], target: "selected" | "deselected" | "any"): Promise<Omit<MutationOutcome, "changed">> {
  const rows = await query<(RowDataPacket & { id: number; eligible: number; selected: number })[]>(
    `SELECT i.id, ${ELIGIBLE_SQL} AS eligible, i.selected_for_processing AS selected ${FROM}
      WHERE i.tenant_id = ? AND i.document_id = ? AND i.id IN (${placeholders(ids)})`,
    [tid(), documentId, ...ids],
  )
  const found = new Map(rows.map((r) => [Number(r.id), r]))
  const out = { applied: [] as number[], ineligible: [] as number[], notFound: [] as number[] }
  for (const id of ids) {
    const r = found.get(id)
    if (!r) out.notFound.push(id)
    else if (target === "selected" && !(n(r.eligible) === 1 && n(r.selected) === 1)) out.ineligible.push(id)
    else out.applied.push(id)
  }
  return out
}

/**
 * Select / deselect specific occurrences. Selecting only touches rows that are eligible at the
 * moment of the UPDATE; repeating the request is a no-op. `updated_at` is preserved because
 * selection is not a change to the extracted mapping.
 */
export async function setSelection(documentId: number, ids: number[], selected: boolean, userId: number): Promise<MutationOutcome> {
  await ensureAltTextSchema()
  const res = await query<ResultSetHeader>(
    `UPDATE alt_text_document_images i
       JOIN alt_text_documents d ON d.tenant_id = i.tenant_id AND d.id = i.document_id
       LEFT JOIN alt_text_assets a ON a.tenant_id = i.tenant_id AND a.id = i.alt_text_asset_id
        SET i.selected_for_processing = ?, i.selection_updated_at = CURRENT_TIMESTAMP, i.selection_updated_by = ?, i.updated_at = i.updated_at
      WHERE i.tenant_id = ? AND i.document_id = ? AND i.id IN (${placeholders(ids)}) AND i.selected_for_processing <> ?${selected ? ` AND ${ELIGIBLE_SQL}` : ""}`,
    [selected ? 1 : 0, userId, tid(), documentId, ...ids, selected ? 1 : 0],
  )
  const outcome = await classify(documentId, ids, selected ? "selected" : "deselected")
  return { ...outcome, changed: res.affectedRows }
}

/** Document-wide selection is resolved on the server from persisted rows, never from a loaded page. */
export async function selectAllEligible(documentId: number, userId: number): Promise<number> {
  await ensureAltTextSchema()
  const res = await query<ResultSetHeader>(
    `UPDATE alt_text_document_images i
       JOIN alt_text_documents d ON d.tenant_id = i.tenant_id AND d.id = i.document_id
       LEFT JOIN alt_text_assets a ON a.tenant_id = i.tenant_id AND a.id = i.alt_text_asset_id
        SET i.selected_for_processing = 1, i.selection_updated_at = CURRENT_TIMESTAMP, i.selection_updated_by = ?, i.updated_at = i.updated_at
      WHERE i.tenant_id = ? AND i.document_id = ? AND i.selected_for_processing = 0 AND ${ELIGIBLE_SQL}`,
    [userId, tid(), documentId],
  )
  return res.affectedRows
}

export async function clearSelection(documentId: number, userId: number): Promise<number> {
  await ensureAltTextSchema()
  const res = await query<ResultSetHeader>(
    `UPDATE alt_text_document_images
        SET selected_for_processing = 0, selection_updated_at = CURRENT_TIMESTAMP, selection_updated_by = ?, updated_at = updated_at
      WHERE tenant_id = ? AND document_id = ? AND selected_for_processing = 1`,
    [userId, tid(), documentId],
  )
  return res.affectedRows
}

/** Source review state only — never touches alt text, asset status or approvals (Task 14). */
export async function setReviewStatus(documentId: number, ids: number[], status: ReviewStatus, userId: number): Promise<MutationOutcome> {
  await ensureAltTextSchema()
  const reset = status === "not_reviewed"
  const res = await query<ResultSetHeader>(
    `UPDATE alt_text_document_images
        SET review_status = ?, reviewed_at = ${reset ? "NULL" : "CURRENT_TIMESTAMP"}, reviewed_by = ?, updated_at = updated_at
      WHERE tenant_id = ? AND document_id = ? AND id IN (${placeholders(ids)}) AND review_status <> ?`,
    [status, reset ? null : userId, tid(), documentId, ...ids, status],
  )
  const outcome = await classify(documentId, ids, "any")
  return { ...outcome, changed: res.affectedRows }
}

/** Explicit eligible-item snapshot for Tasks 11–12 (selected AND eligible right now). */
export async function getSelectionSnapshot(documentId: number): Promise<{ total: number; items: DocumentImageSelectionItem[] }> {
  await ensureAltTextSchema()
  const where = `i.tenant_id = ? AND i.document_id = ? AND ${SELECTED_SQL}`
  const [rows, count] = await Promise.all([
    query<ReviewDbRow[]>(`SELECT ${REVIEW_COLUMNS} ${FROM} ${DUP_JOIN} WHERE ${where} ORDER BY i.occurrence_index, i.id LIMIT ?`, [
      tid(),
      documentId,
      tid(),
      documentId,
      SELECTION_SNAPSHOT_MAX,
    ]),
    query<(RowDataPacket & { total: number | string })[]>(`SELECT COUNT(*) AS total ${FROM} WHERE ${where}`, [tid(), documentId]),
  ])
  const items = rows
    .map(toReviewImageRecord)
    .filter((r) => r.selected && r.altTextAssetId != null && r.assetMimeType)
    .map<DocumentImageSelectionItem>((r) => ({
      documentId: r.documentId,
      imageId: r.id,
      altTextAssetId: r.altTextAssetId as number,
      sourceLocator: r.sourceLocator,
      mediaSha256: r.mediaSha256,
      mimeType: r.assetMimeType as string,
      context: { imageId: r.id, status: r.contextStatus, confidence: r.contextConfidence, version: r.contextVersion },
      eligibility: r.eligibility,
    }))
  return { total: Number(count[0]?.total ?? 0), items }
}
