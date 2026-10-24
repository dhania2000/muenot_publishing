/**
 * @file lib/alt-text/document-preparation-store.ts
 * @module Publishing · Alt Text
 * @kind Server-side library
 * @summary Phase 3 Task 11 — persisted preparation checkpoint on alt_text_documents (stage, job id,
 *   readiness snapshot) and progress counts derived from persisted occurrence rows. Tenant-scoped.
 */
import "server-only"
import type { ResultSetHeader, RowDataPacket } from "mysql2"
import { query } from "@/lib/db"
import { currentTenantId } from "@/lib/tenant-scope"
import { DOCUMENT_CONTEXT_VERSION } from "./document-context"
import { isPreparationStage, type MappingCounts, type PreparationStage } from "./document-preparation-contract"
import { ensureAltTextSchema } from "./store"

export type PreparationCheckpoint = {
  stage: PreparationStage | null
  jobId: number | null
  errorCode: string | null
  /** Stage outputs persisted by the worker: mapping counts and the readiness summary/contract metadata. */
  data: { mapping?: MappingCounts; readiness?: Record<string, unknown> } | null
  updatedAt: string | null
}

const parse = (v: unknown) => {
  if (v == null) return null
  if (typeof v === "object") return v as PreparationCheckpoint["data"]
  try {
    return JSON.parse(String(v)) as PreparationCheckpoint["data"]
  } catch {
    return null
  }
}
const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString())

export async function getPreparationCheckpoint(documentId: number): Promise<PreparationCheckpoint | null> {
  await ensureAltTextSchema()
  const rows = await query<RowDataPacket[]>(
    `SELECT preparation_stage, preparation_job_id, preparation_error_code, preparation_readiness_json, preparation_updated_at
       FROM alt_text_documents WHERE tenant_id = ? AND id = ? LIMIT 1`,
    [currentTenantId(), documentId],
  )
  const r = rows[0]
  if (!r) return null
  return {
    stage: isPreparationStage(r.preparation_stage) ? r.preparation_stage : null,
    jobId: r.preparation_job_id == null ? null : Number(r.preparation_job_id),
    errorCode: r.preparation_error_code ?? null,
    data: parse(r.preparation_readiness_json),
    updatedAt: iso(r.preparation_updated_at),
  }
}

/**
 * Worker checkpoint write. Guarded by job id so a superseded job (or a redelivered stale one)
 * can never overwrite the state owned by the document's current preparation job.
 */
export async function savePreparationCheckpoint(
  documentId: number,
  jobId: number,
  next: { stage: PreparationStage; errorCode?: string | null; data?: PreparationCheckpoint["data"] },
): Promise<boolean> {
  const res = await query<ResultSetHeader>(
    `UPDATE alt_text_documents
        SET preparation_stage = ?, preparation_error_code = ?,
            preparation_readiness_json = COALESCE(?, preparation_readiness_json),
            preparation_updated_at = CURRENT_TIMESTAMP, updated_at = updated_at
      WHERE tenant_id = ? AND id = ? AND preparation_job_id = ?`,
    [next.stage, next.errorCode ?? null, next.data ? JSON.stringify(next.data) : null, currentTenantId(), documentId, jobId],
  )
  return res.affectedRows > 0
}

export type ContextCounts = { ready: number; unavailable: number; failed: number; notAnalyzed: number }

/** Context state of extracted occurrences; stale-version rows count as not analyzed. */
export async function countContextStates(documentId: number): Promise<ContextCounts> {
  await ensureAltTextSchema()
  const rows = await query<RowDataPacket[]>(
    `SELECT
        SUM(context_status = 'analyzed' AND context_version = ?) AS ready,
        SUM(context_status = 'unavailable' AND context_version = ?) AS unavailable,
        SUM(context_status = 'failed' AND context_version = ?) AS failed,
        SUM(context_status IS NULL OR context_version IS NULL OR context_version <> ?) AS not_analyzed
       FROM alt_text_document_images
      WHERE tenant_id = ? AND document_id = ? AND extraction_status = 'extracted'`,
    [DOCUMENT_CONTEXT_VERSION, DOCUMENT_CONTEXT_VERSION, DOCUMENT_CONTEXT_VERSION, DOCUMENT_CONTEXT_VERSION, currentTenantId(), documentId],
  )
  const r = rows[0] ?? {}
  return { ready: Number(r.ready ?? 0), unavailable: Number(r.unavailable ?? 0), failed: Number(r.failed ?? 0), notAnalyzed: Number(r.not_analyzed ?? 0) }
}

/** Actual Alt Text asset statuses for an explicit set of asset ids (tenant-scoped). */
export async function countAssetStatuses(assetIds: number[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  if (assetIds.length === 0) return out
  const rows = await query<RowDataPacket[]>(
    `SELECT status, COUNT(*) AS n FROM alt_text_assets WHERE tenant_id = ? AND id IN (${assetIds.map(() => "?").join(", ")}) GROUP BY status`,
    [currentTenantId(), ...assetIds],
  )
  for (const r of rows) out[String(r.status)] = Number(r.n)
  return out
}

export async function getAssetSettings(assetIds: number[]): Promise<Map<number, { language: string; audience: string; status: string; projectId: number | null; batchId: string | null }>> {
  const out = new Map<number, { language: string; audience: string; status: string; projectId: number | null; batchId: string | null }>()
  if (assetIds.length === 0) return out
  const rows = await query<RowDataPacket[]>(
    `SELECT id, language, audience, status, project_id, batch_id FROM alt_text_assets WHERE tenant_id = ? AND id IN (${assetIds.map(() => "?").join(", ")})`,
    [currentTenantId(), ...assetIds],
  )
  for (const r of rows) {
    out.set(Number(r.id), { language: String(r.language), audience: String(r.audience), status: String(r.status), projectId: r.project_id == null ? null : Number(r.project_id), batchId: r.batch_id ?? null })
  }
  return out
}
