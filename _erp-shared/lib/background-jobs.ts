/**
 * @file lib/background-jobs.ts
 * @module Platform Core
 * @kind Server-side library
 * @summary Platform Core domain logic (BACKGROUND_JOB_TYPES, BackgroundJobType, BACKGROUND_JOB_STATUSES, BackgroundJobStatus, …).
 * @exports BACKGROUND_JOB_TYPES, BackgroundJobType, BACKGROUND_JOB_STATUSES, BackgroundJobStatus, BackgroundJobPayload, BackgroundJob, EnqueueBackgroundJobInput, ensureBackgroundJobSchema, … (17 total)
 * @data Reads and writes MySQL via lib/db. Sends email.
 * @usedBy app/api/auth/forgot-password/route.ts, app/api/cron/background-queue/route.ts, app/api/platform/background-jobs/[id]/route.ts, app/api/platform/background-jobs/route.ts, app/api/sales/emails/bulk/route.ts (+9 more); 4 test files
 * @see docs/CODEBASE-GUIDE.md for module ownership, conventions and where to add new code.
 */
import "server-only"

import crypto from "crypto"
import { query, withTransaction } from "@/lib/db"
import { getAuditScope, runWithAuditScope, sanitizeCorrelationId } from "@/lib/audit-engine/scope"
import { assertOutboundAllowed } from "@/lib/demo/outbound-guard"
import { fingerprint } from "@/lib/job-idempotency"
import { classifyJobFailure, JobDeferredError, retryDisposition, type FailureKind } from "@/lib/job-retry-policy"
import { assertEnqueueAllowed, globalRunningCapFor, jobLimitsFromEnv, payloadBytes, selectClaimable } from "@/lib/observability/job-limits"
import { clampPriority, getJobDefinition, PRIORITY_AGING_MINUTES } from "@/lib/jobs/registry"
import { assertTransition } from "@/lib/jobs/lifecycle"
import { HEARTBEAT_SECONDS, LEASE_SECONDS, RECOVERY_GRACE_SECONDS, leaseSecondsFor, resolveRunAt } from "@/lib/jobs/policy"
import { PROCESS_WORKER_ID, recordWorkerCycleEnd, recordWorkerCycleStart } from "@/lib/jobs/workers"

/**
 * Durable background queue.
 *
 * Queue entries are data, never commands or URLs. A reviewed handler registry
 * determines the code that can run for each job type.
 */
export const BACKGROUND_JOB_TYPES = ["email.send", "bulk.action", "tenant.scheduled_job", "data.import_batch", "alt_text.batch_processing"] as const
export type BackgroundJobType = (typeof BACKGROUND_JOB_TYPES)[number]

export const BACKGROUND_JOB_STATUSES = ["queued", "running", "completed", "failed", "dead_letter", "cancelled"] as const
export type BackgroundJobStatus = (typeof BACKGROUND_JOB_STATUSES)[number]

type EmailPayload = {
  to: string
  subject: string
  html: string
  cc?: string | string[]
  bcc?: string | string[]
  from?: string
  replyTo?: string
  department?: "sales" | "hr" | "finance" | "operations" | "recruit"
  headers?: Record<string, string>
  /** Correlates a queued send with the tenant email ledger. */
  engineMessageId?: number
  messageId?: string
  inReplyTo?: string
  references?: string
  providerThreadId?: string
  /** Stored attachment paths are resolved by the worker; binary data never enters JSON jobs. */
  attachmentPaths?: string[]
  /** Spec49: sales_emails ledger row updated by the worker (bulk sends). */
  salesEmailId?: number
  /** Per-user mailbox sender, resolved by the worker from the user's own settings. */
  senderUserId?: number
}

/**
 * a large bulk action runs in this durable queue. The payload only
 * carries the stored run id; the worker rehydrates the actor context, id list,
 * and value from the persisted run so nothing about the operation is trusted
 * from the (data-only) queue entry.
 */
type BulkActionPayload = {
  runId: number
}

/** Reference only: tenant comes from the job row, assets/settings from the persisted batch. */
export type AltTextBatchJobPayload = {
  batchId: string
}

export type BackgroundJobPayload = EmailPayload | BulkActionPayload | AltTextBatchJobPayload

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
  locked_at: string | null
  worker_id: string | null
  cancel_requested: boolean
  started_at: string | null
  completed_at: string | null
  result: Record<string, unknown> | null
  error_message: string | null
  created_by: number | null
  created_at: string
  updated_at: string
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
  /** Audit correlation id; defaults to the ambient audit scope's correlation. */
  correlationId?: string | null
  /** Delayed execution (within one year). Past/omitted values run as soon as possible. */
  runAt?: Date | string | null
}

function parseJson(value: unknown): Record<string, unknown> | null {
  if (!value) return null
  if (typeof value === "object") return value as Record<string, unknown>
  try { return JSON.parse(String(value)) as Record<string, unknown> } catch { return null }
}

function mapJob(row: any): BackgroundJob {
  return {
    ...row,
    id: Number(row.id),
    tenant_id: Number(row.tenant_id ?? 0),
    priority: Number(row.priority),
    attempts: Number(row.attempts),
    max_attempts: Number(row.max_attempts),
    backoff_seconds: Number(row.backoff_seconds),
    timeout_seconds: Number(row.timeout_seconds),
    concurrency_limit: Number(row.concurrency_limit),
    cancel_requested: Boolean(row.cancel_requested),
    payload: parseJson(row.payload) ?? {},
    result: parseJson(row.result),
  } as BackgroundJob
}

function bounded(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = Number(value ?? fallback)
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, Math.floor(numeric))) : fallback
}

function validateEmailPayload(payload: unknown): EmailPayload {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Background job payload must be an object")
  const value = payload as Record<string, unknown>
  const to = typeof value.to === "string" ? value.to.trim() : ""
  const subject = typeof value.subject === "string" ? value.subject.trim() : ""
  const html = typeof value.html === "string" ? value.html : ""
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error("A valid email recipient is required")
  if (!subject || subject.length > 255) throw new Error("Email subject must contain 1 to 255 characters")
  if (!html || html.length > 200_000) throw new Error("Email HTML must contain 1 to 200000 characters")
  const department = value.department
  if (department != null && !["sales", "hr", "finance", "operations", "recruit"].includes(String(department))) throw new Error("Invalid email department")
  const headers = value.headers
  if (headers != null && (typeof headers !== "object" || Array.isArray(headers) || Object.values(headers).some((item) => typeof item !== "string"))) {
    throw new Error("Email headers must be string values")
  }
  const engineMessageId = value.engineMessageId
  if (engineMessageId != null && (!Number.isSafeInteger(engineMessageId) || Number(engineMessageId) <= 0)) throw new Error("Invalid engine email message id")
  const attachmentPaths = value.attachmentPaths
  if (attachmentPaths != null && (!Array.isArray(attachmentPaths) || attachmentPaths.length > 10 || attachmentPaths.some((item) => typeof item !== "string" || !/^\/api\/email-attachments\/[A-Za-z0-9_-]+$/.test(item)))) {
    throw new Error("Invalid email attachment paths")
  }
  const salesEmailId = value.salesEmailId
  if (salesEmailId != null && (!Number.isSafeInteger(salesEmailId) || Number(salesEmailId) <= 0)) throw new Error("Invalid sales email id")
  const senderUserId = value.senderUserId
  if (senderUserId != null && (!Number.isSafeInteger(senderUserId) || Number(senderUserId) <= 0)) throw new Error("Invalid sender user id")
  return {
    ...(salesEmailId != null ? { salesEmailId: Number(salesEmailId) } : {}),
    ...(senderUserId != null ? { senderUserId: Number(senderUserId) } : {}),
    to, subject, html,
    ...(typeof value.cc === "string" || Array.isArray(value.cc) ? { cc: value.cc as string | string[] } : {}),
    ...(typeof value.bcc === "string" || Array.isArray(value.bcc) ? { bcc: value.bcc as string | string[] } : {}),
    ...(typeof value.from === "string" ? { from: value.from } : {}),
    ...(department ? { department: department as EmailPayload["department"] } : {}),
    ...(headers ? { headers: headers as Record<string, string> } : {}),
    ...(engineMessageId != null ? { engineMessageId: Number(engineMessageId) } : {}),
    ...(typeof value.messageId === "string" ? { messageId: value.messageId } : {}),
    ...(typeof value.inReplyTo === "string" ? { inReplyTo: value.inReplyTo } : {}),
    ...(typeof value.references === "string" ? { references: value.references } : {}),
    ...(typeof value.providerThreadId === "string" ? { providerThreadId: value.providerThreadId } : {}),
    ...(attachmentPaths ? { attachmentPaths: attachmentPaths as string[] } : {}),
  }
}

function validateBulkActionPayload(payload: unknown): BulkActionPayload {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Bulk action payload must be an object")
  const runId = Number((payload as Record<string, unknown>).runId)
  if (!Number.isSafeInteger(runId) || runId <= 0) throw new Error("A valid bulk run id is required")
  return { runId }
}

function validateAltTextBatchPayload(payload: unknown): AltTextBatchJobPayload {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Alt Text batch payload must be an object")
  const value = payload as Record<string, unknown>
  if (Object.keys(value).some((key) => key !== "batchId")) throw new Error("Alt Text batch payload only carries a batch id")
  const batchId = typeof value.batchId === "string" ? value.batchId : ""
  if (!/^[A-Za-z0-9-]{1,64}$/.test(batchId)) throw new Error("A valid Alt Text batch id is required")
  return { batchId }
}

function validatePayload(jobType: BackgroundJobType, payload: unknown): BackgroundJobPayload {
  if (jobType === "email.send") return validateEmailPayload(payload)
  if (jobType === "alt_text.batch_processing") return validateAltTextBatchPayload(payload)
  if (jobType === "bulk.action" || jobType === "tenant.scheduled_job" || jobType === "data.import_batch") return validateBulkActionPayload(payload)
  throw new Error("Unknown background job type")
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
    worker_id VARCHAR(120) NULL,
    cancel_requested TINYINT(1) NOT NULL DEFAULT 0,
    started_at DATETIME NULL,
    completed_at DATETIME NULL,
    result JSON NULL,
    error_message TEXT NULL,
    created_by BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_background_job_idempotency (job_type, tenant_id, idempotency_key),
    KEY idx_background_job_ready (status, available_at, priority),
    KEY idx_background_job_tenant (tenant_id, status, created_at),
    KEY idx_background_job_concurrency (concurrency_key, status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  await query(`CREATE TABLE IF NOT EXISTS platform_background_job_events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    job_id BIGINT UNSIGNED NOT NULL,
    event_type VARCHAR(40) NOT NULL,
    detail JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id), KEY idx_background_job_event (job_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  const columns = await query<any[]>("SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='platform_background_jobs' AND column_name='trigger_source'")
  if (!columns.length) {
    try {
      await query("ALTER TABLE platform_background_jobs ADD COLUMN trigger_source VARCHAR(30) NOT NULL DEFAULT 'unknown'")
    } catch (error: any) {
      if (error?.code !== "ER_DUP_FIELDNAME") throw error
    }
  }
  // Global Audit Engine (Phase 15): carry the enqueuing request's correlation
  // id so job-emitted audit events join the originating flow.
  const correlation = await query<any[]>("SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='platform_background_jobs' AND column_name='correlation_id'")
  if (!correlation.length) {
    try {
      await query("ALTER TABLE platform_background_jobs ADD COLUMN correlation_id VARCHAR(128) NULL")
    } catch (error: any) {
      if (error?.code !== "ER_DUP_FIELDNAME") throw error
    }
  }
  // Spec: worker leases. NULL for rows claimed by pre-lease workers; recovery
  // falls back to the timeout ceiling for those.
  const lease = await query<any[]>("SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='platform_background_jobs' AND column_name='lease_expires_at'")
  if (!lease.length) {
    try {
      await query("ALTER TABLE platform_background_jobs ADD COLUMN lease_expires_at DATETIME NULL")
    } catch (error: any) {
      if (error?.code !== "ER_DUP_FIELDNAME") throw error
    }
  }
  await ensureIndex("platform_background_jobs", "idx_background_job_lease", "(status, lease_expires_at)")
  // Retention + 24h analytics scan by completion time; alerting scans recent events.
  await ensureIndex("platform_background_jobs", "idx_background_job_completed", "(completed_at, status)")
  await ensureIndex("platform_background_job_events", "idx_background_job_event_time", "(created_at, event_type)")
}

async function ensureIndex(table: string, name: string, columns: string) {
  const rows = await query<any[]>("SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name=? AND index_name=? LIMIT 1", [table, name])
  if (rows.length) return
  try {
    await query(`ALTER TABLE ${table} ADD INDEX ${name} ${columns}`)
  } catch (error: any) {
    if (error?.code !== "ER_DUP_KEYNAME") throw error
  }
}

function resolveJobCorrelationId(explicit: string | null | undefined): string | null {
  return sanitizeCorrelationId(explicit) ?? getAuditScope()?.correlationId ?? null
}

export function ensureBackgroundJobSchema() {
  if (!ensured) ensured = runEnsure().catch((error) => { ensured = null; throw error })
  return ensured
}

async function appendEvent(jobId: number, eventType: string, detail: Record<string, unknown> = {}) {
  await query("INSERT INTO platform_background_job_events (job_id, event_type, detail) VALUES (?,?,?)", [jobId, eventType, JSON.stringify(detail)])
}

async function prepareEnqueue(input: EnqueueBackgroundJobInput) {
  await assertOutboundAllowed("JOB_ENQUEUE")
  if (!BACKGROUND_JOB_TYPES.includes(input.jobType)) throw new Error("Unknown background job type")
  const payload = validatePayload(input.jobType, input.payload)
  const tenantId = bounded(input.tenantId, 0, 0, Number.MAX_SAFE_INTEGER)
  const definition = getJobDefinition(input.jobType)
  const priority = clampPriority(input.jobType, input.priority)
  const maxAttempts = bounded(input.maxAttempts, definition?.defaultMaxAttempts ?? 3, 1, 10)
  const backoffSeconds = bounded(input.backoffSeconds, 30, 1, 3600)
  const timeoutSeconds = bounded(input.timeoutSeconds, definition?.defaultTimeoutSeconds ?? 300, 5, 900)
  const runAt = resolveRunAt(input.runAt)
  const concurrencyLimit = bounded(input.concurrencyLimit, 1, 1, 20)
  const concurrencyKey = input.concurrencyKey == null ? input.jobType : String(input.concurrencyKey).trim().slice(0, 160)
  const rawKey = (input.idempotencyKey ?? crypto.randomUUID()).trim()
  const idempotencyKey = rawKey.length > 160 ? fingerprint(rawKey) : rawKey
  if (!idempotencyKey) throw new Error("An idempotency key is required")
  return { payload, tenantId, priority, maxAttempts, backoffSeconds, timeoutSeconds, runAt, concurrencyLimit, concurrencyKey, idempotencyKey }
}

type TransactionConnection = { query: <T = any>(sql: string, params?: any[]) => Promise<[T, unknown]> }

/**
 * Transactional-outbox enqueue: inserts the job on the caller's open
 * transaction so the business state change and its job commit or roll back
 * together. Call ensureBackgroundJobSchema() before opening the transaction
 * (DDL would implicitly commit it). Idempotent on (type, tenant, key).
 */
export async function enqueueBackgroundJobInTransaction(
  connection: TransactionConnection,
  input: EnqueueBackgroundJobInput & { idempotencyKey: string },
): Promise<{ jobId: number; created: boolean }> {
  const p = await prepareEnqueue(input)
  const [prior] = await connection.query<any[]>(
    "SELECT id, payload FROM platform_background_jobs WHERE job_type=? AND tenant_id=? AND idempotency_key=? LIMIT 1 FOR UPDATE",
    [input.jobType, p.tenantId, p.idempotencyKey],
  )
  if (prior[0]) {
    if (fingerprint(parseJson(prior[0].payload) ?? {}) !== fingerprint(p.payload)) throw new Error("Idempotency key reused with different job payload")
    return { jobId: Number(prior[0].id), created: false }
  }
  const [pendingRows] = p.tenantId > 0
    ? await connection.query<any[]>("SELECT COUNT(*) AS count FROM platform_background_jobs WHERE tenant_id=? AND status IN ('queued','running')", [p.tenantId])
    : [[{ count: 0 }]]
  assertEnqueueAllowed({ tenantId: p.tenantId, payloadBytes: payloadBytes(p.payload), tenantPending: Number(pendingRows[0]?.count ?? 0) }, jobLimitsFromEnv())
  const [result] = await connection.query<any>(
    `INSERT INTO platform_background_jobs
     (job_type, tenant_id, payload, priority, max_attempts, backoff_seconds, timeout_seconds, concurrency_key, concurrency_limit, idempotency_key, created_by, trigger_source, correlation_id, available_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,${p.runAt ? "?" : "NOW()"})`,
    [input.jobType, p.tenantId, JSON.stringify(p.payload), p.priority, p.maxAttempts, p.backoffSeconds, p.timeoutSeconds, p.concurrencyKey || null, p.concurrencyLimit, p.idempotencyKey, input.createdBy ?? null, input.triggerSource ?? "system", resolveJobCorrelationId(input.correlationId), ...(p.runAt ? [p.runAt] : [])],
  )
  const jobId = Number(result.insertId)
  await connection.query("INSERT INTO platform_background_job_events (job_id, event_type, detail) VALUES (?,?,?)",
    [jobId, p.runAt ? "scheduled" : "queued", JSON.stringify({ priority: p.priority, maxAttempts: p.maxAttempts, idempotencyKey: p.idempotencyKey, transactional: true })])
  return { jobId, created: true }
}

export async function enqueueBackgroundJob(input: EnqueueBackgroundJobInput): Promise<BackgroundJob> {
  const { payload, tenantId, priority, maxAttempts, backoffSeconds, timeoutSeconds, runAt, concurrencyLimit, concurrencyKey, idempotencyKey } = await prepareEnqueue(input)
  await ensureBackgroundJobSchema()
  // Spec49: an idempotent replay must succeed even when the tenant is at its cap,
  // so resolve an existing job before evaluating limits.
  if (input.idempotencyKey) {
    const prior = await query<any[]>("SELECT * FROM platform_background_jobs WHERE job_type=? AND tenant_id=? AND idempotency_key=? LIMIT 1", [input.jobType, tenantId, idempotencyKey])
    if (prior[0]) {
      const existing = mapJob(prior[0])
      if (fingerprint(existing.payload) !== fingerprint(payload)) throw new Error("Idempotency key reused with different job payload")
      return existing
    }
  }
  const limits = jobLimitsFromEnv()
  const pendingRows = tenantId > 0
    ? await query<any[]>("SELECT COUNT(*) AS count FROM platform_background_jobs WHERE tenant_id=? AND status IN ('queued','running')", [tenantId])
    : [{ count: 0 }]
  assertEnqueueAllowed({ tenantId, payloadBytes: payloadBytes(payload), tenantPending: Number(pendingRows[0]?.count ?? 0) }, limits)
  try {
    const result = await query<any>(
      `INSERT INTO platform_background_jobs
       (job_type, tenant_id, payload, priority, max_attempts, backoff_seconds, timeout_seconds, concurrency_key, concurrency_limit, idempotency_key, created_by, trigger_source, correlation_id, available_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,${runAt ? "?" : "NOW()"})`,
      [input.jobType, tenantId, JSON.stringify(payload), priority, maxAttempts, backoffSeconds, timeoutSeconds, concurrencyKey || null, concurrencyLimit, idempotencyKey, input.createdBy ?? null, input.triggerSource ?? "system", resolveJobCorrelationId(input.correlationId), ...(runAt ? [runAt] : [])],
    )
    const job = await getBackgroundJob(Number(result.insertId))
    if (!job) throw new Error("Queued job could not be read")
    await appendEvent(job.id, runAt ? "scheduled" : "queued", { priority, maxAttempts, idempotencyKey })
    return job
  } catch (error: any) {
    if (error?.code !== "ER_DUP_ENTRY") throw error
    const rows = await query<any[]>("SELECT * FROM platform_background_jobs WHERE job_type=? AND tenant_id=? AND idempotency_key=? LIMIT 1", [input.jobType, tenantId, idempotencyKey])
    const existing = rows[0] ? mapJob(rows[0]) : null
    if (!existing) throw error
    if (fingerprint(existing.payload) !== fingerprint(payload)) throw new Error("Idempotency key reused with different job payload")
    return existing
  }
}

export async function enqueueEmailJob(input: Omit<EnqueueBackgroundJobInput, "jobType">) {
  return enqueueBackgroundJob({ ...input, jobType: "email.send" })
}

export async function getBackgroundJob(id: number): Promise<BackgroundJob | null> {
  await ensureBackgroundJobSchema()
  const rows = await query<any[]>("SELECT * FROM platform_background_jobs WHERE id=? LIMIT 1", [id])
  return rows[0] ? mapJob(rows[0]) : null
}

export async function listBackgroundJobs(input: { limit?: number; tenantId?: number; status?: BackgroundJobStatus } = {}): Promise<BackgroundJob[]> {
  await ensureBackgroundJobSchema()
  const where: string[] = []
  const params: any[] = []
  if (input.tenantId != null) { where.push("tenant_id=?"); params.push(bounded(input.tenantId, 0, 0, Number.MAX_SAFE_INTEGER)) }
  if (input.status) { where.push("status=?"); params.push(input.status) }
  const limit = bounded(input.limit, 100, 1, 200)
  const rows = await query<any[]>(`SELECT * FROM platform_background_jobs ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ${limit}`, params)
  return rows.map(mapJob)
}

export async function getBackgroundJobStats(tenantId?: number) {
  await ensureBackgroundJobSchema()
  const rows = await query<{ status: BackgroundJobStatus; count: number }[]>(
    `SELECT status, COUNT(*) AS count FROM platform_background_jobs ${tenantId == null ? "" : "WHERE tenant_id=?"} GROUP BY status`,
    tenantId == null ? [] : [bounded(tenantId, 0, 0, Number.MAX_SAFE_INTEGER)],
  )
  return BACKGROUND_JOB_STATUSES.reduce<Record<BackgroundJobStatus, number>>((stats, status) => {
    stats[status] = Number(rows.find((row) => row.status === status)?.count ?? 0)
    return stats
  }, {} as Record<BackgroundJobStatus, number>)
}

export async function cancelBackgroundJob(id: number, actor: { userId: number; reason?: string | null } | null = null): Promise<BackgroundJob | null> {
  await ensureBackgroundJobSchema()
  const job = await getBackgroundJob(id)
  if (!job || ["completed", "failed", "dead_letter", "cancelled"].includes(job.status)) return job
  const reason = actor?.reason ? String(actor.reason).trim().slice(0, 200) : null
  const detail = { actorId: actor?.userId ?? null, reason }
  if (job.status === "queued") {
    assertTransition("queued", "cancelled")
    const result = await query<any>("UPDATE platform_background_jobs SET status='cancelled', completed_at=NOW(), cancel_requested=1 WHERE id=? AND status='queued'", [id])
    // Lost the race with a claim: fall through to a running cancellation request.
    if (Number(result?.affectedRows ?? 0) === 1) await appendEvent(id, "cancelled", { phase: "queued", ...detail })
    else await query("UPDATE platform_background_jobs SET cancel_requested=1 WHERE id=? AND status='running'", [id])
  } else {
    await query("UPDATE platform_background_jobs SET cancel_requested=1 WHERE id=? AND status='running'", [id])
    // The running worker's heartbeat observes this and aborts cooperatively.
    await appendEvent(id, "cancellation_requested", detail)
  }
  if (actor) {
    const { audit } = await import("@/lib/audit-engine/sdk")
    await audit.updated({ type: "background_job", id, label: job.job_type }, {
      actorId: actor.userId,
      metadata: { operation: "cancel", previousStatus: job.status, attempts: job.attempts, reason },
    } as any).catch(() => {})
  }
  return getBackgroundJob(id)
}

export function retryDelaySeconds(attempt: number, baseSeconds: number): number {
  return Math.min(3600, Math.max(1, baseSeconds) * 2 ** Math.max(0, attempt - 1))
}

async function recoverExpiredJobs(): Promise<number> {
  // A lease lapses when its worker stops heartbeating (crash/kill). The hard
  // ceiling still bounds pre-lease rows and any worker that keeps renewing.
  const rows = await query<any[]>(
    `SELECT * FROM platform_background_jobs WHERE status='running' AND (
       (lease_expires_at IS NOT NULL AND lease_expires_at < NOW())
       OR locked_at < DATE_SUB(NOW(), INTERVAL timeout_seconds + ? SECOND)
     ) LIMIT 100`,
    [RECOVERY_GRACE_SECONDS],
  )
  for (const row of rows) await failBackgroundJob(mapJob(row), "Job execution timed out; delivery outcome unknown", true)
  return rows.length
}

async function claimQueuedJobs(limit: number, workerId: string): Promise<BackgroundJob[]> {
  // Paused job types stay queued (never dropped) and are simply not claimed.
  const { listPausedJobTypes } = await import("@/lib/jobs/queue-control")
  const paused = await listPausedJobTypes()
  return withTransaction(async (connection) => {
    const [candidateRows] = await connection.query<any[]>(
      // Effective priority ages one step per PRIORITY_AGING_MINUTES so a steady
      // stream of high-priority work cannot starve low classes indefinitely.
      `SELECT * FROM platform_background_jobs WHERE status='queued' AND cancel_requested=0 AND available_at<=NOW()
       ${paused.length ? "AND job_type NOT IN (?)" : ""}
       ORDER BY LEAST(9, priority + FLOOR(TIMESTAMPDIFF(MINUTE, available_at, NOW()) / ?)) DESC, available_at ASC, id ASC LIMIT ? FOR UPDATE`,
      [...(paused.length ? [paused] : []), PRIORITY_AGING_MINUTES, limit],
    )
    const claimed: BackgroundJob[] = []
    // Spec49: per-tenant running cap so one tenant cannot monopolize every worker.
    const candidates = candidateRows.map(mapJob)
    const tenantIds = [...new Set(candidates.map((job) => job.tenant_id).filter((id) => id > 0))]
    const runningByTenant = new Map<number, number>()
    if (tenantIds.length) {
      const [runningRows] = await connection.query<any[]>("SELECT tenant_id, COUNT(*) AS count FROM platform_background_jobs WHERE status='running' AND tenant_id IN (?) GROUP BY tenant_id", [tenantIds])
      for (const r of runningRows) runningByTenant.set(Number(r.tenant_id), Number(r.count))
    }
    for (const job of selectClaimable(candidates, runningByTenant, jobLimitsFromEnv())) {
      const executionId = crypto.randomUUID()
      if (job.concurrency_key) {
        const [countRows] = await connection.query<any[]>("SELECT COUNT(*) AS count FROM platform_background_jobs WHERE concurrency_key=? AND status='running'", [job.concurrency_key])
        if (Number(countRows[0]?.count ?? 0) >= job.concurrency_limit) continue
      }
      const typeCap = globalRunningCapFor(job.job_type)
      if (typeCap != null) {
        const [typeRows] = await connection.query<any[]>("SELECT COUNT(*) AS count FROM platform_background_jobs WHERE job_type=? AND status='running'", [job.job_type])
        if (Number(typeRows[0]?.count ?? 0) >= typeCap) continue
      }
      const [result] = await connection.query<any>("UPDATE platform_background_jobs SET status='running', attempts=attempts+1, locked_at=NOW(), lease_expires_at=DATE_ADD(NOW(), INTERVAL ? SECOND), worker_id=?, started_at=COALESCE(started_at, NOW()) WHERE id=? AND status='queued'", [leaseSecondsFor(job.timeout_seconds), executionId, job.id])
      if (Number(result.affectedRows) !== 1) continue
      job.status = "running"
      job.attempts += 1
      job.locked_at = new Date().toISOString()
      job.worker_id = executionId
      claimed.push(job)
      await connection.query("INSERT INTO platform_background_job_events (job_id, event_type, detail) VALUES (?,?,?)", [job.id, "running", JSON.stringify({ workerId, executionId, attempt: job.attempts })])
    }
    return claimed
  })
}

type JobHandlerContext = { signal: AbortSignal; job: BackgroundJob }
type JobHandler = (payload: BackgroundJobPayload, context: JobHandlerContext) => Promise<Record<string, unknown> | void>

const JOB_HANDLERS: Record<BackgroundJobType, JobHandler> = {
  async "email.send"(payload) {
    const email = payload as EmailPayload
    if (email.engineMessageId) {
      // Spec41: a bounce/complaint may have arrived after queueing; never send to it.
      const { cancelIfSuppressed } = await import("@/lib/email-engine/service")
      if (await cancelIfSuppressed(email.engineMessageId)) return { cancelled: "suppressed" }
    }
    const { hydrateDepartmentSMTP, loadAttachment, sendEmail } = await import("@/lib/email")
    if (email.department) await hydrateDepartmentSMTP(email.department)
    const attachments = (await Promise.all((email.attachmentPaths ?? []).map(loadAttachment))).filter((attachment): attachment is NonNullable<typeof attachment> => Boolean(attachment))
    const { salesEmailId, senderUserId, ...sendable } = email
    const result = await sendEmail({ ...sendable, senderUserId: senderUserId ?? null, attachments })
    if (email.engineMessageId) {
      const { markTenantEmailAccepted } = await import("@/lib/email-engine/service")
      await markTenantEmailAccepted(email.engineMessageId, result)
    }
    if (salesEmailId) {
      await query(
        "UPDATE sales_emails SET status='Sent', error_message=NULL, message_id=COALESCE(?, message_id), references_header=COALESCE(?, references_header), provider_thread_id=?, sent_at=CURRENT_TIMESTAMP WHERE id=? AND status='Queued'",
        [result.messageId ?? null, result.messageId ?? null, result.providerThreadId ?? null, salesEmailId],
      )
    }
    return { messageId: result.messageId ?? null, providerThreadId: result.providerThreadId ?? null }
  },
  async "bulk.action"(payload, context) {
    const { runId } = payload as BulkActionPayload
    const { resumeBulkRun } = await import("@/lib/bulk-actions/service")
    const report = await resumeBulkRun(runId, context.signal)
    if (!report) return { skipped: "run not found or not resumable" }
    return { total: report.total, succeeded: report.succeeded, failed: report.failed, skipped: report.skipped }
  },
  async "tenant.scheduled_job"(payload, context) {
    const { runId } = payload as BulkActionPayload
    const { executeTenantJobRun } = await import("@/lib/tenant-jobs/store")
    return executeTenantJobRun(runId, context.job)
  },
  async "data.import_batch"(payload, context) {
    // Payload carries only the staged job id; tenant, mapping and actor are
    // rehydrated from the persisted, tenant-scoped job row.
    const { runId } = payload as BulkActionPayload
    const { processBatchImport } = await import("@/lib/data-import-batches-store")
    return processBatchImport(runId, context.signal)
  },
  async "alt_text.batch_processing"(payload, context) {
    const [{ runAltTextBatchJob }, { processAltTextBatch }] = await Promise.all([import("@/lib/alt-text/batch-job"), import("@/lib/alt-text/batch-processor")])
    return runAltTextBatchJob(payload as AltTextBatchJobPayload, context, { processor: processAltTextBatch })
  },
}

/** Mirror queue outcomes onto tenant scheduled-job runs (history + notifications). */
async function afterSettle(job: BackgroundJob, status: BackgroundJobStatus, result: Record<string, unknown> | void, errorMessage: string | null) {
  if (job.job_type === "alt_text.batch_processing") {
    try {
      const { onAltTextBatchJobSettled } = await import("@/lib/alt-text/batch-job")
      await onAltTextBatchJobSettled(job, status)
    } catch (error) {
      console.error("[background-jobs] alt text settle hook failed", error instanceof Error ? error.message : error)
    }
    return
  }
  if (job.job_type !== "tenant.scheduled_job") return
  try {
    const { onTenantJobRunSettled } = await import("@/lib/tenant-jobs/store")
    await onTenantJobRunSettled((job.payload as BulkActionPayload).runId, job.tenant_id, status, errorMessage, result)
  } catch (error) {
    console.error("[background-jobs] tenant job settle hook failed", error instanceof Error ? error.message : error)
  }
}

/** Row lock + attempt identity prevent stale workers from finishing another attempt. */
export function ownsJobAttempt(job: BackgroundJob, latest: BackgroundJob): boolean {
  return latest.status === "running" && latest.worker_id === job.worker_id && latest.attempts === job.attempts
}

async function settleBackgroundJob(job: BackgroundJob, result: Record<string, unknown> | void, errorMessage: string | null, failureKind: FailureKind = "uncertain"): Promise<BackgroundJobStatus> {
  return withTransaction(async connection => {
    const [rows] = await connection.query<any[]>("SELECT * FROM platform_background_jobs WHERE id=? FOR UPDATE", [job.id])
    if (!rows[0]) return "failed"
    const latest = mapJob(rows[0])
    if (!ownsJobAttempt(job, latest)) return latest.status
    const status: BackgroundJobStatus = latest.cancel_requested ? "cancelled"
      : !errorMessage ? "completed"
      : retryDisposition(failureKind, latest.attempts, latest.max_attempts)
    assertTransition(latest.status, status)
    const delay = retryDelaySeconds(latest.attempts, latest.backoff_seconds)
    await connection.query(
      `UPDATE platform_background_jobs SET status=?, result=?, error_message=?, locked_at=NULL, lease_expires_at=NULL,
       worker_id=NULL, completed_at=IF(?='queued',NULL,NOW()),
       available_at=IF(?='queued',DATE_ADD(NOW(),INTERVAL ? SECOND),available_at) WHERE id=?`,
      [status, JSON.stringify(errorMessage ? { failureKind } : result ?? {}), errorMessage?.slice(0, 4000) ?? null, status, status, delay, job.id],
    )
    await connection.query("INSERT INTO platform_background_job_events (job_id, event_type, detail) VALUES (?,?,?)",
      [job.id, status === "queued" ? "retry_scheduled" : status, JSON.stringify({ attempt: job.attempts, executionId: job.worker_id, failureKind: errorMessage ? failureKind : null, delaySeconds: status === "queued" ? delay : null })])
    return status
  })
}
async function completeBackgroundJob(job: BackgroundJob, result: Record<string, unknown> | void) {
  const status = await settleBackgroundJob(job, result, null)
  await afterSettle(job, status, result, null)
  if (status === "completed") await meterCompletedJob(job)
  return status
}

/**
 * Operational (non-billable) usage: one event per successfully completed job,
 * idempotent on the job id so a duplicate settle can never double-count.
 * Tenant 0 is the platform/system scope and is not metered.
 */
async function meterCompletedJob(job: BackgroundJob) {
  if (!job.tenant_id || job.tenant_id < 1) return
  try {
    // Dynamic import: billing imports nothing from the queue, but keeping this lazy avoids a load-order cycle via email-engine.
    const { meterUsage } = await import("@/lib/billing/usage-guard")
    meterUsage({
      meterKey: "background_jobs",
      quantity: 1,
      tenantId: job.tenant_id,
      source: "background_jobs",
      refId: String(job.id),
      idempotencyKey: `job:${job.id}`,
      attribution: { actorType: "job", sourceModule: "background_jobs", modelOrService: job.job_type, billable: false, costStatus: "unavailable" },
    })
  } catch (error) {
    console.error("[background-jobs] usage metering failed", error instanceof Error ? error.message : error)
  }
}
async function failBackgroundJob(job: BackgroundJob, errorMessage: string, uncertain = false, error?: unknown) {
  const status = await settleBackgroundJob(job, undefined, errorMessage, classifyJobFailure(error, uncertain))
  await afterSettle(job, status, undefined, errorMessage)
  return status
}

/**
 * Returns a safely-run job to `queued` without completing it or consuming its
 * retry budget (the attempt is still recorded in the event log).
 */
export async function deferBackgroundJob(job: BackgroundJob, deferral: JobDeferredError): Promise<BackgroundJobStatus> {
  return withTransaction(async (connection) => {
    const [rows] = await connection.query<any[]>("SELECT * FROM platform_background_jobs WHERE id=? FOR UPDATE", [job.id])
    if (!rows[0]) return "failed"
    const latest = mapJob(rows[0])
    if (!ownsJobAttempt(job, latest)) return latest.status
    const status: BackgroundJobStatus = latest.cancel_requested ? "cancelled" : "queued"
    assertTransition(latest.status, status)
    await connection.query(
      `UPDATE platform_background_jobs SET status=?, attempts=IF(?='queued', GREATEST(attempts-1, 0), attempts), error_message=?,
       locked_at=NULL, lease_expires_at=NULL, worker_id=NULL, completed_at=IF(?='queued', NULL, NOW()),
       available_at=IF(?='queued', DATE_ADD(NOW(), INTERVAL ? SECOND), available_at) WHERE id=?`,
      [status, status, deferral.code.slice(0, 200), status, status, deferral.delaySeconds, job.id],
    )
    await connection.query("INSERT INTO platform_background_job_events (job_id, event_type, detail) VALUES (?,?,?)",
      [job.id, status === "queued" ? "deferred" : status, JSON.stringify({ attempt: job.attempts, executionId: job.worker_id, reason: deferral.code, delaySeconds: deferral.delaySeconds })])
    return status
  })
}

async function executeBackgroundJob(job: BackgroundJob): Promise<BackgroundJobStatus> {
  const latest = await getBackgroundJob(job.id)
  if (!latest || !ownsJobAttempt(job, latest)) return latest?.status ?? "failed"
  if (latest.cancel_requested) return completeBackgroundJob(job, undefined)
  // The queue/settlement tables belong to the shared control plane, but the
  // handlers below still access shared business repositories. Never run one
  // for an isolated tenant until that handler has been explicitly routed.
  // Tenant 0 is reserved for platform/system jobs without a tenant data plane.
  const { checkBackgroundJobDataPlane } = await import("@/lib/tenant-db/business-gate")
  const decision = await checkBackgroundJobDataPlane(job.tenant_id)
  if (!decision.ok) {
    // A configuration block is terminal; a control-plane outage can retry.
    // Both outcomes persist only a fixed code, never a DB error or credential.
    const error = Object.assign(new Error(decision.code), {
      code: decision.code,
      status: decision.retryable ? 503 : 409,
    })
    return failBackgroundJob(job, decision.code, false, error)
  }
  const controller = new AbortController()
  const handler = JOB_HANDLERS[job.job_type]
  const auditScope = {
    actorType: "BACKGROUND_JOB" as const,
    actorLabel: `job:${job.job_type}`,
    jobId: String(job.id),
    tenantId: job.tenant_id > 0 ? job.tenant_id : null,
    correlationId: sanitizeCorrelationId((latest as any).correlation_id) ?? `job-${job.id}`,
  }
  const work = Promise.resolve().then(() =>
    runWithAuditScope(auditScope, async () => handler(job.payload, { signal: controller.signal, job })),
  )
  // Retain a catch handler for work that completes after the race times out.
  void work.catch(() => {})
  const heartbeat = startLeaseHeartbeat(job, controller)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort()
          reject(new Error(`Job timed out after ${job.timeout_seconds} seconds`))
        }, job.timeout_seconds * 1000)
      }),
    ])
    return completeBackgroundJob(job, result)
  } catch (error) {
    if (error instanceof JobDeferredError && !controller.signal.aborted) return deferBackgroundJob(job, error)
    const status = await failBackgroundJob(job, error instanceof Error ? error.message : "Unknown background job failure", controller.signal.aborted, error)
    // Keep the central email record queued while the durable queue is retrying.
    // A terminal failure is recorded only after retryDisposition has decided it
    // will not be replayed, avoiding a misleading failed state between attempts.
    const email = job.job_type === "email.send" ? job.payload as EmailPayload : null
    if (email?.engineMessageId && status !== "queued") {
      const { markTenantEmailFailed } = await import("@/lib/email-engine/service")
      await markTenantEmailFailed(email.engineMessageId, error).catch(() => {})
    }
    if (email?.salesEmailId && status !== "queued") {
      const reason = (error instanceof Error ? error.message : "Delivery failed").slice(0, 500)
      await query("UPDATE sales_emails SET status='Failed', error_message=? WHERE id=? AND status='Queued'", [reason, email.salesEmailId]).catch(() => {})
    }
    return status
  } finally {
    if (timer) clearTimeout(timer)
    clearInterval(heartbeat)
  }
}

/**
 * Renews the lease while this attempt still owns the row. Losing ownership
 * (recovered elsewhere) or an operator cancellation aborts the handler's
 * signal so cooperative handlers stop at the next checkpoint. A transient DB
 * error only skips one beat; the lease outlives two missed beats.
 */
function startLeaseHeartbeat(job: BackgroundJob, controller: AbortController) {
  const leaseSeconds = Math.min(LEASE_SECONDS, job.timeout_seconds + RECOVERY_GRACE_SECONDS)
  const interval = setInterval(async () => {
    if (controller.signal.aborted) return
    try {
      const result = await query<any>(
        "UPDATE platform_background_jobs SET lease_expires_at=DATE_ADD(NOW(), INTERVAL ? SECOND) WHERE id=? AND status='running' AND worker_id=? AND attempts=? AND cancel_requested=0",
        [leaseSeconds, job.id, job.worker_id, job.attempts],
      )
      if (Number(result?.affectedRows ?? 0) === 0) controller.abort()
    } catch {
      // Skip this beat; recovery only triggers after the lease fully lapses.
    }
  }, HEARTBEAT_SECONDS * 1000)
  interval.unref?.()
  return interval
}

async function runWithConcurrency<T>(items: T[], limit: number, action: (item: T) => Promise<void>) {
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++]
      await action(item)
    }
  })
  await Promise.all(workers)
}

export async function runBackgroundQueueWorker(input: { limit?: number; workerId?: string } = {}) {
  await ensureBackgroundJobSchema()
  const recovered = await recoverExpiredJobs()
  // Do not acquire leases for jobs waiting behind this worker's local slots.
  const limit = bounded(input.limit, 5, 1, 5)
  const workerId = (input.workerId || `scheduler-${process.pid}-${crypto.randomUUID().slice(0, 8)}`).slice(0, 120)
  const jobs = await claimQueuedJobs(limit, workerId)
  await recordWorkerCycleStart(PROCESS_WORKER_ID, limit, jobs.length)
  const outcomes: Record<BackgroundJobStatus, number> = { queued: 0, running: 0, completed: 0, failed: 0, dead_letter: 0, cancelled: 0 }
  try {
    await runWithConcurrency(jobs, 5, async (job) => { outcomes[await executeBackgroundJob(job)]++ })
  } finally {
    await recordWorkerCycleEnd(PROCESS_WORKER_ID, jobs.length, outcomes.failed + outcomes.dead_letter)
  }
  const { runQueueMaintenance } = await import("@/lib/jobs/maintenance")
  const maintenance = await runQueueMaintenance()
  return { recovered, claimed: jobs.length, outcomes, maintenance }
}
