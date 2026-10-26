import "server-only"
import { query, withTransaction } from "@/lib/db"
import { currentTenantId } from "@/lib/tenant-scope"
import { ensureAltTextSchema } from "./store"
import { ensureBackgroundJobSchema, enqueueBackgroundJobInTransaction, type BackgroundJob, type PdfPageOcrJobPayload } from "@/lib/background-jobs"
import { canSelectPage, PDF_PAGE_OCR_LIMITS, type PageOcrPage, type PageOcrRequest, type PageOcrResult } from "./pdf-page-ocr-types"
import { derivePageOcrProgress, classifyDocument, type PageOcrStatus, type PageClass } from "./pdf-page-ocr-contract"

export const PAGE_OCR_TABLE_SQL = `CREATE TABLE IF NOT EXISTS alt_text_document_page_ocr (
  tenant_id BIGINT UNSIGNED NOT NULL, document_id BIGINT UNSIGNED NOT NULL, page_index INT UNSIGNED NOT NULL,
  source_sha256 CHAR(64) NOT NULL, page_class VARCHAR(32) NOT NULL, status VARCHAR(32) NOT NULL,
  evidence_json JSON NOT NULL, result_json JSON NULL, job_id BIGINT UNSIGNED NULL,
  attempts INT UNSIGNED NOT NULL DEFAULT 0, run_attempts INT UNSIGNED NOT NULL DEFAULT 0,
  error_code VARCHAR(80) NULL, next_attempt_at DATETIME NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, document_id, page_index), KEY page_ocr_work (tenant_id, job_id, status, page_index)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
let schema: Promise<void> | null = null
export function ensurePageOcrSchema() {
  schema ??= (async () => { await ensureAltTextSchema(); await ensureBackgroundJobSchema(); await query(PAGE_OCR_TABLE_SQL) })().catch((e) => { schema = null; throw e })
  return schema
}
const json = (v: unknown) => typeof v === "string" ? JSON.parse(v) : v
export function mapPageRow(row: any): PageOcrPage {
  return { ...json(row.evidence_json), pageIndex: Number(row.page_index), pageNumber: Number(row.page_index) + 1,
    sourceSha256: row.source_sha256, status: row.status, attempts: Number(row.attempts), jobId: row.job_id == null ? null : Number(row.job_id),
    errorCode: row.error_code, result: json(row.result_json), updatedAt: new Date(row.updated_at).toISOString() }
}
export async function readOcrPages(documentId: number, offset: number, limit: number, pageIndex?: number): Promise<PageOcrPage[]> {
  await ensurePageOcrSchema()
  // List responses are bounded previews. Only the selected page returns full layout and raw text.
  const result = pageIndex == null ? `IF(result_json IS NULL, NULL, JSON_SET(JSON_REMOVE(result_json, '$.layout', '$.lines'), '$.rawText', LEFT(JSON_UNQUOTE(JSON_EXTRACT(result_json,'$.rawText')),1200), '$.normalizedText', LEFT(JSON_UNQUOTE(JSON_EXTRACT(result_json,'$.normalizedText')),1200)))` : "result_json"
  const rows = await query<any[]>(`SELECT tenant_id, document_id, page_index, source_sha256, status, evidence_json, ${result} AS result_json, job_id, attempts, error_code, updated_at
    FROM alt_text_document_page_ocr WHERE tenant_id=? AND document_id=? ${pageIndex == null ? "" : "AND page_index=?"} ORDER BY page_index LIMIT ? OFFSET ?`,
    [currentTenantId(), documentId, ...(pageIndex == null ? [] : [pageIndex]), limit, offset])
  return rows.map(mapPageRow)
}
export async function pageOcrSummary(documentId: number) {
  await ensurePageOcrSchema()
  const rows = await query<any[]>(`SELECT status,page_class,job_id IS NOT NULL AS in_scope,COUNT(*) AS n FROM alt_text_document_page_ocr WHERE tenant_id=? AND document_id=? GROUP BY status,page_class,in_scope`, [currentTenantId(), documentId])
  const statuses = rows.flatMap((r) => Array(Number(r.n)).fill(r.status as PageOcrStatus))
  const classes = rows.flatMap((r) => Array(Number(r.n)).fill(r.page_class as PageClass))
  const progress = derivePageOcrProgress(statuses.length, statuses)
  const scoped = derivePageOcrProgress(statuses.length, rows.filter((r) => Number(r.in_scope)).flatMap((r) => Array(Number(r.n)).fill(r.status as PageOcrStatus)))
  return { total: statuses.length, progress: { ...progress, inScope: scoped.inScope, scopePercent: scoped.scopePercent, outcome: scoped.outcome }, documentClass: classifyDocument(classes) }
}
export async function latestPageOcrJob(documentId: number) {
  await ensurePageOcrSchema()
  const rows = await query<any[]>(`SELECT id,status,payload,error_message,result FROM platform_background_jobs
    WHERE tenant_id=? AND job_type='alt_text.pdf_page_ocr' AND JSON_EXTRACT(payload,'$.documentId')=? ORDER BY id DESC LIMIT 1`, [currentTenantId(), documentId])
  return rows[0] ? { id: Number(rows[0].id), status: rows[0].status as string, action: json(rows[0].payload).request.action as string,
    outcome: json(rows[0].result)?.outcome ?? null, errorCode: ["failed", "dead_letter"].includes(rows[0].status) ? "PAGE_OCR_JOB_FAILED" : null } : null
}
/** Reuse Task 5/6 evidence only when it belongs to the same occurrence and unchanged image bytes. */
export async function confirmedTextImages(documentId: number): Promise<Set<string>> {
  const rows = await query<any[]>(`SELECT DISTINCT i.source_locator FROM alt_text_document_images i
    JOIN alt_text_ocr_results r ON r.tenant_id=i.tenant_id AND r.asset_id=i.alt_text_asset_id AND r.occurrence_key IN (0,i.id)
    WHERE i.tenant_id=? AND i.document_id=? AND i.extraction_status='extracted' AND r.scope_key='full'
      AND r.status IN ('completed','completed_with_warnings')
      AND JSON_UNQUOTE(JSON_EXTRACT(r.result_json,'$.inputSha256'))=i.media_sha256
      AND CHAR_LENGTH(JSON_UNQUOTE(JSON_EXTRACT(r.result_json,'$.normalizedText')))>=40
      AND JSON_EXTRACT(r.result_json,'$.meanConfidence')>=60`, [currentTenantId(), documentId])
  return new Set(rows.map((r) => r.source_locator as string))
}
export async function enqueuePageOcr(documentId: number, userId: number, request: PageOcrRequest) {
  await ensurePageOcrSchema()
  const tenantId = currentTenantId()
  return withTransaction(async (conn) => {
    const [docs] = await conn.query<any[]>("SELECT id FROM alt_text_documents WHERE tenant_id=? AND id=? AND security_scan_status='clean' FOR UPDATE", [tenantId, documentId])
    if (!docs.length) throw new Error("DOCUMENT_NOT_CLEAN")
    const [priorRows] = await conn.query<any[]>(`SELECT id,status,payload FROM platform_background_jobs WHERE tenant_id=? AND job_type='alt_text.pdf_page_ocr' AND JSON_EXTRACT(payload,'$.documentId')=? ORDER BY id DESC LIMIT 1`, [tenantId, documentId])
    const prior = priorRows[0]
    if (prior && ["queued", "running"].includes(prior.status)) {
      if (JSON.stringify(json(prior.payload).request) !== JSON.stringify(request)) throw new Error("PAGE_OCR_JOB_ACTIVE")
      return { jobId: Number(prior.id), created: false }
    }
    let pages: number[] = []
    if (request.action === "recognize") {
      const [rows] = await conn.query<any[]>(`SELECT page_index, status, evidence_json, result_json IS NOT NULL AS has_result FROM alt_text_document_page_ocr WHERE tenant_id=? AND document_id=? ORDER BY page_index`, [tenantId, documentId])
      pages = rows.filter((r) => (!request.pages.length || request.pages.includes(Number(r.page_index))) && canSelectPage({ ...json(r.evidence_json), status: r.status, result: r.has_result ? {} : null }, request)).map((r) => Number(r.page_index))
      if (!pages.length) throw new Error("NO_ELIGIBLE_PAGES")
      if (request.pages.length && pages.length !== request.pages.length) throw new Error("PAGE_SELECTION_CHANGED")
    }
    const payload: PdfPageOcrJobPayload = { documentId, request }
    const queued = await enqueueBackgroundJobInTransaction(conn, { jobType: "alt_text.pdf_page_ocr", tenantId, payload,
      idempotencyKey: `pdf-ocr:${documentId}:after:${prior?.id ?? 0}`, concurrencyKey: `pdf-page-ocr:tenant:${tenantId}`, concurrencyLimit: 1,
      maxAttempts: 4, backoffSeconds: 30, timeoutSeconds: 280, createdBy: userId, triggerSource: "user_request" })
    if (pages.length) await conn.query(`UPDATE alt_text_document_page_ocr SET job_id=?,status='queued',error_code=NULL,run_attempts=0,next_attempt_at=NULL WHERE tenant_id=? AND document_id=? AND page_index IN (?)`, [queued.jobId, tenantId, documentId, pages])
    return queued
  })
}

/** Fences every worker write against the queue's live lease, not just the job ID. */
const leaseSql = `EXISTS (SELECT 1 FROM platform_background_jobs j WHERE j.id=? AND j.tenant_id=? AND j.worker_id=? AND j.status='running' AND j.lease_expires_at>UTC_TIMESTAMP())`
const leaseParams = (job: BackgroundJob) => [job.id, job.tenant_id, job.worker_id]
export async function saveInspectedPages(documentId: number, pages: PageOcrPage[], job: BackgroundJob) {
  await withTransaction(async (conn) => {
    const [lease] = await conn.query<any[]>(`SELECT id FROM platform_background_jobs j WHERE j.id=? AND j.tenant_id=? AND j.worker_id=? AND j.status='running' AND j.lease_expires_at>UTC_TIMESTAMP() FOR UPDATE`, leaseParams(job))
    if (!lease.length) throw new Error("OCR_LEASE_LOST")
    for (const p of pages) {
      const { result: _r, ...evidence } = p
      await conn.query(`INSERT INTO alt_text_document_page_ocr (tenant_id,document_id,page_index,source_sha256,page_class,status,evidence_json,error_code)
        VALUES (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE
          status=IF(source_sha256=VALUES(source_sha256),status,VALUES(status)),
          result_json=IF(source_sha256=VALUES(source_sha256),result_json,NULL),
          job_id=IF(source_sha256=VALUES(source_sha256),job_id,NULL),
          error_code=IF(source_sha256=VALUES(source_sha256),error_code,VALUES(error_code)),
          attempts=IF(source_sha256=VALUES(source_sha256),attempts,0),
          run_attempts=IF(source_sha256=VALUES(source_sha256),run_attempts,0),
          next_attempt_at=IF(source_sha256=VALUES(source_sha256),next_attempt_at,NULL),
          page_class=VALUES(page_class),evidence_json=VALUES(evidence_json),source_sha256=VALUES(source_sha256)`,
        [job.tenant_id, documentId, p.pageIndex, p.sourceSha256, p.classification.pageClass, p.status, JSON.stringify(evidence), p.errorCode])
    }
  })
}
export async function nextOcrPage(documentId: number, job: BackgroundJob) {
  const rows = await query<any[]>(`SELECT * FROM alt_text_document_page_ocr WHERE tenant_id=? AND document_id=? AND job_id=? AND status IN ('queued','rendering','recognizing') AND (next_attempt_at IS NULL OR next_attempt_at<=UTC_TIMESTAMP()) ORDER BY page_index LIMIT 1`, [job.tenant_id, documentId, job.id])
  return rows[0] ? { page: mapPageRow(rows[0]), runAttempts: Number(rows[0].run_attempts) } : null
}
export async function hasPendingOcr(job: BackgroundJob) {
  const rows = await query<any[]>(`SELECT COUNT(*) AS n FROM alt_text_document_page_ocr WHERE tenant_id=? AND job_id=? AND status IN ('queued','rendering','recognizing')`, [job.tenant_id, job.id])
  return Number(rows[0].n) > 0
}
export async function pageOcrJobOutcome(job: BackgroundJob) {
  const rows = await query<any[]>(`SELECT status,COUNT(*) AS n FROM alt_text_document_page_ocr WHERE tenant_id=? AND job_id=? GROUP BY status`, [job.tenant_id, job.id])
  const p = derivePageOcrProgress(rows.reduce((n,r) => n + Number(r.n),0), rows.flatMap((r) => Array(Number(r.n)).fill(r.status as PageOcrStatus)))
  return { completedScope: true, outcome: p.outcome, completed: p.completed + p.completedWithWarnings, noTextDetected: p.noTextDetected, failed: p.failed, unsupported: p.unsupported, cancelled: p.cancelled }
}
export async function writePageState(job: BackgroundJob, pageIndex: number, status: PageOcrStatus, options: { result?: PageOcrResult; errorCode?: string; attempt?: boolean; retrySeconds?: number } = {}) {
  if (options.result && Buffer.byteLength(JSON.stringify(options.result)) > PDF_PAGE_OCR_LIMITS.maxResultBytes) throw new Error("OCR_RESULT_LIMIT")
  const r = await query<any>(`UPDATE alt_text_document_page_ocr SET status=?,error_code=?,
    result_json=IF(? IS NULL,result_json,CAST(? AS JSON)), attempts=attempts+?,run_attempts=run_attempts+?,
    next_attempt_at=IF(? > 0,DATE_ADD(UTC_TIMESTAMP(),INTERVAL ? SECOND),NULL)
    WHERE tenant_id=? AND job_id=? AND page_index=? AND ${leaseSql}`,
    [status, options.errorCode ?? null, options.result ? JSON.stringify(options.result) : null, options.result ? JSON.stringify(options.result) : null,
      options.attempt ? 1 : 0, options.attempt ? 1 : 0, options.retrySeconds ?? 0, options.retrySeconds ?? 0, job.tenant_id, job.id, pageIndex, ...leaseParams(job)])
  if (!Number(r.affectedRows)) throw new Error("OCR_LEASE_LOST")
}
export async function settlePageOcr(job: BackgroundJob, status: string) {
  if (!["failed", "dead_letter", "cancelled"].includes(status)) return
  await query(`UPDATE alt_text_document_page_ocr p JOIN platform_background_jobs j ON j.id=p.job_id AND j.tenant_id=p.tenant_id
    SET p.status=?,p.error_code=? WHERE p.tenant_id=? AND p.job_id=? AND p.status IN ('queued','rendering','recognizing') AND j.status=?`,
    [status === "cancelled" ? "cancelled" : "failed", status === "cancelled" ? null : "PAGE_OCR_JOB_FAILED", job.tenant_id, job.id, status])
}
