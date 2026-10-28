/**
 * @file lib/alt-text/region-service.ts
 * @module Publishing · Alt Text
 * @kind Server-side library
 * @summary Phase 3 Task 4 — `detectImageRegions` orchestration and the saved-analysis read model.
 *   Governed vision model → scope-checked private image → header dimensions/orientation → metered
 *   vision localisation → `finalizeRegions` validation → append-only versioned persistence.
 * @usedBy app/api/alt-text/assets/[id]/regions/route.ts
 *
 * Guarantees:
 * - Reading saved regions never calls a provider and never charges credits.
 * - No billable call happens before scope, occurrence, capability, model, format and header checks pass.
 * - A client requestId is bound to (asset, occurrence); a retry replays the saved analysis, never re-bills.
 * - Original image bytes, document occurrences and alt text versions are never modified.
 * - No region is ever fabricated: invalid provider output is rejected and reported, not repaired.
 */
import "server-only"
import { randomBytes,createHash } from "node:crypto"
import { getTenantAiSettings } from "@/lib/ai/assistant-store"
import { AiError } from "@/lib/ai/governance-core"
import { resolveTenantModels } from "@/lib/ai/model-catalog"
import { detectAccessibilityBackend } from "./accessibility-backend"
import { resolveEffectiveAccessibilitySettings, type CapabilityState } from "./accessibility-settings"
import { IMAGE_CATEGORIES, type ComplexityLevel, type ManualClassification, type StoredClassification } from "./classification"
import { parseOccurrenceId } from "./classification-service"
import { altTextRequestId, estimateVisionReservation, getAltTextCreditUsage, runMeteredVisionCall } from "./credit-service"
import { aiErrorToFailure, readImageBytes } from "./generate"
import { withinScope, type HistoryActor, type HistoryFailure } from "./history"
import { readImageHeader } from "./image-header"
import { openAltTextImage } from "./preview"
import {
  buildRegionPrompt,
  finalizeRegions,
  orientedDimensions,
  parsePersistedRegions,
  parsePersistedRelationships,
  REGION_COORDINATE_SYSTEM,
  REGION_SCHEMA_VERSION,
  regionRecommendation,
  toRegionReferences,
  type ComplexityRecommendation,
  type RegionAnalysis,
  type RegionAnalysisStatus,
  type RegionReference,
  type RegionSourceImage,
} from "./region-analysis"
import { getAsset, getLatestRegionAnalysis, getOccurrenceClassification, getRegionAnalysisByRequest, getSettings, getSettingsRecord, insertRegionAnalysis, occurrenceBelongsToAsset, type StoredRegionAnalysisRow } from "./store"
import { detectRegionsFromImage, selectVisionModel } from "./vision-service"

export const REGION_CREDIT_FEATURE = "alt_text_region_detection"
const CLIENT_REQUEST_ID = /^[A-Za-z0-9_-]{8,36}$/
const ALLOWED_KEYS = new Set(["occurrenceId", "requestId"])

export type RegionContext = { tenantId: number; role: "admin" | "employee" }
export type RegionActor = HistoryActor & { tenantId: number; role: "admin" | "employee" }

export type RegionAnalysisResponse = {
  success: true
  assetId: number
  occurrenceId: number | null
  analysis: RegionAnalysis | null
  /** Reasons the saved analysis may not reflect the current classification / schema. Empty = current. */
  staleReasons: string[]
  capability: CapabilityState
  complexity: ComplexityLevel
  recommendation: ComplexityRecommendation
  references: RegionReference[]
  permissions: { canAnalyze: boolean }
}
export type DetectRegionsResponse = RegionAnalysisResponse & { replayed: boolean; credits: { charged: number | null; reserved: number; needsReconciliation: boolean } | null }

type Ok<T> = { ok: true; body: T }
const fail = (status: number, code: string, error: string, details?: Record<string, unknown>): HistoryFailure => ({ ok: false, status, code, error, ...(details ? { details } : {}) })
const NOT_FOUND = () => fail(404, "NOT_FOUND", "Image not found.")

export const newRegionId = () => `rgn_${randomBytes(8).toString("hex")}`
const newAnalysisId = () => `rga_${randomBytes(10).toString("hex")}`

/* ───────────── Shared resolution ───────────── */

export async function regionCapability(ctx: RegionContext): Promise<CapabilityState> {
  const [record, backend] = await Promise.all([getSettingsRecord(), detectAccessibilityBackend(ctx.tenantId, ctx.role)])
  const resolved = resolveEffectiveAccessibilitySettings({ storedAccessibility: record.accessibility, revision: record.revision, tenant: record.settings, backend })
  return resolved.capabilities?.region_detection ?? { status: "not_configured", label: "Image region detection", reason: "Capability state could not be resolved." }
}

/** Effective Task 3 result: occurrence correction → asset correction → automated. */
function effectiveClassification(stored: StoredClassification | null | undefined, occurrenceManual: ManualClassification | null) {
  const r = occurrenceManual ?? stored?.manual ?? stored?.automated ?? null
  return { complexity: (r?.complexityLevel ?? "unknown") as ComplexityLevel, category: r?.primaryCategory ?? null }
}

/** Re-validates a persisted row. Corrupt regions are dropped (never repaired) and reported. */
export function toAnalysisView(row: StoredRegionAnalysisRow): RegionAnalysis | null {
  const a = row.analysis as Partial<RegionAnalysis> | null
  if (!a || typeof a !== "object" || !a.source) return null
  const regions = parsePersistedRegions(a.regions)
  const ids = new Set(regions.map((r) => r.id))
  const dropped = Array.isArray(a.regions) ? a.regions.length - regions.length : 0
  const warnings = Array.isArray(a.warnings) ? a.warnings.filter((w): w is string => typeof w === "string") : []
  if (dropped > 0) warnings.push(`${dropped} saved region${dropped === 1 ? "" : "s"} failed validation and ${dropped === 1 ? "is" : "are"} hidden.`)
  return {
    schemaVersion: Number(a.schemaVersion ?? 0),
    analysisId: row.analysisId,
    assetId: Number(a.assetId),
    occurrenceId: a.occurrenceId ?? null,
    version: row.version,
    status: (a.status ?? "needs_review") as RegionAnalysisStatus,
    method: "ai_vision_localization",
    modelId: String(a.modelId ?? ""),
    coordinateSystem: REGION_COORDINATE_SYSTEM,
    source: a.source,
    regions: regions.map((r) => (r.parentId && !ids.has(r.parentId) ? { ...r, parentId: null } : r)),
    relationships: parsePersistedRelationships(a.relationships, ids),
    warnings,
    readingOrderVerified: false,
    layoutAmbiguous: a.layoutAmbiguous === true,
    complexityAtAnalysis: (a.complexityAtAnalysis ?? "unknown") as ComplexityLevel,
    createdAt: String(a.createdAt ?? ""),
    createdBy: Number(a.createdBy ?? 0),
  }
}

export function staleReasonsFor(a: RegionAnalysis | null, currentComplexity: ComplexityLevel): string[] {
  if (!a) return []
  const out: string[] = []
  if (a.schemaVersion !== REGION_SCHEMA_VERSION) out.push("Saved under an older region schema. Re-run detection to refresh.")
  if (a.complexityAtAnalysis !== currentComplexity) out.push("The image complexity was reclassified after this analysis ran.")
  return out
}

async function buildResponse(
  assetId: number,
  occurrenceId: number | null,
  row: StoredRegionAnalysisRow | null,
  complexity: ComplexityLevel,
  capability: CapabilityState,
  canAnalyze: boolean,
): Promise<RegionAnalysisResponse> {
  const analysis = row ? toAnalysisView(row) : null
  return {
    success: true,
    assetId,
    occurrenceId,
    analysis,
    staleReasons: staleReasonsFor(analysis, complexity),
    capability,
    complexity,
    recommendation: regionRecommendation(complexity),
    references: analysis ? toRegionReferences(analysis) : [],
    permissions: { canAnalyze: canAnalyze && capability.status === "available" },
  }
}

type Target = { asset: NonNullable<Awaited<ReturnType<typeof getAsset>>>; occurrenceManual: ManualClassification | null }

async function resolveTarget(assetId: number, occurrenceId: number | null, actor: HistoryActor): Promise<Target | HistoryFailure> {
  const asset = await getAsset(assetId)
  if (!asset || !withinScope(actor.viewScope, actor.userId, asset)) return NOT_FOUND()
  let occurrenceManual: ManualClassification | null = null
  if (occurrenceId != null) {
    // Ownership: the occurrence must map to this asset inside the session tenant.
    if (!(await occurrenceBelongsToAsset(assetId, occurrenceId))) return NOT_FOUND()
    const occ = await getOccurrenceClassification(assetId, occurrenceId)
    occurrenceManual = occ.found ? occ.manual : null
  }
  return { asset, occurrenceManual }
}

/* ───────────── Read (no provider call, no credits) ───────────── */

export async function readRegionAnalysis(assetId: number, occurrenceId: number | null, actor: HistoryActor, ctx: RegionContext): Promise<Ok<RegionAnalysisResponse> | HistoryFailure> {
  const target = await resolveTarget(assetId, occurrenceId, actor)
  if ("ok" in target) return target
  const [row, capability] = await Promise.all([getLatestRegionAnalysis(assetId, occurrenceId), regionCapability(ctx)])
  const { complexity } = effectiveClassification(target.asset.classificationRecord, target.occurrenceManual)
  const canAnalyze = !!actor.updateScope && withinScope(actor.updateScope, actor.userId, target.asset)
  return { ok: true, body: await buildResponse(assetId, occurrenceId, row, complexity, capability, canAnalyze) }
}

/* ───────────── Detect (explicit, authorised, metered) ───────────── */

export function parseDetectRequest(body: unknown): { ok: true; value: { occurrenceId: number | null; requestId: string } } | HistoryFailure {
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail(400, "INVALID_REQUEST", "Send a JSON object.")
  const b = body as Record<string, unknown>
  const extra = Object.keys(b).filter((k) => !ALLOWED_KEYS.has(k))
  if (extra.length) return fail(400, "INVALID_REQUEST", "Unexpected fields in request.", { fields: extra })
  const occurrenceId = parseOccurrenceId(b.occurrenceId)
  if (occurrenceId === undefined) return fail(400, "INVALID_REQUEST", "occurrenceId must be a positive integer.", { field: "occurrenceId" })
  if (typeof b.requestId !== "string" || !CLIENT_REQUEST_ID.test(b.requestId)) return fail(400, "INVALID_REQUEST_ID", "requestId must be 8–36 letters, digits, '-' or '_'.")
  return { ok: true, value: { occurrenceId, requestId: b.requestId } }
}

export type DetectDeps = {
  expectedSourceSha256?: string
  signal?: AbortSignal
  run?: typeof runMeteredVisionCall
  detect?: typeof detectRegionsFromImage
  newId?: () => string
  now?: () => Date
}

export async function detectImageRegions(
  assetId: number,
  body: unknown,
  actor: RegionActor,
  deps: DetectDeps = {},
): Promise<Ok<DetectRegionsResponse> | HistoryFailure> {
  const parsed = parseDetectRequest(body)
  if (!parsed.ok) return parsed
  const { occurrenceId, requestId: clientRequestId } = parsed.value
  const ctx: RegionContext = { tenantId: actor.tenantId, role: actor.role }

  // 1. Authorised asset + occurrence ownership. Writing analysis evidence needs record update scope.
  const target = await resolveTarget(assetId, occurrenceId, actor)
  if ("ok" in target) return target
  const { asset } = target
  if (!actor.updateScope || !withinScope(actor.updateScope, actor.userId, asset)) return fail(403, "FORBIDDEN", "You do not have permission to analyse this image.")
  if (asset.status === "processing") return fail(409, "ASSET_BUSY", "Alt text is being generated for this image. Try again when it finishes.")

  // 2. Idempotency: the request id is bound to (asset, occurrence) so it cannot replay another target.
  const operationId = `rg${assetId}_${occurrenceId ?? 0}_${clientRequestId}`
  if (operationId.length > 64) return fail(400, "INVALID_REQUEST_ID", "requestId is too long for this image.")
  const requestId = altTextRequestId(operationId)
  const { complexity, category } = effectiveClassification(asset.classificationRecord, target.occurrenceManual)

  const capability = await regionCapability(ctx)
  const existing = await getRegionAnalysisByRequest(requestId)
  if (existing) {
    const view = await buildResponse(assetId, occurrenceId, existing, complexity, capability, true)
    return { ok: true, body: { ...view, replayed: true, credits: null } }
  }
  const prior = await getAltTextCreditUsage(actor.tenantId, actor.userId, requestId)
  if (prior?.status === "reserved") return fail(409, "ANALYSIS_IN_PROGRESS", "This region analysis is already running.")

  // 3. Capability: only an available, policy-allowed vision localisation engine may run.
  if (capability.status !== "available") {
    return fail(409, "REGION_DETECTION_UNAVAILABLE", capability.reason ?? "Image region detection is not available for this tenant.", { capabilityStatus: capability.status })
  }

  // 4. Governed model (same selection and entitlement as generation; no hardcoded model id).
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

  // 5. Private image bytes (bounded) + decode-free dimensions/orientation.
  const image = await openAltTextImage(assetId, { userId: actor.userId, tenantId: actor.tenantId, scope: actor.viewScope })
  if (!image.ok) return fail(image.status, image.code, image.error)
  const bytes = await readImageBytes(image.body, altTextSettings.maxFileMb * 1024 * 1024)
  if (!bytes) return fail(413, "FILE_TOO_LARGE", `Images must be ${altTextSettings.maxFileMb} MB or smaller to analyse.`)
  if (deps.expectedSourceSha256 && createHash("sha256").update(bytes).digest("hex") !== deps.expectedSourceSha256) return fail(409,"PIPELINE_SOURCE_CHANGED","The source image changed. Start a new processing run.")
  if (deps.signal?.aborted) return fail(409,"PIPELINE_INTERRUPTED","Processing was interrupted before region detection.")
  const header = readImageHeader(bytes, image.contentType)
  if (!header) return fail(422, "IMAGE_DIMENSIONS_UNAVAILABLE", "The image dimensions could not be read, so regions cannot be located reliably.")
  const oriented = orientedDimensions(header.width, header.height, header.orientation)
  const source: RegionSourceImage = {
    mediaType: image.contentType,
    storedWidth: header.width,
    storedHeight: header.height,
    orientation: header.orientation,
    orientationUnknown: header.orientationUnknown,
    width: oriented.width,
    height: oriented.height,
  }

  // 6. Metered vision localisation (reserve → call → settle; failure releases the hold).
  const prompt = buildRegionPrompt({ complexity, categoryHint: category ? IMAGE_CATEGORIES[category] : null })
  const sizing = estimateVisionReservation({ textChars: prompt.instructions.length + prompt.prompt.length, model })
  const detect = deps.detect ?? detectRegionsFromImage
  let outcome: Awaited<ReturnType<typeof runMeteredVisionCall<Awaited<ReturnType<typeof detectRegionsFromImage>>>>>
  try {
    outcome = await (deps.run ?? runMeteredVisionCall)(
      { tenantId: actor.tenantId, userId: actor.userId, operationId, model, sizing, feature: REGION_CREDIT_FEATURE },
      () => detect({ image: { bytes, mediaType: image.contentType }, model, prompt, maxFileMb: altTextSettings.maxFileMb, ...(deps.signal?{abortSignal:deps.signal}:{}) }),
    )
  } catch (e) {
    if (e instanceof AiError) return aiErrorToFailure(e)
    console.error("[alt-text/regions] unexpected failure", e instanceof Error ? e.name : "unknown")
    return fail(500, "REGION_DETECTION_FAILED", "Region detection failed. Please try again.")
  }

  if (outcome.status === "replayed") {
    const saved = await getRegionAnalysisByRequest(requestId)
    if (!saved) return fail(409, "ANALYSIS_IN_PROGRESS", "This region analysis was already billed and is still being saved.")
    const view = await buildResponse(assetId, occurrenceId, saved, complexity, capability, true)
    return { ok: true, body: { ...view, replayed: true, credits: null } }
  }

  // 7. Validate geometry/hierarchy and persist a new append-only version.
  const { result, credits } = outcome
  const finalized = finalizeRegions({ raw: result.raw, source, complexity, newId: deps.newId ?? newRegionId })
  const createdAt = (deps.now?.() ?? new Date()).toISOString()
  let row: StoredRegionAnalysisRow
  try {
    row = await insertRegionAnalysis({
      assetId,
      occurrenceId,
      requestId,
      createdBy: actor.userId,
      build: (version) => {
        const analysis: RegionAnalysis = {
          schemaVersion: REGION_SCHEMA_VERSION,
          analysisId: newAnalysisId(),
          assetId,
          occurrenceId,
          version,
          status: finalized.status,
          method: "ai_vision_localization",
          modelId: result.modelId,
          coordinateSystem: REGION_COORDINATE_SYSTEM,
          source,
          regions: finalized.regions,
          relationships: finalized.relationships,
          warnings: finalized.warnings,
          readingOrderVerified: false,
          layoutAmbiguous: finalized.layoutAmbiguous,
          complexityAtAnalysis: complexity,
          createdAt,
          createdBy: actor.userId,
        }
        return { analysisId: analysis.analysisId, status: analysis.status, analysis }
      },
    })
  } catch (e) {
    console.error("[alt-text/regions] save failed after provider usage; needs reconciliation", {
      requestId,
      assetId,
      creditsCharged: credits.creditsCharged,
      error: e instanceof Error ? e.name : "unknown",
    })
    return fail(500, "SAVE_FAILED", "Regions were detected but could not be saved. Usage was recorded; retry with a new request.")
  }

  const view = await buildResponse(assetId, occurrenceId, row, complexity, capability, true)
  return {
    ok: true,
    body: { ...view, replayed: false, credits: { charged: credits.creditsCharged, reserved: credits.creditsReserved, needsReconciliation: credits.needsReconciliation } },
  }
}
