/**
 * @file lib/alt-text/ocr-service.ts
 * @module Publishing · Alt Text
 * @kind Server-side library
 * @summary Phase 3 Task 5 — OCR orchestration and read model.
 *   Scope-checked asset/occurrence → capability + tenant OCR policy → private image bytes →
 *   header-only format/size checks → (optional) region → reuse or run self-hosted OCR →
 *   whitespace-only normalisation → append-only persistence.
 * @usedBy app/api/alt-text/assets/[id]/ocr/route.ts
 *
 * Guarantees:
 * - Reading saved OCR never runs the engine.
 * - OCR never writes alt text, never approves review and never modifies the original image.
 * - A client requestId is bound to (asset, occurrence, scope); a retry replays the saved result.
 * - A failed attempt is stored for audit but never replaces an earlier usable result.
 * - No text is invented: an empty engine result is reported as "no text detected".
 */
import "server-only"
import { createHash, randomBytes } from "node:crypto"
import { detectAccessibilityBackend } from "./accessibility-backend"
import { resolveEffectiveAccessibilitySettings, type CapabilityState } from "./accessibility-settings"
import { readImageBytes } from "./generate"
import { withinScope, type HistoryActor, type HistoryFailure } from "./history"
import { readImageHeader } from "./image-header"
import {
  deriveOcrStatus,
  mapEngineLayout,
  meanWordConfidence,
  normalizeOcrText,
  OCR_ERROR_CATEGORIES,
  OCR_LIMITS,
  OCR_PROVIDER_ID,
  OCR_PROVIDER_LABEL,
  OCR_SCHEMA_VERSION,
  OCR_SUPPORTED_MEDIA_TYPES,
  OCR_TEXT_REGION_TYPES,
  parseOcrRunRequest,
  pickActiveResult,
  regionCrop,
  sanitizeOcrText,
  truncateText,
  type OcrErrorCategory,
  type OcrPixelBox,
  type OcrResult,
  type OcrResultStatus,
} from "./ocr-contract"
import { OCR_ENGINE_VERSION, OCR_LANGUAGE_MODEL, OcrEngineError, recognizeImage } from "./ocr-engine"
import { openAltTextImage } from "./preview"
import { REGION_TYPES, type ImageRegion, type RegionType } from "./region-analysis"
import { toAnalysisView } from "./region-service"
import { findReusableOcrResult, getAsset, getLatestRegionAnalysis, getOcrResultByRequest, getSettings, getSettingsRecord, insertOcrResult, listOcrResults, occurrenceBelongsToAsset, type StoredOcrRow } from "./store"

export type OcrActor = HistoryActor & { tenantId: number; role: "admin" | "employee" }

export type OcrScopeView = { active: OcrResult | null; latestFailure: OcrResult | null }
export type OcrRegionOption = {
  regionId: string
  index: number
  primaryType: RegionType
  label: string
  eligible: boolean
  ineligibleReason: string | null
} & OcrScopeView

export type OcrResponse = {
  success: true
  assetId: number
  occurrenceId: number | null
  capability: CapabilityState
  /** Tenant OCR policy after capability gating (Accessibility settings → OCR). */
  policy: { enabled: boolean; languages: string[]; reason: string | null }
  engine: { label: string; version: string; languageModel: string }
  settingsRevision: number
  full: OcrScopeView
  regionAnalysis: { analysisId: string; version: number } | null
  regions: OcrRegionOption[]
  permissions: { canRun: boolean }
}
export type RunOcrResponse = OcrResponse & { result: OcrResult; replayed: boolean; reused: boolean }

type Ok<T> = { ok: true; body: T }
const fail = (status: number, code: string, error: string, details?: Record<string, unknown>): HistoryFailure => ({ ok: false, status, code, error, ...(details ? { details } : {}) })
const NOT_FOUND = () => fail(404, "NOT_FOUND", "Image not found.")
const newResultId = () => `ocr_${randomBytes(10).toString("hex")}`
const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex")

const RESULT_STATUSES = new Set<OcrResultStatus>(["completed", "completed_with_warnings", "no_text_detected", "failed", "unsupported"])

/** Re-validates a persisted row; anything malformed is hidden rather than shown as evidence. */
export function toOcrView(row: StoredOcrRow): OcrResult | null {
  const r = row.result as Partial<OcrResult> | null
  if (!r || typeof r !== "object" || !RESULT_STATUSES.has(r.status as OcrResultStatus)) return null
  if (typeof r.rawText !== "string" || typeof r.normalizedText !== "string" || !r.source) return null
  return { ...(r as OcrResult), version: row.version, resultId: row.resultId, warnings: Array.isArray(r.warnings) ? r.warnings.filter((w): w is string => typeof w === "string") : [] }
}

function scopeView(rows: StoredOcrRow[]): OcrScopeView {
  const views = rows.map(toOcrView).filter((v): v is OcrResult => !!v)
  return pickActiveResult(views)
}

type Policy = { capability: CapabilityState; policy: OcrResponse["policy"]; revision: number }

async function ocrPolicy(actor: OcrActor): Promise<Policy> {
  const [record, backend] = await Promise.all([getSettingsRecord(), detectAccessibilityBackend(actor.tenantId, actor.role)])
  const resolved = resolveEffectiveAccessibilitySettings({ storedAccessibility: record.accessibility, revision: record.revision, tenant: record.settings, backend })
  const capability = resolved.capabilities?.ocr ?? { status: "not_configured", label: "OCR text recognition", reason: "Capability state could not be resolved." }
  const enabled = resolved.effective.ocr.enabled === true
  const languages = enabled ? [...(resolved.effective.ocr.languages as string[])] : []
  const reason =
    capability.status !== "available"
      ? (capability.reason ?? "OCR is not available in this deployment.")
      : !enabled
        ? "OCR is turned off in Accessibility settings. An administrator can enable it under OCR."
        : !languages.includes("en")
          ? "English is not selected as an OCR language in Accessibility settings."
          : null
  return { capability, policy: { enabled: enabled && languages.includes("en"), languages, reason }, revision: record.revision }
}

type Target = { asset: NonNullable<Awaited<ReturnType<typeof getAsset>>> }

async function resolveTarget(assetId: number, occurrenceId: number | null, actor: HistoryActor): Promise<Target | HistoryFailure> {
  const asset = await getAsset(assetId)
  if (!asset || !withinScope(actor.viewScope, actor.userId, asset)) return NOT_FOUND()
  if (occurrenceId != null && !(await occurrenceBelongsToAsset(assetId, occurrenceId))) return NOT_FOUND()
  return { asset }
}

/** Why a region cannot be read, or null when it can. Pure so it is unit tested. */
export function regionIneligibility(region: Pick<ImageRegion, "primaryType" | "locationStatus">, source: { orientation: number; orientationUnknown: boolean }): string | null {
  if (!OCR_TEXT_REGION_TYPES.includes(region.primaryType)) return "Not a text-bearing region type."
  if (source.orientationUnknown || source.orientation !== 1) return "Image orientation differs from the stored pixels, so the region cannot be mapped."
  if (region.locationStatus !== "verified_frame") return "Region location is unverified."
  return null
}

async function buildResponse(assetId: number, occurrenceId: number | null, p: Policy, canRun: boolean): Promise<OcrResponse> {
  const [rows, regionRow] = await Promise.all([listOcrResults(assetId, occurrenceId), getLatestRegionAnalysis(assetId, occurrenceId)])
  const byScope = new Map<string, StoredOcrRow[]>()
  for (const r of rows) byScope.set(r.scopeKey, [...(byScope.get(r.scopeKey) ?? []), r])
  const analysis = regionRow ? toAnalysisView(regionRow) : null
  const regions: OcrRegionOption[] = (analysis?.regions ?? []).map((region, i) => {
    const reason = regionIneligibility(region, analysis!.source)
    return {
      regionId: region.id,
      index: i + 1,
      primaryType: region.primaryType,
      label: REGION_TYPES[region.primaryType] ?? region.primaryType,
      eligible: !reason,
      ineligibleReason: reason,
      ...scopeView(byScope.get(region.id) ?? []),
    }
  })
  return {
    success: true,
    assetId,
    occurrenceId,
    capability: p.capability,
    policy: p.policy,
    engine: { label: OCR_PROVIDER_LABEL, version: OCR_ENGINE_VERSION, languageModel: OCR_LANGUAGE_MODEL },
    settingsRevision: p.revision,
    full: scopeView(byScope.get("full") ?? []),
    regionAnalysis: analysis ? { analysisId: analysis.analysisId, version: analysis.version } : null,
    regions,
    permissions: { canRun: canRun && p.capability.status === "available" && p.policy.enabled },
  }
}

/* ───────────── Read (never runs the engine) ───────────── */

export async function readOcrResults(assetId: number, occurrenceId: number | null, actor: OcrActor): Promise<Ok<OcrResponse> | HistoryFailure> {
  const target = await resolveTarget(assetId, occurrenceId, actor)
  if ("ok" in target) return target
  const p = await ocrPolicy(actor)
  const canRun = !!actor.updateScope && withinScope(actor.updateScope, actor.userId, target.asset)
  return { ok: true, body: await buildResponse(assetId, occurrenceId, p, canRun) }
}

/* ───────────── Run (explicit, authorised) ───────────── */

export type RunOcrDeps = { recognize?: typeof recognizeImage; now?: () => Date }

const ENGINE_FAILURE_STATUS: Partial<Record<OcrErrorCategory, number>> = { engine_busy: 503, engine_unavailable: 503 }

export async function runOcr(assetId: number, body: unknown, actor: OcrActor, deps: RunOcrDeps = {}): Promise<Ok<RunOcrResponse> | HistoryFailure> {
  const parsed = parseOcrRunRequest(body)
  if (!parsed.ok) return fail(parsed.status, parsed.code, parsed.error, parsed.details)
  const { occurrenceId, regionId, reprocess, settingsRevision } = parsed.value

  // 1. Authorised asset + occurrence ownership. Writing OCR evidence needs record update scope.
  const target = await resolveTarget(assetId, occurrenceId, actor)
  if ("ok" in target) return target
  if (!actor.updateScope || !withinScope(actor.updateScope, actor.userId, target.asset)) return fail(403, "FORBIDDEN", "You do not have permission to run OCR on this image.")

  // 2. Idempotent replay, bound to (asset, occurrence, scope).
  const scopeKey = regionId ?? "full"
  const requestId = `ocr:${assetId}_${occurrenceId ?? 0}_${scopeKey}_${parsed.value.requestId}`
  const p = await ocrPolicy(actor)
  const respond = async (row: StoredOcrRow, flags: { replayed: boolean; reused: boolean }): Promise<Ok<RunOcrResponse> | HistoryFailure> => {
    const result = toOcrView(row)
    if (!result) return fail(500, "OCR_RESULT_INVALID", "The saved OCR result could not be read.")
    return { ok: true, body: { ...(await buildResponse(assetId, occurrenceId, p, true)), result, ...flags } }
  }
  const existing = await getOcrResultByRequest(requestId)
  if (existing) return respond(existing, { replayed: true, reused: false })

  // 3. Capability + tenant processing policy.
  if (p.capability.status !== "available") return fail(409, "OCR_UNAVAILABLE", p.policy.reason ?? "OCR is not available.", { capabilityStatus: p.capability.status })
  if (!p.policy.enabled) return fail(409, "OCR_DISABLED", p.policy.reason ?? "OCR is turned off.")
  if (settingsRevision != null && settingsRevision !== p.revision) return fail(409, "SETTINGS_CHANGED", "Accessibility settings changed. Reload and try again.")

  // 4. Private bytes (bounded) + header-only format, size and orientation checks.
  const altTextSettings = await getSettings()
  const image = await openAltTextImage(assetId, { userId: actor.userId, tenantId: actor.tenantId, scope: actor.viewScope })
  if (!image.ok) return fail(image.status, image.code, image.error)
  if (!(OCR_SUPPORTED_MEDIA_TYPES as readonly string[]).includes(image.contentType)) {
    return fail(415, "OCR_UNSUPPORTED_FORMAT", OCR_ERROR_CATEGORIES.unsupported_format, { mediaType: image.contentType })
  }
  const bytes = await readImageBytes(image.body, altTextSettings.maxFileMb * 1024 * 1024)
  if (!bytes) return fail(413, "FILE_TOO_LARGE", `Images must be ${altTextSettings.maxFileMb} MB or smaller for OCR.`)
  const header = readImageHeader(bytes, image.contentType)
  if (!header) return fail(422, "OCR_DECODE_FAILED", OCR_ERROR_CATEGORIES.decode_failed)
  if (header.width > OCR_LIMITS.maxSide || header.height > OCR_LIMITS.maxSide || header.width * header.height > OCR_LIMITS.maxPixels) {
    return fail(413, "OCR_IMAGE_TOO_LARGE", OCR_ERROR_CATEGORIES.image_too_large, { width: header.width, height: header.height })
  }
  const orientationMatches = header.orientation === 1 && !header.orientationUnknown

  // 5. Region → stored-pixel crop. Only when the region frame is provably the stored frame.
  let region: OcrResult["region"] = null
  let crop: OcrPixelBox | null = null
  if (regionId) {
    const row = await getLatestRegionAnalysis(assetId, occurrenceId)
    const analysis = row ? toAnalysisView(row) : null
    const found = analysis?.regions.find((r) => r.id === regionId)
    if (!analysis || !found) return fail(404, "REGION_NOT_FOUND", "That region is not in the current region analysis. Re-run region detection or refresh.")
    const reason = regionIneligibility(found, analysis.source)
    if (reason) return fail(422, "REGION_NOT_ELIGIBLE", reason)
    if (analysis.source.storedWidth !== header.width || analysis.source.storedHeight !== header.height || !orientationMatches) {
      return fail(409, "REGION_UNMAPPABLE", OCR_ERROR_CATEGORIES.region_unmappable)
    }
    crop = regionCrop(found.box, header.width, header.height)
    if (!crop) return fail(422, "REGION_TOO_SMALL", OCR_ERROR_CATEGORIES.region_too_small)
    region = { regionId, analysisId: analysis.analysisId, analysisVersion: analysis.version, primaryType: found.primaryType, box: found.box, crop }
  }

  // 6. Reuse an identical earlier result unless reprocessing was requested.
  const inputSha256 = sha256(bytes)
  const configFingerprint = sha256(JSON.stringify({ p: OCR_PROVIDER_ID, e: OCR_ENGINE_VERSION, m: OCR_LANGUAGE_MODEL, mode: "printed_text", lang: "en", crop, s: OCR_SCHEMA_VERSION }))
  const cacheKey = sha256(`${inputSha256}:${configFingerprint}`)
  if (!reprocess) {
    const reusable = await findReusableOcrResult(assetId, occurrenceId, scopeKey, cacheKey)
    if (reusable) return respond(reusable, { replayed: false, reused: true })
  }

  // 7. Recognise.
  const source: OcrResult["source"] = { mediaType: image.contentType, storedWidth: header.width, storedHeight: header.height, orientation: header.orientation, orientationUnknown: header.orientationUnknown }
  const base = {
    schemaVersion: OCR_SCHEMA_VERSION,
    assetId,
    occurrenceId,
    scope: regionId ? ("region" as const) : ("full_image" as const),
    region,
    providerId: OCR_PROVIDER_ID,
    engineVersion: OCR_ENGINE_VERSION,
    languageModel: OCR_LANGUAGE_MODEL,
    language: "en" as const,
    mode: "printed_text" as const,
    confidenceScale: "tesseract_0_100" as const,
    source,
    inputSha256,
    configFingerprint,
    settingsRevision: p.revision,
    createdAt: (deps.now?.() ?? new Date()).toISOString(),
  }

  let built: Omit<OcrResult, "resultId" | "version">
  try {
    const rec = await (deps.recognize ?? recognizeImage)({ bytes, rectangle: crop })
    built = { ...base, ...buildRecognitionResult(rec, { orientationMatches, orientation: header.orientation, orientationUnknown: header.orientationUnknown }) }
  } catch (e) {
    const category: OcrErrorCategory = e instanceof OcrEngineError ? e.category : "engine_error"
    if (ENGINE_FAILURE_STATUS[category]) return fail(ENGINE_FAILURE_STATUS[category]!, category === "engine_busy" ? "OCR_BUSY" : "OCR_UNAVAILABLE", OCR_ERROR_CATEGORIES[category])
    console.error("[alt-text/ocr] recognition failed", { assetId, category })
    built = {
      ...base,
      status: "failed",
      errorCategory: category,
      rawText: "",
      normalizedText: "",
      meanConfidence: null,
      lowConfidenceWordCount: 0,
      layout: null,
      warnings: [OCR_ERROR_CATEGORIES[category]],
      durationMs: 0,
    }
  }

  const row = await insertOcrResult({
    assetId,
    occurrenceId,
    scopeKey,
    requestId,
    cacheKey,
    createdBy: actor.userId,
    build: () => {
      const resultId = newResultId()
      return { resultId, status: built.status, result: { ...built, resultId } }
    },
  })
  return respond(row, { replayed: false, reused: false })
}

/** Engine output → persisted fields. Pure so normalisation and warnings are unit tested. */
export function buildRecognitionResult(
  rec: { text: string; blocks: unknown; durationMs: number },
  frame: { orientationMatches: boolean; orientation: number; orientationUnknown: boolean },
): Pick<OcrResult, "status" | "errorCategory" | "rawText" | "normalizedText" | "meanConfidence" | "lowConfidenceWordCount" | "layout" | "warnings" | "durationMs"> {
  const raw = truncateText(sanitizeOcrText(rec.text))
  const normalized = truncateText(normalizeOcrText(rec.text))
  const layout = mapEngineLayout(rec.blocks, frame.orientationMatches)
  const { mean, low } = meanWordConfidence(layout)
  const warnings: string[] = []
  if (!frame.orientationMatches) {
    warnings.push(
      frame.orientationUnknown
        ? "The image orientation could not be read. Text was recognised from the stored pixels and boxes are not drawn."
        : `The image is stored rotated (EXIF orientation ${frame.orientation}). Text was recognised from the stored pixels; rotated text may be missed and boxes are not drawn.`,
    )
  }
  if (raw.truncated || normalized.truncated) warnings.push(`Text was truncated at ${OCR_LIMITS.maxTextChars.toLocaleString("en-US")} characters.`)
  if (layout.truncated) warnings.push("Layout detail was truncated; the full text is still recorded up to the character limit.")
  if (low > 0) warnings.push(`${low} word${low === 1 ? " has" : "s have"} low engine confidence. Check them against the image.`)
  const status = deriveOcrStatus({ normalizedText: normalized.text, meanConfidence: mean, warnings })
  return {
    status,
    errorCategory: null,
    rawText: raw.text,
    normalizedText: normalized.text,
    meanConfidence: mean,
    lowConfidenceWordCount: low,
    layout: layout.lines.length ? layout : null,
    warnings,
    durationMs: rec.durationMs,
  }
}
