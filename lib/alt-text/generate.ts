/**
 * @file lib/alt-text/generate.ts
 * @module Publishing · Alt Text
 * @kind Server-side library
 * @summary Task 14 orchestration: governed model → scan-cleared image → claim → metered vision → save.
 * @usedBy app/api/alt-text/generate/route.ts
 *
 * Lifecycle guarantees:
 * - No billable call happens before model, asset, scope, scan and format checks pass.
 * - Every claimed asset leaves `processing` (saveGeneration or markFailed with the claim's attempt).
 * - Same client requestId + asset is charged at most once (credit ledger is keyed by request id).
 * - Provider usage that cannot be saved stays billed and is logged for reconciliation, never refunded blindly.
 */
import "server-only"
import { getTenantAiSettings } from "@/lib/ai/assistant-store"
import { AiError } from "@/lib/ai/governance-core"
import { resolveTenantModels } from "@/lib/ai/model-catalog"
import type { PermissionScope } from "@/lib/permission-model"
import { normalizeGenerationSettings, validateGenerationSettings, type AltTextResult, type GenerationSettings } from "./core"
import { altTextRequestId, getAltTextCreditUsage, runMeteredAltTextGeneration, type AltTextCreditUsage } from "./credit-service"
import type { DocumentPromptContext } from "./document-prompt"
import { withinScope } from "./history"
import { openAltTextImage } from "./preview"
import { normalizeAccessibilityPreferences } from "./accessibility-settings"
import { manualTypeHint } from "./classification"
import { claimForGeneration, getAsset, getSettings, getSettingsRecord, markFailed, saveGeneration } from "./store"
import { selectVisionModel } from "./vision-service"

const CLIENT_REQUEST_ID = /^[A-Za-z0-9_-]{8,48}$/
const ALLOWED_KEYS = new Set(["assetId", "settings", "requestId"])

export type GenerateRequest = {
  assetId: number
  settings: GenerationSettings
  requestId: string | null
  /** Set only by server code (the batch processor) from the persisted occurrence; never parsed from a request body. */
  document?: DocumentPromptContext | null
}
export type GenerateActor = { userId: number; tenantId: number; role: "admin" | "employee"; viewScope: PermissionScope; updateScope: PermissionScope }

export type GenerateFailure = { ok: false; status: number; code: string; error: string; details?: Record<string, unknown> }
export type GenerateSuccess = {
  ok: true
  body: {
    success: true
    assetId: number
    status: string
    replayed: boolean
    version: number
    result: Pick<AltTextResult, "classification" | "shortAlt" | "longDescription" | "extractedText" | "warnings" | "treatment">
    usage: {
      requestId: string | null
      model: string
      provider: string | null
      creditsReserved: number
      creditsCharged: number | null
      inputTokens: number | null
      outputTokens: number | null
      status: AltTextCreditUsage["status"]
      needsReconciliation: boolean
    }
  }
}

const fail = (status: number, code: string, error: string, details?: Record<string, unknown>): GenerateFailure => ({ ok: false, status, code, error, ...(details ? { details } : {}) })

export function parseGenerateRequest(body: unknown): { ok: true; value: GenerateRequest } | GenerateFailure {
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail(400, "INVALID_REQUEST", "Send a JSON object.")
  const b = body as Record<string, unknown>
  const extra = Object.keys(b).filter((k) => !ALLOWED_KEYS.has(k))
  if (extra.length) return fail(400, "INVALID_REQUEST", "Unexpected fields in request.", { fields: extra })
  const assetId = typeof b.assetId === "number" ? b.assetId : typeof b.assetId === "string" && /^\d{1,15}$/.test(b.assetId) ? Number(b.assetId) : NaN
  if (!Number.isSafeInteger(assetId) || assetId <= 0) return fail(400, "INVALID_ID", "Invalid asset identifier.")
  if (b.settings !== undefined && (typeof b.settings !== "object" || b.settings === null || Array.isArray(b.settings))) {
    return fail(400, "INVALID_SETTINGS", "Settings must be an object.")
  }
  const settings = normalizeGenerationSettings(b.settings)
  const errors = validateGenerationSettings(settings)
  if (Object.keys(errors).length) return fail(400, "INVALID_SETTINGS", "Generation settings are invalid.", { fields: errors })
  if (b.requestId != null && (typeof b.requestId !== "string" || !CLIENT_REQUEST_ID.test(b.requestId))) {
    return fail(400, "INVALID_REQUEST_ID", "requestId must be 8–48 letters, digits, '-' or '_'.")
  }
  return { ok: true, value: { assetId, settings, requestId: (b.requestId as string | undefined) ?? null } }
}

export function aiErrorToFailure(e: AiError): GenerateFailure {
  const creditCode = typeof e.details?.creditCode === "string" ? e.details.creditCode : null
  const reason = typeof e.details?.reason === "string" ? e.details.reason : null
  const code = (creditCode ?? (reason === "invalid_output" ? "invalid_ai_response" : reason === "timeout" ? "provider_timeout" : e.code)).toUpperCase()
  const retryAfterSeconds = typeof e.details?.retryAfterSeconds === "number" ? e.details.retryAfterSeconds : null
  const details = reason === "credentials" || retryAfterSeconds != null ? { ...(reason === "credentials" ? { reason } : {}), ...(retryAfterSeconds != null ? { retryAfterSeconds } : {}) } : undefined
  return fail(e.status, code, e.message, details)
}

export async function readImageBytes(body: ReadableStream<Uint8Array> | Uint8Array, maxBytes: number): Promise<Uint8Array | null> {
  if (body instanceof Uint8Array) return body.length > maxBytes ? null : body
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > maxBytes) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  const out = new Uint8Array(size)
  let offset = 0
  for (const c of chunks) (out.set(c, offset), (offset += c.length))
  return out
}

function usageView(credits: AltTextCreditUsage, clientRequestId: string | null) {
  return {
    requestId: clientRequestId,
    model: credits.modelId,
    provider: credits.provider,
    creditsReserved: credits.creditsReserved,
    creditsCharged: credits.creditsCharged,
    inputTokens: credits.inputTokens,
    outputTokens: credits.outputTokens,
    status: credits.status,
    needsReconciliation: credits.needsReconciliation,
  }
}

async function successFromAsset(assetId: number, credits: AltTextCreditUsage, clientRequestId: string | null, replayed: boolean): Promise<GenerateSuccess | GenerateFailure> {
  const asset = await getAsset(assetId)
  if (!asset) return fail(404, "NOT_FOUND", "Image not found.")
  return {
    ok: true,
    body: {
      success: true,
      assetId,
      status: asset.status,
      replayed,
      version: asset.currentVersion,
      result: {
        classification: asset.classification as AltTextResult["classification"],
        shortAlt: asset.shortAlt ?? "",
        longDescription: asset.longDescription ?? "",
        extractedText: asset.extractedText ?? "",
        warnings: asset.warnings,
        treatment: asset.treatment ?? "",
      },
      usage: usageView(credits, clientRequestId),
    },
  }
}

export async function generateAltTextForAsset(
  req: GenerateRequest,
  actor: GenerateActor,
  deps: { run?: typeof runMeteredAltTextGeneration } = {},
): Promise<GenerateSuccess | GenerateFailure> {
  const altTextSettings = await getSettings()

  let model
  try {
    const tenantSettings = await getTenantAiSettings()
    const resolved = await resolveTenantModels(actor.tenantId, tenantSettings, actor.role)
    model = selectVisionModel({
      usable: resolved.usable,
      tenantSettings,
      preferredModelId: altTextSettings.preferredModelId,
      defaultModelId: resolved.defaultModel?.id,
      fallbackModelId: resolved.fallbackModel?.id,
    })
  } catch (e) {
    if (e instanceof AiError) return aiErrorToFailure(e)
    throw e
  }

  const image = await openAltTextImage(req.assetId, { userId: actor.userId, tenantId: actor.tenantId, scope: actor.viewScope })
  if (!image.ok) return fail(image.status, image.code, image.error)
  const bytes = await readImageBytes(image.body, altTextSettings.maxFileMb * 1024 * 1024)
  if (!bytes) return fail(413, "FILE_TOO_LARGE", `Images must be ${altTextSettings.maxFileMb} MB or smaller to generate alt text.`)

  // Generation overwrites saved content, so it needs the same record scope as a manual edit.
  const target = await getAsset(req.assetId)
  if (!target) return fail(404, "NOT_FOUND", "Image not found.")
  if (!withinScope(actor.updateScope, actor.userId, target)) return fail(403, "FORBIDDEN", "You do not have permission to change the alt text of this image.")

  // Binding the asset into the operation id stops one requestId from replaying another asset's charge.
  const operationId = req.requestId ? `a${req.assetId}_${req.requestId}` : null
  const requestId = altTextRequestId(operationId)
  if (operationId) {
    const prior = await getAltTextCreditUsage(actor.tenantId, actor.userId, requestId)
    if (prior?.creditsCharged != null) return successFromAsset(req.assetId, prior, req.requestId, true)
    if (prior?.status === "reserved") return fail(409, "GENERATION_IN_PROGRESS", "This generation request is already being processed.")
  }

  const classify = await autoClassificationEnabled()
  const classificationHint = manualTypeHint(target.classificationRecord ?? null)

  const attempt = await claimForGeneration(req.assetId)
  if (attempt == null) return fail(409, "GENERATION_CONFLICT", "Alt text is already being generated for this image.")

  let outcome: Awaited<ReturnType<typeof runMeteredAltTextGeneration>>
  try {
    outcome = await (deps.run ?? runMeteredAltTextGeneration)({
      tenantId: actor.tenantId,
      userId: actor.userId,
      operationId: requestId.slice("alttext:".length),
      vision: { image: { bytes, mediaType: image.contentType }, generation: req.settings, altTextSettings, model, document: req.document ?? null, classify, classificationHint },
    })
  } catch (e) {
    const failure = e instanceof AiError ? aiErrorToFailure(e) : fail(500, "GENERATION_FAILED", "Alt text generation failed. Please try again.")
    if (!(e instanceof AiError)) console.error("[alt-text/generate] unexpected failure", e instanceof Error ? e.name : "unknown")
    await markFailed(req.assetId, failure.error, attempt, failure.code).catch(() => {})
    return failure
  }

  if (outcome.status === "replayed") {
    await markFailed(req.assetId, "Duplicate request; the earlier result was kept.", attempt).catch(() => {})
    return successFromAsset(req.assetId, outcome.credits, req.requestId, true)
  }

  const { output, vision, credits } = outcome
  let saved: boolean
  try {
    saved = await saveGeneration(req.assetId, output, vision.modelId, credits.creditsCharged ?? 0, actor.userId, altTextSettings.requireReview, attempt)
  } catch (e) {
    console.error("[alt-text/generate] save failed after provider usage; needs reconciliation", {
      requestId,
      assetId: req.assetId,
      creditsCharged: credits.creditsCharged,
      error: e instanceof Error ? e.name : "unknown",
    })
    // Billed but unsaved: SAVE_FAILED is unclassified on purpose, so it is never auto-eligible for retry.
    await markFailed(req.assetId, "The generated alt text could not be saved.", attempt, "SAVE_FAILED").catch(() => {})
    return fail(500, "SAVE_FAILED", "The alt text was generated but could not be saved. Usage was recorded; please try again with a new request.", {
      usage: usageView(credits, req.requestId),
    })
  }
  if (!saved) {
    console.error("[alt-text/generate] generation superseded before save; needs reconciliation", { requestId, assetId: req.assetId, creditsCharged: credits.creditsCharged })
    return fail(409, "GENERATION_SUPERSEDED", "A newer generation or edit replaced this request. The newer content was kept.", { usage: usageView(credits, req.requestId) })
  }

  const success = await successFromAsset(req.assetId, credits, req.requestId, false)
  if (success.ok) success.body.result = { ...success.body.result, ...pickResult(output) }
  return success
}

/** Classification is on by default; an unreadable settings row must never block generation. */
async function autoClassificationEnabled(): Promise<boolean> {
  try {
    const record = await getSettingsRecord()
    return normalizeAccessibilityPreferences(record.accessibility).preferences.general.useAutoClassification !== false
  } catch {
    return true
  }
}

function pickResult(o: AltTextResult) {
  return { classification: o.classification, shortAlt: o.shortAlt, longDescription: o.longDescription, extractedText: o.extractedText, warnings: o.warnings, treatment: o.treatment }
}
