/**
 * @file lib/alt-text/document-preparation-job.ts
 * @module Publishing · Alt Text
 * @kind Server-side library
 * @summary Phase 3 Task 11 — durable document preparation on the Phase 2 queue
 *   (`alt_text.document_preparation`). Stages: extraction → mapping → context → readiness → ready.
 *   Reuses the existing extractors (Task 5/7), location resolver (Task 8), context engine (Task 9)
 *   and selection snapshot (Task 10). Never generates AI descriptions or calls paid providers.
 * @usedBy lib/background-jobs.ts (handler + settle hook), app/api/alt-text/documents/[uploadId]/process/route.ts
 */
import "server-only"
import {
  enqueueBackgroundJobInTransaction,
  ensureBackgroundJobSchema,
  getBackgroundJob,
  isBackgroundJobCancelRequested,
  recordBackgroundJobEvent,
  requestBackgroundJobCancel,
  type BackgroundJob,
  type BackgroundJobStatus,
  type DocumentPreparationJobPayload,
} from "@/lib/background-jobs"
import { withTransaction } from "@/lib/db"
import { JobCancelledError, JobDeferredError } from "@/lib/job-retry-policy"
import { currentTenantId, runForTenant } from "@/lib/tenant-scope"
import { analyzeDocumentContexts } from "./document-context-service"
import { extractDocumentImages } from "./document-extraction"
import { getReadinessSummary, getSelectionSnapshot } from "./document-image-review-store"
import type { DocumentImageSelectionItem } from "./document-image-review"
import {
  derivePreparationJobStatus,
  WORK_STAGES,
  type DocumentPreparationProgress,
  type MappingCounts,
  type PreparationStage,
  type ReadinessSummary,
  type WorkStage,
} from "./document-preparation-contract"
import {
  countAssetStatuses,
  countContextStates,
  getAssetSettings,
  getPreparationCheckpoint,
  savePreparationCheckpoint,
} from "./document-preparation-store"
import { DOCUMENT_IMAGE_PAGE_MAX } from "./document-records"
import { countDocumentImages, getDocumentImages, type StoredDocument } from "./document-store"
import { getDocumentForExtraction } from "./document-service"
import { resolveImageLocation, type LocatableImage } from "./image-location"

export const DOCUMENT_PREPARATION_JOB_TYPE = "alt_text.document_preparation" as const
export const PREPARATION_SUPPORTED_TYPES = new Set(["pdf", "pptx"])

const bounded = (raw: string | undefined, fallback: number, min: number, max: number) => {
  const n = Number(raw)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : fallback
}
/** Per-tenant running document jobs (the global cap lives in background-jobs claimNext). */
export const documentPreparationTenantCap = () => bounded(process.env.ALT_TEXT_DOCUMENT_JOBS_PER_TENANT_MAX, 1, 1, 10)
export const PREPARATION_JOB_LIMITS = { maxAttempts: 4, backoffSeconds: 30, timeoutSeconds: 280 } as const

/** Error carrying an HTTP-like status so the shared classifier treats 4xx as permanent and 5xx as transient. */
export class PreparationStageError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "PreparationStageError"
  }
}

const tenantConcurrencyKey = (tenantId: number) => `alt_text.document_preparation:tenant:${tenantId}`
/** Stable per-run identity: chained to the job it replaces, so double submits converge on one job. */
export const preparationIdempotencyKey = (documentId: number, previousJobId: number | null) => `alt-text-doc-prep:${documentId}:after:${previousJobId ?? 0}`

const ACTIVE_QUEUE_STATUSES = new Set<BackgroundJobStatus>(["queued", "running"])

// ─── Enqueue ─────────────────────────────────────────────────────────────────

export type StartPreparationResult =
  | { ok: true; jobId: number; created: boolean }
  | { ok: false; status: 409 | 415 | 503; code: string; error: string }

/**
 * Create (or reuse) the durable preparation job for an authorized, security-cleared document.
 * The job row and the document's preparation pointer are written in one transaction, so success is
 * only returned after the queue accepted the job.
 */
export async function startDocumentPreparation(doc: StoredDocument, userId: number): Promise<StartPreparationResult> {
  if (doc.securityStatus !== "clean") return { ok: false, status: 409, code: "DOCUMENT_NOT_CLEAN", error: "The document has not passed the security scan." }
  if (!PREPARATION_SUPPORTED_TYPES.has(doc.documentType))
    return { ok: false, status: 415, code: "UNSUPPORTED_DOCUMENT_TYPE", error: "Word (DOCX) image extraction is not available yet." }

  const tenantId = currentTenantId()
  const checkpoint = await getPreparationCheckpoint(doc.id)
  const previousJobId = checkpoint?.jobId ?? null
  if (previousJobId) {
    const prior = await getBackgroundJob(previousJobId)
    if (prior && prior.tenant_id === tenantId && ACTIVE_QUEUE_STATUSES.has(prior.status)) return { ok: true, jobId: prior.id, created: false }
  }

  await ensureBackgroundJobSchema()
  try {
    return await withTransaction(async (conn) => {
      const { jobId, created } = await enqueueBackgroundJobInTransaction(conn, {
        jobType: DOCUMENT_PREPARATION_JOB_TYPE,
        tenantId,
        payload: { documentId: doc.id },
        idempotencyKey: preparationIdempotencyKey(doc.id, previousJobId),
        concurrencyKey: tenantConcurrencyKey(tenantId),
        concurrencyLimit: documentPreparationTenantCap(),
        ...PREPARATION_JOB_LIMITS,
        createdBy: userId,
        triggerSource: "user_request",
      })
      // Compare-and-set on the previous pointer: a concurrent submit that already advanced it loses.
      const [res] = await conn.query<any>(
        `UPDATE alt_text_documents
            SET preparation_job_id = ?, preparation_stage = 'queued', preparation_error_code = NULL, preparation_updated_at = CURRENT_TIMESTAMP
          WHERE tenant_id = ? AND id = ? AND (preparation_job_id <=> ? OR preparation_job_id = ?)`,
        [jobId, tenantId, doc.id, previousJobId, jobId],
      )
      if (Number(res.affectedRows ?? 0) === 0) throw new PreparationStageError(409, "PREPARATION_CONFLICT", "Another preparation request was accepted first.")
      return { ok: true as const, jobId, created }
    })
  } catch (err) {
    if (err instanceof PreparationStageError) {
      const current = await getPreparationCheckpoint(doc.id)
      if (current?.jobId) return { ok: true, jobId: current.jobId, created: false }
      return { ok: false, status: 409, code: err.code, error: err.message }
    }
    if (err instanceof Error && /limit|capacity|too many/i.test(err.message))
      return { ok: false, status: 503, code: "QUEUE_FULL", error: "The processing queue is full. Please try again shortly." }
    throw err
  }
}

/** Durable cancel through the shared Phase 2 flag. A running job stops at its next stage checkpoint. */
export async function cancelDocumentPreparation(documentId: number): Promise<{ result: "cancelled" | "cancel_requested" | "not_active"; jobId: number | null }> {
  const checkpoint = await getPreparationCheckpoint(documentId)
  if (!checkpoint?.jobId) return { result: "not_active", jobId: null }
  const result = await requestBackgroundJobCancel(checkpoint.jobId, currentTenantId())
  if (result === "cancelled") await savePreparationCheckpoint(documentId, checkpoint.jobId, { stage: "cancelled", errorCode: null })
  return { result, jobId: checkpoint.jobId }
}

// ─── Worker ──────────────────────────────────────────────────────────────────

const stageIndex = (s: PreparationStage | null) => (s && (WORK_STAGES as readonly string[]).includes(s) ? WORK_STAGES.indexOf(s as WorkStage) : 0)

function failureToError(f: { status: number; code: string; error: string }): Error {
  // Another extraction holds the document's lock: wait for it instead of failing permanently on a 409.
  if (f.code === "EXTRACTION_IN_PROGRESS" || f.code === "CONFLICT") return new JobDeferredError("EXTRACTION_IN_PROGRESS", 60)
  return new PreparationStageError(f.status, f.code, f.error)
}

export async function runDocumentPreparationJob(payload: DocumentPreparationJobPayload, context: { signal: AbortSignal; job: BackgroundJob }) {
  const { job, signal } = context
  return runForTenant({ tenantId: job.tenant_id }, async () => {
    const documentId = payload.documentId
    const checkpoint = await getPreparationCheckpoint(documentId)
    // Superseded or orphaned delivery: never touch state owned by another job.
    if (!checkpoint || checkpoint.jobId !== job.id) return { superseded: true }

    const checkpointGuard = async (stage: WorkStage) => {
      if (signal.aborted) throw Object.assign(new Error("Preparation run timed out"), { name: "AbortError" })
      if (await isBackgroundJobCancelRequested(job.id)) throw new JobCancelledError("PREPARATION_CANCELLED")
      await savePreparationCheckpoint(documentId, job.id, { stage, errorCode: null })
      await recordBackgroundJobEvent(job.id, "stage_started", { stage })
    }
    const permanent = async (status: number, code: string, message: string) => {
      await savePreparationCheckpoint(documentId, job.id, { stage: "failed", errorCode: code })
      return new PreparationStageError(status, code, message)
    }

    const doc = await getDocumentForExtraction(documentId, null)
    if (!doc) throw await permanent(404, "NOT_FOUND", "The document no longer exists.")
    if (doc.securityStatus !== "clean") throw await permanent(409, "DOCUMENT_NOT_CLEAN", "The document has not passed the security scan.")
    if (!PREPARATION_SUPPORTED_TYPES.has(doc.documentType)) throw await permanent(415, "UNSUPPORTED_DOCUMENT_TYPE", "This document type cannot be prepared yet.")

    // Resume after the last checkpointed stage; each stage is idempotent, so re-running the
    // interrupted one is safe (extraction reports alreadyProcessed, context rows are overwritten).
    const start = stageIndex(checkpoint.stage)
    const result: Record<string, unknown> = { documentId }

    if (start <= 0) {
      await checkpointGuard("extraction")
      const r = await extractDocumentImages(documentId, null)
      if (!r.ok) {
        const err = failureToError(r)
        if (err instanceof PreparationStageError && r.status < 500) throw await permanent(r.status, r.code, r.error)
        await savePreparationCheckpoint(documentId, job.id, { stage: "extraction", errorCode: r.code })
        throw err
      }
      result.extraction = { counts: r.summary.counts, alreadyProcessed: r.summary.alreadyProcessed ?? false }
    }

    if (start <= 1) {
      await checkpointGuard("mapping")
      const mapping = await mapOccurrences(documentId, doc.documentType as "pdf" | "pptx", signal)
      await savePreparationCheckpoint(documentId, job.id, { stage: "mapping", errorCode: null, data: { ...(checkpoint.data ?? {}), mapping } })
      result.mapping = mapping
    }

    if (start <= 2) {
      await checkpointGuard("context")
      const counts = await countDocumentImages(documentId)
      if (counts.extracted > 0) {
        const r = await analyzeDocumentContexts(documentId, null)
        if (!r.ok) {
          if (r.status >= 500) {
            await savePreparationCheckpoint(documentId, job.id, { stage: "context", errorCode: r.code })
            throw new PreparationStageError(r.status, r.code, r.error)
          }
          // Recoverable at document level: occurrences keep their extraction; readiness still runs.
          result.contextError = r.code
        } else result.context = r.summary
      }
    }

    await checkpointGuard("readiness")
    const readiness = await buildReadinessSummary(documentId)
    const latest = await getPreparationCheckpoint(documentId)
    await savePreparationCheckpoint(documentId, job.id, {
      stage: "ready",
      errorCode: typeof result.contextError === "string" ? result.contextError : null,
      data: { ...(latest?.data ?? {}), readiness: readiness as unknown as Record<string, unknown> },
    })
    await recordBackgroundJobEvent(job.id, "stage_completed", { stage: "ready" })
    return { ...result, readiness }
  })
}

/** Task 8 location resolution over persisted occurrences, paged (no unbounded Promise.all). */
async function mapOccurrences(documentId: number, documentType: "pdf" | "pptx", signal: AbortSignal): Promise<MappingCounts> {
  const out: MappingCounts = { mapped: 0, partial: 0, unavailable: 0 }
  for (let offset = 0; ; offset += DOCUMENT_IMAGE_PAGE_MAX) {
    if (signal.aborted) throw Object.assign(new Error("Preparation run timed out"), { name: "AbortError" })
    const page = await getDocumentImages(documentId, { limit: DOCUMENT_IMAGE_PAGE_MAX, offset })
    for (const img of page) {
      if (img.extractionStatus !== "extracted") continue
      try {
        out[resolveImageLocation(img as unknown as LocatableImage, documentType).status]++
      } catch {
        out.unavailable++
      }
    }
    if (page.length < DOCUMENT_IMAGE_PAGE_MAX) return out
  }
}

async function buildReadinessSummary(documentId: number): Promise<ReadinessSummary> {
  const snapshot = await getSelectionSnapshot(documentId)
  const eligible = snapshot.items.filter((i) => i.eligibility.eligible).length
  const bySha = new Map<string, number>()
  for (const i of snapshot.items) if (i.mediaSha256) bySha.set(i.mediaSha256, (bySha.get(i.mediaSha256) ?? 0) + 1)
  const shared = snapshot.items.filter((i) => i.mediaSha256 && (bySha.get(i.mediaSha256) ?? 0) > 1).length
  return { selected: snapshot.total, eligible, ineligible: snapshot.total - eligible, sharedBinaryOccurrences: shared, preparedAt: new Date().toISOString() }
}

// ─── Settlement hook (called by background-jobs afterSettle) ─────────────────

export async function onDocumentPreparationJobSettled(job: BackgroundJob, status: BackgroundJobStatus) {
  if (status !== "failed" && status !== "dead_letter" && status !== "cancelled") return
  const documentId = (job.payload as DocumentPreparationJobPayload).documentId
  await runForTenant({ tenantId: job.tenant_id }, async () => {
    const checkpoint = await getPreparationCheckpoint(documentId)
    if (!checkpoint || checkpoint.jobId !== job.id || checkpoint.stage === "ready") return
    const stage = status === "cancelled" ? "cancelled" : "failed"
    await savePreparationCheckpoint(documentId, job.id, { stage, errorCode: stage === "failed" ? (checkpoint.errorCode ?? "PREPARATION_FAILED") : null })
  })
}

// ─── Batch readiness contract (Task 12 consumes this; nothing is enqueued here) ─

export type PreparedBatchItem = {
  tenantId: number
  documentId: number
  imageOccurrenceId: number
  altTextAssetId: number
  sourceLocator: string
  contextRef: DocumentImageSelectionItem["context"]
  eligibility: DocumentImageSelectionItem["eligibility"]
  imageSettings: { language: string; audience: string; assetStatus: string } | null
  projectId: number | null
  batchId: string | null
  /** Binary identity only. Occurrences sharing a binary stay separate items. */
  mediaSha256: string | null
}

/** One item per selected occurrence, never deduplicated by image bytes. Caller must have authorized the document. */
export async function getPreparedBatchItems(documentId: number): Promise<PreparedBatchItem[]> {
  const tenantId = currentTenantId()
  const snapshot = await getSelectionSnapshot(documentId)
  const settings = await getAssetSettings(snapshot.items.map((i) => i.altTextAssetId))
  return snapshot.items.map((i) => {
    const s = settings.get(i.altTextAssetId)
    return {
      tenantId,
      documentId,
      imageOccurrenceId: i.imageId,
      altTextAssetId: i.altTextAssetId,
      sourceLocator: i.sourceLocator,
      contextRef: i.context,
      eligibility: i.eligibility,
      imageSettings: s ? { language: s.language, audience: s.audience, assetStatus: s.status } : null,
      projectId: s?.projectId ?? null,
      batchId: s?.batchId ?? null,
      mediaSha256: i.mediaSha256,
    }
  })
}

// ─── Progress (read from persisted state only) ───────────────────────────────

export async function getDocumentPreparationProgress(documentId: number): Promise<DocumentPreparationProgress> {
  const tenantId = currentTenantId()
  const checkpoint = await getPreparationCheckpoint(documentId)
  const [job, counts, context, review] = await Promise.all([
    checkpoint?.jobId ? getBackgroundJob(checkpoint.jobId) : Promise.resolve(null),
    countDocumentImages(documentId),
    countContextStates(documentId),
    getReadinessSummary(documentId),
  ])
  const ownJob = job && job.tenant_id === tenantId ? job : null
  const jobStatus = ownJob ? derivePreparationJobStatus({ status: ownJob.status, attempts: ownJob.attempts, cancelRequested: ownJob.cancel_requested }) : null
  const readiness = (checkpoint?.data?.readiness as ReadinessSummary | undefined) ?? null
  const byAssetStatus = await selectedAssetStatuses(documentId)
  const extended = ownJob as (BackgroundJob & { started_at?: unknown; updated_at?: unknown }) | null
  const toIso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString())
  return {
    documentId,
    jobId: ownJob?.id ?? null,
    stage: checkpoint?.stage ?? null,
    jobStatus,
    attempts: ownJob?.attempts ?? 0,
    maxAttempts: ownJob?.max_attempts ?? 0,
    errorCode: checkpoint?.errorCode ?? null,
    counts: {
      totalKnown: counts.total > 0 ? counts.total : null,
      extracted: counts.extracted,
      failed: counts.failed,
      unsupported: counts.unsupported,
      mapping: checkpoint?.data?.mapping ?? null,
      context,
    },
    readiness,
    aiGeneration: { status: review.selectedOccurrences > 0 ? "pending_generation" : "not_started", byAssetStatus },
    startedAt: toIso(extended?.started_at),
    updatedAt: checkpoint?.updatedAt ?? toIso(extended?.updated_at),
    active: jobStatus != null && !["completed", "failed", "cancelled"].includes(jobStatus),
  }
}

async function selectedAssetStatuses(documentId: number): Promise<Record<string, number>> {
  const snapshot = await getSelectionSnapshot(documentId)
  return countAssetStatuses(snapshot.items.map((i) => i.altTextAssetId))
}
