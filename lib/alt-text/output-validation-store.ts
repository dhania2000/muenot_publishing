/**
 * @file lib/alt-text/output-validation-store.ts
 * @module Publishing · Alt Text
 * @kind Server-side data access
 * @summary Phase 3 Task 18 — tenant-scoped persisted validation runs for accessible document outputs.
 *   One row per run; `active_lock` (1 while running, NULL after) is unique per output so duplicate
 *   requests cannot start parallel runs. Completed runs are never overwritten, so earlier reports
 *   stay available after re-validation. Mirrors the Task 15 export-row pattern.
 */
import "server-only"
import type { ResultSetHeader, RowDataPacket } from "mysql2"
import { query } from "@/lib/db"
import { currentTenantId } from "@/lib/tenant-scope"
import type { ManualAcknowledgement, ValidationReport, ValidationRunStatus } from "./output-validation-contract"
import { ensureAltTextSchema } from "./store"

export const OUTPUT_VALIDATIONS_DDL = `CREATE TABLE IF NOT EXISTS alt_text_output_validations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  document_id INT NOT NULL,
  output_ref CHAR(36) NOT NULL,
  run_ref CHAR(36) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'processing',
  active_lock TINYINT(1) NULL DEFAULT 1,
  fingerprint CHAR(64) NOT NULL,
  rule_version VARCHAR(20) NOT NULL,
  overall_status VARCHAR(30) NULL,
  readiness VARCHAR(30) NULL,
  pass_rate DECIMAL(5,1) NULL,
  report JSON NULL,
  acknowledgements JSON NULL,
  error_code VARCHAR(60) NULL,
  created_by INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  UNIQUE KEY uq_alt_out_val_run (tenant_id, run_ref),
  UNIQUE KEY uq_alt_out_val_active (tenant_id, output_ref, active_lock),
  INDEX idx_alt_out_val_output (tenant_id, output_ref, id)
)`

const STALE_MINUTES = 15

let schemaReady: Promise<void> | null = null
export function ensureSchema(): Promise<void> {
  schemaReady ??= ensureAltTextSchema()
    .then(() => query(OUTPUT_VALIDATIONS_DDL))
    .then(() => undefined)
    .catch((e) => {
      schemaReady = null
      throw e
    })
  return schemaReady
}
const tid = () => currentTenantId()

type Row = RowDataPacket & {
  run_ref: string
  document_id: number
  status: string
  fingerprint: string
  report: unknown
  acknowledgements: unknown
  error_code: string | null
  created_at: Date | string
}

export type StoredValidationRun = {
  runId: string
  documentId: number
  status: ValidationRunStatus
  fingerprint: string
  report: ValidationReport | null
  acknowledgements: Record<string, ManualAcknowledgement>
  errorCode: string | null
  createdAt: string
}

const json = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : (v ?? null))

function toRun(r: Row): StoredValidationRun {
  const status = (["processing", "completed", "failed"].includes(r.status) ? r.status : "failed") as ValidationRunStatus
  return {
    runId: r.run_ref,
    documentId: Number(r.document_id),
    status,
    fingerprint: r.fingerprint,
    report: json(r.report),
    acknowledgements: json(r.acknowledgements) ?? {},
    errorCode: r.error_code,
    createdAt: new Date(r.created_at).toISOString(),
  }
}

const COLS = "run_ref, document_id, status, fingerprint, report, acknowledgements, error_code, created_at"

/** Latest run of any status, and latest completed run (they differ while a re-validation runs or after it fails). */
export async function getLatestRuns(documentId: number, outputRef: string): Promise<{ latest: StoredValidationRun | null; completed: StoredValidationRun | null }> {
  await ensureSchema()
  const [latest, completed] = await Promise.all([
    query<Row[]>(`SELECT ${COLS} FROM alt_text_output_validations WHERE tenant_id = ? AND document_id = ? AND output_ref = ? ORDER BY id DESC LIMIT 1`, [tid(), documentId, outputRef]),
    query<Row[]>(`SELECT ${COLS} FROM alt_text_output_validations WHERE tenant_id = ? AND document_id = ? AND output_ref = ? AND status = 'completed' ORDER BY id DESC LIMIT 1`, [tid(), documentId, outputRef]),
  ])
  return { latest: latest[0] ? toRun(latest[0]) : null, completed: completed[0] ? toRun(completed[0]) : null }
}

/** Claim the single active slot for this output. Stale claims (crashed workers) are released first. */
export async function claimValidation(input: { documentId: number; outputRef: string; runRef: string; fingerprint: string; ruleVersion: string; createdBy: number }): Promise<"claimed" | "in_progress"> {
  await ensureSchema()
  await query(
    `UPDATE alt_text_output_validations SET status = 'failed', active_lock = NULL, error_code = 'STALE_RUN', completed_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ? AND output_ref = ? AND active_lock = 1 AND created_at < (CURRENT_TIMESTAMP - INTERVAL ${STALE_MINUTES} MINUTE)`,
    [tid(), input.outputRef],
  )
  try {
    await query(
      `INSERT INTO alt_text_output_validations (tenant_id, document_id, output_ref, run_ref, fingerprint, rule_version, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [tid(), input.documentId, input.outputRef, input.runRef, input.fingerprint, input.ruleVersion, input.createdBy],
    )
    return "claimed"
  } catch (e) {
    if ((e as { code?: string }).code === "ER_DUP_ENTRY") return "in_progress"
    throw e
  }
}

export async function completeValidation(runRef: string, report: ValidationReport): Promise<void> {
  await query(
    `UPDATE alt_text_output_validations SET status = 'completed', active_lock = NULL, overall_status = ?, readiness = ?, pass_rate = ?, report = ?, completed_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ? AND run_ref = ? AND status = 'processing'`,
    [report.summary.overallStatus, report.summary.readiness, report.summary.passRate, JSON.stringify(report), tid(), runRef],
  )
}

export async function failValidation(runRef: string, code: string): Promise<void> {
  await query(
    `UPDATE alt_text_output_validations SET status = 'failed', active_lock = NULL, error_code = ?, completed_at = CURRENT_TIMESTAMP WHERE tenant_id = ? AND run_ref = ? AND status = 'processing'`,
    [code.slice(0, 60), tid(), runRef],
  )
}

const CHUNK = 500
const chunks = (ids: number[]) => Array.from({ length: Math.ceil(ids.length / CHUNK) }, (_, i) => ids.slice(i * CHUNK, (i + 1) * CHUNK))
const placeholders = (n: number) => Array.from({ length: n }, () => "?").join(",")

export type OccurrenceApproval = { sourceLocator: string; approvedVersionId: number | null }

/** Current locator + approval of each occurrence, in batched queries (no N+1). */
export async function loadOccurrenceApprovals(documentId: number, ids: number[]): Promise<Map<number, OccurrenceApproval>> {
  await ensureSchema()
  const out = new Map<number, OccurrenceApproval>()
  for (const chunk of chunks([...new Set(ids)])) {
    const rows = await query<RowDataPacket[]>(
      `SELECT id, source_locator, approved_version_id FROM alt_text_document_images WHERE tenant_id = ? AND document_id = ? AND id IN (${placeholders(chunk.length)})`,
      [tid(), documentId, ...chunk],
    )
    for (const r of rows) out.set(Number(r.id), { sourceLocator: String(r.source_locator ?? ""), approvedVersionId: r.approved_version_id == null ? null : Number(r.approved_version_id) })
  }
  return out
}

/** Immutable approved version rows referenced by an export. */
export async function loadVersionTexts(ids: number[]): Promise<Map<number, { version: number; shortAlt: string | null }>> {
  await ensureSchema()
  const out = new Map<number, { version: number; shortAlt: string | null }>()
  for (const chunk of chunks([...new Set(ids)])) {
    const rows = await query<RowDataPacket[]>(`SELECT id, version, short_alt FROM alt_text_versions WHERE tenant_id = ? AND id IN (${placeholders(chunk.length)})`, [tid(), ...chunk])
    for (const r of rows) out.set(Number(r.id), { version: Number(r.version), shortAlt: r.short_alt ?? null })
  }
  return out
}

/** Record a reviewer acknowledgement on one manual-review item of a completed run. Idempotent per item. */
export async function acknowledgeCheck(documentId: number, outputRef: string, runRef: string, checkId: string, ack: ManualAcknowledgement): Promise<boolean> {
  await ensureSchema()
  const r = await query<ResultSetHeader>(
    `UPDATE alt_text_output_validations
        SET acknowledgements = JSON_SET(COALESCE(acknowledgements, JSON_OBJECT()), CONCAT('$."', ?, '"'), JSON_OBJECT('by', ?, 'at', ?, 'note', ?))
      WHERE tenant_id = ? AND document_id = ? AND output_ref = ? AND run_ref = ? AND status = 'completed'`,
    [checkId, ack.by, ack.at, ack.note, tid(), documentId, outputRef, runRef],
  )
  return r.affectedRows > 0
}
