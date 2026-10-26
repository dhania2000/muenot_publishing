import "server-only"
/**
 * Standalone durable job queue (MySQL-backed), schema-compatible with the ERP
 * platform queue so Alt Text batch code runs unchanged. Jobs are claimed with
 * row locks, run with a timeout, and settled with retry/backoff or deferral.
 */
import { createHash, randomUUID } from "node:crypto"
import { query, withTransaction } from "@/lib/db"
import { classifyJobFailure, JobCancelledError, JobDeferredError, retryDisposition } from "@/lib/job-retry-policy"
import { assertEnqueueAllowed, jobLimitsFromEnv, payloadBytes } from "@/lib/observability/job-limits"

export const BACKGROUND_JOB_TYPES = ["alt_text.batch_processing", "alt_text.document_preparation", "alt_text.pdf_page_ocr", "alt_text.math_recognition", "alt_text.advanced_analysis"] as const
export type BackgroundJobType = (typeof BACKGROUND_JOB_TYPES)[number]
export const BACKGROUND_JOB_STATUSES = ["queued", "running", "completed", "failed", "dead_letter", "cancelled"] as const
export type BackgroundJobStatus = (typeof BACKGROUND_JOB_STATUSES)[number]

export type AltTextBatchJobPayload = { batchId: string }
/** Phase 3 Task 11: staged extraction → location mapping → context → AI readiness for one document. */
export type DocumentPreparationJobPayload = { documentId: number }
export type PdfPageOcrJobPayload = { documentId: number; request: import("./alt-text/pdf-page-ocr-types").PageOcrRequest }
export type MathRecognitionJobPayload = { evidenceId: number }
export type AdvancedAnalysisJobPayload = {evidenceId:number}
export type BackgroundJobPayload = AltTextBatchJobPayload | DocumentPreparationJobPayload | PdfPageOcrJobPayload | MathRecognitionJobPayload

/** Cluster-wide running cap for document preparation (memory-heavy parsing). Phase 2 types keep their own policy. */
export const documentPreparationGlobalCap = () => bounded(process.env.ALT_TEXT_DOCUMENT_JOBS_GLOBAL_MAX, 2, 1, 20)

export type BackgroundJob = {
  id: number
  job_type: BackgroundJobType
  tenant_id: number
  payload: BackgroundJobPayload
  status: BackgroundJobStatus
  priority: number
  attempts: number
  max_attempts: number
  backoff_seconds: number
  timeout_seconds: number
  concurrency_key: string | null
  concurrency_limit: number
  idempotency_key: string
  available_at: string
  worker_id: string | null
  cancel_requested: boolean
  result: Record<string, unknown> | null
  error_message: string | null
  created_by: number | null
}

export type EnqueueBackgroundJobInput = {
  triggerSource?: "scheduler" | "user_request" | "system"
  jobType: BackgroundJobType
  payload: BackgroundJobPayload
  tenantId?: number | null
  priority?: number
  maxAttempts?: number
  backoffSeconds?: number
  timeoutSeconds?: number
  concurrencyKey?: string | null
  concurrencyLimit?: number
  idempotencyKey?: string
  createdBy?: number | null
  correlationId?: string | null
  runAt?: Date | string | null
}

const bounded = (v: unknown, fallback: number, min: number, max: number) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback
}
const fingerprint = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex")

function parseJson(value: unknown): Record<string, unknown> | null {
  if (!value) return null
  if (typeof value === "object") return value as Record<string, unknown>
  try { return JSON.parse(String(value)) as Record<string, unknown> } catch { return null }
}

function mapJob(row: any): BackgroundJob {
  return {
    ...row,
    id: Number(row.id),
    tenant_id: Number(row.tenant_id),
    payload: parseJson(row.payload) as BackgroundJobPayload,
    attempts: Number(row.attempts),
    max_attempts: Number(row.max_attempts),
    backoff_seconds: Number(row.backoff_seconds),
    timeout_seconds: Number(row.timeout_seconds),
    concurrency_limit: Number(row.concurrency_limit),
    cancel_requested: Boolean(row.cancel_requested),
    result: parseJson(row.result),
  }
}

function validatePayload(type: BackgroundJobType, payload: unknown): BackgroundJobPayload {
  const evidenceId = (payload as MathRecognitionJobPayload)?.evidenceId
  if (["alt_text.math_recognition","alt_text.advanced_analysis"].includes(type) && Number.isSafeInteger(evidenceId) && evidenceId > 0) return { evidenceId }
  const batchId = (payload as { batchId?: unknown })?.batchId
  if (type === "alt_text.batch_processing" && typeof batchId === "string" && batchId.length > 0 && batchId.length <= 64) return { batchId }
  const documentId = (payload as { documentId?: unknown })?.documentId
  if (type === "alt_text.document_preparation" && Number.isSafeInteger(documentId) && (documentId as number) > 0) return { documentId: documentId as number }
  if (type === "alt_text.pdf_page_ocr" && Number.isSafeInteger(documentId) && (documentId as number) > 0) {
    const request = (payload as PdfPageOcrJobPayload).request
    if (request && ["inspect", "recognize"].includes(request.action)) return { documentId: documentId as number, request }
  }
  throw new Error("Invalid background job payload")
}

let ensured: Promise<void> | null = null
async function runEnsure() {
  await query(`CREATE TABLE IF NOT EXISTS platform_background_jobs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    job_type VARCHAR(80) NOT NULL,
    tenant_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
    payload JSON NOT NULL,
    status ENUM('queued','running','completed','failed','dead_letter','cancelled') NOT NULL DEFAULT 'queued',
    priority TINYINT UNSIGNED NOT NULL DEFAULT 5,
    attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
    max_attempts TINYINT UNSIGNED NOT NULL DEFAULT 3,
    backoff_seconds SMALLINT UNSIGNED NOT NULL DEFAULT 30,
    timeout_seconds SMALLINT UNSIGNED NOT NULL DEFAULT 300,
    concurrency_key VARCHAR(160) NULL,
    concurrency_limit TINYINT UNSIGNED NOT NULL DEFAULT 1,
    idempotency_key VARCHAR(160) NOT NULL,
    available_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    locked_at DATETIME NULL,
    lease_expires_at DATETIME NULL,
    worker_id VARCHAR(120) NULL,
    cancel_requested TINYINT(1) NOT NULL DEFAULT 0,
    started_at DATETIME NULL,
    completed_at DATETIME NULL,
    result JSON NULL,
    error_message TEXT NULL,
    created_by BIGINT UNSIGNED NULL,
    trigger_source VARCHAR(30) NOT NULL DEFAULT 'unknown',
    correlation_id VARCHAR(128) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_background_job_idempotency (job_type, tenant_id, idempotency_key),
    KEY idx_background_job_ready (status, available_at, priority),
    KEY idx_background_job_tenant (tenant_id, status, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  await query(`CREATE TABLE IF NOT EXISTS platform_background_job_events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    job_id BIGINT UNSIGNED NOT NULL,
    event_type VARCHAR(40) NOT NULL,
    detail JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id), KEY idx_background_job_event (job_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
}

export function ensureBackgroundJobSchema() {
  if (!ensured) ensured = runEnsure().catch((error) => { ensured = null; throw error })
  return ensured
}

async function appendEvent(jobId: number, eventType: string, detail: Record<string, unknown> = {}) {
  await query("INSERT INTO platform_background_job_events (job_id, event_type, detail) VALUES (?,?,?)", [jobId, eventType, JSON.stringify(detail)])
}

function prepareEnqueue(input: EnqueueBackgroundJobInput) {
  if (!BACKGROUND_JOB_TYPES.includes(input.jobType)) throw new Error("Unknown background job type")
  const payload = validatePayload(input.jobType, input.payload)
  const runAtDate = input.runAt ? new Date(input.runAt) : null
  const runAt = runAtDate && !Number.isNaN(runAtDate.getTime()) && runAtDate.getTime() > Date.now() ? runAtDate : null
  const rawKey = (input.idempotencyKey ?? randomUUID()).trim()
  return {
    payload,
    tenantId: bounded(input.tenantId, 0, 0, Number.MAX_SAFE_INTEGER),
    priority: bounded(input.priority, 5, 0, 9),
    maxAttempts: bounded(input.maxAttempts, 3, 1, 10),
    backoffSeconds: bounded(input.backoffSeconds, 30, 1, 3600),
    timeoutSeconds: bounded(input.timeoutSeconds, 300, 5, 900),
    concurrencyLimit: bounded(input.concurrencyLimit, 1, 1, 20),
    concurrencyKey: input.concurrencyKey == null ? input.jobType : String(input.concurrencyKey).trim().slice(0, 160),
    idempotencyKey: rawKey.length > 160 ? fingerprint(rawKey) : rawKey,
    runAt,
  }
}

type TransactionConnection = { query: <T = any>(sql: string, params?: any[]) => Promise<[T, unknown]> }

/** Transactional-outbox enqueue. Call ensureBackgroundJobSchema() before opening the transaction. */
export async function enqueueBackgroundJobInTransaction(
  connection: TransactionConnection,
  input: EnqueueBackgroundJobInput & { idempotencyKey: string },
): Promise<{ jobId: number; created: boolean }> {
  const p = prepareEnqueue(input)
  const [prior] = await connection.query<any[]>(
    "SELECT id, payload FROM platform_background_jobs WHERE job_type=? AND tenant_id=? AND idempotency_key=? LIMIT 1 FOR UPDATE",
    [input.jobType, p.tenantId, p.idempotencyKey],
  )
  if (prior[0]) {
    if (fingerprint(parseJson(prior[0].payload) ?? {}) !== fingerprint(p.payload)) throw new Error("Idempotency key reused with different job payload")
    return { jobId: Number(prior[0].id), created: false }
  }
  const [pending] = await connection.query<any[]>("SELECT COUNT(*) AS count FROM platform_background_jobs WHERE tenant_id=? AND status IN ('queued','running')", [p.tenantId])
  assertEnqueueAllowed({ tenantId: p.tenantId, payloadBytes: payloadBytes(p.payload), tenantPending: Number(pending[0]?.count ?? 0) }, jobLimitsFromEnv())
  const [result] = await connection.query<any>(
    `INSERT INTO platform_background_jobs
     (job_type, tenant_id, payload, priority, max_attempts, backoff_seconds, timeout_seconds, concurrency_key, concurrency_limit, idempotency_key, created_by, trigger_source, correlation_id, available_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,${p.runAt ? "?" : "UTC_TIMESTAMP()"})`,
    [input.jobType, p.tenantId, JSON.stringify(p.payload), p.priority, p.maxAttempts, p.backoffSeconds, p.timeoutSeconds, p.concurrencyKey || null,
      p.concurrencyLimit, p.idempotencyKey, input.createdBy ?? null, input.triggerSource ?? "system", input.correlationId ?? null, ...(p.runAt ? [p.runAt] : [])],
  )
  const jobId = Number(result.insertId)
  await connection.query("INSERT INTO platform_background_job_events (job_id, event_type, detail) VALUES (?,?,?)",
    [jobId, p.runAt ? "scheduled" : "queued", JSON.stringify({ priority: p.priority, transactional: true })])
  return { jobId, created: true }
}

export async function enqueueBackgroundJob(input: EnqueueBackgroundJobInput): Promise<BackgroundJob> {
  await ensureBackgroundJobSchema()
  const idempotencyKey = input.idempotencyKey ?? randomUUID()
  const { jobId } = await withTransaction((conn) => enqueueBackgroundJobInTransaction(conn as unknown as TransactionConnection, { ...input, idempotencyKey }))
  return (await getBackgroundJob(jobId))!
}

export async function getBackgroundJob(id: number): Promise<BackgroundJob | null> {
  const rows = await query<any[]>("SELECT * FROM platform_background_jobs WHERE id=? LIMIT 1", [id])
  return rows[0] ? mapJob(rows[0]) : null
}

type JobHandlerContext = { signal: AbortSignal; job: BackgroundJob }
type JobHandler = (payload: BackgroundJobPayload, context: JobHandlerContext) => Promise<Record<string, unknown> | void>

const JOB_HANDLERS: Record<BackgroundJobType, JobHandler> = {
  async "alt_text.advanced_analysis"(payload,context){
    const {runAdvancedEvidenceJob}=await import("@/lib/alt-text/advanced-evidence-job")
    return runAdvancedEvidenceJob(payload as AdvancedAnalysisJobPayload,context)
  },
  async "alt_text.math_recognition"(payload, context) {
    const { runMathRecognitionJob } = await import("@/lib/alt-text/math-job")
    return runMathRecognitionJob(payload as MathRecognitionJobPayload, context)
  },
  async "alt_text.pdf_page_ocr"(payload, context) {
    const { runPdfPageOcrJob } = await import("@/lib/alt-text/pdf-page-ocr-job")
    return runPdfPageOcrJob(payload as PdfPageOcrJobPayload, context)
  },
  async "alt_text.batch_processing"(payload, context) {
    const [{ runAltTextBatchJob }, { processAltTextBatch }] = await Promise.all([import("@/lib/alt-text/batch-job"), import("@/lib/alt-text/batch-processor")])
    return runAltTextBatchJob(payload as AltTextBatchJobPayload, context, { processor: processAltTextBatch })
  },
  async "alt_text.document_preparation"(payload, context) {
    const { runDocumentPreparationJob } = await import("@/lib/alt-text/document-preparation-job")
    return runDocumentPreparationJob(payload as DocumentPreparationJobPayload, context)
  },
}

/** Stage/progress audit entry on the existing job event log. */
export async function recordBackgroundJobEvent(jobId: number, eventType: string, detail: Record<string, unknown> = {}) {
  await appendEvent(jobId, eventType.slice(0, 40), detail)
}

/** Durable cancel flag read at handler checkpoints (the in-memory job snapshot is taken at claim time). */
export async function isBackgroundJobCancelRequested(jobId: number): Promise<boolean> {
  const rows = await query<any[]>("SELECT cancel_requested FROM platform_background_jobs WHERE id=? LIMIT 1", [jobId])
  return Boolean(Number(rows[0]?.cancel_requested ?? 0))
}

/**
 * Tenant-scoped cancel. A queued job is cancelled atomically; a running job only gets the durable
 * cancel_requested flag and settles at its next safe checkpoint (in-flight work is never killed).
 */
export async function requestBackgroundJobCancel(jobId: number, tenantId: number): Promise<"cancelled" | "cancel_requested" | "not_active"> {
  await ensureBackgroundJobSchema()
  const queued = await query<any>(
    `UPDATE platform_background_jobs SET status='cancelled', cancel_requested=1, error_message='CANCELLED', completed_at=UTC_TIMESTAMP()
      WHERE id=? AND tenant_id=? AND status='queued'`,
    [jobId, tenantId],
  )
  if (Number(queued.affectedRows) > 0) {
    await appendEvent(jobId, "cancelled", { while: "queued" })
    const job = await getBackgroundJob(jobId)
    if (job) await afterSettle(job, "cancelled")
    return "cancelled"
  }
  const running = await query<any>("UPDATE platform_background_jobs SET cancel_requested=1 WHERE id=? AND tenant_id=? AND status='running'", [jobId, tenantId])
  if (Number(running.affectedRows) > 0) {
    await appendEvent(jobId, "cancel_requested", {})
    return "cancel_requested"
  }
  return "not_active"
}

async function afterSettle(job: BackgroundJob, status: BackgroundJobStatus) {
  if(job.job_type==="alt_text.advanced_analysis"){
    const {settleAdvancedEvidence}=await import("@/lib/alt-text/advanced-evidence-store")
    await settleAdvancedEvidence(job,status)
    return
  }
  if (job.job_type === "alt_text.math_recognition") {
    const { settleMathEvidence } = await import("@/lib/alt-text/math-store")
    await settleMathEvidence(job, status)
    return
  }
  if (job.job_type === "alt_text.pdf_page_ocr") {
    const { settlePageOcr } = await import("@/lib/alt-text/pdf-page-ocr-store")
    await settlePageOcr(job, status)
    return
  }
  if (job.job_type === "alt_text.document_preparation") {
    try {
      const { onDocumentPreparationJobSettled } = await import("@/lib/alt-text/document-preparation-job")
      await onDocumentPreparationJobSettled(job, status)
    } catch (error) {
      console.error("[jobs] document preparation settle hook failed", error instanceof Error ? error.message : error)
    }
    return
  }
  if (job.job_type !== "alt_text.batch_processing") return
  try {
    const { onAltTextBatchJobSettled } = await import("@/lib/alt-text/batch-job")
    await onAltTextBatchJobSettled(job, status)
  } catch (error) {
    console.error("[jobs] alt-text settle hook failed", error instanceof Error ? error.message : error)
  }
}

/** Requeues jobs whose worker lease expired (crashed or timed-out serverless invocation). */
async function recoverExpiredLeases() {
  await query(
    `UPDATE platform_background_jobs SET status = IF(attempts >= max_attempts, 'dead_letter', 'queued'),
       worker_id = NULL, locked_at = NULL, lease_expires_at = NULL, error_message = 'LEASE_EXPIRED',
       completed_at = IF(attempts >= max_attempts, UTC_TIMESTAMP(), NULL)
     WHERE status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < UTC_TIMESTAMP()`,
  )
  // A final crashed OCR delivery has no handler left to settle its unfinished pages.
  await query(`UPDATE alt_text_document_page_ocr p JOIN platform_background_jobs j ON p.job_id=j.id AND p.tenant_id=j.tenant_id
    SET p.status='failed',p.error_code='LEASE_EXPIRED' WHERE j.job_type='alt_text.pdf_page_ocr' AND j.status='dead_letter'
      AND p.status IN ('queued','rendering','recognizing')`).catch((e) => {
    if ((e as { code?: string }).code !== "ER_NO_SUCH_TABLE") throw e
  })
  await query(`UPDATE alt_text_accessibility_evidence e JOIN platform_background_jobs j ON e.job_id=j.id AND e.tenant_id=j.tenant_id
    SET e.status='failed',e.error_code='LEASE_EXPIRED' WHERE j.job_type='alt_text.math_recognition' AND j.status='dead_letter'
      AND e.kind='math_recognition' AND e.status IN ('queued','recognizing')`).catch((e) => {
    if ((e as { code?: string }).code !== "ER_NO_SUCH_TABLE") throw e
  })
  await query(`UPDATE alt_text_accessibility_evidence e JOIN platform_background_jobs j ON e.job_id=j.id AND e.tenant_id=j.tenant_id
    SET e.status='failed',e.error_code='LEASE_EXPIRED' WHERE j.job_type='alt_text.advanced_analysis' AND j.status='dead_letter'
      AND e.status IN ('queued','running','received')`).catch((e)=>{if((e as {code?:string}).code!=="ER_NO_SUCH_TABLE")throw e})
}

async function claimNext(workerId: string): Promise<BackgroundJob | null> {
  return withTransaction(async (conn) => {
    // Every claimant locks the same existing OCR queue row until commit. Without a shared lock,
    // two claim transactions could both observe zero running OCR jobs and allocate two rasters.
    await conn.query("SELECT id FROM platform_background_jobs WHERE job_type IN ('alt_text.pdf_page_ocr','alt_text.math_recognition','alt_text.advanced_analysis') ORDER BY id LIMIT 1 FOR UPDATE")
    const [rows] = await conn.query<any[]>(
      `SELECT j.* FROM platform_background_jobs j
        WHERE j.status = 'queued' AND j.available_at <= UTC_TIMESTAMP()
          AND (j.concurrency_key IS NULL OR (
            SELECT COUNT(*) FROM platform_background_jobs r WHERE r.status = 'running' AND r.concurrency_key = j.concurrency_key
          ) < j.concurrency_limit)
          AND (j.job_type <> 'alt_text.document_preparation' OR (
            SELECT COUNT(*) FROM platform_background_jobs g WHERE g.status = 'running' AND g.job_type = 'alt_text.document_preparation'
          ) < ?)
          AND (j.job_type NOT IN ('alt_text.pdf_page_ocr','alt_text.math_recognition','alt_text.advanced_analysis') OR (
            SELECT COUNT(*) FROM platform_background_jobs o WHERE o.status='running' AND o.job_type IN ('alt_text.pdf_page_ocr','alt_text.math_recognition','alt_text.advanced_analysis')
          ) < 1)
        ORDER BY j.priority DESC, j.available_at ASC, j.id ASC
        LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [documentPreparationGlobalCap()],
    )
    const row = rows[0]
    if (!row) return null
    await conn.query(
      `UPDATE platform_background_jobs SET status='running', attempts = attempts + 1, worker_id=?, locked_at=UTC_TIMESTAMP(),
         lease_expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND), started_at = COALESCE(started_at, UTC_TIMESTAMP()) WHERE id=?`,
      [workerId, Number(row.timeout_seconds) + 30, row.id],
    )
    return mapJob({ ...row, status: "running", attempts: Number(row.attempts) + 1, worker_id: workerId })
  })
}

async function settle(job: BackgroundJob, status: BackgroundJobStatus, result: Record<string, unknown> | null, errorMessage: string | null, delaySeconds = 0) {
  const terminal = status !== "queued"
  await query(
    `UPDATE platform_background_jobs SET status=?, result=?, error_message=?, worker_id=NULL, locked_at=NULL, lease_expires_at=NULL,
       available_at = IF(? = 'queued', DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND), available_at),
       completed_at = ${terminal ? "UTC_TIMESTAMP()" : "NULL"}
     WHERE id=? AND worker_id=?`,
    [status, result ? JSON.stringify(result) : null, errorMessage?.slice(0, 2000) ?? null, status, delaySeconds, job.id, job.worker_id],
  )
  await appendEvent(job.id, status === "queued" ? "retry_scheduled" : status, { attempt: job.attempts, delaySeconds: status === "queued" ? delaySeconds : null })
  if (terminal) await afterSettle(job, status)
}

export function retryDelaySeconds(attempt: number, baseSeconds: number): number {
  return Math.min(3600, baseSeconds * 2 ** Math.max(0, attempt - 1))
}

async function runJob(job: BackgroundJob): Promise<BackgroundJobStatus> {
  if (job.cancel_requested) {
    await settle(job, "cancelled", null, "CANCELLED")
    return "cancelled"
  }
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, job.timeout_seconds * 1000)
  try {
    const result = await JOB_HANDLERS[job.job_type](job.payload, { signal: controller.signal, job })
    await settle(job, "completed", result ?? null, null)
    return "completed"
  } catch (error) {
    if (error instanceof JobCancelledError) {
      await settle(job, "cancelled", null, error.code)
      return "cancelled"
    }
    if (error instanceof JobDeferredError && !controller.signal.aborted) {
      await query("UPDATE platform_background_jobs SET attempts = GREATEST(attempts - 1, 0) WHERE id=?", [job.id])
      await settle(job, "queued", null, error.code, error.delaySeconds)
      return "queued"
    }
    const message = error instanceof Error ? error.message : String(error)
    const status = retryDisposition(classifyJobFailure(error, timedOut), job.attempts, job.max_attempts)
    await settle(job, status, null, message, status === "queued" ? retryDelaySeconds(job.attempts, job.backoff_seconds) : 0)
    return status
  } finally {
    clearTimeout(timer)
  }
}

/** Drains due jobs until the time budget is spent. Used by /api/jobs/run and post-submit kicks. */
export async function runDueBackgroundJobs(opts: { maxJobs?: number; budgetMs?: number } = {}) {
  await ensureBackgroundJobSchema()
  await recoverExpiredLeases()
  const workerId = `w-${randomUUID()}`
  const deadline = Date.now() + (opts.budgetMs ?? 240_000)
  const outcomes: Array<{ id: number; status: BackgroundJobStatus }> = []
  while (outcomes.length < (opts.maxJobs ?? 10) && Date.now() < deadline) {
    const job = await claimNext(workerId)
    if (!job) break
    outcomes.push({ id: job.id, status: await runJob(job) })
  }
  return outcomes
}
