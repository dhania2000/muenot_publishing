/**
 * @file lib/alt-text/advanced-analysis-contract.ts
 * @module Publishing · Alt Text
 * @kind Browser-safe contract + pure validation (no I/O, no AI calls)
 * @summary Advanced Accessibility (OCR, math, charts, diagrams, image tables) — Task 1 foundation.
 *   Defines the structured evidence that later analysis tasks attach to an existing Alt Text asset
 *   (`alt_text_assets`) or document image occurrence (`alt_text_document_images`). It performs no
 *   analysis itself; `parseAccessibilityAnalysis` only validates and enforces the evidence rules.
 *
 * Evidence rules (enforced by the parser, not left to callers):
 * - Every evidence item names its source. Only `user_confirmed` evidence may be marked verified.
 * - Confidence is an interpretable tier (reused from document context), never an invented number.
 *   A numeric score is accepted only when an engine actually reported it, and must name that engine.
 * - `model_interpretation` evidence can never be `high` confidence and always requires verification.
 * - All evidence text (OCR, document context, model output) is untrusted data. Text that reads like
 *   an instruction is kept verbatim but flagged with an `INSTRUCTION_LIKE_TEXT` warning.
 * - Regions use the existing normalized 0–1 image-relative bounds.
 */
import { CLASSIFICATION_LABELS, type ImageClassification } from "./core"
import { DESCRIPTION_REVIEW_STATUSES, type DescriptionReviewStatus } from "./document-approval-contract"
import { boundText, looksLikeInstruction, normalizeContextText, type ContextConfidence } from "./document-context"
import type { NormalizedBounds } from "./image-location"

export const ACCESSIBILITY_ANALYSIS_VERSION = 1

// ─── Analysis types (logical routing categories, not a DB enum) ─────────────

export const ACCESSIBILITY_ANALYSIS_TYPES = [
  "standard_image",
  "text_heavy_image",
  "mathematical_equation",
  "graph_or_chart",
  "scientific_diagram",
  "flowchart",
  "table_image",
  "map_or_geometry",
  "mixed_complex_image",
  "unknown",
] as const
export type AccessibilityAnalysisType = (typeof ACCESSIBILITY_ANALYSIS_TYPES)[number]

/**
 * Derives the routing category from the existing stored classification. `text_heavy_image` and
 * `mixed_complex_image` have no classification equivalent and are only assigned from evidence.
 */
const TYPE_FOR_CLASSIFICATION: Record<ImageClassification, AccessibilityAnalysisType> = {
  photograph: "standard_image",
  illustration: "standard_image",
  screenshot: "standard_image",
  logo_icon: "standard_image",
  decorative: "standard_image",
  functional: "standard_image",
  chart: "graph_or_chart",
  table: "table_image",
  map: "map_or_geometry",
  math_equation: "mathematical_equation",
  scientific_diagram: "scientific_diagram",
  flowchart: "flowchart",
  other: "unknown",
}

export function analysisTypeForClassification(classification: string | null | undefined): AccessibilityAnalysisType {
  return classification && Object.prototype.hasOwnProperty.call(CLASSIFICATION_LABELS, classification)
    ? TYPE_FOR_CLASSIFICATION[classification as ImageClassification]
    : "unknown"
}

// ─── Provenance & confidence ────────────────────────────────────────────────

export const EVIDENCE_SOURCES = ["visual_observation", "ocr", "document_context", "model_interpretation", "user_confirmed"] as const
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number]

export const EVIDENCE_SOURCE_LABEL: Record<EvidenceSource, string> = {
  visual_observation: "Observed in image",
  ocr: "OCR-recognized text",
  document_context: "Document context",
  model_interpretation: "AI interpretation",
  user_confirmed: "Confirmed by editor",
}

export const EVIDENCE_KINDS = ["text", "equation", "chart_structure", "diagram_component", "table_structure", "label", "relationship"] as const
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number]

/** How `content` is encoded. LaTeX/MathML are stored as text and never rendered as markup by this layer. */
export const EVIDENCE_REPRESENTATIONS = ["plain", "latex", "mathml", "json"] as const
export type EvidenceRepresentation = (typeof EVIDENCE_REPRESENTATIONS)[number]

const CONFIDENCE_TIERS = ["high", "medium", "low", "unavailable"] as const satisfies readonly ContextConfidence[]

export type AccessibilityConfidence = {
  tier: ContextConfidence
  /** Short rule or reason for the tier, e.g. `ocr_engine_score`, `model_self_report`, `editor_confirmed`. */
  basis: string
  /** Only when an engine actually reported a score (0–1). Never synthesized from the tier. */
  reportedScore?: { value: number; reportedBy: string }
}

export type AccessibilityRegion = {
  /** Image-relative bounds, origin top-left, each value in [0, 1]. */
  bounds: NormalizedBounds
  label?: string
}

export type AccessibilityEvidence = {
  id: string
  kind: EvidenceKind
  source: EvidenceSource
  content: string
  representation: EvidenceRepresentation
  /** BCP 47-style tag when the engine reports one, e.g. `en`, `hi`. */
  language?: string
  region?: AccessibilityRegion
  confidence: AccessibilityConfidence
  /** Derived by the parser; true unless source is `user_confirmed`. */
  requiresVerification: boolean
}

export const ACCESSIBILITY_WARNING_CODES = [
  "LOW_CONFIDENCE",
  "UNREADABLE_REGION",
  "UNSUPPORTED_CONTENT",
  "INSTRUCTION_LIKE_TEXT",
  "MODEL_INTERPRETATION_UNVERIFIED",
  "TRUNCATED",
  "CAPABILITY_UNAVAILABLE",
] as const
export type AccessibilityWarningCode = (typeof ACCESSIBILITY_WARNING_CODES)[number]
export type AccessibilityWarning = { code: AccessibilityWarningCode; message: string; evidenceId?: string }

/** Reuses the existing description review lifecycle rather than adding a parallel one. */
export type AccessibilityReviewStatus = DescriptionReviewStatus

// ─── Requests & results ─────────────────────────────────────────────────────

/** Targets existing records only; analysis never creates its own image store. */
export type AdvancedAccessibilityInput =
  | { kind: "asset"; assetId: number }
  | { kind: "document_image"; documentId: number; documentImageId: number; assetId: number | null }

export type AccessibilityAnalysisRequest = {
  input: AdvancedAccessibilityInput
  /** Editor hint or the type derived from the stored classification. */
  analysisType: AccessibilityAnalysisType
}

export type AccessibilityAnalysisResult = {
  version: typeof ACCESSIBILITY_ANALYSIS_VERSION
  analysisType: AccessibilityAnalysisType
  evidence: AccessibilityEvidence[]
  warnings: AccessibilityWarning[]
  reviewStatus: AccessibilityReviewStatus
  /** Null when no AI model produced any of the evidence. */
  model: { modelId: string; provider: string | null } | null
  analyzedAt: string
}

export const ANALYSIS_LIMITS = { maxEvidence: 200, maxContent: 20_000, maxWarnings: 50, maxMessage: 500, maxLabel: 200, maxBasis: 80, maxId: 64 } as const

// ─── Validation ─────────────────────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v)
const str = (v: unknown, max: number) => (typeof v === "string" ? normalizeContextText(v).slice(0, max) : "")
const unit = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1

function parseRegion(v: unknown): AccessibilityRegion | undefined {
  if (!isObj(v) || !isObj(v.bounds)) return undefined
  const { x, y, width, height } = v.bounds
  if (![x, y, width, height].every(unit)) return undefined
  const b = { x, y, width, height } as NormalizedBounds
  if (b.width <= 0 || b.height <= 0 || b.x + b.width > 1 + 1e-6 || b.y + b.height > 1 + 1e-6) return undefined
  const label = str(v.label, ANALYSIS_LIMITS.maxLabel)
  return label ? { bounds: b, label } : { bounds: b }
}

function parseConfidence(v: unknown, source: EvidenceSource): AccessibilityConfidence {
  const c = isObj(v) ? v : {}
  let tier: ContextConfidence = oneOf(CONFIDENCE_TIERS, c.tier) ? c.tier : "unavailable"
  if (source === "model_interpretation" && tier === "high") tier = "medium"
  const basis = str(c.basis, ANALYSIS_LIMITS.maxBasis) || "unspecified"
  const r = c.reportedScore
  const reportedBy = isObj(r) ? str(r.reportedBy, ANALYSIS_LIMITS.maxBasis) : ""
  return isObj(r) && unit(r.value) && reportedBy ? { tier, basis, reportedScore: { value: r.value as number, reportedBy } } : { tier, basis }
}

/**
 * Validates stored or engine-produced analysis. Returns null when the shape is unusable; drops
 * individual malformed evidence items; enforces the provenance rules in the file header.
 */
export function parseAccessibilityAnalysis(raw: unknown): AccessibilityAnalysisResult | null {
  if (!isObj(raw) || raw.version !== ACCESSIBILITY_ANALYSIS_VERSION || !Array.isArray(raw.evidence)) return null
  if (!oneOf(ACCESSIBILITY_ANALYSIS_TYPES, raw.analysisType)) return null
  const analyzedAt = typeof raw.analyzedAt === "string" && !Number.isNaN(Date.parse(raw.analyzedAt)) ? raw.analyzedAt : null
  if (!analyzedAt) return null

  const warnings: AccessibilityWarning[] = []
  for (const w of Array.isArray(raw.warnings) ? raw.warnings : []) {
    if (!isObj(w) || !oneOf(ACCESSIBILITY_WARNING_CODES, w.code)) continue
    const message = str(w.message, ANALYSIS_LIMITS.maxMessage)
    if (!message) continue
    const evidenceId = str(w.evidenceId, ANALYSIS_LIMITS.maxId)
    warnings.push(evidenceId ? { code: w.code, message, evidenceId } : { code: w.code, message })
  }

  const evidence: AccessibilityEvidence[] = []
  const seen = new Set<string>()
  if (raw.evidence.length > ANALYSIS_LIMITS.maxEvidence) {
    warnings.push({ code: "TRUNCATED", message: `Only the first ${ANALYSIS_LIMITS.maxEvidence} evidence items were kept.` })
  }
  for (const e of raw.evidence.slice(0, ANALYSIS_LIMITS.maxEvidence)) {
    if (!isObj(e) || !oneOf(EVIDENCE_KINDS, e.kind) || !oneOf(EVIDENCE_SOURCES, e.source)) continue
    const id = str(e.id, ANALYSIS_LIMITS.maxId)
    if (!id || seen.has(id)) continue
    const rawContent = typeof e.content === "string" ? normalizeContextText(e.content) : ""
    if (!rawContent) continue
    seen.add(id)
    const { text: content, truncated } = boundText(rawContent, ANALYSIS_LIMITS.maxContent)
    const source = e.source
    const item: AccessibilityEvidence = {
      id,
      kind: e.kind,
      source,
      content,
      representation: oneOf(EVIDENCE_REPRESENTATIONS, e.representation) ? e.representation : "plain",
      confidence: parseConfidence(e.confidence, source),
      requiresVerification: source !== "user_confirmed",
    }
    const language = str(e.language, 16)
    if (language && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(language)) item.language = language
    const region = parseRegion(e.region)
    if (region) item.region = region
    evidence.push(item)

    if (truncated) warnings.push({ code: "TRUNCATED", message: "Evidence text exceeded the storage limit and was shortened.", evidenceId: id })
    if (source !== "user_confirmed" && looksLikeInstruction(content)) {
      warnings.push({ code: "INSTRUCTION_LIKE_TEXT", message: "This text reads like an instruction. It is kept as image data and was not followed.", evidenceId: id })
    }
    if (source === "model_interpretation") {
      warnings.push({ code: "MODEL_INTERPRETATION_UNVERIFIED", message: "AI interpretation; verify against the image before publishing.", evidenceId: id })
    }
  }

  const m = raw.model
  const modelId = isObj(m) ? str(m.modelId, 120) : ""
  const model = modelId ? { modelId, provider: isObj(m) && typeof m.provider === "string" ? str(m.provider, 60) || null : null } : null

  return {
    version: ACCESSIBILITY_ANALYSIS_VERSION,
    analysisType: raw.analysisType,
    evidence,
    warnings: warnings.slice(0, ANALYSIS_LIMITS.maxWarnings),
    reviewStatus: oneOf(DESCRIPTION_REVIEW_STATUSES, raw.reviewStatus) ? raw.reviewStatus : "not_reviewed",
    model,
    analyzedAt,
  }
}

/** True when any evidence still needs a human check before the analysis can inform an approval. */
export const analysisNeedsVerification = (r: AccessibilityAnalysisResult) => r.evidence.some((e) => e.requiresVerification)
