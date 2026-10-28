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
import { createHash } from "node:crypto"
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
import { descriptionKindsForTypes } from "./description-evidence"
import { claimForGeneration, getAsset, getSettings, getSettingsRecord, getSavedGeneration, markFailed, saveGeneration } from "./store"
import { selectVisionModel } from "./vision-service"

const CLIENT_REQUEST_ID = /^[A-Za-z0-9_-]{8,48}$/
const ALLOWED_KEYS = new Set(["assetId", "settings", "requestId", "occurrenceId"])

export type GenerateRequest = {
  expectedSourceSha256?: string
  signal?: AbortSignal
  occurrenceId?: number | null
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
    candidate?: boolean
    version: number
    activeVersion?: number
    result: Pick<AltTextResult, "classification" | "shortAlt" | "longDescription" | "extractedText" | "warnings" | "treatment" | "generationEvidence">
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
  const requestedLanguage=(b.settings as Record<string,unknown>|undefined)?.outputLanguage
  if(requestedLanguage!==undefined&&!['en','hi'].includes(String(requestedLanguage)))return fail(400,"UNSUPPORTED_LANGUAGE","Alt Text prose currently supports English and Hindi only. OCR recognition language is selected separately.")
  const settings = normalizeGenerationSettings(b.settings)
  const errors = validateGenerationSettings(settings)
  if (Object.keys(errors).length) return fail(400, "INVALID_SETTINGS", "Generation settings are invalid.", { fields: errors })
  if (b.requestId != null && (typeof b.requestId !== "string" || !CLIENT_REQUEST_ID.test(b.requestId))) {
    return fail(400, "INVALID_REQUEST_ID", "requestId must be 8–48 letters, digits, '-' or '_'.")
  }
  if (b.occurrenceId != null && (!Number.isSafeInteger(b.occurrenceId) || Number(b.occurrenceId) <= 0)) return fail(400,"INVALID_ID","Invalid image occurrence identifier.")
  return { ok: true, value: { assetId, settings, requestId: (b.requestId as string | undefined) ?? null, ...(b.occurrenceId != null ? {occurrenceId:Number(b.occurrenceId)} : {}) } }
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
  const saved = await getSavedGeneration(assetId, credits.requestId)
  return {
    ok: true,
    body: {
      success: true,
      assetId,
      status: asset.status,
      replayed,
      version: saved?.version ?? asset.currentVersion,
      activeVersion: asset.currentVersion,
      candidate: saved?.candidate ?? false,
      result: saved?.result ?? {
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
  if (req.expectedSourceSha256 && createHash("sha256").update(bytes).digest("hex") !== req.expectedSourceSha256) return fail(409,"PIPELINE_SOURCE_CHANGED","The source image changed. Start a new processing run.")
  if (req.signal?.aborted) return fail(409,"PIPELINE_INTERRUPTED","Processing was interrupted before generation.")

  // Generation overwrites saved content, so it needs the same record scope as a manual edit.
  const target = await getAsset(req.assetId)
  if (!target) return fail(404, "NOT_FOUND", "Image not found.")
  if (!withinScope(actor.updateScope, actor.userId, target)) return fail(403, "FORBIDDEN", "You do not have permission to change the alt text of this image.")
  if (req.document && req.document.imageAssetId !== req.assetId) return fail(409, "DOCUMENT_SOURCE_MISMATCH", "The document context belongs to another image. Reload the source before generating.")
  const { resolveDocumentPromptContext } = await import("./document-generation")
  const resolvedDocument = await resolveDocumentPromptContext(req.assetId,actor,req.occurrenceId ?? req.document?.imageOccurrenceId ?? null)
  if (resolvedDocument.kind === "ineligible") return fail(resolvedDocument.code === "NOT_FOUND" ? 404 : 409,resolvedDocument.code,resolvedDocument.error)
  const document = resolvedDocument.kind === "document" ? resolvedDocument.document : null
  if (document?.packet && document.packet.source.imageSha256 !== createHash("sha256").update(bytes).digest("hex")) return fail(409,"DOCUMENT_SOURCE_CHANGED","The current image does not match the saved document occurrence. Refresh extraction and context before generating.")

  // Binding the asset into the operation id stops one requestId from replaying another asset's charge.
  const rawOperation = req.requestId ? `a${req.assetId}_${req.requestId}` : null
  const operationId = rawOperation && (req.occurrenceId != null || rawOperation.length > 64) ? `d${createHash("sha256").update(JSON.stringify([req.assetId,req.occurrenceId??null,req.requestId])).digest("hex").slice(0,60)}` : rawOperation
  const requestId = altTextRequestId(operationId)
  if (operationId) {
    const prior = await getAltTextCreditUsage(actor.tenantId, actor.userId, requestId)
    if (prior?.creditsCharged != null) return successFromAsset(req.assetId, prior, req.requestId, true)
    if (prior?.status === "reserved") return fail(409, "GENERATION_IN_PROGRESS", "This generation request is already being processed.")
  }

  const policy = await generationPolicy()
  const classify = policy.classify
  const classificationHint = manualTypeHint(target.classificationRecord ?? null)
  let advancedEvidence: import("./description-evidence").DescriptionEvidence | null = null
  if (policy.advanced) {
    try {
      const { loadDescriptionEvidence } = await import("./description-evidence-source")
      advancedEvidence = await loadDescriptionEvidence(req.assetId, document?.imageOccurrenceId ?? null, bytes, actor, policy.allowedKinds)
    } catch {
      return fail(503, "EVIDENCE_UNAVAILABLE", "Saved accessibility evidence could not be checked. No generation was charged; please try again.")
    }
  }

  const attempt = await claimForGeneration(req.assetId)
  if (attempt == null) return fail(409, "GENERATION_CONFLICT", "Alt text is already being generated for this image.")

  let outcome: Awaited<ReturnType<typeof runMeteredAltTextGeneration>>
  try {
    outcome = await (deps.run ?? runMeteredAltTextGeneration)({
      tenantId: actor.tenantId,
      userId: actor.userId,
      operationId: requestId.slice("alttext:".length),
      vision: { image: { bytes, mediaType: image.contentType }, generation: req.settings, altTextSettings, model, document, classify, classificationHint, ...(advancedEvidence ? { advancedEvidence } : {}), ...(req.signal ? {abortSignal:req.signal} : {}) },
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
  output.documentContextSnapshot = document?.packet ?? undefined
  output.generationEvidence = {
    schemaVersion: 1, requestId, strategy: advancedEvidence?.strategy ?? "standard", sourceSha256: advancedEvidence?.sourceSha256 ?? createHash("sha256").update(bytes).digest("hex"),
    occurrenceId: advancedEvidence?.occurrenceId ?? document?.imageOccurrenceId ?? null, regionAnalysisId: advancedEvidence?.regionAnalysisId ?? null,
    evidence: advancedEvidence?.items.map(({ id, version, kind, state }) => ({ id, version, kind, state })) ?? [],
    outputLanguage: req.settings.outputLanguage, provider: vision.provider, generatedAt: new Date().toISOString(),
    guidelineVersion: null, reviewStatus: "needs_review", warnings: output.warnings, treatment: output.treatment,
    ...(output.terminologyReview?{terminology:output.terminologyReview}:{}),
    ...(document?.packet ? {documentContext:{documentId:document.documentId,occurrenceId:document.imageOccurrenceId,contextVersion:document.contextVersion,source:document.packet.source,fingerprint:createHash("sha256").update(JSON.stringify(document.packet)).digest("hex"),references:document.packet.snippets.map(s=>({id:s.id,sourceKind:s.sourceKind,sourceRef:s.sourceRef,duplicates:s.duplicateReferences})),policy:document.packet.policy}} : {}),
  }
  let saved: boolean
  try {
    saved = await saveGeneration(req.assetId, output, vision.modelId, credits.creditsCharged ?? 0, actor.userId, true, attempt)
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
async function generationPolicy(): Promise<{ classify: boolean; advanced: boolean; allowedKinds: string[] }> {
  try {
    const record = await getSettingsRecord()
    const preferences = normalizeAccessibilityPreferences(record.accessibility).preferences
    return { classify: preferences.general.useAutoClassification !== false, advanced: preferences.general.processingPreference !== "standard_only" && process.env.ALT_TEXT_ADVANCED_DISABLED !== "1", allowedKinds: descriptionKindsForTypes(preferences.general.analysisTypes) }
  } catch {
    return { classify: true, advanced: false, allowedKinds: [] }
  }
}

function pickResult(o: AltTextResult) {
  return { classification: o.classification, shortAlt: o.shortAlt, longDescription: o.longDescription, extractedText: o.extractedText, warnings: o.warnings, treatment: o.treatment, generationEvidence: o.generationEvidence }
}
