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
import type {
  BatchCreditUsageResponse,
  DocumentProcessingListResponse,
  DocumentProcessingRow,
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
