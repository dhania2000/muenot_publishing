/**
 * @file lib/alt-text/batch-submission.ts
 * @module Publishing · Alt Text
 * @kind Server-side library
 * @summary Phase 2 Task 7 — validate + create draft batches and queue them for the Task 8 job queue.
 * @usedBy app/api/alt-text/batches/route.ts, app/api/alt-text/batches/[id]/submit/route.ts
 *
 * Guarantees:
 * - Tenant and creator come from the session; request JSON never carries ownership.
 * - Creation (batch row + asset attachment + overrides) is one transaction via createBatch().
 * - Submission never runs AI or charges credits: it only moves draft → queued after scan,
 *   settings and model-availability checks pass.
 */
import "server-only"
import { getTenantAiSettings } from "@/lib/ai/assistant-store"
import { AiError } from "@/lib/ai/governance-core"
import { resolveTenantModels } from "@/lib/ai/model-catalog"
import { enqueueBackgroundJobInTransaction, ensureBackgroundJobSchema } from "@/lib/background-jobs"
import type { PermissionScope } from "@/lib/permission-model"
import { ALT_TEXT_BATCH_JOB_TYPE, altTextBatchConcurrencyKey, altTextBatchIdempotencyKey } from "./batch-job"
import { altTextConcurrencyFromEnv } from "./concurrency"
import { keyBelongsToTenant } from "@/lib/storage"
import { getByObjectKey } from "@/lib/storage/file-metadata"
import { canDownload, getScanForFile } from "@/lib/storage/file-scanning"
import { BATCH_FIELD_LIMITS, OVERRIDABLE_FIELDS, resolveEffectiveSettings } from "./batch-settings"
import { normalizeGenerationSettings, validateGenerationSettings, type GenerationSettings } from "./core"
import { aiErrorToFailure } from "./generate"
import { withinScope } from "./history"
import {
  BATCH_MAX_ASSETS_PER_CALL,
  BatchError,
  createBatch,
  findBatchIdByIdempotencyKey,
  getAssetRefs,
  getBatch,
  getSettings,
  listBatchAssets,
  normalizeOverride,
  submitBatch,
  type AssetRef,
  type BatchRow,
} from "./store"
import { selectVisionModel } from "./vision-service"

export const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,80}$/
const ALLOWED_KEYS = new Set(["name", "description", "projectId", "assetIds", "settings", "overrides", "idempotencyKey"])

export type BatchFailure = { ok: false; status: number; code: string; error: string; details?: Record<string, unknown> }
export type BatchActor = { userId: number; tenantId: number; role: "admin" | "employee"; updateScope: PermissionScope }

export type CreateBatchRequest = {
  /** Server-validated opt-in document pipeline; public draft parser remains strict. */
  accessibilityPipeline?: import("./processing-pipeline-contract").ProcessingSelection
  name: string
  description: string | null
  projectId: number | null
  assetIds: number[]
  settings: GenerationSettings
  overrides: Record<number, unknown>
  idempotencyKey: string | null
}

const fail = (status: number, code: string, error: string, details?: Record<string, unknown>): BatchFailure => ({ ok: false, status, code, error, ...(details ? { details } : {}) })

const toId = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && /^\d{1,15}$/.test(v) ? Number(v) : NaN)
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)

export function parseCreateBatchRequest(body: unknown, headerKey: string | null): { ok: true; value: CreateBatchRequest } | BatchFailure {
  if (!isObject(body)) return fail(400, "INVALID_REQUEST", "Send a JSON object.")
  const extra = Object.keys(body).filter((k) => !ALLOWED_KEYS.has(k))
  if (extra.length) return fail(400, "INVALID_REQUEST", "Unexpected fields in request.", { fields: extra })

  const name = typeof body.name === "string" ? body.name.trim() : ""
  if (!name || name.length > BATCH_FIELD_LIMITS.name) return fail(400, "INVALID_BATCH", `Batch name is required (max ${BATCH_FIELD_LIMITS.name} characters).`, { field: "name" })
  if (body.description != null && typeof body.description !== "string") return fail(400, "INVALID_BATCH", "Description must be text.", { field: "description" })
  const description = typeof body.description === "string" ? body.description.trim() : ""
  if (description.length > BATCH_FIELD_LIMITS.description) return fail(400, "INVALID_BATCH", `Description must be ${BATCH_FIELD_LIMITS.description} characters or fewer.`, { field: "description" })

  let projectId: number | null = null
  if (body.projectId != null && body.projectId !== "") {
    projectId = toId(body.projectId)
    if (!Number.isSafeInteger(projectId) || projectId <= 0) return fail(400, "INVALID_BATCH", "Invalid project identifier.", { field: "projectId" })
  }

  if (!Array.isArray(body.assetIds)) return fail(400, "INVALID_BATCH", "assetIds must be a list of uploaded image ids.", { field: "assetIds" })
  if (body.assetIds.length > BATCH_MAX_ASSETS_PER_CALL) return fail(413, "TOO_MANY_ASSETS", `A batch can contain at most ${BATCH_MAX_ASSETS_PER_CALL} images.`)
  const assetIds = [...new Set(body.assetIds.map(toId))]
  if (assetIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) return fail(400, "INVALID_BATCH", "One or more asset ids are invalid.", { field: "assetIds" })
  if (!assetIds.length) return fail(400, "INVALID_BATCH", "Select at least one uploaded image.", { field: "assetIds" })

  if (body.settings !== undefined && !isObject(body.settings)) return fail(400, "INVALID_SETTINGS", "Settings must be an object.")
  const settings = normalizeGenerationSettings(body.settings)
  const settingsErrors = validateGenerationSettings(settings)
  if (Object.keys(settingsErrors).length) return fail(422, "INVALID_SETTINGS", "Common generation settings are invalid.", { fields: settingsErrors })

  const overrides: Record<number, unknown> = {}
  if (body.overrides !== undefined) {
    if (!isObject(body.overrides)) return fail(400, "INVALID_SETTINGS", "Overrides must be an object keyed by asset id.")
    const selected = new Set(assetIds)
    const imageErrors: Record<string, unknown> = {}
    for (const [key, raw] of Object.entries(body.overrides)) {
      const id = toId(key)
      if (!selected.has(id)) return fail(422, "INVALID_OVERRIDE", "Overrides may only reference selected images.", { assetId: key })
      if (!isObject(raw)) return fail(400, "INVALID_SETTINGS", "Each override must be an object.", { assetId: key })
      if(Object.hasOwn(raw,"clientGuidelineId")!==Object.hasOwn(raw,"clientGuidelineVersion"))return fail(422,"INVALID_OVERRIDE","Client guideline ID and version must be overridden together.",{assetId:key})
      const unknownFields = Object.keys(raw).filter((k) => !(OVERRIDABLE_FIELDS as readonly string[]).includes(k))
      if (unknownFields.length) return fail(422, "INVALID_OVERRIDE", "These settings cannot be overridden per image.", { assetId: key, fields: unknownFields })
      const effective = resolveEffectiveSettings(settings, normalizeOverride(settings, raw) ?? undefined)
      const errors = validateGenerationSettings(effective)
      if (Object.keys(errors).length) imageErrors[key] = errors
      overrides[id] = raw
    }
    if (Object.keys(imageErrors).length) return fail(422, "INVALID_SETTINGS", "Some image overrides are invalid.", { images: imageErrors })
  }

  const rawKey = headerKey ?? (typeof body.idempotencyKey === "string" ? body.idempotencyKey : null)
  if (rawKey != null && !IDEMPOTENCY_KEY.test(rawKey)) return fail(400, "INVALID_IDEMPOTENCY_KEY", "Idempotency key must be 8–80 letters, digits, '-' or '_'.")
  if (headerKey && typeof body.idempotencyKey === "string" && body.idempotencyKey !== headerKey) {
    return fail(400, "INVALID_IDEMPOTENCY_KEY", "Header and body idempotency keys do not match.")
  }

  return { ok: true, value: { name, description: description || null, projectId, assetIds, settings, overrides, idempotencyKey: rawKey } }
}

const createdView = (b: BatchRow, replayed: boolean) => ({
  success: true as const,
  replayed,
  batch: { id: b.id, name: b.name, status: b.status, totalImages: b.stats.total, createdAt: b.createdAt },
})

function batchErrorToFailure(e: BatchError): BatchFailure {
  const m = e.message
  if (/project not found/i.test(m)) return fail(404, "PROJECT_NOT_FOUND", "Project not found.")
  if (/not found/i.test(m)) return fail(404, "ASSET_NOT_FOUND", "One or more images were not found.")
  if (/another batch/i.test(m)) return fail(409, "ASSET_IN_OTHER_BATCH", "One or more images already belong to another batch.")
  if (/being processed/i.test(m)) return fail(422, "ASSET_NOT_ELIGIBLE", "One or more images are currently being processed.")
  if (/At most/i.test(m)) return fail(413, "TOO_MANY_ASSETS", m)
  return fail(400, "INVALID_BATCH", "The batch data is invalid.")
}

export async function createBatchFromRequest(req: CreateBatchRequest, actor: BatchActor) {
  if (req.idempotencyKey) {
    const existing = await findBatchIdByIdempotencyKey(req.idempotencyKey)
    const prior = existing ? await getBatch(existing) : null
    if (prior) {
      if(JSON.stringify(prior.accessibilityPipeline??null)!==JSON.stringify(req.accessibilityPipeline??null))return fail(409,"REQUEST_CONFLICT","This batch request already belongs to different processing modes.")
      return { ok: true as const, status: 200, body: createdView(prior, true) }
    }
  }

  // Preflight gives a clear 404 / 403 / 409; createBatch re-validates ownership under row locks.
  const refs = await getAssetRefs({ ids: req.assetIds })
  if (refs.length !== req.assetIds.length) return fail(404, "ASSET_NOT_FOUND", "One or more images were not found.")
  if (refs.some((r) => !withinScope(actor.updateScope, actor.userId, r))) return fail(403, "FORBIDDEN", "You do not have permission to use one or more of these images.")
  const conflicting = refs.filter((r) => r.batchId != null).map((r) => r.id)
  if (conflicting.length) return fail(409, "ASSET_IN_OTHER_BATCH", "One or more images already belong to another batch.", { assetIds: conflicting })
  const busy = refs.filter((r) => r.status === "processing").map((r) => r.id)
  if (busy.length) return fail(422, "ASSET_NOT_ELIGIBLE", "One or more images are currently being processed.", { assetIds: busy })

  let id: string
  try {
    id = await createBatch(
      {
        name: req.name,
        description: req.description,
        projectId: req.projectId,
        settings: req.settings,
        assets: req.assetIds.map((assetId) => ({ assetId, override: req.overrides[assetId] })),
        idempotencyKey: req.idempotencyKey,
        ...(req.accessibilityPipeline?{accessibilityPipeline:req.accessibilityPipeline}:{}),
      },
      actor.userId,
    )
  } catch (e) {
    if (e instanceof BatchError) return batchErrorToFailure(e)
    throw e
  }
  const batch = await getBatch(id)
  if (!batch) return fail(500, "INTERNAL_ERROR", "Something went wrong. Please try again.")
  return { ok: true as const, status: 201, body: createdView(batch, false) }
}

export type ScanVerdict = "clean" | "pending" | "unsafe" | "quarantined" | "missing"

/** Strict, fail-closed: anything not proven clean (or admin-approved and not infected) is blocked. */
export async function assetScanVerdict(ref: Pick<AssetRef, "storageKey">, tenantId: number): Promise<ScanVerdict> {
  if (!ref.storageKey || !keyBelongsToTenant(ref.storageKey, tenantId)) return "missing"
  const file = await getByObjectKey(ref.storageKey)
  if (!file || file.uploadStatus === "deleted") return "missing"
  const scan = await getScanForFile(file.id)
  if (!scan) return "pending"
  if (scan.scanStatus === "infected") return "unsafe"
  if (scan.quarantineStatus === "quarantined" && !scan.approved && scan.scanStatus !== "clean") return "quarantined"
  const decision = canDownload({ scanStatus: scan.scanStatus, approved: scan.approved }, { blockUntilClean: true, failureMode: "fail_closed" })
  return decision.allowed ? "clean" : "pending"
}

async function mapLimited<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
      }
    }),
  )
  return out
}

export type SubmitDeps = { scan?: typeof assetScanVerdict; resolveModel?: (actor: BatchActor) => Promise<unknown> }

export async function resolveBatchModel(actor: BatchActor) {
  const [altTextSettings, tenantSettings] = await Promise.all([getSettings(), getTenantAiSettings()])
  const resolved = await resolveTenantModels(actor.tenantId, tenantSettings, actor.role)
  return selectVisionModel({
    usable: resolved.usable,
    tenantSettings,
    preferredModelId: altTextSettings.preferredModelId,
    defaultModelId: resolved.defaultModel?.id,
    fallbackModelId: resolved.fallbackModel?.id,
  })
}

export async function submitBatchForProcessing(batchId: string, actor: BatchActor, deps: SubmitDeps = {}) {
  const batch = await getBatch(batchId)
  if (!batch) return fail(404, "NOT_FOUND", "Batch not found.")
  if (batch.status !== "draft") return fail(409, "BATCH_ALREADY_SUBMITTED", "This batch has already been submitted.", { batchId, status: batch.status })

  const refs = await getAssetRefs({ batchId })
  if (!refs.length) return fail(422, "NO_ELIGIBLE_ASSETS", "Add at least one image before submitting the batch.")
  if (refs.some((r) => !withinScope(actor.updateScope, actor.userId, r))) return fail(403, "FORBIDDEN", "You do not have permission to process one or more images in this batch.")
  const busy = refs.filter((r) => r.status === "processing").map((r) => r.id)
  if (busy.length) return fail(409, "ASSET_BUSY", "One or more images are already being processed.", { assetIds: busy })

  const settingsErrors = validateGenerationSettings(batch.settings)
  if (Object.keys(settingsErrors).length) return fail(422, "INVALID_SETTINGS", "Batch settings are invalid.", { fields: settingsErrors })
  const imageErrors: Record<number, unknown> = {}
  for (let offset = 0; offset < refs.length; offset += 100) {
    const page = await listBatchAssets(batchId, { limit: 100, offset })
    for (const a of page?.items ?? []) {
      const errors = validateGenerationSettings(a.effectiveSettings)
      if (Object.keys(errors).length) imageErrors[a.id] = errors
    }
  }
  if (Object.keys(imageErrors).length) return fail(422, "INVALID_SETTINGS", "Some image settings are invalid.", { images: imageErrors })

  const scan = deps.scan ?? assetScanVerdict
  const verdicts = await mapLimited(refs, 8, (r) => scan(r, actor.tenantId))
  const blocked = refs.map((r, i) => ({ assetId: r.id, reason: verdicts[i] })).filter((v) => v.reason !== "clean")
  if (blocked.length) return fail(422, "ASSETS_NOT_CLEARED", "Some images have not passed security scanning and cannot be processed.", { blocked })

  try {
    await (deps.resolveModel ?? resolveBatchModel)(actor)
  } catch (e) {
    if (e instanceof AiError) {
      const f = aiErrorToFailure(e)
      return fail(f.status, f.code, f.error)
    }
    throw e
  }

  // DDL implicitly commits, so the queue schema must exist before the submit transaction opens.
  await ensureBackgroundJobSchema()
  let jobId: number | null = null
  const outcome = await submitBatch(batchId, actor.userId, refs.map((r) => r.id), async (conn, ctx) => {
    const job = await enqueueBackgroundJobInTransaction(conn, {
      jobType: ALT_TEXT_BATCH_JOB_TYPE,
      tenantId: ctx.tenantId,
      payload: { batchId: ctx.batchId },
      idempotencyKey: altTextBatchIdempotencyKey(ctx.batchId),
      concurrencyKey: altTextBatchConcurrencyKey(ctx.tenantId),
      concurrencyLimit: altTextConcurrencyFromEnv().tenantMaxConcurrency,
      createdBy: actor.userId,
      triggerSource: "user_request",
    })
    jobId = job.jobId
  })
  if (outcome.state === "not_found") return fail(404, "NOT_FOUND", "Batch not found.")
  if (outcome.state === "assets_changed") return fail(409, "BATCH_CHANGED", "The batch changed while it was being submitted. Please review it and try again.")
  if (outcome.state === "already_submitted") return fail(409, "BATCH_ALREADY_SUBMITTED", "This batch has already been submitted.", { batchId, status: outcome.status })
  return {
    ok: true as const,
    body: {
      success: true as const,
      batchId,
      jobId,
      submissionStatus: "queued" as const,
      acceptedImageCount: outcome.acceptedCount,
      message: "Batch queued. Processing has not started yet.",
    },
  }
}
