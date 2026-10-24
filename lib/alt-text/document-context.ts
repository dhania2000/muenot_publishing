/**
 * @file lib/alt-text/document-context.ts
 * @module Publishing · Alt Text
 * @kind Browser-safe contract + pure logic
 * @summary Phase 3 Task 9 — shared document-image context model and the deterministic builder
 *   that turns format-specific *evidence* (PDF / PPTX / DOCX readers) into a bounded, provenance-
 *   tagged context. Every value is either copied from the document, taken from user settings, or
 *   deterministically derived — never invented. All document text is untrusted evidence: it is
 *   stored and displayed as data and must be wrapped as delimited source material by Task 12.
 */

export const DOCUMENT_CONTEXT_VERSION = 1

/** Interpretable heuristic tiers. NOT a calibrated probability. */
export type ContextConfidence = "high" | "medium" | "low" | "unavailable"
export const CONTEXT_CONFIDENCE_LABEL: Record<ContextConfidence, string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
  unavailable: "Unavailable",
}

/**
 * explicit    — the document itself links this text to the image (struct Caption child, cell, anchor paragraph, picture alt)
 * structural  — document structure places it in the image's scope (heading hierarchy, slide title placeholder)
 * settings    — user-provided ERP / document settings
 * derived     — deterministic rule over structure (caption-styled adjacent paragraph, adjacent paragraph)
 * approximate — geometric or proximity heuristic; may be unrelated
 */
export type ContextProvenance = "explicit" | "structural" | "settings" | "derived" | "approximate"

export type ContextSourceRef = {
  /** e.g. `pdf_struct`, `pdf_text_block`, `pptx_shape`, `pptx_notes`, `docx_paragraph`, `docx_table_cell`, `image_metadata`, `settings`. */
  kind: string
  /** Stable, document-local reference (struct ref, shape id, paragraph path). Never a storage key. */
  ref: string | null
}

export type ContextText = {
  text: string
  truncated: boolean
  provenance: ContextProvenance
  confidence: ContextConfidence
  /** Association rule that produced it, e.g. `pdf_struct_caption_child`, `spatial_below`. */
  method: string
  source: ContextSourceRef
}

export type ContextHeading = ContextText & { level: number | null }

export type CaptionSource = "explicit_relationship" | "accessible_structure" | "caption_style" | "shape_metadata" | "proximity"
export type ContextCaption = ContextText & { label: string | null; captionSource: CaptionSource }

export type ContextTable = {
  tableId: string
  row: number | null
  column: number | null
  caption: string | null
  headerCells: string[]
  cellText: string | null
  rowLabel: string | null
  provenance: ContextProvenance
  source: ContextSourceRef
  truncated: boolean
}

export type ContextWarningCode =
  | "CAPTION_SHARED"
  | "CAPTION_CANDIDATES_CONFLICT"
  | "ALT_CAPTION_DIFFER"
  | "MULTIPLE_IMAGES_NEARBY"
  | "MULTI_COLUMN_LAYOUT"
  | "BETWEEN_PARAGRAPHS"
  | "FLOATING_IMAGE_ANCHOR"
  | "HEADER_FOOTER_IMAGE"
  | "UNTAGGED_PDF"
  | "TEXT_UNREADABLE"
  | "READING_ORDER_UNVERIFIED"
  | "GEOMETRY_UNAVAILABLE"
  | "INSTRUCTION_LIKE_TEXT"
  | "CONTEXT_TRUNCATED"
  | "NO_CONTEXT"

export type ContextWarning = { code: ContextWarningCode; message: string }

export type DocumentImageContext = {
  version: typeof DOCUMENT_CONTEXT_VERSION
  documentId: number
  imageOccurrenceId: number
  documentType: "pdf" | "pptx" | "docx"
  documentTitle: ContextText | null
  location: { page: number | null; slide: number | null; paragraph: string | null; part: string | null; label: string | null }
  /** Heading chain, outermost (chapter) first. */
  headings: ContextHeading[]
  chapter: ContextHeading | null
  sectionHeading: ContextHeading | null
  /** Slide title / page title when the format exposes one. */
  pageTitle: ContextText | null
  subtitle: ContextText | null
  sectionName: ContextText | null
  caption: ContextCaption | null
  nearbyText: ContextText[]
  /** Short labels positioned on/next to the image (PPTX text boxes, PDF short text). */
  labels: ContextText[]
  table: ContextTable | null
  /** Presenter-only text; never displayed slide content. */
  speakerNotes: ContextText | null
  /** Author alt text read from the source. Preserved verbatim; never overwritten or approved. */
  existingAltText: { text: string; source: ContextSourceRef } | null
  readingOrder: { index: number | null; basis: string; verified: boolean }
  settings: { outputLanguage: string | null; targetAudience: string | null; subject: string | null; grade: string | null; topic: string | null }
  /** Unicode scripts present in the context, e.g. `["Latin", "Devanagari"]`. Text is never translated. */
  scripts: string[]
  confidence: ContextConfidence
  warnings: ContextWarning[]
  /** Always true: Task 12 must treat every text field as delimited, untrusted document data. */
  untrustedSource: true
}

export const CONTEXT_STATUSES = ["analyzed", "unavailable", "failed"] as const
export type ContextStatus = (typeof CONTEXT_STATUSES)[number]
export const isContextStatus = (v: unknown): v is ContextStatus => typeof v === "string" && (CONTEXT_STATUSES as readonly string[]).includes(v)

/** Per-source limits (characters, after normalization). Override per call through `buildDocumentImageContext`. */
export const CONTEXT_LIMITS = {
  titleChars: 200,
  headingChars: 200,
  maxHeadings: 4,
  captionChars: 400,
  nearbyItemChars: 400,
  nearbyItems: 4,
  nearbyTotalChars: 1200,
  labelChars: 80,
  labels: 8,
  notesChars: 600,
  tableCellChars: 240,
  tableHeaders: 8,
  altChars: 2000,
  /** Hard ceiling for the serialized context (bytes of JSON). */
  maxJsonBytes: 16_384,
} as const
export type ContextLimits = { [K in keyof typeof CONTEXT_LIMITS]: number }

// ─── Text normalization ──────────────────────────────────────────────────────

// C0/C1 controls (except tab/newline) and bidi embedding/override/isolate controls. ZWJ/ZWNJ are kept (Indic shaping).
const UNSAFE_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\ufeff]/g

/** NFC, strip unsafe control characters, collapse whitespace. Never transliterates or drops scripts. */
export function normalizeContextText(raw: string | null | undefined): string {
  if (!raw) return ""
  return raw
    .normalize("NFC")
    .replace(UNSAFE_CHARS, "")
    .replace(/[ \t\u00a0\u2000-\u200a\u3000]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim()
}

const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null

/**
 * Bound text to `max` characters without splitting a grapheme cluster, and preferably at a
 * whitespace boundary so tokens such as `H₂SO₄`, `∫₀¹ f(x) dx` or `9.8 m/s²` stay intact.
 */
export function boundText(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false }
  let cut = 0
  if (segmenter) {
    for (const { index, segment } of segmenter.segment(text)) {
      if (index + segment.length > max - 1) break
      cut = index + segment.length
    }
  } else {
    cut = max - 1
    const code = text.charCodeAt(cut - 1)
    if (code >= 0xd800 && code <= 0xdbff) cut--
  }
  const space = text.lastIndexOf(" ", cut)
  if (space > max * 0.6) cut = space
  return { text: `${text.slice(0, cut).trimEnd()}…`, truncated: true }
}

const SCRIPT_TESTS: [string, RegExp][] = [
  ["Latin", /\p{Script=Latin}/u],
  ["Devanagari", /\p{Script=Devanagari}/u],
  ["Bengali", /\p{Script=Bengali}/u],
  ["Tamil", /\p{Script=Tamil}/u],
  ["Telugu", /\p{Script=Telugu}/u],
  ["Gujarati", /\p{Script=Gujarati}/u],
  ["Gurmukhi", /\p{Script=Gurmukhi}/u],
  ["Kannada", /\p{Script=Kannada}/u],
  ["Malayalam", /\p{Script=Malayalam}/u],
  ["Arabic", /\p{Script=Arabic}/u],
  ["Cyrillic", /\p{Script=Cyrillic}/u],
  ["Greek", /\p{Script=Greek}/u],
  ["Han", /\p{Script=Han}/u],
]
export function detectScripts(texts: string[]): string[] {
  const joined = texts.join(" ")
  return SCRIPT_TESTS.filter(([, re]) => re.test(joined)).map(([name]) => name)
}

/** Caption label at the start of text: Figure 1, Fig. 2a, Diagram 3, Chart 1.2, चित्र ४, आकृति 5. */
const FIGURE_LABEL_RE =
  /^\s*((?:figure|fig\.?|diagram|chart|graph|plate|illustration|exhibit|scheme|map|photo|चित्र|आकृति|रेखाचित्र|चार्ट)\s*[0-9\u0966-\u096f]+[a-z]?(?:[.\-–][0-9\u0966-\u096f]+)*)\s*[:.\-–)]?/iu
const TABLE_LABEL_RE = /^\s*((?:table|tab\.|तालिका|सारणी)\s*[0-9\u0966-\u096f]+(?:[.\-–][0-9\u0966-\u096f]+)*)/iu

export function figureLabel(text: string): string | null {
  return FIGURE_LABEL_RE.exec(text)?.[1].replace(/\s+/g, " ") ?? null
}
export function tableLabel(text: string): string | null {
  return TABLE_LABEL_RE.exec(text)?.[1].replace(/\s+/g, " ") ?? null
}

/** Text that reads like an instruction to an AI system. Flagged only; it is kept as plain data. */
const INSTRUCTION_RE =
  /\b(ignore (all|any|the)? ?(previous|prior|above) (instructions|prompts?)|disregard (the )?(system|previous)|you are (now )?(an?|the) (ai|assistant|model)|system prompt|developer message|act as (an?|the) )/i
export const looksLikeInstruction = (text: string) => INSTRUCTION_RE.test(text)

const key = (s: string) => s.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim()

function wordSet(s: string): Set<string> {
  return new Set(key(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2))
}

// ─── Evidence (format readers → builder) ─────────────────────────────────────

export type EvidenceText = { text: string; method: string; source: ContextSourceRef; provenance: ContextProvenance }

/** Lower rank wins. Matches the Task 9 caption priority list. */
export const CAPTION_RANK: Record<CaptionSource, number> = {
  explicit_relationship: 1,
  accessible_structure: 2,
  caption_style: 3,
  shape_metadata: 4,
  proximity: 5,
}

export type CaptionCandidate = EvidenceText & { captionSource: CaptionSource; /** Number of image occurrences this same candidate is associated with. */ sharedWith: number }

/** `relation` drives deterministic confidence; `distance` orders candidates within a relation (smaller = closer). */
export type NearbyRelation = "same_cell" | "anchor_paragraph" | "adjacent_paragraph" | "same_section" | "spatial_adjacent" | "same_page"
export type NearbyCandidate = EvidenceText & { relation: NearbyRelation; distance: number }

export type ContextEvidence = {
  documentTitle?: EvidenceText | null
  headings?: (EvidenceText & { level: number | null })[]
  pageTitle?: EvidenceText | null
  subtitle?: EvidenceText | null
  sectionName?: EvidenceText | null
  captions?: CaptionCandidate[]
  nearby?: NearbyCandidate[]
  labels?: (EvidenceText & { distance: number })[]
  table?: (Omit<ContextTable, "truncated">) | null
  speakerNotes?: EvidenceText | null
  existingAlt?: { text: string; source: ContextSourceRef } | null
  location?: Partial<DocumentImageContext["location"]>
  readingOrder?: DocumentImageContext["readingOrder"]
  warnings?: ContextWarning[]
}

export type ContextSettingsInput = {
  outputLanguage?: string | null
  targetAudience?: string | null
  subject?: string | null
  grade?: string | null
  topic?: string | null
  /** User-entered document title (alt_text_documents.document_title). Takes precedence over document metadata. */
  documentTitle?: string | null
}

const RELATION_CONFIDENCE: Record<NearbyRelation, ContextConfidence> = {
  same_cell: "high",
  anchor_paragraph: "high",
  adjacent_paragraph: "medium",
  same_section: "low",
  spatial_adjacent: "low",
  same_page: "low",
}
const RELATION_ORDER: Record<NearbyRelation, number> = { same_cell: 0, anchor_paragraph: 1, adjacent_paragraph: 2, spatial_adjacent: 3, same_section: 4, same_page: 5 }

const CAPTION_CONFIDENCE = (c: CaptionCandidate): ContextConfidence => {
  const rank = CAPTION_RANK[c.captionSource]
  if (c.sharedWith > 1) return rank <= 2 ? "medium" : "low"
  return rank <= 2 ? "high" : rank <= 4 ? "medium" : "low"
}

const PROVENANCE_CONFIDENCE: Record<ContextProvenance, ContextConfidence> = {
  explicit: "high",
  structural: "high",
  settings: "high",
  derived: "medium",
  approximate: "low",
}

const clean = (s: string | null | undefined) => {
  const t = normalizeContextText(s)
  return t.length ? t : null
}

const TIER: ContextConfidence[] = ["unavailable", "low", "medium", "high"]
const maxTier = (a: ContextConfidence, b: ContextConfidence) => (TIER.indexOf(a) >= TIER.indexOf(b) ? a : b)

export type BuildContextInput = {
  documentId: number
  imageOccurrenceId: number
  documentType: DocumentImageContext["documentType"]
  evidence: ContextEvidence
  settings?: ContextSettingsInput
  limits?: Partial<ContextLimits>
}

/**
 * Deterministic: the same evidence, settings and limits always produce the same context.
 * Order of preference — explicit > structural > derived > approximate — then closeness.
 */
export function buildDocumentImageContext(input: BuildContextInput): DocumentImageContext {
  const L: ContextLimits = { ...CONTEXT_LIMITS, ...input.limits }
  const ev = input.evidence
  const warnings: ContextWarning[] = [...(ev.warnings ?? [])]
  const warn = (code: ContextWarningCode, message: string) => {
    if (!warnings.some((w) => w.code === code)) warnings.push({ code, message })
  }
  let truncatedAny = false
  const used = new Set<string>()

  const toText = (e: EvidenceText | null | undefined, max: number, confidence?: ContextConfidence): ContextText | null => {
    const t = clean(e?.text)
    if (!e || !t) return null
    const b = boundText(t, max)
    truncatedAny ||= b.truncated
    if (looksLikeInstruction(t)) warn("INSTRUCTION_LIKE_TEXT", "Some document text reads like instructions. It is kept as untrusted document data only.")
    return { text: b.text, truncated: b.truncated, provenance: e.provenance, confidence: confidence ?? PROVENANCE_CONFIDENCE[e.provenance], method: e.method, source: e.source }
  }

  const userTitle = clean(input.settings?.documentTitle)
  const documentTitle = userTitle
    ? toText({ text: userTitle, method: "document_settings", source: { kind: "settings", ref: "document_title" }, provenance: "settings" }, L.titleChars)
    : toText(ev.documentTitle, L.titleChars)

  const headings: ContextHeading[] = []
  for (const h of (ev.headings ?? []).slice(-L.maxHeadings)) {
    const t = toText(h, L.headingChars)
    if (!t || used.has(key(t.text))) continue
    used.add(key(t.text))
    headings.push({ ...t, level: h.level })
  }
  const pageTitle = toText(ev.pageTitle, L.headingChars)
  if (pageTitle) used.add(key(pageTitle.text))
  const subtitle = toText(ev.subtitle, L.headingChars)
  if (subtitle) used.add(key(subtitle.text))
  const sectionName = toText(ev.sectionName, L.headingChars)

  // Captions: best rank, then not shared, then evidence order. Never merged.
  let caption: ContextCaption | null = null
  const candidates = (ev.captions ?? []).filter((c) => clean(c.text))
  if (candidates.length) {
    const sorted = [...candidates].sort((a, b) => CAPTION_RANK[a.captionSource] - CAPTION_RANK[b.captionSource] || a.sharedWith - b.sharedWith)
    const best = sorted[0]
    const t = toText(best, L.captionChars, CAPTION_CONFIDENCE(best))
    if (t) {
      caption = { ...t, label: figureLabel(t.text), captionSource: best.captionSource }
      used.add(key(clean(best.text)!))
      if (best.sharedWith > 1) warn("CAPTION_SHARED", `This caption is equally close to ${best.sharedWith} images; it may describe another image.`)
      const rival = sorted.find((c) => c !== best && key(clean(c.text)!) !== key(clean(best.text)!) && CAPTION_RANK[c.captionSource] === CAPTION_RANK[best.captionSource])
      if (rival) warn("CAPTION_CANDIDATES_CONFLICT", "More than one caption candidate was found with the same evidence strength; the first in document order is shown.")
    }
  }

  const nearbyText: ContextText[] = []
  let nearbyBudget = L.nearbyTotalChars
  const nearby = [...(ev.nearby ?? [])].sort((a, b) => RELATION_ORDER[a.relation] - RELATION_ORDER[b.relation] || a.distance - b.distance)
  for (const n of nearby) {
    if (nearbyText.length >= L.nearbyItems || nearbyBudget <= 40) break
    const t0 = clean(n.text)
    if (!t0 || used.has(key(t0))) continue
    const t = toText(n, Math.min(L.nearbyItemChars, nearbyBudget), RELATION_CONFIDENCE[n.relation])
    if (!t) continue
    used.add(key(t0))
    nearbyBudget -= t.text.length
    nearbyText.push(t)
  }
  if (nearbyText.length < nearby.length && nearby.length > L.nearbyItems) truncatedAny = true

  const labels: ContextText[] = []
  for (const l of [...(ev.labels ?? [])].sort((a, b) => a.distance - b.distance)) {
    if (labels.length >= L.labels) break
    const t0 = clean(l.text)
    if (!t0 || used.has(key(t0))) continue
    const t = toText(l, L.labelChars)
    if (!t) continue
    used.add(key(t0))
    labels.push(t)
  }

  let table: ContextTable | null = null
  if (ev.table) {
    const cell = clean(ev.table.cellText)
    const cellB = cell ? boundText(cell, L.tableCellChars) : null
    const headers = ev.table.headerCells.map((h) => clean(h)).filter((h): h is string => !!h)
    const headerB = headers.slice(0, L.tableHeaders).map((h) => boundText(h, L.labelChars))
    const rowLabel = clean(ev.table.rowLabel)
    const tcap = clean(ev.table.caption)
    const truncated = !!cellB?.truncated || headers.length > L.tableHeaders || headerB.some((h) => h.truncated)
    truncatedAny ||= truncated
    table = {
      ...ev.table,
      cellText: cellB?.text ?? null,
      headerCells: headerB.map((h) => h.text),
      rowLabel: rowLabel ? boundText(rowLabel, L.labelChars).text : null,
      caption: tcap ? boundText(tcap, L.captionChars).text : null,
      truncated,
    }
  }

  const speakerNotes = toText(ev.speakerNotes, L.notesChars)

  const altRaw = clean(ev.existingAlt?.text)
  // Existing alt text is copied verbatim (NFC only, no truncation below the source limit) and never modified.
  const existingAltText = altRaw && ev.existingAlt ? { text: altRaw.slice(0, L.altChars), source: ev.existingAlt.source } : null
  if (existingAltText && caption) {
    const a = wordSet(existingAltText.text)
    const c = wordSet(caption.text)
    const overlap = [...a].some((w) => c.has(w))
    if (a.size > 0 && c.size > 0 && !overlap) warn("ALT_CAPTION_DIFFER", "The existing alt text and the caption share no terms. Both are kept for review; neither was changed.")
  }
  if (truncatedAny) warn("CONTEXT_TRUNCATED", "Some context was shortened to stay within limits.")

  const s = input.settings ?? {}
  const settings = {
    outputLanguage: clean(s.outputLanguage),
    targetAudience: clean(s.targetAudience),
    subject: clean(s.subject),
    grade: clean(s.grade),
    topic: clean(s.topic),
  }

  // Overall tier = strongest image-specific evidence. Headings/titles alone cap at medium (they describe scope, not the image).
  let confidence: ContextConfidence = "unavailable"
  if (caption) confidence = maxTier(confidence, caption.confidence)
  if (table?.cellText || table?.headerCells.length) confidence = maxTier(confidence, table.provenance === "explicit" ? "high" : "medium")
  for (const n of nearbyText) confidence = maxTier(confidence, n.confidence)
  for (const l of labels) confidence = maxTier(confidence, l.confidence)
  if (existingAltText) confidence = maxTier(confidence, "medium")
  if (headings.length || pageTitle) confidence = maxTier(confidence, headings.some((h) => h.provenance === "approximate") && !pageTitle ? "low" : "medium")
  if (confidence === "unavailable") warn("NO_CONTEXT", "No document text could be reliably associated with this image.")

  const scripts = detectScripts([
    documentTitle?.text ?? "",
    ...headings.map((h) => h.text),
    pageTitle?.text ?? "",
    caption?.text ?? "",
    ...nearbyText.map((n) => n.text),
    ...labels.map((l) => l.text),
    table?.cellText ?? "",
    existingAltText?.text ?? "",
  ])

  const ctx: DocumentImageContext = {
    version: DOCUMENT_CONTEXT_VERSION,
    documentId: input.documentId,
    imageOccurrenceId: input.imageOccurrenceId,
    documentType: input.documentType,
    documentTitle,
    location: { page: null, slide: null, paragraph: null, part: null, label: null, ...ev.location },
    headings,
    chapter: headings.length > 1 ? headings[0] : null,
    sectionHeading: headings.length ? headings[headings.length - 1] : null,
    pageTitle,
    subtitle,
    sectionName,
    caption,
    nearbyText,
    labels,
    table,
    speakerNotes,
    existingAltText,
    readingOrder: ev.readingOrder ?? { index: null, basis: "unknown", verified: false },
    settings,
    scripts,
    confidence,
    warnings,
    untrustedSource: true,
  }
  return enforceJsonBudget(ctx, L.maxJsonBytes)
}

/** Drop lowest-priority material until the serialized context fits. Captions, headings and alt text are kept last. */
function enforceJsonBudget(ctx: DocumentImageContext, maxBytes: number): DocumentImageContext {
  const size = () => new TextEncoder().encode(JSON.stringify(ctx)).length
  if (size() <= maxBytes) return ctx
  const note = () => {
    if (!ctx.warnings.some((w) => w.code === "CONTEXT_TRUNCATED")) ctx.warnings.push({ code: "CONTEXT_TRUNCATED", message: "Some context was shortened to stay within limits." })
  }
  note()
  while (size() > maxBytes && ctx.nearbyText.length) ctx.nearbyText.pop()
  while (size() > maxBytes && ctx.labels.length) ctx.labels.pop()
  if (size() > maxBytes) ctx.speakerNotes = null
  if (size() > maxBytes && ctx.table) ctx.table = { ...ctx.table, headerCells: [], cellText: ctx.table.cellText ? boundText(ctx.table.cellText, 80).text : null }
  if (size() > maxBytes && ctx.existingAltText) ctx.existingAltText = { ...ctx.existingAltText, text: boundText(ctx.existingAltText.text, 500).text }
  return ctx
}

/** Validate a stored context before returning it (rejects legacy / tampered JSON). */
export function parseStoredContext(v: unknown): DocumentImageContext | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null
  const c = v as Partial<DocumentImageContext>
  if (c.version !== DOCUMENT_CONTEXT_VERSION || typeof c.imageOccurrenceId !== "number" || !Array.isArray(c.warnings) || !Array.isArray(c.headings) || !Array.isArray(c.nearbyText)) return null
  return c as DocumentImageContext
}

// ─── Geometry helpers shared by the PDF and PPTX evidence builders ───────────

/** Axis-aligned box in a top-left, y-down space (any unit). */
export type Box = { x0: number; y0: number; x1: number; y1: number }
export const boxWidth = (b: Box) => b.x1 - b.x0
export const boxHeight = (b: Box) => b.y1 - b.y0
export const horizontalOverlap = (a: Box, b: Box) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0))
export const verticalOverlap = (a: Box, b: Box) => Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0))
/** Edge-to-edge distance (0 when overlapping). */
export function boxDistance(a: Box, b: Box): number {
  const dx = Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1))
  const dy = Math.max(0, Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1))
  return Math.hypot(dx, dy)
}
