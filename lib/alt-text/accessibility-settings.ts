/**
 * @file lib/alt-text/accessibility-settings.ts
 * @module Publishing · Alt Text
 * @kind Shared contract (client + server, pure — no I/O)
 * @summary Phase 3 Task 2 — Advanced Accessibility preferences: capability registry, declarative
 *   settings schema, strict patch validation, the single effective-settings resolver and the job
 *   settings snapshot.
 *
 * Preferences are stored inside the existing tenant `alt_text_settings.settings` JSON under the
 * `accessibility` key (no new table). Two kinds of field exist:
 *   - capability-gated fields (e.g. "OCR enabled") can only be turned on when the backend reports
 *     the capability as available; the resolver forces them off in the effective configuration
 *     otherwise, and the PATCH route rejects enabling them.
 *   - policy preferences (review, evidence and description rules) are persisted now and applied by
 *     analysis engines when those engines are implemented. They never trigger processing.
 *
 * Supported scopes are the ones that exist in this ERP: platform defaults → tenant settings.
 * An optional named client guideline supplements the tenant defaults; there is no project-settings or per-batch accessibility scope. Batch and image
 * overrides continue to apply to per-request GenerationSettings only (lib/alt-text/batch-settings.ts).
 */
import { SUBJECTS, type AltTextSettings, type Subject } from "./core"
import {normalizeClientGuideline} from "./client-guideline"

/* ───────────────────────── Capability registry ───────────────────────── */

export const CAPABILITY_STATUSES = {
  available: { label: "Available", tone: "success" },
  disabled_by_policy: { label: "Disabled by policy", tone: "muted" },
  not_configured: { label: "Not configured", tone: "warning" },
  not_implemented: { label: "Not yet implemented", tone: "muted" },
  unsupported: { label: "Unsupported", tone: "muted" },
} as const
export type CapabilityStatus = keyof typeof CAPABILITY_STATUSES

export const ACCESSIBILITY_CAPABILITIES = {
  standard_description: { label: "Standard image description", dependency: "Requires an approved, vision-capable AI model for this tenant." },
  auto_classification: { label: "Automatic image classification", dependency: "Uses the image type returned by the vision model during generation." },
  region_detection: {
    label: "Image region detection",
    dependency: "Uses an approved vision model to estimate region positions. Positions are model estimates, not pixel-verified.",
  },
  classification_confidence: { label: "Classification uncertainty & review", dependency: "Uses categorical clear, ambiguous or insufficient evidence and the existing manual review workflow. These are not calibrated confidence percentages." },
  advanced_description: { label: "Advanced description pipeline", dependency: "Uses bounded saved OCR, math, chart and diagram evidence in the existing governed generator. Missing or tentative evidence requires review; no analyzer runs automatically." },
  text_heavy_analysis: { label: "Text-heavy image analysis", dependency: "Uses existing saved raw and corrected OCR in the governed description generator. Recognition must be run separately." },
  ocr: { label: "OCR text recognition", dependency: "Self-hosted Tesseract.js engine with integrity-checked English and Hindi language packs. Printed English, Hindi (Devanagari) and mixed English + Hindi text." },
  math_analysis: { label: "Mathematical equation analysis", dependency: "Local recognizer with runtime readiness checks. Recognition remains a candidate requiring human verification." },
  math_ocr: { label: "Mathematical OCR", dependency: "Local mathematical recognition; output accuracy requires human review." },
  math_verification: { label: "Equation syntax & human verification", dependency: "Local bounded syntax parsing, KaTeX rendering and separate human source-match review. Syntax validity does not establish mathematical truth." },
  latex_output: { label: "LaTeX output", dependency: "Saved equation candidates and reviewer corrections with bounded syntax validation." },
  mathml_output: { label: "Presentation MathML output", dependency: "Local KaTeX conversion and sanitized Presentation MathML; no semantic mathematical proof." },
  chart_analysis: { label: "Graph and chart analysis", dependency: "Governed vision proposals for existing chart regions. Labels and data require review." },
  chart_axes: {label:"Chart axes, labels and scales",dependency:"Uses reviewer-verified OCR and existing chart regions. Geometry and scale fits remain candidates."},
  chart_data_extraction: { label: "Graph data extraction", dependency: "Local reviewed visible data labels only. Native chart data and image digitization are unsupported; reviewer confirmation and source provenance are required." },
  scientific_diagram_analysis: { label: "Scientific diagram analysis", dependency: "Governed vision of existing diagram/component regions, OCR references and tentative visual relationships. No subject identity or scientific accuracy is verified." },
  scientific_domain_analysis: {label:"Scientific subject evidence",dependency:"Bounded chemistry, physics, biology and geometry candidates with original notation and source references. No chemical validity, simulation, diagnosis or proof."},
  flowchart_analysis: { label: "Flowchart analysis", dependency: "Governed source-region node/connector proposals. Unclear directions stay unknown; graph semantics require review." },
  table_image_analysis: { label: "Table-as-image analysis", dependency: "Bounded visible table/cell/row/column proposals with cell-scoped OCR. No missing values or native table remediation." },
  map_geometry_analysis: { label: "Map and geometry analysis", dependency: "Source-bound map elements and existing geometry evidence. No geocoding, distances, scale calibration or routing." },
  mixed_complex_analysis: { label: "Mixed complex image analysis", dependency: "Retains source panels and mixed region categories without flattening or automatic reading-order verification." },
  client_guidelines: { label: "Client guidelines", dependency: "Optional named client policy saved as this tenant's default. Literal and detailed-description checks supplement source evidence and mandatory review." },
  advanced_qa: { label: "Advanced accessibility QA", dependency: "Versioned local checks for saved OCR, equations, charts, science and reviewed descriptions. Findings require human resolution; no conformance certification." },
} as const
export type CapabilityId = keyof typeof ACCESSIBILITY_CAPABILITIES
export const CAPABILITY_IDS = Object.keys(ACCESSIBILITY_CAPABILITIES) as CapabilityId[]

/**
 * Facts about the running backend. Produced server-side from real registries
 * (lib/alt-text/accessibility-backend.ts) — never from client input.
 */
export type AccessibilityBackend = {
  /** Engines actually implemented and registered in code. */
  implemented: readonly CapabilityId[]
  /** null = could not be verified for this tenant. */
  visionModelAvailable: boolean | null
  /** OCR language codes with an installed recognition pack. */
  ocrLanguagePacks: readonly string[]
  /** OCR recognition modes (eng, hin, eng_hin) whose worker actually initialised. Absent = not reported. */
  ocrModes?: readonly string[]
  /** Why the OCR engine failed its health check, when it did. */
  ocrIssue?: string | null
  mathReady?: boolean
  mathIssue?: string | null
  /** Capabilities switched off by a mandatory platform or tenant policy. */
  disabledByPolicy: readonly CapabilityId[]
}

export type CapabilityState = { status: CapabilityStatus; label: string; reason: string | null }

/** Capabilities that need a configured runtime resource in addition to an implementation. */
const RUNTIME_REQUIREMENTS: Partial<Record<CapabilityId, (b: AccessibilityBackend) => string | null>> = {
  text_heavy_analysis: (b) => b.visionModelAvailable === true ? null : "Requires an authorized, configured vision model for description generation.",
  advanced_description: (b) => b.visionModelAvailable === true ? null : "Requires an authorized, configured vision model.",
  standard_description: (b) =>
    b.visionModelAvailable === true ? null : b.visionModelAvailable === false ? "No approved vision-capable model is available to this tenant." : "Vision model availability could not be verified.",
  auto_classification: (b) => (b.visionModelAvailable === true ? null : "Requires an available vision model."),
  classification_confidence: (b) => (b.visionModelAvailable === true ? null : "Requires an available vision model for automated uncertainty; existing manual review remains available."),
  region_detection: (b) => (b.visionModelAvailable === true ? null : "Requires an available vision model."),
  scientific_domain_analysis: (b) => b.visionModelAvailable===true?null:"Requires an authorized, configured vision model.",
  scientific_diagram_analysis: (b) => b.visionModelAvailable===true?null:"Requires an authorized, configured vision model.",
  flowchart_analysis: (b) => b.visionModelAvailable===true?null:"Requires an authorized, configured vision model.",
  table_image_analysis: (b) => b.visionModelAvailable===true?null:"Requires an authorized, configured vision model.",
  map_geometry_analysis: (b) => b.visionModelAvailable===true?null:"Requires an authorized, configured vision model.",
  mixed_complex_analysis: (b) => b.visionModelAvailable===true?null:"Requires an authorized, configured vision model.",
  chart_analysis: (b) => b.visionModelAvailable===true?null:"Requires an authorized, configured vision model.",
  ocr: (b) => (b.ocrLanguagePacks.length ? null : (b.ocrIssue ?? "No OCR language pack is installed.")),
  math_analysis: (b) => b.mathReady === true ? null : (b.mathIssue ?? "The local mathematical recognizer has not passed its runtime check."),
  math_ocr: (b) => b.mathReady === true ? null : (b.mathIssue ?? "The local mathematical recognizer has not passed its runtime check."),
}

export function deriveCapabilityStates(backend: AccessibilityBackend): Record<CapabilityId, CapabilityState> {
  return Object.fromEntries(
    CAPABILITY_IDS.map((id) => {
      const meta = ACCESSIBILITY_CAPABILITIES[id]
      if (backend.disabledByPolicy.includes(id)) return [id, { status: "disabled_by_policy", label: meta.label, reason: "Disabled by a mandatory platform or tenant policy." }]
      if (!backend.implemented.includes(id)) return [id, { status: "not_implemented", label: meta.label, reason: meta.dependency }]
      const missing = RUNTIME_REQUIREMENTS[id]?.(backend) ?? null
      return [id, missing ? { status: "not_configured", label: meta.label, reason: missing } : { status: "available", label: meta.label, reason: null }]
    }),
  ) as Record<CapabilityId, CapabilityState>
}

/* ───────────────────────── Option catalogues ───────────────────────── */

/** Advanced analysis types (Step 4). Standard image description is always on and not listed here. */
export const ANALYSIS_TYPES = {
  text_heavy: "Text-Heavy Image Analysis",
  math: "Mathematical Equation Analysis",
  chart: "Graph and Chart Analysis",
  scientific_diagram: "Scientific Diagram Analysis",
  flowchart: "Flowchart Analysis",
  table: "Table-as-Image Analysis",
  map_geometry: "Map and Geometry Analysis",
  mixed_complex: "Mixed Complex Image Analysis",
} as const
export type AnalysisType = keyof typeof ANALYSIS_TYPES

export const ANALYSIS_CAPABILITY: Record<AnalysisType, CapabilityId> = {
  text_heavy: "text_heavy_analysis",
  math: "math_analysis",
  chart: "chart_analysis",
  scientific_diagram: "scientific_diagram_analysis",
  flowchart: "flowchart_analysis",
  table: "table_image_analysis",
  map_geometry: "map_geometry_analysis",
  mixed_complex: "mixed_complex_analysis",
}

/**
 * OCR recognition languages (ISO 639-1). Independent of the Alt Text output language
 * (`AltTextSettings.defaultLanguage`). Listing a language here does not mean a pack is installed.
 */
export const OCR_LANGUAGES = {
  en: "English",
  hi: "Hindi (हिन्दी)",
  mr: "Marathi (मराठी)",
  bn: "Bengali (বাংলা)",
  ta: "Tamil (தமிழ்)",
  te: "Telugu (తెలుగు)",
  gu: "Gujarati (ગુજરાતી)",
  ur: "Urdu (اردو)",
} as const
export type OcrLanguage = keyof typeof OCR_LANGUAGES

const SCIENCE_SUBJECT_KEYS = [
  "biology",
  "physics",
  "chemistry",
  "mathematics",
  "geography",
  "mechanical_engineering",
  "electrical_engineering",
  "electronics",
  "medical",
  "computer_science",
  "other",
] as const satisfies readonly Subject[]
/** Reuses the Phase 1 subject catalogue; no separate subject module. */
export const SCIENCE_SUBJECTS = Object.fromEntries(SCIENCE_SUBJECT_KEYS.map((k) => [k, SUBJECTS[k]])) as Record<(typeof SCIENCE_SUBJECT_KEYS)[number], string>

export const DETAILED_DESCRIPTION_PARTS = {
  components: "Components",
  relationships: "Relationships",
  labels: "Labels",
  trends: "Graph trends",
  processes: "Scientific processes",
  numbers: "Important numerical information",
  spatial: "Relevant spatial information",
  math: "Mathematical explanations",
} as const

/* ───────────────────────── Declarative schema ───────────────────────── */

type FlagField = { kind: "flag"; key: string; label: string; help?: string; group?: string; default: boolean; requires?: CapabilityId }
type ChoiceField = {
  kind: "choice"
  key: string
  label: string
  help?: string
  group?: string
  options: Readonly<Record<string, string>>
  default: string
  requiresByOption?: Readonly<Partial<Record<string, CapabilityId>>>
}
type MultiField = {
  kind: "multi"
  key: string
  label: string
  help?: string
  group?: string
  options: Readonly<Record<string, string>>
  default: readonly string[]
  min?: number
  max?: number
  requiresByOption?: Readonly<Partial<Record<string, CapabilityId>>>
}
export type AccessibilityField = FlagField | ChoiceField | MultiField
type SectionDef = { title: string; description: string; capabilities: readonly CapabilityId[]; fields: readonly AccessibilityField[] }

const flag = <K extends string>(key: K, label: string, def: boolean, extra: { help?: string; group?: string; requires?: CapabilityId } = {}) =>
  ({ kind: "flag", key, label, default: def, ...extra }) as const

export const ACCESSIBILITY_SCHEMA = {
  general: {
    title: "General Accessibility",
    description: "Which analysis types and classification behaviours apply when the corresponding engines are available.",
    capabilities: ["standard_description", "auto_classification", "advanced_description"],
    fields: [
      {
        kind: "multi",
        key: "analysisTypes",
        label: "Advanced analysis types",
        help: "Standard image description always runs. Advanced types can be enabled once their analyzer is installed.",
        group: "Analysis types",
        options: ANALYSIS_TYPES,
        default: [],
        requiresByOption: ANALYSIS_CAPABILITY,
      },
      {
        kind: "choice",
        key: "processingPreference",
        label: "Processing preference",
        help: "Short / detailed output is still chosen per request in Generation Settings.",
        group: "Processing mode",
        options: {
          standard_only: "Standard Alt Text (current behaviour)",
          advanced_when_available: "Advanced Description when supported",
          both: "Standard Alt Text and Advanced Description",
        },
        default: "standard_only",
        requiresByOption: { advanced_when_available: "advanced_description", both: "advanced_description" },
      },
      flag("useAutoClassification", "Use supported automatic image classification", true, { group: "Auto-detection", requires: "auto_classification" }),
      flag("preferUserSelectedType", "Prefer the user-selected image type", true, {
        group: "Auto-detection",
        help: "A type chosen in Generation Settings is sent instead of Auto Detect.",
      }),
      flag("reviewUncertainClassification", "Request manual review for uncertain classification", false, {
        group: "Auto-detection",
        requires: "classification_confidence",
      }),
      flag("preserveClassificationMetadata", "Preserve original classification metadata", true, { group: "Auto-detection" }),
      flag("allowCategoryCorrection", "Allow authorized users to correct the category", true, {
        group: "Auto-detection",
        help: "Manual corrections are never overwritten by automatic classification.",
      }),
    ],
  },
  ocr: {
    title: "OCR & Text Recognition",
    description: "Recognition of text inside images. Recognition language is separate from the Alt Text output language.",
    capabilities: ["ocr", "text_heavy_analysis", "math_ocr"],
    fields: [
      flag("enabled", "OCR enabled", false, { group: "Recognition", requires: "ocr" }),
      flag("textHeavyImages", "OCR for text-heavy images", false, { group: "Recognition", requires: "ocr" }),
      flag("scientificLabels", "OCR for scientific labels", false, { group: "Recognition", requires: "ocr" }),
      flag("chartsAndGraphs", "OCR for charts and graphs", false, { group: "Recognition", requires: "ocr" }),
      flag("mathematicalImages", "OCR for mathematical images", false, { group: "Recognition", requires: "math_ocr" }),
      {
        kind: "multi",
        key: "languages",
        label: "Recognition languages",
        help: "Saved as a preference. A language is used only when its recognition pack is installed.",
        group: "Languages",
        options: OCR_LANGUAGES,
        default: ["en"],
        min: 1,
        max: 5,
      },
      {
        kind: "choice",
        key: "defaultLanguageMode",
        label: "Default recognition mode",
        help: "Used when a run does not choose a mode. A mode runs only when every language it needs is selected above and its engine passed start-up. This is the language of the text in the image, not the Alt Text output language.",
        group: "Languages",
        options: { eng: "English", hin: "Hindi", eng_hin: "English + Hindi" },
        default: "eng",
      },
      flag("keepExtractedText", "Extracted text", true, { group: "Evidence to preserve" }),
      flag("keepTextRegions", "Text-region references", true, { group: "Evidence to preserve" }),
      flag("keepSourceLanguage", "Source language", true, { group: "Evidence to preserve" }),
      flag("keepRecognizer", "Recognizer identity", true, { group: "Evidence to preserve" }),
      flag("keepConfidence", "Confidence evidence (when the recognizer reports it)", true, { group: "Evidence to preserve" }),
      flag("keepWarnings", "Warnings", true, { group: "Evidence to preserve" }),
      flag("keepManualCorrections", "Manual corrections", true, { group: "Evidence to preserve" }),
      {
        kind: "choice",
        key: "reviewPolicy",
        label: "OCR review policy",
        group: "Review",
        options: { on_warning: "Review when the recognizer reports warnings", always: "Always review OCR evidence" },
        default: "on_warning",
      },
    ],
  },
  math: {
    title: "Mathematics & Equations",
    description: "Recognition and representation of equations, symbols and geometry labels. Local syntax/MathML validation runs from equation review or the shared processing pipeline; mathematical truth requires human verification.",
    capabilities: ["math_analysis", "math_verification", "latex_output", "mathml_output"],
    fields: [
      flag("equationRecognition", "Equation recognition", false, { group: "Recognition", requires: "math_analysis" }),
      flag("symbolRecognition", "Mathematical symbol recognition", false, { group: "Recognition", requires: "math_analysis" }),
      flag("displayedEquations", "Displayed equations", false, { group: "Recognition", requires: "math_analysis" }),
      flag("inlineEquations", "Inline equations", false, { group: "Recognition", requires: "math_analysis" }),
      flag("geometryLabels", "Geometry labels", false, { group: "Recognition", requires: "math_analysis" }),
      {
        kind: "choice",
        key: "outputFormat",
        label: "Mathematical output",
        help: "The spoken description stays separate from any structured representation. Generated LaTeX is never presented as verified.",
        group: "Output",
        options: {
          plain_language: "Plain-language math description",
          latex: "LaTeX (when validated)",
          mathml: "MathML (when validated)",
          combined: "Description plus structured representation",
        },
        default: "plain_language",
        requiresByOption: { latex: "latex_output", mathml: "mathml_output", combined: "latex_output" },
      },
      flag("requireMathReview", "Require human review of mathematical content", true, { group: "Review" }),
    ],
  },
  graphs: {
    title: "Graphs & Charts",
    description: "Recognition of chart structure and the policy for any numerical data.",
    capabilities: ["chart_analysis", "chart_axes", "chart_data_extraction"],
    fields: [
      flag("graphDetection", "Graph detection", false, { group: "Recognition", requires: "chart_analysis" }),
      flag("chartTypeDetection", "Chart type detection", false, { group: "Recognition", requires: "chart_analysis" }),
      flag("axisLabels", "Axis label recognition", false, { group: "Recognition", requires: "chart_axes" }),
      flag("axisScale", "Axis scale recognition", false, { group: "Recognition", requires: "chart_axes" }),
      flag("legend", "Legend recognition", false, { group: "Recognition", requires: "chart_axes" }),
      flag("dataLabels", "Data label recognition", false, { group: "Recognition", requires: "chart_axes" }),
      flag("trendDescription", "Trend description", false, { group: "Recognition", requires: "chart_data_extraction" }),
      flag("dataExtraction", "Graph data extraction", false, { group: "Recognition", requires: "chart_data_extraction" }),
      flag("flagUncertainAxisValues", "Flag uncertain axis values", true, { group: "Data policy" }),
      flag("preserveNumericEvidence", "Preserve extracted numerical evidence", true, { group: "Data policy" }),
      flag("reviewUncertainData", "Require review for uncertain data extraction", true, { group: "Data policy" }),
      flag("preferQualitative", "Prefer qualitative descriptions when exact values are unreadable", true, { group: "Data policy" }),
    ],
  },
  science: {
    title: "Scientific Diagrams",
    description: "Subjects, notation preservation and review rules for complex scientific images.",
    capabilities: ["scientific_diagram_analysis", "scientific_domain_analysis", "flowchart_analysis", "table_image_analysis", "map_geometry_analysis"],
    fields: [
      {
        kind: "multi",
        key: "subjects",
        label: "Subjects",
        help: "Uses the existing Phase 1 subject list.",
        group: "Subjects",
        options: SCIENCE_SUBJECTS,
        default: SCIENCE_SUBJECT_KEYS,
        min: 1,
      },
      flag("terminology", "Scientific terminology", true, { group: "Preserve" }),
      flag("chemicalSymbols", "Chemical symbols", true, { group: "Preserve" }),
      flag("notation", "Mathematical notation", true, { group: "Preserve" }),
      flag("units", "Units and dimensions", true, { group: "Preserve" }),
      flag("diagramLabels", "Diagram labels", true, { group: "Preserve" }),
      flag("directions", "Directional relationships", true, { group: "Preserve" }),
      flag("components", "Component names", true, { group: "Preserve" }),
      flag("structure", "Structural relationships", true, { group: "Preserve" }),
      flag("reviewUnreadableLabels", "Require review for unreadable labels", true, { group: "Complex diagram review" }),
      flag("reviewUncertainInterpretation", "Require review for uncertain scientific interpretation", true, { group: "Complex diagram review" }),
      flag("reviewAmbiguousRelationships", "Require review for ambiguous visual relationships", true, { group: "Complex diagram review" }),
      flag("preserveSourceText", "Preserve original source text", true, { group: "Complex diagram review" }),
      flag("showEvidenceToReviewers", "Display source evidence to reviewers", true, { group: "Complex diagram review" }),
    ],
  },
  descriptions: {
    title: "Advanced Descriptions",
    description: "Short Alt Text and Detailed Description preferences. Output language and audience reuse the existing tenant defaults.",
    capabilities: ["standard_description", "advanced_description"],
    fields: [
      flag("useDocumentContext", "Use associated source document context", true, { group: "Document evidence", help: "Only bounded context from the authorized image occurrence is used. Unrelated page text is excluded." }),
      flag("includeSpeakerNotes", "Include presenter-only speaker notes", false, { group: "Document evidence", help: "Notes are untrusted context, not visible slide content. Enable only when needed for this workspace." }),
      flag("avoidRedundantPhrases", 'Avoid redundant phrases ("image of", "picture of")', true, { group: "Short Alt Text" }),
      flag("preserveExistingAlt", "Use existing alt text found in documents as a starting point", true, { group: "Short Alt Text" }),
      {
        kind: "multi",
        key: "detailedIncludes",
        label: "Detailed description should cover",
        help: "Applied only to images that need a detailed description; detailed descriptions are not required for every image.",
        group: "Detailed Description",
        options: DETAILED_DESCRIPTION_PARTS,
        default: Object.keys(DETAILED_DESCRIPTION_PARTS),
      },
    ],
  },
  quality: {
    title: "Quality & Human Review",
    description: "How uncertain analysis is surfaced and which outputs need a reviewer. Uses the existing review and approval workflow.",
    capabilities: ["advanced_qa"],
    fields: [
      flag("markLowConfidence", "Mark low-confidence analysis for review", true, {
        group: "Confidence & uncertainty",
        help: "Uses calibrated confidence only when an analyzer documents it; otherwise categorical warnings are used.",
      }),
      flag("preserveRecognitionWarnings", "Preserve recognition warnings", true, { group: "Confidence & uncertainty" }),
      flag("reviewConflictingContext", "Require review for conflicting context", true, { group: "Confidence & uncertainty" }),
      flag("reviewUnreadableScientificLabels", "Require review for unreadable scientific labels", true, { group: "Confidence & uncertainty" }),
      flag("allowManualCorrections", "Manual corrections allowed", true, { group: "Review requirements" }),
      flag("scientificAccuracyReview", "Scientific accuracy review", false, { group: "Review requirements" }),
      flag("ocrEvidenceReview", "OCR evidence review", true, { group: "Review requirements" }),
      flag("graphDataVerification", "Graph data verification", true, { group: "Review requirements" }),
    ],
  },
} as const satisfies Record<string, SectionDef>

export type AccessibilitySectionId = keyof typeof ACCESSIBILITY_SCHEMA
export const ACCESSIBILITY_SECTION_IDS = Object.keys(ACCESSIBILITY_SCHEMA) as AccessibilitySectionId[]

type FieldsOf<S extends AccessibilitySectionId> = (typeof ACCESSIBILITY_SCHEMA)[S]["fields"][number]
type ValueOf<F> = F extends { kind: "flag" }
  ? boolean
  : F extends { kind: "choice"; options: infer O }
    ? Extract<keyof O, string>
    : F extends { kind: "multi"; options: infer O }
      ? Extract<keyof O, string>[]
      : never
export type AccessibilityPreferences = {
  [S in AccessibilitySectionId]: { [F in FieldsOf<S> as F extends { key: infer K extends string } ? K : never]: ValueOf<F> }
}
export type FieldValue = boolean | string | string[]
type LoosePreferences = Record<string, Record<string, FieldValue>>
export type AccessibilityPatch = { [S in AccessibilitySectionId]?: Partial<AccessibilityPreferences[S]> }

export const ACCESSIBILITY_SCHEMA_VERSION = 1
export const MAX_ACCESSIBILITY_PATCH_BYTES = 8 * 1024

const sectionFields = (s: string): readonly AccessibilityField[] => (ACCESSIBILITY_SCHEMA as Record<string, SectionDef>)[s]?.fields ?? []
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)
const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)

export function fieldDefaultValue(field: AccessibilityField): FieldValue {
  return field.kind === "multi" ? [...field.default] : field.default
}

export function defaultAccessibilityPreferences(): AccessibilityPreferences {
  return Object.fromEntries(
    ACCESSIBILITY_SECTION_IDS.map((s) => [s, Object.fromEntries(sectionFields(s).map((f) => [f.key, fieldDefaultValue(f)]))]),
  ) as AccessibilityPreferences
}

/** Option order is the schema's, so equal selections always serialize identically. */
const orderedOptions = (field: MultiField, values: readonly string[]) => Object.keys(field.options).filter((k) => values.includes(k))

/** Returns the stored value when it is valid for the field, otherwise undefined. */
function coerceStored(field: AccessibilityField, raw: unknown): FieldValue | undefined {
  if (field.kind === "flag") return typeof raw === "boolean" ? raw : undefined
  if (field.kind === "choice") return typeof raw === "string" && has(field.options, raw) ? raw : undefined
  if (!Array.isArray(raw) || !raw.every((v) => typeof v === "string" && has(field.options, v))) return undefined
  const values = orderedOptions(field, raw as string[])
  if ((field.min && values.length < field.min) || (field.max && values.length > field.max)) return undefined
  return values
}

/**
 * Lenient read of the persisted `accessibility` JSON. Historical rows without the key, unknown keys
 * and invalid values fall back to platform defaults, so old records never fail to load.
 */
export function normalizeAccessibilityPreferences(raw: unknown): { preferences: AccessibilityPreferences; explicit: Set<string> } {
  const stored = isPlainObject(raw) ? raw : {}
  const explicit = new Set<string>()
  const preferences = {} as LoosePreferences
  for (const s of ACCESSIBILITY_SECTION_IDS) {
    const section = isPlainObject(stored[s]) ? stored[s] : {}
    preferences[s] = {}
    for (const f of sectionFields(s)) {
      const v = has(section, f.key) ? coerceStored(f, section[f.key]) : undefined
      if (v !== undefined) explicit.add(`${s}.${f.key}`)
      preferences[s][f.key] = v ?? fieldDefaultValue(f)
    }
  }
  return { preferences: preferences as AccessibilityPreferences, explicit }
}

/** Capabilities a given field value depends on (empty when the value needs no engine). */
export function requiredCapabilities(field: AccessibilityField, value: FieldValue): CapabilityId[] {
  if (field.kind === "flag") return value === true && field.requires ? [field.requires] : []
  const req = field.requiresByOption ?? {}
  const values = field.kind === "choice" ? [value as string] : (value as string[])
  return [...new Set(values.map((v) => req[v]).filter((c): c is CapabilityId => !!c))]
}

export type FieldError = { path: string; code: "UNKNOWN_FIELD" | "INVALID_TYPE" | "INVALID_OPTION" | "OUT_OF_RANGE" | "CAPABILITY_UNAVAILABLE"; message: string }

/**
 * Strict validation of an untrusted settings patch: unknown sections/fields, wrong types, invalid
 * options and attempts to enable unavailable capabilities are all rejected (never coerced).
 */
export function validateAccessibilityPatch(
  raw: unknown,
  capabilities: Record<CapabilityId, CapabilityState>,
): { ok: true; patch: AccessibilityPatch } | { ok: false; errors: FieldError[] } {
  if (!isPlainObject(raw)) return { ok: false, errors: [{ path: "accessibility", code: "INVALID_TYPE", message: "Accessibility settings must be an object." }] }
  const errors: FieldError[] = []
  const patch: LoosePreferences = {}
  for (const [s, sectionRaw] of Object.entries(raw)) {
    if (!has(ACCESSIBILITY_SCHEMA, s)) {
      errors.push({ path: s, code: "UNKNOWN_FIELD", message: `Unknown settings section "${s}".` })
      continue
    }
    if (!isPlainObject(sectionRaw)) {
      errors.push({ path: s, code: "INVALID_TYPE", message: "Section must be an object." })
      continue
    }
    const fields = new Map(sectionFields(s).map((f) => [f.key, f]))
    for (const [key, value] of Object.entries(sectionRaw)) {
      const path = `${s}.${key}`
      const field = fields.get(key)
      if (!field) {
        errors.push({ path, code: "UNKNOWN_FIELD", message: `Unknown setting "${path}".` })
        continue
      }
      const err = validateValue(field, value)
      if (err) {
        errors.push({ path, ...err })
        continue
      }
      const normalized = field.kind === "multi" ? orderedOptions(field, value as string[]) : (value as FieldValue)
      const blocked = requiredCapabilities(field, normalized).filter((c) => capabilities[c].status !== "available")
      if (blocked.length) {
        const c = capabilities[blocked[0]]
        errors.push({ path, code: "CAPABILITY_UNAVAILABLE", message: `${c.label} is ${CAPABILITY_STATUSES[c.status].label.toLowerCase()}. ${c.reason ?? ""}`.trim() })
        continue
      }
      ;(patch[s] ??= {})[key] = normalized
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, patch: patch as AccessibilityPatch }
}

function validateValue(field: AccessibilityField, value: unknown): Omit<FieldError, "path"> | null {
  if (field.kind === "flag") return typeof value === "boolean" ? null : { code: "INVALID_TYPE", message: `${field.label} must be true or false.` }
  if (field.kind === "choice") {
    if (typeof value !== "string") return { code: "INVALID_TYPE", message: `${field.label} must be a string.` }
    return has(field.options, value) ? null : { code: "INVALID_OPTION", message: `"${value}" is not a valid option for ${field.label}.` }
  }
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) return { code: "INVALID_TYPE", message: `${field.label} must be a list of options.` }
  const invalid = value.find((v) => !has(field.options, v))
  if (invalid !== undefined) return { code: "INVALID_OPTION", message: `"${invalid}" is not a valid option for ${field.label}.` }
  if (new Set(value).size !== value.length) return { code: "INVALID_OPTION", message: `${field.label} contains duplicates.` }
  if (field.min && value.length < field.min) return { code: "OUT_OF_RANGE", message: `Select at least ${field.min} for ${field.label}.` }
  if (field.max && value.length > field.max) return { code: "OUT_OF_RANGE", message: `Select at most ${field.max} for ${field.label}.` }
  return null
}

/** Applies a validated patch; untouched sections and fields keep their current values. */
export function mergeAccessibilityPreferences(current: AccessibilityPreferences, patch: AccessibilityPatch): AccessibilityPreferences {
  const next = structuredClone(current) as unknown as LoosePreferences
  for (const [s, values] of Object.entries(patch as LoosePreferences)) Object.assign(next[s], values)
  return next as unknown as AccessibilityPreferences
}

/** Field paths whose values differ between two preference sets. */
export function changedAccessibilityFields(a: AccessibilityPreferences, b: AccessibilityPreferences): string[] {
  const la = a as unknown as LoosePreferences
  const lb = b as unknown as LoosePreferences
  return ACCESSIBILITY_SECTION_IDS.flatMap((s) =>
    sectionFields(s)
      .filter((f) => JSON.stringify(la[s][f.key]) !== JSON.stringify(lb[s][f.key]))
      .map((f) => `${s}.${f.key}`),
  )
}

/* ───────────────────────── Policies ───────────────────────── */

/** Platform safeguards: always active and not configurable by any scope. */
export const PLATFORM_SAFEGUARDS = [
  { id: "no_auto_approve", label: "AI output is never approved automatically." },
  { id: "approved_only_insertion", label: "Only approved descriptions are inserted into exported documents." },
  { id: "no_silent_replacement", label: "Approved descriptions are never replaced silently; regeneration creates a new version for review." },
  { id: "visible_data_only", label: "Describe only reliably visible data and never extrapolate missing chart values." },
  { id: "no_fabricated_confidence", label: "Confidence is shown only when an analyzer returns it; no percentages are invented." },
  { id: "language_separation", label: "OCR recognition language is independent of the Alt Text output language." },
  { id: "no_conformance_claim", label: "Passing checks does not claim WCAG or PDF/UA conformance." },
] as const

/** Deterministic checks that already run in Output Validation (lib/alt-text/output-validation.ts). */
export const ACTIVE_QA_CHECKS = [
  { id: "missing_alt", label: "Missing alt text" },
  { id: "empty_nondecorative", label: "Empty text on non-decorative images" },
  { id: "placeholder", label: "Suspicious placeholder text or file names" },
  { id: "length", label: "Short description length (tenant limit)" },
] as const

export const ADVANCED_QA_CHECKS = [
  { id: "ocr_warnings", label: "Unresolved OCR warnings" },
  { id: "unverified_equations", label: "Unverified equations" },
  { id: "ambiguous_graph_data", label: "Ambiguous graph data" },
  { id: "scientific_labels", label: "Unresolved scientific labels" },
] as const

/* ───────────────────────── Resolver ───────────────────────── */

export type SettingSource = "platform_default" | "tenant" | "capability_unavailable"

export type EffectiveAccessibilitySettings = {
  schemaVersion: number
  revision: number
  /** What the tenant has configured (or platform defaults). */
  configured: AccessibilityPreferences
  /** What engines may actually use: gated values are forced off when their capability is unavailable. */
  effective: AccessibilityPreferences
  sources: Record<string, { source: SettingSource; blockedBy: CapabilityId[] }>
  capabilities: Record<CapabilityId, CapabilityState>
  ocrLanguages: { code: OcrLanguage; label: string; configured: boolean; packInstalled: boolean }[]
  outputLanguage: AltTextSettings["defaultLanguage"]
  mandatory: { id: string; label: string; source: "platform" | "tenant"; active: boolean }[]
  guideline: { status: "none"|"active"; reference: {id:string;version:number;clientName:string}|null; message: string }
  scopes: { supported: ("platform_default" | "tenant")[]; unsupported: { scope: string; reason: string }[] }
}

/** The single resolution path for accessibility settings. Frontend tabs and future engines both read its output. */
export function resolveEffectiveAccessibilitySettings(ctx: {
  storedAccessibility: unknown
  clientGuideline?:unknown
  revision: number
  tenant: Pick<AltTextSettings, "requireReview" | "defaultLanguage">
  backend: AccessibilityBackend
}): EffectiveAccessibilitySettings {
  const capabilities = deriveCapabilityStates(ctx.backend)
  const guideline=normalizeClientGuideline(ctx.clientGuideline)
  const { preferences: configured, explicit } = normalizeAccessibilityPreferences(ctx.storedAccessibility)
  const effective = structuredClone(configured) as unknown as LoosePreferences
  const sources: EffectiveAccessibilitySettings["sources"] = {}

  for (const s of ACCESSIBILITY_SECTION_IDS) {
    for (const f of sectionFields(s)) {
      const path = `${s}.${f.key}`
      const value = effective[s][f.key]
      const blockedBy = requiredCapabilities(f, value).filter((c) => capabilities[c].status !== "available")
      if (blockedBy.length) {
        effective[s][f.key] =
          f.kind === "flag"
            ? false
            : f.kind === "choice"
              ? f.default
              : (value as string[]).filter((v) => !requiredCapabilities(f, [v]).some((c) => blockedBy.includes(c)))
      }
      sources[path] = { source: blockedBy.length ? "capability_unavailable" : explicit.has(path) ? "tenant" : "platform_default", blockedBy }
    }
  }

  const packs = new Set(ctx.backend.ocrLanguagePacks)
  const ocrConfigured = configured.ocr.languages as string[]
  effective.ocr.languages = (effective.ocr.languages as string[]).filter((l) => packs.has(l))
  if (!(effective.ocr.languages as string[]).length) effective.ocr.enabled = false

  return {
    schemaVersion: ACCESSIBILITY_SCHEMA_VERSION,
    revision: ctx.revision,
    configured,
    effective: effective as unknown as AccessibilityPreferences,
    sources,
    capabilities,
    ocrLanguages: (Object.keys(OCR_LANGUAGES) as OcrLanguage[]).map((code) => ({
      code,
      label: OCR_LANGUAGES[code],
      configured: ocrConfigured.includes(code),
      packInstalled: packs.has(code),
    })),
    outputLanguage: ctx.tenant.defaultLanguage,
    mandatory: [
      ...PLATFORM_SAFEGUARDS.map((g) => ({ id: g.id, label: g.label, source: "platform" as const, active: true })),
      { id: "tenant_require_review", label: "Human review is required before AI output is approved.", source: "tenant", active: ctx.tenant.requireReview },
    ],
    guideline: {
      status: guideline.enabled?"active":"none",
      reference:guideline.enabled?{id:"tenant-client-guideline",version:guideline.version,clientName:guideline.clientName}:null,
      message:guideline.enabled?`Client policy for ${guideline.clientName}, version ${guideline.version}, applies as the tenant default to new generation and QA. Source evidence and mandatory review take priority.`:"Client guidelines are optional. No guideline is applied, so tenant settings and platform defaults are used.",
    },
    scopes: {
      supported: ["platform_default", "tenant"],
      unsupported: [
        { scope: "project", reason: "Projects do not carry Alt Text settings in this ERP." },
        { scope: "batch_and_image", reason: "Batch and image overrides apply to per-request generation settings only." },
      ],
    },
  }
}

/* ───────────────────────── Job snapshot ───────────────────────── */

export type AccessibilitySettingsSnapshot = {
  schemaVersion: number
  settingsRevision: number
  modelId: string | null
  outputLanguage: string
  analysisTypes: string[]
  ocr: { enabled: boolean; languages: string[]; defaultLanguageMode: string | null }
  mathOutput: string
  guidelineVersion: string|null
  reviewPolicy: {
    requireReview: boolean
    ocrReview: string
    mathReview: boolean
    scientificAccuracyReview: boolean
    graphDataVerification: boolean
  }
}

/**
 * Immutable copy of the effective settings a job ran with. A plain JSON value so it can be stored
 * alongside an existing batch/job record; later settings changes never alter it.
 */
export function accessibilitySnapshot(resolved: EffectiveAccessibilitySettings, extras: { modelId: string | null; requireReview: boolean }): AccessibilitySettingsSnapshot {
  const e = resolved.effective
  const snapshot: AccessibilitySettingsSnapshot = {
    schemaVersion: resolved.schemaVersion,
    settingsRevision: resolved.revision,
    modelId: extras.modelId,
    outputLanguage: resolved.outputLanguage,
    analysisTypes: [...e.general.analysisTypes],
    ocr: { enabled: e.ocr.enabled, languages: e.ocr.enabled ? [...e.ocr.languages] : [], defaultLanguageMode: e.ocr.enabled ? e.ocr.defaultLanguageMode : null },
    mathOutput: e.math.outputFormat,
    guidelineVersion:resolved.guideline.reference?String(resolved.guideline.reference.version):null,
    reviewPolicy: {
      requireReview: extras.requireReview,
      ocrReview: e.ocr.reviewPolicy,
      mathReview: e.math.requireMathReview,
      scientificAccuracyReview: e.quality.scientificAccuracyReview,
      graphDataVerification: e.quality.graphDataVerification,
    },
  }
  return JSON.parse(JSON.stringify(snapshot)) as AccessibilitySettingsSnapshot
}
