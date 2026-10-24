/**
 * @file lib/alt-text/docx-export-store.ts
 * @module Publishing · Alt Text
 * @kind Server-side data access
 * @summary Phase 3 Task 15 — tenant-scoped generated-output records for accessible DOCX exports.
 *   One row per export attempt; (document, idempotency_key) is unique so retries replay, and
 *   `active_lock` (1 while processing, NULL otherwise) is unique per document so two concurrent
 *   exports of one document cannot run. The original document row and file are never touched.
 */
import "server-only"
import type { RowDataPacket } from "mysql2"
import { query } from "@/lib/db"
import { currentTenantId } from "@/lib/tenant-scope"
import { docxExportDownloadUrl, type AccessibleExportFormat, type DocxExportItem, type DocxExportPolicy, type DocxExportRecord, type DocxExportStatus, type DocxExportSummary } from "./docx-export-contract"
import { ensureAltTextSchema } from "./store"

export const DOCX_EXPORTS_DDL = `CREATE TABLE IF NOT EXISTS alt_text_document_exports (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  document_id INT NOT NULL,
  output_ref CHAR(36) NOT NULL,
  idempotency_key VARCHAR(64) NOT NULL,
  format VARCHAR(10) NOT NULL DEFAULT 'docx',
  policy VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'processing',
  active_lock TINYINT(1) NULL DEFAULT 1,
  snapshot_hash CHAR(64) NOT NULL,
  source_checksum CHAR(64) NULL,
  output_object_key VARCHAR(512) NULL,
  output_file_id INT NULL,
  output_checksum CHAR(64) NULL,
  output_filename VARCHAR(255) NOT NULL,
  output_size_bytes BIGINT NULL,
  updated_count INT NOT NULL DEFAULT 0,
  skipped_count INT NOT NULL DEFAULT 0,
  unsupported_count INT NOT NULL DEFAULT 0,
  failed_count INT NOT NULL DEFAULT 0,
  report JSON NULL,
  error_code VARCHAR(60) NULL,
  created_by INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  UNIQUE KEY uq_alt_doc_exports_ref (tenant_id, output_ref),
  UNIQUE KEY uq_alt_doc_exports_key (tenant_id, document_id, idempotency_key),
  UNIQUE KEY uq_alt_doc_exports_active (tenant_id, document_id, active_lock),
  INDEX idx_alt_doc_exports_doc (tenant_id, document_id, id)
)`

const STALE_MINUTES = 15

let schemaReady: Promise<void> | null = null
/** Base Alt Text schema first, then this table (kept here to avoid an import cycle with store.ts). */
function ensureExportSchema(): Promise<void> {
  schemaReady ??= ensureAltTextSchema()
    .then(() => query(DOCX_EXPORTS_DDL))
    .then(() => undefined)
    .catch((e) => {
      schemaReady = null
      throw e
    })
  return schemaReady
}
const tid = () => currentTenantId()

type Row = RowDataPacket & {
  document_id: number
  output_ref: string
  format: string
  policy: string
  status: string
  output_filename: string
  output_size_bytes: number | string | null
  output_object_key: string | null
  updated_count: number
  skipped_count: number
  unsupported_count: number
  failed_count: number
  error_code: string | null
  report: unknown
  created_at: Date | string
  completed_at: Date | string | null
}

export type StoredDocxExport = DocxExportRecord & { objectKey: string | null; report: { summary: DocxExportSummary; items: DocxExportItem[] } | null }

const iso = (v: Date | string | null) => (v ? new Date(v).toISOString() : null)

function toRecord(r: Row): StoredDocxExport {
  const status = (["processing", "completed", "failed"].includes(r.status) ? r.status : "failed") as DocxExportStatus
  const report = typeof r.report === "string" ? JSON.parse(r.report) : (r.report ?? null)
  return {
    outputId: r.output_ref,
    format: r.format === "pptx" || r.format === "pdf" ? r.format : "docx",
    status,
    policy: (r.policy === "strict" ? "strict" : "approved_only") as DocxExportPolicy,
    filename: r.output_filename,
    sizeBytes: r.output_size_bytes == null ? null : Number(r.output_size_bytes),
    updated: Number(r.updated_count),
    skipped: Number(r.skipped_count),
    unsupported: Number(r.unsupported_count),
    failed: Number(r.failed_count),
    errorCode: r.error_code,
    createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
    completedAt: iso(r.completed_at),
    downloadUrl: status === "completed" && r.output_object_key ? docxExportDownloadUrl(Number(r.document_id), r.output_ref) : null,
    objectKey: r.output_object_key,
    report,
  }
}

const COLUMNS =
  "document_id, output_ref, format, policy, status, output_filename, output_size_bytes, output_object_key, updated_count, skipped_count, unsupported_count, failed_count, error_code, report, created_at, completed_at"

export async function getExportByKey(documentId: number, key: string): Promise<StoredDocxExport | null> {
  await ensureExportSchema()
  const rows = await query<Row[]>(`SELECT ${COLUMNS} FROM alt_text_document_exports WHERE tenant_id = ? AND document_id = ? AND idempotency_key = ? LIMIT 1`, [tid(), documentId, key])
  return rows[0] ? toRecord(rows[0]) : null
}

export async function getExportByRef(documentId: number, ref: string): Promise<StoredDocxExport | null> {
  await ensureExportSchema()
  const rows = await query<Row[]>(`SELECT ${COLUMNS} FROM alt_text_document_exports WHERE tenant_id = ? AND document_id = ? AND output_ref = ? LIMIT 1`, [tid(), documentId, ref])
  return rows[0] ? toRecord(rows[0]) : null
}

/** Checksums recorded at export time; used by Task 18 validation to prove integrity. */
export async function getExportChecksums(documentId: number, ref: string): Promise<{ sourceChecksum: string | null; outputChecksum: string | null } | null> {
  await ensureExportSchema()
  const rows = await query<RowDataPacket[]>(
    `SELECT source_checksum, output_checksum FROM alt_text_document_exports WHERE tenant_id = ? AND document_id = ? AND output_ref = ? LIMIT 1`,
    [tid(), documentId, ref],
  )
  return rows[0] ? { sourceChecksum: rows[0].source_checksum ?? null, outputChecksum: rows[0].output_checksum ?? null } : null
}

export async function listExports(documentId: number, limit = 5): Promise<DocxExportRecord[]> {
  await ensureExportSchema()
  const rows = await query<Row[]>(`SELECT ${COLUMNS} FROM alt_text_document_exports WHERE tenant_id = ? AND document_id = ? ORDER BY id DESC LIMIT ?`, [tid(), documentId, limit])
  return rows.map((r) => {
    const { objectKey: _k, report: _r, ...rec } = toRecord(r)
    return rec
  })
}

export type ClaimInput = { documentId: number; outputRef: string; idempotencyKey: string; format: AccessibleExportFormat; policy: DocxExportPolicy; snapshot: string; filename: string; createdBy: number }

/** Claim the per-document export slot. Stale processing rows (crashed runs) are released first. */
export async function claimExport(input: ClaimInput): Promise<"claimed" | "duplicate_key" | "in_progress"> {
  await ensureExportSchema()
  await query(
    `UPDATE alt_text_document_exports SET status = 'failed', error_code = 'STALE_RUN', active_lock = NULL
     WHERE tenant_id = ? AND document_id = ? AND active_lock = 1 AND created_at < (NOW() - INTERVAL ${STALE_MINUTES} MINUTE)`,
    [tid(), input.documentId],
  )
  try {
    await query(
      `INSERT INTO alt_text_document_exports (tenant_id, document_id, output_ref, idempotency_key, format, policy, snapshot_hash, output_filename, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tid(), input.documentId, input.outputRef, input.idempotencyKey, input.format, input.policy, input.snapshot, input.filename, input.createdBy],
    )
    return "claimed"
  } catch (e) {
    if ((e as { code?: string })?.code !== "ER_DUP_ENTRY") throw e
    return (await getExportByKey(input.documentId, input.idempotencyKey)) ? "duplicate_key" : "in_progress"
  }
}

export type CompleteInput = {
  sourceChecksum: string
  objectKey: string
  fileId: number | null
  outputChecksum: string
  sizeBytes: number
  summary: DocxExportSummary
  items: DocxExportItem[]
}

export async function completeExport(documentId: number, outputRef: string, c: CompleteInput): Promise<void> {
  await query(
    `UPDATE alt_text_document_exports SET status = 'completed', active_lock = NULL, completed_at = NOW(), source_checksum = ?, output_object_key = ?, output_file_id = ?,
       output_checksum = ?, output_size_bytes = ?, updated_count = ?, skipped_count = ?, unsupported_count = ?, failed_count = ?, report = ?
     WHERE tenant_id = ? AND document_id = ? AND output_ref = ? AND status = 'processing'`,
    [c.sourceChecksum, c.objectKey, c.fileId, c.outputChecksum, c.sizeBytes, c.summary.updated, c.summary.skipped, c.summary.unsupported, c.summary.failed,
      JSON.stringify({ summary: c.summary, items: c.items }), tid(), documentId, outputRef],
  )
}

export async function failExport(documentId: number, outputRef: string, code: string, report: { summary: DocxExportSummary; items: DocxExportItem[] } | null = null): Promise<void> {
  await query(
    `UPDATE alt_text_document_exports SET status = 'failed', active_lock = NULL, completed_at = NOW(), error_code = ?, report = ?,
       updated_count = 0, skipped_count = ?, unsupported_count = ?, failed_count = ?
     WHERE tenant_id = ? AND document_id = ? AND output_ref = ? AND status = 'processing'`,
    [code.slice(0, 60), report ? JSON.stringify(report) : null, report?.summary.skipped ?? 0, report?.summary.unsupported ?? 0, report?.summary.failed ?? 0, tid(), documentId, outputRef],
  )
}
