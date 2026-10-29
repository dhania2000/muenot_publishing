/**
 * @file lib/alt-text/batch-processor.ts
 * @module Publishing · Alt Text
 * @kind Server-side library
 * @summary Phase 2 Task 9 — per-image AI processing for `alt_text.batch_processing` jobs.
 * @usedBy lib/background-jobs.ts (passed to runAltTextBatchJob)
 *
 * Guarantees:
 * - Runs inside the job's tenant scope (runAltTextBatchJob). Every image goes through the Phase 1
 *   generateAltTextForAsset lifecycle as the batch submitter: governed model → scan-cleared private
 *   bytes → atomic claim → metered vision (reserve/settle/release) → versioned save.
 * - Sequential, one provider call per job; tenant/global caps are enforced by the queue claim
 *   (see ./concurrency.ts). Halts defer with bounded exponential backoff + jitter (Retry-After floor);
 *   credit exhaustion keeps remaining images pending; non-clearing config halts are bounded.
 * - Credit idempotency: the operation id is derived from (batch, asset, version, claim attempt), so a
 *   duplicate delivery replays instead of re-charging; a billed-but-unsaved prior attempt is never re-run.
 * - Global AI/credit/governance failures stop the batch and defer the job; the image is put back in
 *   the queue instead of being reported as an image failure.
 */
import "server-only"
import { query } from "@/lib/db"
import { JobDeferredError } from "@/lib/job-retry-policy"
import { getScope, hasActionGrant } from "@/lib/permission-store"
import { resolveEffectiveSettings } from "./batch-settings"
import { AltTextBatchJobError, applyBatchControl, isHoldStatus, type AltTextBatchPlan } from "./batch-job"
import { altTextConcurrencyFromEnv, classifyHalt, haltDelaySeconds } from "./concurrency"
import { validateGenerationSettings } from "./core"
import { altTextRequestId, getAltTextCreditUsage } from "./credit-service"
import { resolveDocumentPromptContext } from "./document-generation"
import { generateAltTextForAsset, type GenerateActor, type GenerateFailure } from "./generate"
import { claimForGeneration, finalizeBatchFromAssets, getAsset, getBatch, getBatchStatus, markFailed, requeueAsset } from "./store"

export const BUSY_RETRY_DELAY_SECONDS = 120
export const HALT_RETRY_DELAY_SECONDS = 600

/** Failures that would repeat for every image: stop issuing requests and defer the whole job. */
const HALT_CODES = new Set([
  "AI_DISABLED",
  "AI_EMERGENCY_DISABLED",
  "AI_SUSPENDED",
  "FEATURE_DISABLED",
  "MODULE_NOT_ENTITLED",
  "PERMISSION_DENIED",
  "NO_MODEL_AVAILABLE",
  "MODEL_NOT_ALLOWED",
  "PREMIUM_NOT_ALLOWED",
  "RATE_LIMITED",
  "PROVIDER_ERROR",
  "PROVIDER_TIMEOUT",
  "EVIDENCE_UNAVAILABLE",
])
/** Transient per-image states: leave the image queued and revisit later. */
const BUSY_CODES = new Set(["GENERATION_CONFLICT", "GENERATION_IN_PROGRESS", "SCAN_PENDING", "STORAGE_UNAVAILABLE"])
/** Raised before generate() claims the asset, so the processor must record the failure itself. */
const PRE_CLAIM_CODES = new Set(["NOT_FOUND", "UNSUPPORTED_TYPE", "FILE_TOO_LARGE", "FORBIDDEN", "INVALID_SETTINGS", "DOCUMENT_SOURCE_MISMATCH", "DOCUMENT_SOURCE_CHANGED"])

export type FailureKind = "halt" | "busy" | "permanent" | "superseded"

export function classifyGenerateFailure(f: Pick<GenerateFailure, "status" | "code">): FailureKind {
  if (f.code === "GENERATION_SUPERSEDED") return "superseded"
  if (BUSY_CODES.has(f.code)) return "busy"
  if (f.status === 402 || f.status === 429 || HALT_CODES.has(f.code)) return "halt"
  return "permanent"
}

/** Deterministic per (batch, asset, version, claim attempt); fits generate()'s 64-char operation id. */
export function batchOperationKey(batchId: string, version: number, attempts: number) {
  return `b${batchId.replace(/-/g, "").slice(0, 24)}v${version}n${attempts}`
}

export type BatchActorLoader = (tenantId: number, userId: number) => Promise<GenerateActor | null>

/** Re-evaluates the submitter's current status and permissions; nothing is trusted from submission time. */
export const loadBatchActor: BatchActorLoader = async (tenantId, userId) => {
  const rows = await query<any[]>("SELECT id, role, status FROM users WHERE tenant_id = ? AND id = ? LIMIT 1", [tenantId, userId])
  const u = rows[0]
  if (!u || (u.status != null && u.status !== "active")) return null
  const role = u.role === "admin" ? "admin" : "employee"
  if (role !== "admin" && !(await hasActionGrant(userId, role, "publishing.alt_text", "generate"))) return null
  const [viewScope, updateScope] = await Promise.all([
    getScope(userId, role, "publishing.alt_text", "view"),
    getScope(userId, role, "publishing.alt_text", "update"),
  ])
  if (viewScope === "none" || updateScope === "none") return null
  return { userId, tenantId, role, viewScope, updateScope }
}

export type BatchProcessorDeps = {
  scheduleProcessing?: typeof import("./processing-batch").scheduleBatchImageProcessing
  generate?: typeof generateAltTextForAsset
  loadActor?: BatchActorLoader
  countHaltDeferrals?: (jobId: number) => Promise<number>
  random?: () => number
  resolveDocument?: typeof resolveDocumentPromptContext
}

/** Consecutive halt deferrals recorded by the durable queue for this job (last 24h). */
async function countHaltDeferrals(jobId: number): Promise<number> {
  const rows = await query<any[]>(
    `SELECT COUNT(*) AS count FROM platform_background_job_events WHERE job_id=? AND event_type='deferred'
     AND created_at > DATE_SUB(NOW(), INTERVAL 1 DAY)
     AND (JSON_UNQUOTE(JSON_EXTRACT(detail, '$.reason')) LIKE 'ALT\\_TEXT\\_HALTED\\_%' OR JSON_UNQUOTE(JSON_EXTRACT(detail, '$.reason')) = 'ALT_TEXT_AWAITING_CREDITS')`,
    [jobId],
  )
  return Number(rows[0]?.count ?? 0)
}

async function failUnclaimed(assetId: number, message: string, code: string) {
  const attempt = await claimForGeneration(assetId)
  if (attempt != null) await markFailed(assetId, message, attempt, code)
}

export async function processAltTextBatch(plan: AltTextBatchPlan, ctx: { signal: AbortSignal }, deps: BatchProcessorDeps = {}): Promise<Record<string, unknown>> {
  const generate = deps.generate ?? generateAltTextForAsset
  const batch = await getBatch(plan.batchId)
  if (!batch) throw new AltTextBatchJobError("BATCH_NOT_FOUND", 404)

  const actor = await (deps.loadActor ?? loadBatchActor)(plan.tenantId, batch.submittedBy ?? batch.createdBy)
  if (!actor || actor.tenantId !== plan.tenantId) throw new AltTextBatchJobError("SUBMITTER_NOT_PERMITTED", 403)

  const counts = { completed: 0, failed: 0, skipped: 0, busy: 0 }
  let halt: GenerateFailure | null = null

  for (const assetId of plan.assetIds) {
    if (ctx.signal.aborted) throw new JobDeferredError("ALT_TEXT_JOB_INTERRUPTED", 30)
    // Safe boundary: the persisted batch row (not memory) decides whether to claim the next image.
    const control = await getBatchStatus(plan.batchId)
    if (control && isHoldStatus(control)) return applyBatchControl(plan.batchId)

    const asset = await getAsset(assetId)
    if (!asset || asset.batchId !== plan.batchId || (asset.status !== "uploaded" && asset.status !== "processing")) {
      counts.skipped++
      continue
    }

    const settings = resolveEffectiveSettings(plan.settings, asset.settingsOverride ?? undefined)
    if (Object.keys(validateGenerationSettings(settings)).length) {
      await failUnclaimed(assetId, "The image's generation settings are invalid.", "INVALID_SETTINGS")
      counts.failed++
      continue
    }

    if (asset.attempts > 0) {
      const prevId = altTextRequestId(`a${assetId}_${batchOperationKey(plan.batchId, asset.currentVersion, asset.attempts - 1)}`)
      const prev = await getAltTextCreditUsage(plan.tenantId, actor.userId, prevId)
      if (prev?.creditsCharged != null) {
        console.error("[alt-text/batch] prior attempt billed but unsaved; needs reconciliation", { batchId: plan.batchId, assetId, requestId: prevId })
        await failUnclaimed(assetId, "A previous attempt was billed but its result was not saved. Usage needs reconciliation.", "BILLED_UNSAVED")
        counts.failed++
        continue
      }
    }

    // Document occurrences: re-read eligibility + occurrence-specific context at processing time.
    const docCtx = await (deps.resolveDocument ?? resolveDocumentPromptContext)(assetId, actor)
    if (docCtx.kind === "ineligible") {
      await failUnclaimed(assetId, docCtx.error, docCtx.code)
      counts.failed++
      continue
    }
    const document = docCtx.kind === "document" ? docCtx.document : null

    if(batch.accessibilityPipeline){
      // The opted-in pipeline owns generation. The ordinary batch path never generates a
      // second description while its persisted per-image processing run is pending.
      try{
        const schedule=deps.scheduleProcessing??(await import("./processing-batch")).scheduleBatchImageProcessing
        const processing=await schedule(plan.batchId,assetId,document?.imageOccurrenceId??null,batch.accessibilityPipeline,settings,actor)
        if(["queued","processing"].includes(processing.summary.status))counts.busy++
        else {await failUnclaimed(assetId,`Advanced processing needs review: ${processing.summary.status}. Open this image's processing results before retrying.` ,"ADVANCED_PROCESSING_REVIEW");counts.failed++}
      }catch(e){
        const error=e as {code?:string;message?:string;status?:number}
        if(error.code==="PROCESSING_ACTIVE")counts.busy++
        else {await failUnclaimed(assetId,error.message??"Advanced processing could not be scheduled.",error.code??"PROCESSING_SCHEDULE_FAILED");counts.failed++}
      }
      if(counts.busy>=10)break
      continue
    }

    const res = await generate({ assetId, settings, requestId: batchOperationKey(plan.batchId, asset.currentVersion, asset.attempts), document }, actor)
    if (res.ok) {
      if (res.body.replayed) counts.skipped++
      else counts.completed++
      continue
    }

    const kind = classifyGenerateFailure(res)
    if (kind === "superseded") counts.skipped++
    else if (kind === "busy") counts.busy++
    else if (kind === "halt") {
      await requeueAsset(assetId, plan.batchId, res.error)
      halt = res
      break
    } else {
      if (PRE_CLAIM_CODES.has(res.code)) await failUnclaimed(assetId, res.error, res.code)
      counts.failed++
    }
  }

  const finalControl = await getBatchStatus(plan.batchId)
  if (finalControl && isHoldStatus(finalControl)) return applyBatchControl(plan.batchId)
  const settled = await finalizeBatchFromAssets(plan.batchId)
  const summary = { ...counts, batchStatus: settled?.status ?? batch.status }
  if (halt) {
    const cfg = altTextConcurrencyFromEnv()
    const kind = classifyHalt(halt)
    // Progress in this run resets backoff; otherwise grow with consecutive halts of this job.
    const deferrals = counts.completed > 0 ? 0 : await (deps.countHaltDeferrals ?? countHaltDeferrals)(plan.jobId)
    if (kind === "config" && deferrals >= cfg.maxConfigHaltRetries) {
      // Will not clear by itself: stop deferring. Remaining images stay pending (not failed).
      throw new AltTextBatchJobError(`HALTED_${halt.code}`.slice(0, 64), halt.status >= 400 && halt.status < 500 ? halt.status : 409)
    }
    const retryAfter = typeof halt.details?.retryAfterSeconds === "number" ? halt.details.retryAfterSeconds : null
    const code = kind === "credits" ? "ALT_TEXT_AWAITING_CREDITS" : `ALT_TEXT_HALTED_${halt.code}`
    throw new JobDeferredError(code.slice(0, 64), haltDelaySeconds(kind, deferrals, retryAfter, cfg, deps.random))
  }
  if (settled && settled.stats.pending + settled.stats.processing > 0) throw new JobDeferredError("ALT_TEXT_IMAGES_PENDING", BUSY_RETRY_DELAY_SECONDS)
  return summary
}
