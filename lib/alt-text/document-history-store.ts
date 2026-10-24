/**
 * @file lib/alt-text/document-history-store.ts
 * @module Publishing · Alt Text
 * @kind Server data access
 * @summary Phase 3 Task 19 — read-only, tenant-scoped history queries over the existing
 *   document, occurrence, asset, version, batch, job, export and validation tables.
 *   No new tables; never reads binaries for list views; every query is bounded.
 */
import "server-only"
import type { RowDataPacket } from "mysql2"
import { query } from "@/lib/db"
import { currentTenantId } from "@/lib/tenant-scope"
import { ensureBackgroundJobSchema } from "@/lib/background-jobs"
import { ensureAltTextSchema } from "./store"
import { ensureExportSchema } from "./docx-export-store"
import { ensureSchema as ensureValidationSchema } from "./output-validation-store"
import { existingAltText } from "./document-image-review"
import type { DocumentImageRecord } from "./document-records"
import type {
  DocumentHistoryDetail,
  DocumentHistoryFilter,
  HistoryBatch,
  HistoryDocumentRow,
  HistoryJob,
  HistoryOutput,
  HistoryValidationRun,
  OccurrenceHistoryResponse,
  OccurrenceOption,
  OccurrenceVersion,
  TimelineEvent,
} from "./document-history-contract"
import type { OverallStatus, ValidationCounts } from "./output-validation-contract"

type OwnerScope = { uploadedBy: number } | null | undefined
type Row = RowDataPacket & Record<string, unknown>

const PREPARATION_JOB_TYPE = "alt_text.document_preparation"
const BATCH_JOB_TYPE = "alt_text.batch_processing"
const AI_COMPLETED = "'in_review','approved','rejected'"
const TIMELINE_SOURCE_LIMIT = 100

const tid = () => currentTenantId()
const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString())
const num = (v: unknown): number => Number(v ?? 0)
const str = (v: unknown): string | null => (v == null ? null : String(v))
const json = <T>(v: unknown): T | null => {
  if (v == null) return null
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T
    } catch {
      return null
    }
  }
  return v as T
}

let ready: Promise<void> | null = null
/** Existing schemas plus one supporting index for the "last updated" sort. */
function ensureHistorySchema(): Promise<void> {
  ready ??= (async () => {
    await ensureAltTextSchema()
    await Promise.all([ensureExportSchema(), ensureValidationSchema(), ensureBackgroundJobSchema()])
    await query("ALTER TABLE alt_text_documents ADD INDEX idx_alt_documents_tenant_updated (tenant_id, updated_at)").catch((e: { code?: string }) => {
      if (e?.code !== "ER_DUP_KEYNAME") throw e
    })
  })().catch((e) => {
    ready = null
    throw e
  })
  return ready
}

function ownerClause(scope: OwnerScope) {
  return scope ? { sql: " AND d.uploaded_by = ?", params: [scope.uploadedBy] } : { sql: "", params: [] as unknown[] }
}

/** Effective approval mirrors Task 14: an approval is current only while it targets the asset's current version. */
const APPROVED_SQL = `(SELECT COUNT(*) FROM alt_text_document_images i JOIN alt_text_assets a ON a.tenant_id = i.tenant_id AND a.id = i.alt_text_asset_id
  WHERE i.tenant_id = d.tenant_id AND i.document_id = d.id AND i.alt_review_status = 'approved' AND i.approved_version_id IS NOT NULL AND i.approved_version = a.current_version)`
const LATEST_VALIDATION_SQL = `(SELECT v.overall_status FROM alt_text_output_validations v
  WHERE v.tenant_id = d.tenant_id AND v.document_id = d.id AND v.status = 'completed' ORDER BY v.id DESC LIMIT 1)`
const COMPLETED_EXPORTS_SQL = `(SELECT COUNT(*) FROM alt_text_document_exports e WHERE e.tenant_id = d.tenant_id AND e.document_id = d.id AND e.status = 'completed')`

const ROW_COLUMNS = `d.id, d.upload_reference_id, d.project_id, d.original_filename, d.document_type, d.mime_type, d.file_size_bytes,
  d.upload_status, d.security_scan_status, d.processing_status, d.preparation_stage, d.preparation_error_code, d.preparation_job_id, d.file_object_id,
  d.uploaded_by, u.name AS uploader_name, d.created_at, d.updated_at,
  (SELECT COUNT(*) FROM alt_text_document_images i WHERE i.tenant_id = d.tenant_id AND i.document_id = d.id AND i.extraction_status = 'extracted') AS extracted_images,
  (SELECT COUNT(*) FROM alt_text_document_images i JOIN alt_text_assets a ON a.tenant_id = i.tenant_id AND a.id = i.alt_text_asset_id
     WHERE i.tenant_id = d.tenant_id AND i.document_id = d.id AND a.status IN (${AI_COMPLETED})) AS ai_generated_images,
  ${APPROVED_SQL} AS approved_images,
  ${COMPLETED_EXPORTS_SQL} AS completed_exports,
  ${LATEST_VALIDATION_SQL} AS latest_validation`

const FROM = `FROM alt_text_documents d LEFT JOIN users u ON u.id = d.uploaded_by AND u.tenant_id = d.tenant_id`

function toRow(r: Row): HistoryDocumentRow {
  return {
    id: num(r.id),
    uploadId: String(r.upload_reference_id),
    projectId: r.project_id == null ? null : num(r.project_id),
    filename: String(r.original_filename),
    documentType: String(r.document_type) as HistoryDocumentRow["documentType"],
    size: num(r.file_size_bytes),
    uploadStatus: String(r.upload_status) as HistoryDocumentRow["uploadStatus"],
    securityStatus: String(r.security_scan_status) as HistoryDocumentRow["securityStatus"],
    processingStatus: String(r.processing_status) as HistoryDocumentRow["processingStatus"],
    preparationStage: str(r.preparation_stage),
    extractedImages: num(r.extracted_images),
    aiGeneratedImages: num(r.ai_generated_images),
    approvedImages: num(r.approved_images),
    completedExports: num(r.completed_exports),
    latestValidation: (str(r.latest_validation) as OverallStatus | null) ?? null,
    uploadedBy: num(r.uploaded_by),
    uploaderName: str(r.uploader_name),
    createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
    updatedAt: iso(r.updated_at) ?? new Date(0).toISOString(),
  }
}

const ORDER: Record<DocumentHistoryFilter["sort"], string> = {
  updated_desc: "d.updated_at DESC, d.id DESC",
  created_desc: "d.created_at DESC, d.id DESC",
  created_asc: "d.created_at ASC, d.id ASC",
  name_asc: "d.original_filename ASC, d.id ASC",
}

export async function listDocumentHistory(f: DocumentHistoryFilter, scope: OwnerScope): Promise<{ documents: HistoryDocumentRow[]; total: number }> {
  await ensureHistorySchema()
  const owner = ownerClause(scope)
  let where = `d.tenant_id = ?${owner.sql}`
  const params: unknown[] = [tid(), ...owner.params]
  if (f.search) {
    where += " AND d.original_filename LIKE ? ESCAPE '\\\\'"
    params.push(`%${f.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)
  }
  if (f.type) {
    where += " AND d.document_type = ?"
    params.push(f.type)
  }
  if (f.status) {
    where += " AND d.processing_status = ?"
    params.push(f.status)
  }
  if (f.projectId != null) {
    where += " AND d.project_id = ?"
    params.push(f.projectId)
  }
  if (f.from) {
    where += " AND d.created_at >= ?"
    params.push(`${f.from} 00:00:00`)
  }
  if (f.to) {
    where += " AND d.created_at < DATE_ADD(?, INTERVAL 1 DAY)"
    params.push(`${f.to} 00:00:00`)
  }
  switch (f.output) {
    case "none":
      where += ` AND ${COMPLETED_EXPORTS_SQL} = 0`
      break
    case "available":
      where += ` AND ${COMPLETED_EXPORTS_SQL} > 0`
      break
    case "passed":
      where += ` AND ${LATEST_VALIDATION_SQL} = 'passed'`
      break
    case "warnings":
      where += ` AND ${LATEST_VALIDATION_SQL} = 'passed_with_warnings'`
      break
    case "failed":
      where += ` AND ${LATEST_VALIDATION_SQL} = 'failed'`
      break
    case "not_verified":
      where += ` AND ${LATEST_VALIDATION_SQL} IN ('not_verified','manual_review_required')`
      break
  }
  const [rows, count] = await Promise.all([
    query<Row[]>(`SELECT ${ROW_COLUMNS} ${FROM} WHERE ${where} ORDER BY ${ORDER[f.sort]} LIMIT ? OFFSET ?`, [...params, f.pageSize, (f.page - 1) * f.pageSize]),
    query<Row[]>(`SELECT COUNT(*) AS total FROM alt_text_documents d WHERE ${where}`, params),
  ])
  return { documents: rows.map(toRow), total: num(count[0]?.total) }
}

async function loadDocumentRow(documentId: number, scope: OwnerScope): Promise<Row | null> {
  const owner = ownerClause(scope)
  const rows = await query<Row[]>(
    `SELECT ${ROW_COLUMNS},
       (SELECT COUNT(*) FROM alt_text_document_images i WHERE i.tenant_id = d.tenant_id AND i.document_id = d.id) AS total_occurrences,
       (SELECT COUNT(*) FROM alt_text_document_images i WHERE i.tenant_id = d.tenant_id AND i.document_id = d.id AND i.alt_review_status = 'approved' AND i.approved_decorative = 1) AS decorative_approved,
       EXISTS(SELECT 1 FROM app_files f JOIN app_file_blobs b ON b.tenant_id = f.tenant_id AND b.object_key = f.object_key
         WHERE f.id = d.file_object_id AND f.tenant_id = d.tenant_id AND f.file_ref = d.private_storage_reference AND f.upload_status <> 'deleted') AS original_available
     ${FROM} WHERE d.tenant_id = ? AND d.id = ?${owner.sql} LIMIT 1`,
    [tid(), documentId, ...owner.params],
  )
  return rows[0] ?? null
}

/** Ownership check shared by the history routes. Returns null when not visible to the actor. */
export async function historyDocumentExists(documentId: number, scope: OwnerScope): Promise<boolean> {
  await ensureHistorySchema()
  const owner = ownerClause(scope)
  const rows = await query<Row[]>(`SELECT d.id FROM alt_text_documents d WHERE d.tenant_id = ? AND d.id = ?${owner.sql} LIMIT 1`, [tid(), documentId, ...owner.params])
  return rows.length > 0
}

async function loadJobs(documentId: number, currentJobId: number | null, errorCode: string | null): Promise<HistoryJob[]> {
  const rows = await query<Row[]>(
    `SELECT id, status, attempts, max_attempts, created_at, started_at, completed_at, updated_at
       FROM platform_background_jobs
      WHERE tenant_id = ? AND job_type = ? AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.documentId')) = ?
      ORDER BY id DESC LIMIT 50`,
    [tid(), PREPARATION_JOB_TYPE, String(documentId)],
  )
  return rows.map((r) => {
    const isCurrent = currentJobId != null && num(r.id) === currentJobId
    return {
      id: num(r.id),
      kind: "document_preparation",
      status: String(r.status),
      attempts: num(r.attempts),
      maxAttempts: num(r.max_attempts),
      createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
      startedAt: iso(r.started_at),
      completedAt: iso(r.completed_at),
      updatedAt: iso(r.updated_at) ?? new Date(0).toISOString(),
      errorCode: isCurrent ? errorCode : null,
      isCurrent,
    }
  })
}

async function loadBatches(documentId: number): Promise<HistoryBatch[]> {
  const rows = await query<Row[]>(
    `SELECT b.id, b.name, b.status, b.created_at, x.submitted, x.completed, x.failed, x.model_id, j.completed_at
       FROM (SELECT a.batch_id, COUNT(*) AS submitted, SUM(a.status IN (${AI_COMPLETED})) AS completed, SUM(a.status = 'failed') AS failed, MAX(a.model_id) AS model_id
               FROM alt_text_document_images i JOIN alt_text_assets a ON a.tenant_id = i.tenant_id AND a.id = i.alt_text_asset_id
              WHERE i.tenant_id = ? AND i.document_id = ? AND a.batch_id IS NOT NULL GROUP BY a.batch_id) x
       JOIN alt_text_batches b ON b.tenant_id = ? AND b.id = x.batch_id
       LEFT JOIN platform_background_jobs j ON j.tenant_id = b.tenant_id AND j.job_type = ? AND j.idempotency_key = CONCAT('alt-text-batch:', b.id)
      ORDER BY b.created_at DESC LIMIT 50`,
    [tid(), documentId, tid(), BATCH_JOB_TYPE],
  )
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    status: String(r.status),
    modelId: str(r.model_id),
    submitted: num(r.submitted),
    completed: num(r.completed),
    failed: num(r.failed),
    createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
    completedAt: iso(r.completed_at),
  }))
}

async function loadOutputs(documentId: number): Promise<HistoryOutput[]> {
  const rows = await query<Row[]>(
    `SELECT e.id, e.output_ref, e.format, e.status, e.policy, e.output_filename, e.output_size_bytes, e.updated_count, e.skipped_count, e.unsupported_count, e.failed_count,
            JSON_EXTRACT(e.report, '$.summary.existingAltTextPreserved') AS preserved, JSON_EXTRACT(e.report, '$.summary.pictureCount') AS picture_count,
            e.error_code, e.created_by, u.name AS created_by_name, e.created_at, e.completed_at,
            (e.output_object_key IS NOT NULL AND EXISTS(SELECT 1 FROM app_file_blobs b WHERE b.tenant_id = e.tenant_id AND b.object_key = e.output_object_key)) AS file_available,
            (SELECT v.overall_status FROM alt_text_output_validations v WHERE v.tenant_id = e.tenant_id AND v.output_ref = e.output_ref AND v.status = 'completed' ORDER BY v.id DESC LIMIT 1) AS latest_validation,
            (SELECT COUNT(*) FROM alt_text_output_validations v WHERE v.tenant_id = e.tenant_id AND v.output_ref = e.output_ref) AS validation_runs
       FROM alt_text_document_exports e LEFT JOIN users u ON u.id = e.created_by AND u.tenant_id = e.tenant_id
      WHERE e.tenant_id = ? AND e.document_id = ? ORDER BY e.id ASC LIMIT 200`,
    [tid(), documentId],
  )
  let seq = 0
  const outputs = rows.map((r) => {
    const completed = String(r.status) === "completed"
    return {
      outputId: String(r.output_ref),
      version: completed ? ++seq : null,
      format: String(r.format) as HistoryOutput["format"],
      status: String(r.status),
      policy: String(r.policy),
      filename: String(r.output_filename),
      sizeBytes: r.output_size_bytes == null ? null : num(r.output_size_bytes),
      updated: num(r.updated_count),
      skipped: num(r.skipped_count),
      unsupported: num(r.unsupported_count),
      failed: num(r.failed_count),
      preserved: r.preserved == null ? null : num(json(r.preserved)),
      pictureCount: r.picture_count == null ? null : num(json(r.picture_count)),
      errorCode: str(r.error_code),
      createdBy: num(r.created_by),
      createdByName: str(r.created_by_name),
      createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
      completedAt: iso(r.completed_at),
      fileAvailable: completed && num(r.file_available) === 1,
      latestValidation: str(r.latest_validation) as OverallStatus | null,
      validationRuns: num(r.validation_runs),
    }
  })
  return outputs.reverse()
}

async function loadValidations(documentId: number, versions: Map<string, number | null>): Promise<HistoryValidationRun[]> {
  const rows = await query<Row[]>(
    `SELECT v.run_ref, v.output_ref, v.status, v.rule_version, v.overall_status, v.readiness, v.pass_rate, JSON_EXTRACT(v.report, '$.summary.counts') AS counts,
            v.error_code, u.name AS created_by_name, v.created_at, v.completed_at
       FROM alt_text_output_validations v
       JOIN alt_text_document_exports e ON e.tenant_id = v.tenant_id AND e.output_ref = v.output_ref AND e.document_id = v.document_id
       LEFT JOIN users u ON u.id = v.created_by AND u.tenant_id = v.tenant_id
      WHERE v.tenant_id = ? AND v.document_id = ? ORDER BY v.id DESC LIMIT 200`,
    [tid(), documentId],
  )
  return rows.map((r) => ({
    runId: String(r.run_ref),
    outputId: String(r.output_ref),
    outputVersion: versions.get(String(r.output_ref)) ?? null,
    status: String(r.status),
    ruleVersion: String(r.rule_version),
    overallStatus: str(r.overall_status) as OverallStatus | null,
    readiness: str(r.readiness),
    passRate: r.pass_rate == null ? null : Number(r.pass_rate),
    counts: json<ValidationCounts>(r.counts),
    errorCode: str(r.error_code),
    createdByName: str(r.created_by_name),
    createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
    completedAt: iso(r.completed_at),
  }))
}

/** Review events from immutable alt_text_versions rows of this document's linked assets. */
async function loadReviewEvents(documentId: number): Promise<TimelineEvent[]> {
  const rows = await query<Row[]>(
    `SELECT v.id, v.action, v.version, v.created_at, u.name AS actor_name, i.id AS occurrence_id
       FROM alt_text_versions v
       JOIN alt_text_document_images i ON i.tenant_id = v.tenant_id AND i.alt_text_asset_id = v.asset_id AND i.document_id = ?
       LEFT JOIN users u ON u.id = v.actor_id AND u.tenant_id = v.tenant_id
      WHERE v.tenant_id = ? ORDER BY v.id DESC LIMIT ?`,
    [documentId, tid(), TIMELINE_SOURCE_LIMIT],
  )
  const LABEL: Record<string, string> = { generated: "AI description generated", edited: "Description edited", approved: "Description approved", rejected: "Description rejected" }
  return rows.map((r) => {
    const action = String(r.action)
    return {
      id: `version:${num(r.id)}:occ:${num(r.occurrence_id)}`,
      group: action === "generated" ? "processing" : "review",
      type: action,
      label: LABEL[action] ?? `Version ${action.replace(/_/g, " ")}`,
      at: iso(r.created_at) ?? new Date(0).toISOString(),
      actor: str(r.actor_name),
      detail: `Image #${num(r.occurrence_id)} · version ${num(r.version)}`,
    } satisfies TimelineEvent
  })
}

function buildTimeline(doc: HistoryDocumentRow, jobs: HistoryJob[], batches: HistoryBatch[], outputs: HistoryOutput[], runs: HistoryValidationRun[], reviews: TimelineEvent[]): TimelineEvent[] {
  const events: TimelineEvent[] = [{ id: `doc:${doc.id}:uploaded`, group: "processing", type: "uploaded", label: "Document uploaded", at: doc.createdAt, actor: doc.uploaderName, detail: doc.filename }]
  for (const j of jobs) {
    if (j.startedAt) events.push({ id: `job:${j.id}:started`, group: "processing", type: "job_started", label: "Document preparation started", at: j.startedAt, actor: null, detail: `Job #${j.id}` })
    if (j.completedAt) events.push({ id: `job:${j.id}:finished`, group: "processing", type: `job_${j.status}`, label: `Document preparation ${j.status.replace(/_/g, " ")}`, at: j.completedAt, actor: null, detail: `Job #${j.id}` })
  }
  for (const b of batches) {
    events.push({ id: `batch:${b.id}:created`, group: "processing", type: "ai_submitted", label: "AI generation batch created", at: b.createdAt, actor: null, detail: b.name })
    if (b.completedAt) events.push({ id: `batch:${b.id}:completed`, group: "processing", type: "ai_completed", label: "AI generation batch finished", at: b.completedAt, actor: null, detail: `${b.completed} completed · ${b.failed} failed` })
  }
  for (const o of outputs) {
    if (o.completedAt && o.status === "completed")
      events.push({ id: `export:${o.outputId}`, group: "output", type: "export_generated", label: `${o.format.toUpperCase()} export generated`, at: o.completedAt, actor: o.createdByName, detail: `Output v${o.version} · ${o.filename}` })
  }
  for (const r of runs) {
    if (r.status === "completed" && r.completedAt)
      events.push({ id: `validation:${r.runId}`, group: "output", type: "validation_completed", label: "Validation completed", at: r.completedAt, actor: r.createdByName, detail: r.overallStatus ? `Output v${r.outputVersion ?? "?"} · ${r.overallStatus.replace(/_/g, " ")}` : null })
  }
  const seen = new Set<string>()
  return [...events, ...reviews]
    .filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
    .sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id))
}

export async function getDocumentHistory(documentId: number, scope: OwnerScope): Promise<DocumentHistoryDetail | null> {
  await ensureHistorySchema()
  const raw = await loadDocumentRow(documentId, scope)
  if (!raw) return null
  const doc = toRow(raw)
  const currentJobId = raw.preparation_job_id == null ? null : num(raw.preparation_job_id)
  const [jobs, batches, outputs, reviews] = await Promise.all([
    loadJobs(doc.id, currentJobId, str(raw.preparation_error_code)),
    loadBatches(doc.id),
    loadOutputs(doc.id),
    loadReviewEvents(doc.id),
  ])
  const validations = await loadValidations(doc.id, new Map(outputs.map((o) => [o.outputId, o.version])))
  return {
    success: true,
    document: {
      ...doc,
      mimeType: String(raw.mime_type),
      preparationErrorCode: str(raw.preparation_error_code),
      originalAvailable: num(raw.original_available) === 1,
      totalOccurrences: num(raw.total_occurrences),
      decorativeApproved: num(raw.decorative_approved),
    },
    jobs,
    batches,
    outputs,
    validations,
    timeline: buildTimeline(doc, jobs, batches, outputs, validations, reviews),
    limits: { stageHistoryPersisted: false, downloadAuditPersisted: false, reviewEventsPerVersionOnly: true },
  }
}

const OCC_PAGE = 50
function occurrenceLabel(r: Row) {
  const where = r.page_number != null ? `Page ${num(r.page_number)}` : r.slide_number != null ? `Slide ${num(r.slide_number)}` : `Position ${num(r.occurrence_index) + 1}`
  return `#${num(r.id)} · ${where}`
}

export async function listOccurrenceOptions(documentId: number, page: number): Promise<{ items: OccurrenceOption[]; total: number; pageSize: number }> {
  await ensureHistorySchema()
  const [rows, count] = await Promise.all([
    query<Row[]>(
      `SELECT id, page_number, slide_number, occurrence_index, alt_review_status, alt_text_asset_id FROM alt_text_document_images
        WHERE tenant_id = ? AND document_id = ? AND extraction_status = 'extracted' ORDER BY occurrence_index ASC, id ASC LIMIT ? OFFSET ?`,
      [tid(), documentId, OCC_PAGE, (page - 1) * OCC_PAGE],
    ),
    query<Row[]>(`SELECT COUNT(*) AS total FROM alt_text_document_images WHERE tenant_id = ? AND document_id = ? AND extraction_status = 'extracted'`, [tid(), documentId]),
  ])
  return {
    items: rows.map((r) => ({ id: num(r.id), label: occurrenceLabel(r), reviewStatus: String(r.alt_review_status ?? "not_reviewed"), hasAsset: r.alt_text_asset_id != null })),
    total: num(count[0]?.total),
    pageSize: OCC_PAGE,
  }
}

/** Full version list for one occurrence — loaded only on request. Never mutates anything. */
export async function getOccurrenceHistory(documentId: number, imageId: number): Promise<Omit<OccurrenceHistoryResponse, "success"> | null> {
  await ensureHistorySchema()
  const occ = await query<Row[]>(
    `SELECT i.id, i.source_locator, i.page_number, i.slide_number, i.alt_text_asset_id, i.source_metadata_json, i.alt_review_status, i.alt_review_version, i.alt_review_comment,
            i.alt_review_category, ru.name AS reviewer_name, i.alt_reviewed_at, i.approved_version_id, i.approved_version, au.name AS approved_by_name, i.approved_at,
            i.approved_decorative, a.current_version
       FROM alt_text_document_images i
       LEFT JOIN alt_text_assets a ON a.tenant_id = i.tenant_id AND a.id = i.alt_text_asset_id
       LEFT JOIN users ru ON ru.id = i.alt_reviewed_by AND ru.tenant_id = i.tenant_id
       LEFT JOIN users au ON au.id = i.approved_by AND au.tenant_id = i.tenant_id
      WHERE i.tenant_id = ? AND i.document_id = ? AND i.id = ? LIMIT 1`,
    [tid(), documentId, imageId],
  )
  const r = occ[0]
  if (!r) return null
  const assetId = r.alt_text_asset_id == null ? null : num(r.alt_text_asset_id)
  const approvedVersionId = r.approved_version_id == null ? null : num(r.approved_version_id)
  const reviewVersion = r.alt_review_version == null ? null : num(r.alt_review_version)
  const versionRows = assetId
    ? await query<Row[]>(
        `SELECT v.id, v.version, v.action, v.short_alt, v.long_description, v.model_id, v.note, v.created_at, u.name AS actor_name
           FROM alt_text_versions v LEFT JOIN users u ON u.id = v.actor_id AND u.tenant_id = v.tenant_id
          WHERE v.tenant_id = ? AND v.asset_id = ? ORDER BY v.id DESC LIMIT 200`,
        [tid(), assetId],
      )
    : []
  const versions: OccurrenceVersion[] = versionRows.map((v) => {
    const action = String(v.action)
    const isContent = action === "generated" || action === "edited"
    return {
      versionId: num(v.id),
      version: num(v.version),
      action,
      kind: action === "generated" ? "ai_generated" : action === "edited" ? "manual_edit" : "other",
      shortAlt: str(v.short_alt),
      longDescription: str(v.long_description),
      modelId: str(v.model_id),
      note: str(v.note),
      actorName: str(v.actor_name),
      createdAt: iso(v.created_at) ?? new Date(0).toISOString(),
      isApproved: approvedVersionId != null && num(v.id) === approvedVersionId,
      isReviewCandidate: isContent && r.current_version != null && num(v.version) === num(r.current_version),
    }
  })
  return {
    occurrence: {
      id: num(r.id),
      sourceLocator: String(r.source_locator),
      pageNumber: r.page_number == null ? null : num(r.page_number),
      slideNumber: r.slide_number == null ? null : num(r.slide_number),
      altTextAssetId: assetId,
      sourceAltText: existingAltText({ sourceMetadata: json(r.source_metadata_json) as DocumentImageRecord["sourceMetadata"] }),
      reviewStatus: String(r.alt_review_status ?? "not_reviewed"),
      reviewVersion,
      reviewComment: str(r.alt_review_comment),
      reviewCategory: str(r.alt_review_category),
      reviewerName: str(r.reviewer_name),
      reviewedAt: iso(r.alt_reviewed_at),
      approvedVersionId,
      approvedVersion: r.approved_version == null ? null : num(r.approved_version),
      approvedByName: str(r.approved_by_name),
      approvedAt: iso(r.approved_at),
      approvedDecorative: num(r.approved_decorative) === 1,
      currentVersion: r.current_version == null ? null : num(r.current_version),
    },
    versions,
  }
}

/** One persisted validation run, verified to belong to this document + output. Never re-runs validation. */
export async function getValidationRunReport(documentId: number, outputRef: string, runRef: string) {
  await ensureHistorySchema()
  const rows = await query<Row[]>(
    `SELECT v.status, v.report, e.output_filename FROM alt_text_output_validations v
       JOIN alt_text_document_exports e ON e.tenant_id = v.tenant_id AND e.output_ref = v.output_ref AND e.document_id = v.document_id
      WHERE v.tenant_id = ? AND v.document_id = ? AND v.output_ref = ? AND v.run_ref = ? LIMIT 1`,
    [tid(), documentId, outputRef, runRef],
  )
  const r = rows[0]
  if (!r) return null
  return { status: String(r.status), report: json<import("./output-validation-contract").ValidationReport>(r.report), outputFilename: String(r.output_filename) }
}
