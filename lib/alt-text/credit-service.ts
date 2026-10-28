/**
 * @file lib/alt-text/credit-service.ts
 * @module Publishing · Alt Text
 * @kind Server-side library
 * @summary Alt Text adapter over the existing AI credit engine (reserve → vision → settle / release).
 * @exports altTextRequestId, estimateAltTextReservation, reserveAltTextCredits, settleAltTextCredits, releaseAltTextCredits, getAltTextCreditUsage, runMeteredAltTextGeneration, … (12 total)
 * @data Reads ai_credit_reservations / ai_credit_ledger; all writes go through lib/ai/credits.
 * @see docs/CODEBASE-GUIDE.md for module ownership, conventions and where to add new code.
 *
 * Billing policy (no new pricing — every amount comes from rateForModel / rateUsage):
 * - Reservation: prompt chars + IMAGE_INPUT_TOKEN_RESERVE image tokens, plus the
 *   full output-token ceiling, rated with the standalone engine's model tier.
 * - Settlement: provider-reported tokens. If input or output counts are missing,
 *   the reservation estimate is settled (never zero, never above the hold) and the
 *   ledger entry is flagged `needsReconciliation`; no tokens are metered.
 * - Usage above the estimate follows the engine's existing overage rules.
 * - Failures (invalid output, timeout, rate limit, network, cancellation) release
 *   the hold, matching the ERP rule that failed attempts are not billable.
 * - Settlement failures keep the hold (usage is billable); the engine's
 *   reservation TTL stops it from blocking credits permanently.
 */
import "server-only"
import { randomUUID } from "node:crypto"
import { query } from "@/lib/db"
import { costTier, type CatalogModel } from "@/lib/ai/catalog-core"
import type { UsageMeasure } from "@/lib/ai/credits/credits-core"
import { abortMeteredRequest, beginMeteredRequest, finishMeteredRequest, type MeteredRequest } from "@/lib/ai/credits/credits-service"
import { AiError } from "@/lib/ai/governance-core"
import { buildPrompt, validateImage, type AltTextResult, type AltTextSettings, type GenerationSettings } from "./core"
import { CLASSIFICATION_PROMPT_RULES } from "./classification"
import {
  generateAltTextFromImage,
  isVisionCompatible,
  visionMaxOutputTokens,
  type GenerateAltTextFromImageInput,
  type VisionGenerationResult,
} from "./vision-service"

/** Conservative per-image input allowance; above typical high-detail vision costs across providers. */
export const IMAGE_INPUT_TOKEN_RESERVE = 6_000
/** Matches the chars-per-token ratio used by estimateCredits. */
const CHARS_PER_TOKEN = 3.5
const SOURCE_MODULE = "alt_text"
const REQUEST_PREFIX = "alttext:"
const OPERATION_ID = /^[A-Za-z0-9_-]{8,64}$/

export type AltTextUsageStatus = "settled" | "estimated" | "pending_settlement" | "released" | "reserved"

/** Safe, tenant-scoped view of one generation's billing; sourced from the credit ledger. */
export type AltTextCreditUsage = {
  requestId: string
  modelId: string
  provider: string | null
  creditsReserved: number
  creditsCharged: number | null
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  cachedInputTokens: number | null
  status: AltTextUsageStatus
  needsReconciliation: boolean
}

export type AltTextReservation = {
  metered: MeteredRequest
  userId: number
  modelId: string
  estimate: UsageMeasure
}

/**
 * One id per logical generation attempt. Retries reuse the client operation id;
 * a regeneration must send a new one. The tenant is never part of client input:
 * reservations are keyed by (server tenant, request id).
 */
export function altTextRequestId(operationId?: string | null): string {
  if (operationId == null || operationId === "") return `${REQUEST_PREFIX}${randomUUID()}`
  if (!OPERATION_ID.test(operationId)) throw new AiError("invalid_request", "Invalid generation operation id.")
  return `${REQUEST_PREFIX}${operationId}`
}

export type VisionReservationSizing = { promptChars: number; maxOutputTokens: number; estimate: UsageMeasure }

export function estimateAltTextReservation(input: { generation: GenerationSettings; altTextSettings: AltTextSettings; model: Pick<CatalogModel, "maxOutputTokens">; document?: GenerateAltTextFromImageInput["document"]; advancedEvidence?: GenerateAltTextFromImageInput["advancedEvidence"]; classify?: boolean; classificationHint?: GenerateAltTextFromImageInput["classificationHint"] }) {
  const { instructions, prompt } = buildPrompt({
    language: input.generation.outputLanguage,
    audience: input.altTextSettings.defaultAudience,
    context: input.generation.imageContext,
    shortMaxChars: input.altTextSettings.shortMaxChars,
    generation: input.generation,
    document: input.document,
    advancedEvidence: input.advancedEvidence,
    classificationHint: input.classificationHint,
    classificationRules: input.classify === false ? undefined : CLASSIFICATION_PROMPT_RULES,
  })
  return estimateVisionReservation({ textChars: instructions.length + prompt.length, model: input.model })
}

/** Sizing for any single-image vision call: prompt text + one image allowance + full output ceiling. */
export function estimateVisionReservation(input: { textChars: number; model: Pick<CatalogModel, "maxOutputTokens"> }): VisionReservationSizing {
  const promptChars = input.textChars + Math.ceil(IMAGE_INPUT_TOKEN_RESERVE * CHARS_PER_TOKEN)
  const maxOutputTokens = visionMaxOutputTokens(input.model)
  const estimate: UsageMeasure = {
    inputTokens: Math.ceil(promptChars / CHARS_PER_TOKEN),
    cachedInputTokens: 0,
    outputTokens: maxOutputTokens,
    reasoningTokens: 0,
    toolCalls: 0,
  }
  return { promptChars, maxOutputTokens, estimate }
}

const numOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null)

function parseJson(v: unknown): Record<string, any> {
  if (!v) return {}
  if (typeof v === "object") return v as Record<string, any>
  try {
    return JSON.parse(String(v))
  } catch {
    return {}
  }
}

/** Reads the existing reservation + usage ledger rows; scoped to tenant, user and Alt Text requests. */
export async function getAltTextCreditUsage(tenantId: number, userId: number, requestId: string): Promise<AltTextCreditUsage | null> {
  if (!requestId.startsWith(REQUEST_PREFIX)) return null
  const rows = await query<any[]>(
    `SELECT r.status, r.credits, r.settled_credits, r.model_id, l.amount, l.provider, l.metadata_json
       FROM ai_credit_reservations r
       LEFT JOIN ai_credit_ledger l ON l.tenant_id = r.tenant_id AND l.idempotency_key = CONCAT('usage:', r.request_id)
      WHERE r.tenant_id = ? AND r.user_id = ? AND r.request_id = ?
      LIMIT 1`,
    [tenantId, userId, requestId],
  )
  const row = rows[0]
  if (!row) return null
  const meta = parseJson(row.metadata_json)
  const reported = parseJson(meta.reportedUsage)
  const settled = row.status === "settled"
  const needsReconciliation = Boolean(meta.needsReconciliation)
  return {
    requestId,
    modelId: String(row.model_id),
    provider: row.provider ? String(row.provider) : typeof meta.provider === "string" ? meta.provider : null,
    creditsReserved: Number(row.credits),
    creditsCharged: settled ? Number(row.settled_credits ?? Math.abs(Number(row.amount ?? 0))) : null,
    inputTokens: numOrNull(reported.inputTokens),
    outputTokens: numOrNull(reported.outputTokens),
    totalTokens: numOrNull(reported.totalTokens),
    cachedInputTokens: numOrNull(reported.cachedInputTokens),
    status: settled ? (needsReconciliation ? "estimated" : "settled") : row.status === "released" ? "released" : "reserved",
    needsReconciliation,
  }
}

const isDuplicateKey = (e: unknown) => (e as { code?: string })?.code === "ER_DUP_ENTRY"

/**
 * Preflight + hold using the standalone engine's tier rate and optional monthly credit cap.
 * Model/tenant governance is checked by the caller. Returns `replay` when this operation was
 * already settled so no second provider call is made.
 */
export async function reserveAltTextCredits(
  input: { tenantId: number; userId: number; model: CatalogModel; requestId: string } & (
    | { generation: GenerationSettings; altTextSettings: AltTextSettings; sizing?: undefined }
    | { sizing: VisionReservationSizing; generation?: undefined; altTextSettings?: undefined }
  ),
): Promise<{ reservation: AltTextReservation; replay?: undefined } | { reservation?: undefined; replay: AltTextCreditUsage }> {
  const { tenantId, userId, model, requestId } = input
  const prior = await getAltTextCreditUsage(tenantId, userId, requestId)
  if (prior && prior.creditsCharged != null) return { replay: prior }

  const { promptChars, maxOutputTokens, estimate } = input.sizing ?? estimateAltTextReservation({ generation: input.generation, altTextSettings: input.altTextSettings, model })
  const meteredModel = { id: model.id, tier: costTier(model), supportsReasoning: model.supportsReasoning, maxOutputTokens }
  let metered: MeteredRequest
  try {
    metered = await beginMeteredRequest(tenantId, userId, meteredModel, promptChars, maxOutputTokens, requestId)
  } catch (e) {
    if (!isDuplicateKey(e)) throw e
    const settled = await getAltTextCreditUsage(tenantId, userId, requestId)
    if (settled && settled.creditsCharged != null) return { replay: settled }
    throw new AiError("invalid_request", "This generation request was already processed.", { creditCode: "duplicate_request" })
  }

  // A concurrent attempt may have settled between the pre-check and the hold.
  const after = await getAltTextCreditUsage(tenantId, userId, requestId)
  if (after && after.creditsCharged != null) return { replay: after }

  return { reservation: { metered, userId, modelId: model.id, estimate } }
}

export async function releaseAltTextCredits(r: AltTextReservation): Promise<void> {
  await abortMeteredRequest(r.metered, { sourceModule: SOURCE_MODULE })
}

/** Settles provider-reported usage through the engine's conditional reservation and ledger transaction. */
/** The billing-relevant part of any vision call result. */
export type VisionCallMeta = Pick<VisionGenerationResult, "modelId" | "provider" | "usage" | "finishReason" | "latencyMs">

export async function settleAltTextCredits(r: AltTextReservation, vision: VisionCallMeta, opts: { interactionId?: number; feature?: string } = {}): Promise<AltTextCreditUsage> {
  const u = vision.usage
  const reported = u.inputTokens != null && u.outputTokens != null
  const measure: UsageMeasure = reported
    ? { inputTokens: u.inputTokens!, cachedInputTokens: u.cachedInputTokens ?? 0, outputTokens: u.outputTokens!, reasoningTokens: 0, toolCalls: 0 }
    : r.estimate
  const metadata = {
    feature: opts.feature ?? SOURCE_MODULE,
    provider: vision.provider,
    usageSource: reported ? "provider" : "reservation_estimate",
    needsReconciliation: !reported,
    reportedUsage: u,
    imageInputReserveTokens: IMAGE_INPUT_TOKEN_RESERVE,
    finishReason: vision.finishReason,
    latencyMs: vision.latencyMs,
  }
  const settle = () => finishMeteredRequest(r.metered, r.userId, vision.modelId, measure, opts.interactionId ?? 0, { sourceModule: SOURCE_MODULE, metadata, meterTokens: reported })

  let charged: number | null = null
  try {
    charged = (await settle()).credits
  } catch (first) {
    console.error("[alt-text] credit settlement failed, retrying", { requestId: r.metered.requestId, error: (first as Error)?.message })
    // The engine only transitions 'reserved' rows and commits the ledger in the same transaction.
    charged = await settle()
      .then((res) => res.credits)
      .catch((e) => {
        console.error("[alt-text] credit settlement failed", { requestId: r.metered.requestId, error: (e as Error)?.message })
        return null
      })
  }

  return {
    requestId: r.metered.requestId,
    modelId: vision.modelId,
    provider: vision.provider,
    creditsReserved: r.metered.reserved,
    creditsCharged: charged,
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
    totalTokens: u.totalTokens,
    cachedInputTokens: u.cachedInputTokens,
    status: charged == null ? "pending_settlement" : reported ? "settled" : "estimated",
    needsReconciliation: charged == null || !reported,
  }
}

/**
 * Generic reserve → call → settle for a non-alt-text vision feature (e.g. region detection).
 * Same billing policy as generation: a failed call releases the hold and is not billable.
 */
export async function runMeteredVisionCall<T extends VisionCallMeta>(
  input: { tenantId: number; userId: number; operationId: string; model: CatalogModel; sizing: VisionReservationSizing; feature: string },
  call: () => Promise<T>,
): Promise<{ status: "generated"; result: T; credits: AltTextCreditUsage } | { status: "replayed"; credits: AltTextCreditUsage }> {
  const requestId = altTextRequestId(input.operationId)
  const held = await reserveAltTextCredits({ tenantId: input.tenantId, userId: input.userId, model: input.model, requestId, sizing: input.sizing })
  if (held.replay) return { status: "replayed", credits: held.replay }
  let result: T
  try {
    result = await call()
  } catch (e) {
    await releaseAltTextCredits(held.reservation)
    throw e
  }
  const credits = await settleAltTextCredits(held.reservation, result, { feature: input.feature })
  return { status: "generated", result, credits }
}

export type MeteredAltTextOutcome =
  | { status: "generated"; output: AltTextResult; vision: VisionGenerationResult; credits: AltTextCreditUsage }
  | { status: "replayed"; credits: AltTextCreditUsage }

/**
 * Full billed generation for Task 14: validate → reserve → vision → settle,
 * releasing the hold on any generation failure. `tenantId`/`userId` must come
 * from the server session, never the request body.
 */
export async function runMeteredAltTextGeneration(
  input: { tenantId: number; userId: number; operationId?: string | null; interactionId?: number; vision: GenerateAltTextFromImageInput },
  deps: { generate?: typeof generateAltTextFromImage } = {},
): Promise<MeteredAltTextOutcome> {
  const { vision } = input
  if (!isVisionCompatible(vision.model)) throw new AiError("model_not_allowed", "The selected model cannot analyse images or its provider is not configured.", { modelId: vision.model.id })
  const check = validateImage({ type: vision.image.mediaType, size: vision.image.bytes?.length ?? 0, name: "" }, vision.image.bytes ?? new Uint8Array(), vision.altTextSettings.maxFileMb)
  if (!check.ok) throw new AiError("invalid_request", check.error)

  const requestId = altTextRequestId(input.operationId)
  const held = await reserveAltTextCredits({
    tenantId: input.tenantId,
    userId: input.userId,
    model: vision.model,
    requestId,
    sizing: estimateAltTextReservation(vision),
  })
  if (held.replay) return { status: "replayed", credits: held.replay }

  let result: VisionGenerationResult
  try {
    result = await (deps.generate ?? generateAltTextFromImage)(vision)
  } catch (e) {
    await releaseAltTextCredits(held.reservation)
    throw e
  }
  const credits = await settleAltTextCredits(held.reservation, result, { interactionId: input.interactionId })
  return { status: "generated", output: result.output, vision: result, credits }
}
