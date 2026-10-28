/**
 * @file lib/alt-text/vision-service.ts
 * @module Publishing · Alt Text
 * @kind Server-side library
 * @summary Vision-model selection and image → alt text generation over the existing ERP AI stack.
 * @exports isVisionCompatible, selectVisionModel, generateAltTextFromImage, VisionGenerationResult
 * @see docs/CODEBASE-GUIDE.md for module ownership, conventions and where to add new code.
 */
import "server-only"
import type { CatalogModel } from "@/lib/ai/catalog-core"
import { safeAiErrorMetadata } from "@/lib/ai/error-diagnostics"
import { retryAfterFromError } from "./concurrency"
import { AiError, type TenantAiSettings } from "@/lib/ai/governance-core"
import { gatewayAuthAvailable } from "@/lib/ai/provider"
import { assertOutboundAllowed } from "@/lib/demo/outbound-guard"
import {
  AltTextOutputError,
  buildPrompt,
  parseAiOutput,
  validateImage,
  type AltTextResult,
  type AltTextSettings,
  type GenerationSettings,
  type ImageClassification,
  type SupportedImageType,
} from "./core"
import { documentContextNotices, type DocumentPromptContext } from "./document-prompt"
import { buildAutomatedClassification, CLASSIFICATION_PROMPT_RULES, parseClassificationAnalysis } from "./classification"
import { parseRegionProviderOutput, RegionOutputError, type RawRegionOutput } from "./region-analysis"

const DEFAULT_TIMEOUT_MS = 90_000

/** Output-token ceiling sent to the provider; also the worst case reserved by credit metering. */
export function visionMaxOutputTokens(model: Pick<CatalogModel, "maxOutputTokens">): number {
  return model.maxOutputTokens ? Math.min(model.maxOutputTokens, 8000) : 4000
}

/** The catalog flag alone is not enough: the model must accept image input and have a reachable provider. */
export function isVisionCompatible(model: CatalogModel): boolean {
  if (!model.supportsVision || !model.inputTypes.includes("image")) return false
  if (model.id.startsWith("openai/") && process.env.OPENAI_API_KEY) return true
  return gatewayAuthAvailable()
}

/**
 * Picks a vision model from models already authorised by tenant governance
 * (`resolveTenantModels().usable`). Order: Alt Text preferred model → tenant
 * default → tenant fallback → first compatible. Never falls back to text-only.
 */
export function selectVisionModel(input: {
  usable: CatalogModel[]
  tenantSettings: TenantAiSettings
  preferredModelId?: string | null
  defaultModelId?: string | null
  fallbackModelId?: string | null
}): CatalogModel {
  const { usable, tenantSettings } = input
  if (!tenantSettings.enabled) throw new AiError("ai_disabled", "AI is not enabled for your organisation. An administrator can turn it on in AI governance.")
  if (!tenantSettings.allowVision) throw new AiError("feature_disabled", "Image analysis is disabled by your organisation's AI governance.")

  const compatible = usable.filter(isVisionCompatible)
  if (input.preferredModelId) {
    const preferred = usable.find((m) => m.id === input.preferredModelId)
    if (!preferred) throw new AiError("model_not_allowed", "The Alt Text preferred model is not available under your organisation's AI policy.")
    if (!isVisionCompatible(preferred)) throw new AiError("model_not_allowed", "The Alt Text preferred model cannot analyse images. Choose a vision-capable model.")
    return preferred
  }
  const byId = (id: string | null | undefined) => (id ? compatible.find((m) => m.id === id) : undefined)
  const chosen = byId(input.defaultModelId) ?? byId(input.fallbackModelId) ?? compatible[0]
  if (!chosen) throw new AiError("no_model_available", "No vision-capable AI model is configured and permitted for this workspace.")
  return chosen
}

export type VisionUsage = {
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  cachedInputTokens: number | null
}

export type VisionGenerationResult = {
  output: AltTextResult
  modelId: string
  provider: string
  /** Provider-reported only; fields are null when the provider omits them. */
  usage: VisionUsage
  finishReason: string | null
  latencyMs: number
}

export type GenerateAltTextFromImageInput = {
  advancedEvidence?: import("./description-evidence").DescriptionEvidence | null
  image: { bytes: Uint8Array; mediaType: SupportedImageType }
  generation: GenerationSettings
  altTextSettings: AltTextSettings
  model: CatalogModel
  /** Occurrence-specific document context resolved server-side; omitted for standalone images. */
  document?: DocumentPromptContext | null
  /** False when automatic classification is switched off in Accessibility Settings. */
  classify?: boolean
  /** Editor-corrected category, mapped to the Phase 1 image type, handed to the prompt as a hint. */
  classificationHint?: ImageClassification | null
  timeoutMs?: number
  abortSignal?: AbortSignal
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null)

function toProviderError(e: unknown, modelId: string): AiError {
  const meta = safeAiErrorMetadata(e)
  const status = typeof meta.status === "number" ? meta.status : null
  const name = typeof meta.name === "string" ? meta.name : ""
  if (status === 429) {
    const retryAfterSeconds = retryAfterFromError(e)
    return new AiError("rate_limited", "The AI provider is rate limiting requests. Please try again shortly.", { modelId, providerStatus: status, ...(retryAfterSeconds != null ? { retryAfterSeconds } : {}) })
  }
  if (status === 401 || status === 403 || name === "AI_LoadAPIKeyError") {
    return new AiError("provider_error", "The AI provider rejected the configured credentials. An administrator must check the AI provider configuration.", { modelId, reason: "credentials", providerStatus: status })
  }
  if (name === "AbortError" || name === "TimeoutError") return new AiError("provider_error", "The AI provider timed out while analysing the image.", { modelId, reason: "timeout" })
  if (name === "AI_UnsupportedFunctionalityError") return new AiError("model_not_allowed", "The selected model does not accept image input.", { modelId, reason: "unsupported_input" })
  return new AiError("provider_error", "The AI service is unavailable right now. Please try again shortly.", { modelId, reason: "unavailable", ...(status ? { providerStatus: status } : {}) })
}

/**
 * Sends the actual image bytes (never a URL or file name) with the existing
 * Alt Text prompt to an authorised vision model and returns validated output.
 * Throws AiError on any failure; never returns a fabricated result.
 */
export async function generateAltTextFromImage(input: GenerateAltTextFromImageInput): Promise<VisionGenerationResult> {
  const { image, generation, altTextSettings, model } = input
  if (!isVisionCompatible(model)) throw new AiError("model_not_allowed", "The selected model cannot analyse images or its provider is not configured.", { modelId: model.id })

  const check = validateImage({ type: image.mediaType, size: image.bytes?.length ?? 0, name: "" }, image.bytes ?? new Uint8Array(), altTextSettings.maxFileMb)
  if (!check.ok) throw new AiError("invalid_request", check.error)

  await assertOutboundAllowed("AI_EXECUTE")

  const { instructions, prompt } = buildPrompt({
    language: generation.outputLanguage,
    audience: altTextSettings.defaultAudience,
    context: generation.imageContext,
    shortMaxChars: altTextSettings.shortMaxChars,
    generation,
    document: input.document ?? null,
    advancedEvidence: input.advancedEvidence,
    classificationRules: input.classify === false ? undefined : CLASSIFICATION_PROMPT_RULES,
    classificationHint: input.classificationHint ?? null,
  })

  const started = Date.now()
  let result: Awaited<ReturnType<typeof import("ai").generateText>>
  try {
    const [{ generateText }, { resolveLanguageModel }] = await Promise.all([import("ai"), import("@/lib/ai/provider")])
    result = await generateText({
      model: await resolveLanguageModel(model.id),
      instructions,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "file", mediaType: check.type, data: { type: "data", data: image.bytes } },
          ],
        },
      ],
      maxOutputTokens: visionMaxOutputTokens(model),
      timeout: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      abortSignal: input.abortSignal,
    })
  } catch (e) {
    console.error("[alt-text] vision generation failed", { modelId: model.id, ...safeAiErrorMetadata(e) })
    throw toProviderError(e, model.id)
  }

  let output: AltTextResult
  try {
    output = parseAiOutput(result.text, altTextSettings.shortMaxChars, { purpose: generation.imagePurpose })
  } catch (e) {
    if (e instanceof AltTextOutputError) {
      console.error("[alt-text] invalid vision output", { modelId: model.id, code: e.code, field: e.field })
      throw new AiError("provider_error", "The AI returned an invalid response. No alt text was saved.", { modelId: model.id, reason: "invalid_output", outputError: e.code, field: e.field })
    }
    throw e
  }
  if (input.document) {
    const notices = documentContextNotices(input.document).filter((n) => !output.warnings.includes(n))
    if (notices.length) output = { ...output, warnings: [...output.warnings, ...notices] }
  }
  if (input.advancedEvidence) {
    output = { ...output, warnings: [...new Set([...input.advancedEvidence.warnings, ...output.warnings])] }
    if (generation.imagePurpose !== "decorative" && output.purpose === "decorative" && input.advancedEvidence.strategy !== "standard") {
      throw new AiError("provider_error", "A complex informative image requires an editor's explicit decorative decision.", { reason: "invalid_output" })
    }
    if (generation.imagePurpose !== "decorative" && !["standard", "text", "fallback"].includes(input.advancedEvidence.strategy) && !output.longDescription.trim()) {
      throw new AiError("provider_error", "The complex image response omitted its detailed description.", { reason: "invalid_output" })
    }
  }
  {
    const { rawAnalysis, ...rest } = output
    output =
      input.classify === false
        ? rest
        : { ...rest, automatedClassification: buildAutomatedClassification(parseClassificationAnalysis(rawAnalysis, output.classification), model.id) }
  }

  const u = (result.usage ?? {}) as Record<string, unknown> & { inputTokenDetails?: { cacheReadTokens?: unknown } }
  return {
    output,
    modelId: model.id,
    provider: model.provider,
    usage: {
      inputTokens: num(u.inputTokens),
      outputTokens: num(u.outputTokens),
      totalTokens: num(u.totalTokens),
      cachedInputTokens: num(u.inputTokenDetails?.cacheReadTokens),
    },
    finishReason: typeof result.finishReason === "string" ? result.finishReason : null,
    latencyMs: Date.now() - started,
  }
}

export type RegionDetectionResult = Omit<VisionGenerationResult, "output"> & { raw: RawRegionOutput }

/**
 * Phase 3 Task 4 — asks an authorised vision model to localise regions in the actual image bytes.
 * Output is shape-checked here; geometry and hierarchy are validated by `finalizeRegions`.
 */
type EvidenceVisionInput = {
  image: { bytes: Uint8Array; mediaType: SupportedImageType }
  model: CatalogModel
  prompt: { instructions: string; prompt: string }
  maxFileMb: number
  timeoutMs?: number
  abortSignal?: AbortSignal
}
export async function detectRegionsFromImage(input:EvidenceVisionInput):Promise<RegionDetectionResult>{
  return analyzeVisionEvidence(input,parseRegionProviderOutput)
}
/** Shared governed image transport. Callers own strict feature-specific parsing and existing metering. */
export async function analyzeVisionEvidence<T>(input:EvidenceVisionInput,parseOutput:(text:string)=>T):Promise<Omit<VisionGenerationResult,"output">&{raw:T}> {
  const { image, model } = input
  if (!isVisionCompatible(model)) throw new AiError("model_not_allowed", "The selected model cannot analyse images or its provider is not configured.", { modelId: model.id })
  const check = validateImage({ type: image.mediaType, size: image.bytes?.length ?? 0, name: "" }, image.bytes ?? new Uint8Array(), input.maxFileMb)
  if (!check.ok) throw new AiError("invalid_request", check.error)
  await assertOutboundAllowed("AI_EXECUTE")

  const started = Date.now()
  let result: Awaited<ReturnType<typeof import("ai").generateText>>
  try {
    const [{ generateText }, { resolveLanguageModel }] = await Promise.all([import("ai"), import("@/lib/ai/provider")])
    result = await generateText({
      model: await resolveLanguageModel(model.id),
      instructions: input.prompt.instructions,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: input.prompt.prompt },
            { type: "file", mediaType: check.type, data: { type: "data", data: image.bytes } },
          ],
        },
      ],
      maxOutputTokens: visionMaxOutputTokens(model),
      timeout: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      abortSignal: input.abortSignal,
    })
  } catch (e) {
    console.error("[alt-text] region detection failed", { modelId: model.id, ...safeAiErrorMetadata(e) })
    throw toProviderError(e, model.id)
  }

  let raw:T
  try {
    raw = parseOutput(result.text)
  } catch (e) {
    if (e instanceof RegionOutputError) {
      console.error("[alt-text] invalid region output", { modelId: model.id, code: e.code })
      throw new AiError("provider_error", "The AI returned an invalid region response. No regions were saved.", { modelId: model.id, reason: "invalid_output", outputError: e.code })
    }
    throw new AiError("provider_error", "The AI returned invalid visual evidence. No analysis was accepted.", {modelId:model.id,reason:"invalid_output"})
  }

  const u = (result.usage ?? {}) as Record<string, unknown> & { inputTokenDetails?: { cacheReadTokens?: unknown } }
  return {
    raw,
    modelId: model.id,
    provider: model.provider,
    usage: {
      inputTokens: num(u.inputTokens),
      outputTokens: num(u.outputTokens),
      totalTokens: num(u.totalTokens),
      cachedInputTokens: num(u.inputTokenDetails?.cacheReadTokens),
    },
    finishReason: typeof result.finishReason === "string" ? result.finishReason : null,
    latencyMs: Date.now() - started,
  }
}
