/**
 * @file lib/alt-text/document-processing.ts
 * @module Publishing · Alt Text
 * @kind Server-side library
 * @summary Phase 3 Task 13 — read-only aggregates for the Live Document AI Processing dashboard.
 * @usedBy app/api/alt-text/documents/processing, app/api/alt-text/batches/[id]/credits
 *
 * Nothing here enqueues, claims, generates or bills. Counts come from persisted occurrence and
 * asset rows in bounded, grouped queries (no N+1). Credit usage is attributed to a batch only via
 * the deterministic batch request ids the Phase 2 processor reserves under.
 */
import "server-only"
import { query } from "@/lib/db"
import { currentTenantId } from "@/lib/tenant-scope"
import type { HistoryActor, HistoryFailure } from "./history"
import { batchOperationKey } from "./batch-processor"
import { BATCH_ID_PATTERN, readBatchProgress } from "./batch-progress"
import { toPublicDocument } from "./document-service"
import { toDocumentRecord, type DocumentOwnerScope } from "./document-store"
import type { DocumentType } from "./document-records"
import { contextState } from "./document-image-review"
import { RETRY_BLOCKER_MESSAGES, maxImageAttemptsFromEnv, retryBlocker } from "./retry-policy"
import { BATCH_COMPLETED_ASSET_STATUSES } from "./store"
import type {
  BatchCreditUsageResponse,
  DocumentImageResultRow,
  DocumentImageResultsResponse,
  DocumentProcessingListResponse,
  DocumentProcessingRow,
  ImageResultAiStatus,
  ImageResultFilter,
  OccurrenceProcessingCounts,
} from "./document-processing-contract"

const COMPLETED = "'in_review','approved','rejected'"

/** Per-occurrence aggregate columns; `a` is the linked asset (null until linked). */
const COUNT_COLUMNS = `
  COALESCE(SUM(i.extraction_status = 'extracted'), 0) AS extracted,
  COALESCE(SUM(i.selected_for_processing = 1), 0) AS selected,
  COALESCE(SUM(a.batch_id IS NOT NULL), 0) AS submitted,
  COALESCE(SUM(a.batch_id IS NOT NULL AND a.status = 'uploaded'), 0) AS pending,
  COALESCE(SUM(a.batch_id IS NOT NULL AND a.status = 'processing'), 0) AS processing,
  COALESCE(SUM(a.batch_id IS NOT NULL AND a.status IN (${COMPLETED})), 0) AS completed,
  COALESCE(SUM(a.batch_id IS NOT NULL AND a.status = 'failed'), 0) AS failed,
  COALESCE(SUM(a.batch_id IS NOT NULL AND a.status = 'cancelled'), 0) AS cancelled`

const ASSET_JOIN = "LEFT JOIN alt_text_assets a ON a.tenant_id = i.tenant_id AND a.id = i.alt_text_asset_id"

const toCounts = (r: Record<string, unknown> | undefined): OccurrenceProcessingCounts => ({
  extracted: Number(r?.extracted ?? 0),
  selected: Number(r?.selected ?? 0),
  submitted: Number(r?.submitted ?? 0),
  pending: Number(r?.pending ?? 0),
  processing: Number(r?.processing ?? 0),
  completed: Number(r?.completed ?? 0),
  failed: Number(r?.failed ?? 0),
  cancelled: Number(r?.cancelled ?? 0),
})

const toIso = (v: unknown) => {
  if (v == null) return null
  const d = v instanceof Date ? v : new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export async function listDocumentProcessing(
  filter: { page: number; pageSize: number; documentType: DocumentType | null },
  scope: DocumentOwnerScope,
): Promise<Omit<DocumentProcessingListResponse, "success">> {
  const tenantId = currentTenantId()
  const owner = scope ? { sql: " AND d.uploaded_by = ?", params: [scope.uploadedBy] } : { sql: "", params: [] as number[] }
  const typeSql = filter.documentType ? " AND d.document_type = ?" : ""
  const typeParams = filter.documentType ? [filter.documentType] : []

  // Reuse the Task 4 document list for metadata (tenant + owner scoped) when no type filter applies.
  const docWhere = `d.tenant_id = ?${owner.sql}${typeSql}`
  const docParams = [tenantId, ...owner.params, ...typeParams]
  const pageSize = filter.pageSize
  const offset = (filter.page - 1) * pageSize

  const [idRows, totalsRows] = await Promise.all([
    query<any[]>(`SELECT d.id FROM alt_text_documents d WHERE ${docWhere} ORDER BY d.updated_at DESC, d.id DESC LIMIT ? OFFSET ?`, [...docParams, pageSize, offset]),
    query<any[]>(
      `SELECT (SELECT COUNT(*) FROM alt_text_documents d WHERE ${docWhere}) AS documents, ${COUNT_COLUMNS}
         FROM alt_text_document_images i ${ASSET_JOIN}
         JOIN alt_text_documents d ON d.tenant_id = i.tenant_id AND d.id = i.document_id
        WHERE i.tenant_id = ? AND ${docWhere}`,
      [...docParams, tenantId, ...docParams],
    ),
  ])
  const ids = idRows.map((r) => Number(r.id))
  const totals = { documents: Number(totalsRows[0]?.documents ?? 0), ...toCounts(totalsRows[0]) }
  if (!ids.length) return { rows: [], totals, page: filter.page, pageSize, total: totals.documents }

  const marks = ids.map(() => "?").join(",")
  const [docs, countRows, batchRows] = await Promise.all([
    // Same columns and mapping as the Task 4 list; storage references are stripped by toPublicDocument.
    query<any[]>(
      `SELECT d.id, d.project_id, d.upload_reference_id, d.file_object_id, d.private_storage_reference, d.original_filename, d.document_type,
              d.mime_type, d.file_size_bytes, d.upload_status, d.security_scan_status, d.processing_status, d.uploaded_by, d.created_at, d.updated_at
         FROM alt_text_documents d WHERE ${docWhere} AND d.id IN (${marks})`,
      [...docParams, ...ids],
    ).then((rs) => rs.map((r) => toPublicDocument(toDocumentRecord(r)))),
    query<any[]>(
      `SELECT i.document_id, ${COUNT_COLUMNS}, MAX(GREATEST(i.updated_at, COALESCE(a.updated_at, i.updated_at))) AS last_updated
         FROM alt_text_document_images i ${ASSET_JOIN}
        WHERE i.tenant_id = ? AND i.document_id IN (${marks})
        GROUP BY i.document_id`,
      [tenantId, ...ids],
    ),
    query<any[]>(
      `SELECT x.document_id, x.batch_id, b.status, b.created_at
         FROM (SELECT DISTINCT i.document_id, a.batch_id
                 FROM alt_text_document_images i JOIN alt_text_assets a ON a.tenant_id = i.tenant_id AND a.id = i.alt_text_asset_id
                WHERE i.tenant_id = ? AND i.document_id IN (${marks}) AND a.batch_id IS NOT NULL) x
         JOIN alt_text_batches b ON b.tenant_id = ? AND b.id = x.batch_id
        ORDER BY b.created_at DESC`,
      [tenantId, ...ids, tenantId],
    ),
  ])
  const byDoc = new Map(countRows.map((r) => [Number(r.document_id), r]))
  const batches = new Map<number, { id: string; status: string; batchCount: number }>()
  for (const r of batchRows) {
    const id = Number(r.document_id)
    const prev = batches.get(id)
    if (prev) prev.batchCount++
    else batches.set(id, { id: String(r.batch_id), status: String(r.status), batchCount: 1 })
  }
  const docById = new Map(docs.map((d) => [d.id, d]))
  const rows: DocumentProcessingRow[] = ids.flatMap((id) => {
    const document = docById.get(id)
    if (!document) return []
    const c = byDoc.get(id)
    const last = toIso(c?.last_updated)
    return [{ document, counts: toCounts(c), latestBatch: batches.get(id) ?? null, lastUpdatedAt: last && last > document.updatedAt ? last : document.updatedAt }]
  })
  return { rows, totals, page: filter.page, pageSize, total: totals.documents }
}

/** Constant SQL per filter — no user input is interpolated. Mirrors contextState() for context_review. */
const RESULT_FILTER_SQL: Record<ImageResultFilter, string> = {
  all: "",
  not_submitted: " AND (a.id IS NULL OR a.batch_id IS NULL)",
  pending: " AND a.batch_id IS NOT NULL AND a.status = 'uploaded'",
  processing: " AND a.batch_id IS NOT NULL AND a.status = 'processing'",
  completed: ` AND a.batch_id IS NOT NULL AND a.status IN (${COMPLETED})`,
  failed: " AND a.batch_id IS NOT NULL AND a.status = 'failed'",
  cancelled: " AND a.batch_id IS NOT NULL AND a.status = 'cancelled'",
  context_review:
    " AND (i.context_status = 'failed' OR (i.context_status = 'analyzed' AND (i.context_confidence = 'low' OR i.context_confidence IS NULL)))",
}

const ACTIVE_BATCH_SQL = new Set(["queued", "processing", "pause_requested", "cancel_requested"])

function aiStatusOf(batchId: string | null, status: string | null): ImageResultAiStatus {
  if (!batchId || !status) return "not_submitted"
  if (status === "uploaded") return "pending"
  if (status === "processing" || status === "failed" || status === "cancelled") return status
  return BATCH_COMPLETED_ASSET_STATUSES.includes(status) ? "completed" : "pending"
}

/**
 * Per-occurrence AI results for one document the caller already owns (checked by the route).
 * Read-only: one bounded page query plus a count; never enqueues, retries or bills.
 */
export async function listDocumentImageResults(
  documentId: number,
  q: { page: number; pageSize: number; filter: ImageResultFilter },
): Promise<Omit<DocumentImageResultsResponse, "success" | "documentId">> {
  const tenantId = currentTenantId()
  const where = `i.tenant_id = ? AND i.document_id = ? AND i.extraction_status = 'extracted'${RESULT_FILTER_SQL[q.filter]}`
  const from = `FROM alt_text_document_images i ${ASSET_JOIN} LEFT JOIN alt_text_batches b ON b.tenant_id = a.tenant_id AND b.id = a.batch_id`
  const params = [tenantId, documentId]
  const [rows, count] = await Promise.all([
    query<any[]>(
      `SELECT i.id, i.alt_text_asset_id, i.occurrence_index, i.page_number, i.slide_number, i.source_locator, i.context_status, i.context_confidence,
              a.status AS asset_status, a.batch_id, b.status AS batch_status, LEFT(a.short_alt, 200) AS short_alt_preview,
              a.error_message, a.error_code, a.attempts, a.current_version,
              GREATEST(i.updated_at, COALESCE(a.updated_at, i.updated_at)) AS last_updated
         ${from} WHERE ${where}
        ORDER BY i.occurrence_index ASC, i.id ASC LIMIT ? OFFSET ?`,
      [...params, q.pageSize, (q.page - 1) * q.pageSize],
    ),
    query<any[]>(`SELECT COUNT(*) AS n ${from} WHERE ${where}`, params),
  ])
  const maxAttempts = maxImageAttemptsFromEnv()
  let active = false
  const out: DocumentImageResultRow[] = rows.map((r) => {
    const batchId = r.batch_id == null ? null : String(r.batch_id)
    const assetStatus = r.asset_status == null ? null : String(r.asset_status)
    const aiStatus = aiStatusOf(batchId, assetStatus)
    const batchStatus = r.batch_status == null ? null : String(r.batch_status)
    if ((aiStatus === "pending" || aiStatus === "processing") && batchStatus && ACTIVE_BATCH_SQL.has(batchStatus)) active = true
    const blocker =
      aiStatus === "failed"
        ? retryBlocker(
            { status: "failed", currentVersion: Number(r.current_version ?? 0), errorCode: r.error_code ?? null, attempts: Number(r.attempts ?? 0) },
            maxAttempts,
          )
        : null
    return {
      imageId: Number(r.id),
      assetId: r.alt_text_asset_id == null ? null : Number(r.alt_text_asset_id),
      occurrenceIndex: Number(r.occurrence_index ?? 0),
      pageNumber: r.page_number == null ? null : Number(r.page_number),
      slideNumber: r.slide_number == null ? null : Number(r.slide_number),
      sourceLocator: String(r.source_locator ?? ""),
      contextState: contextState(r.context_status ?? null, r.context_confidence ?? null),
      aiStatus,
      assetStatus,
      batchId,
      batchStatus,
      shortAltPreview: aiStatus === "completed" ? (r.short_alt_preview ?? null) : null,
      failureReason: aiStatus === "failed" ? (r.error_message ?? null) : null,
      waitingReason: aiStatus === "pending" ? (r.error_message ?? null) : null,
      attempts: Number(r.attempts ?? 0),
      retryable: aiStatus === "failed" && blocker === null && batchId != null,
      retryBlockedReason: blocker ? RETRY_BLOCKER_MESSAGES[blocker] : null,
      updatedAt: toIso(r.last_updated) ?? new Date(0).toISOString(),
    }
  })
  return { rows: out, page: q.page, pageSize: q.pageSize, total: Number(count[0]?.n ?? 0), active }
}

/**
 * Credit usage attributable to one batch. Attribution is exact: the batch processor reserves every
 * attempt under `alttext:a{assetId}_{batchOperationKey(batchId, …)}`, and each reservation is joined
 * to an asset that currently belongs to the batch. Each reservation row is one attempt, so a settled
 * attempt is counted once. Callers without tenant-wide view only see their own reservations.
 */
export async function readBatchCreditUsage(batchId: string, actor: HistoryActor): Promise<{ ok: true; body: BatchCreditUsageResponse } | HistoryFailure> {
  if (!BATCH_ID_PATTERN.test(batchId)) return { ok: false, status: 400, code: "INVALID_BATCH_ID", error: "Invalid batch identifier." }
  const visible = await readBatchProgress(batchId, actor)
  if (!visible.ok) return visible
  const tenantId = currentTenantId()
  const keyPrefix = batchOperationKey(batchId, 0, 0).replace(/v0n0$/, "")
  const own = actor.viewScope !== "all"
  const rows = await query<any[]>(
    `SELECT r.status, r.model_id, r.credits, r.settled_credits, l.amount,
            JSON_UNQUOTE(JSON_EXTRACT(l.metadata_json, '$.needsReconciliation')) AS recon
       FROM alt_text_assets a
       JOIN ai_credit_reservations r
         ON r.tenant_id = a.tenant_id AND r.request_id LIKE CONCAT('alttext:a', a.id, '\\_', ?, 'v%')
       LEFT JOIN ai_credit_ledger l ON l.tenant_id = r.tenant_id AND l.idempotency_key = CONCAT('usage:', r.request_id)
      WHERE a.tenant_id = ? AND a.batch_id = ?${own ? " AND r.user_id = ?" : ""}
      LIMIT 5000`,
    own ? [keyPrefix, tenantId, batchId, actor.userId] : [keyPrefix, tenantId, batchId],
  ).catch((e: { code?: string }) => {
    if (e?.code === "ER_NO_SUCH_TABLE") return []
    throw e
  })
  const models = new Set<string>()
  const attempts = { total: 0, settled: 0, reserved: 0, released: 0, needsReconciliation: 0 }
  let creditsCharged = 0
  let creditsReserved = 0
  for (const r of rows) {
    attempts.total++
    if (r.model_id) models.add(String(r.model_id))
    if (r.status === "settled") {
      attempts.settled++
      creditsCharged += Number(r.settled_credits ?? Math.abs(Number(r.amount ?? 0)))
      if (r.recon === "true") attempts.needsReconciliation++
    } else if (r.status === "released") attempts.released++
    else {
      attempts.reserved++
      creditsReserved += Number(r.credits ?? 0)
    }
  }
  return {
    ok: true,
    body: { success: true, batchId, scope: own ? "own" : "batch", attribution: "request_id", models: [...models].sort(), attempts, creditsCharged, creditsReserved },
  }
}
