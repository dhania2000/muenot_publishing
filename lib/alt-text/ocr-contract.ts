/**
 * @file lib/alt-text/ocr-contract.ts
 * @module Publishing · Alt Text
 * @kind Shared (pure) library
 * @summary Phase 3 Task 5 — OCR result contract, statuses, request parsing, text normalisation and
 *   layout bounding. Pure: no engine, database or network access, so it is safe to unit test and to
 *   import from client components for types.
 *
 * OCR output is evidence for a human or a later description step. It is never an approved Alt Text
 * description and never marks review as complete.
 */
import type { NormalizedBox, RegionType } from "./region-analysis"

/** 1 = Task 5 (English only). 2 = Task 6 (language modes, script hints, paragraph evidence, NFC normalised text). */
export const OCR_SCHEMA_VERSION = 2
export const OCR_PROVIDER_ID = "tesseract_js"
export const OCR_PROVIDER_LABEL = "Tesseract.js (self-hosted)"

/** ISO 639-1 languages with an installed, integrity-checked pack (see ocr-engine OCR_LANGUAGE_PACKS). */
export const OCR_IMPLEMENTED_LANGUAGES = ["en", "hi"] as const
export type OcrImplementedLanguage = (typeof OCR_IMPLEMENTED_LANGUAGES)[number]

/**
 * Explicit recognition language modes (Task 6). `tesseract` is the exact language list handed to the
 * engine, in priority order. The order for the bilingual mode was chosen by measuring both orders on
 * the bilingual fixtures (scripts/ocr-accuracy-report.mjs). There is no automatic language detection.
 */
export const OCR_LANGUAGE_MODES = {
  eng: { label: "English", tesseract: ["eng"], languages: ["en"] },
  hin: { label: "Hindi", tesseract: ["hin"], languages: ["hi"] },
  eng_hin: { label: "English + Hindi", tesseract: ["hin", "eng"], languages: ["hi", "en"] },
} as const satisfies Record<string, { label: string; tesseract: readonly ("eng" | "hin")[]; languages: readonly OcrImplementedLanguage[] }>
export type OcrLanguageMode = keyof typeof OCR_LANGUAGE_MODES
export const OCR_LANGUAGE_MODE_IDS = Object.keys(OCR_LANGUAGE_MODES) as OcrLanguageMode[]
export const isOcrLanguageMode = (v: unknown): v is OcrLanguageMode => typeof v === "string" && Object.prototype.hasOwnProperty.call(OCR_LANGUAGE_MODES, v)

/** A language pack actually loaded for a run: npm package/variant reference and its verified SHA-256. */
export type OcrModelReference = { code: string; reference: string; sha256: string }

/**
 * Tesseract page segmentation modes this service uses (never user-supplied raw parameters):
 * auto = PSM 3 (full image, multiple blocks), single_block = PSM 6 (regions / one paragraph),
 * single_line = PSM 7, sparse_text = PSM 11 (scattered labels).
 */
export type OcrPageSegmentation = "auto" | "single_block" | "single_line" | "sparse_text"

/**
 * Recognition modes. Only `printed_text` is implemented; the others are reserved contract values so
 * later tasks (multilingual, mathematical OCR) extend this type instead of inventing a new one.
 */
export const OCR_MODES = {
  printed_text: { label: "Printed text", implemented: true },
  multilingual_text: { label: "Multilingual text", implemented: false },
  mathematical: { label: "Mathematical notation", implemented: false },
} as const
export type OcrMode = keyof typeof OCR_MODES

export type OcrScope = "full_image" | "region"

/** Persisted outcome of one OCR attempt. Distinct from classification, generation and review status. */
export type OcrResultStatus = "completed" | "completed_with_warnings" | "no_text_detected" | "failed" | "unsupported"

/** What the UI shows. `queued`/`processing` exist for the shared status vocabulary; runs are synchronous today. */
export type OcrDisplayStatus = "not_started" | "queued" | "processing" | "unavailable" | OcrResultStatus

export const OCR_STATUS_LABELS: Record<OcrDisplayStatus, string> = {
  not_started: "Not started",
  queued: "Queued",
  processing: "Processing",
  unavailable: "OCR unavailable",
  completed: "Completed",
  completed_with_warnings: "Completed with warnings",
  no_text_detected: "No text detected",
  failed: "Failed",
  unsupported: "Unsupported",
}

export const OCR_ERROR_CATEGORIES = {
  engine_unavailable: "The OCR engine is not available in this deployment.",
  engine_busy: "The OCR engine is busy. Try again shortly.",
  timeout: "Text recognition took too long and was stopped.",
  decode_failed: "The image could not be decoded for text recognition.",
  unsupported_format: "This image format is not supported for OCR.",
  image_too_large: "The image is too large for text recognition.",
  region_too_small: "The selected region is too small to read.",
  region_unmappable: "The region position cannot be mapped to the stored image pixels.",
  engine_error: "The OCR engine reported an error.",
  memory_exceeded: "Text recognition ran out of memory and was stopped.",
  invalid_language: "That OCR language selection is not supported.",
  language_unavailable: "The selected OCR language is not available in this deployment.",
  language_asset_missing: "A required OCR language pack is not installed.",
  language_asset_invalid: "A required OCR language pack failed its integrity check.",
  language_init_failed: "The OCR worker for the selected language could not be initialised.",
} as const
export type OcrErrorCategory = keyof typeof OCR_ERROR_CATEGORIES

/** Region types whose content is expected to be printed text worth recognising. */
export const OCR_TEXT_REGION_TYPES: readonly RegionType[] = [
  "text_region",
  "caption_region",
  "heading_region",
  "chart_label_region",
  "legend_region",
  "axis_region",
  "table_region",
  "table_cell_region",
  "flowchart_node",
  "mixed_content_region",
]

/** Pixel rectangle in the stored image frame (what the decoder sees, before EXIF orientation). */
export type OcrPixelBox = { left: number; top: number; width: number; height: number }

export type OcrWord = { text: string; confidence: number; box: OcrPixelBox }
export type OcrLine = {
  text: string
  confidence: number
  box: OcrPixelBox
  words: OcrWord[]
  /** Task 6: engine block / paragraph the line belongs to (indexes in engine order). Absent on v1 rows. */
  block?: number
  paragraph?: number
  /** Deterministic script hint from the recognised code points. Not a language identification. */
  script?: OcrScriptHint
}

/** A paragraph exactly as the engine grouped it: line indexes into `lines`, in engine order. */
export type OcrParagraph = { block: number; paragraph: number; lineIndexes: number[]; box: OcrPixelBox }

export type OcrLayout = {
  /** Boxes are engine output in stored-pixel coordinates; `drawable` is false when display orientation differs. */
  frame: "stored_pixels"
  drawable: boolean
  lines: OcrLine[]
  truncated: boolean
  /** Task 6. Engine-reported paragraphs; reading order is the engine's, not semantically verified. */
  paragraphs?: OcrParagraph[]
  blockCount?: number
  /** True when blocks sit side by side, so the engine's block order may not be the intended reading order. */
  possibleColumns?: boolean
}

export type OcrScriptHint = "devanagari" | "latin" | "mixed" | "digits_symbols" | "other"

/** Counts of recognised characters by Unicode script. Labelled a hint: Roman script is not assumed to be English. */
export type OcrScriptHints = {
  basis: "unicode_code_points"
  summary: OcrScriptHint | "none"
  devanagari: number
  latin: number
  latinDigits: number
  devanagariDigits: number
  other: number
}

export type OcrResult = {
  schemaVersion: number
  resultId: string
  version: number
  assetId: number
  occurrenceId: number | null
  scope: OcrScope
  region: { regionId: string; analysisId: string; analysisVersion: number; primaryType: RegionType; box: NormalizedBox; crop: OcrPixelBox } | null
  providerId: string
  engineVersion: string
  languageModel: string
  /** Primary language of the mode (Task 5 field). Use `languageMode` / `languages` for the full selection. */
  language: OcrImplementedLanguage
  /** Task 6 — requested language mode. Absent on schema v1 rows, which were always English. */
  languageMode?: OcrLanguageMode
  languages?: OcrImplementedLanguage[]
  /** Exact Tesseract language string loaded, e.g. "hin+eng". */
  loadedLanguages?: string
  languageModels?: OcrModelReference[]
  segmentation?: OcrPageSegmentation
  scriptHints?: OcrScriptHints | null
  mode: OcrMode
  status: OcrResultStatus
  errorCategory: OcrErrorCategory | null
  rawText: string
  normalizedText: string
  /** Tesseract's own 0–100 score. Engine evidence only, not an accuracy guarantee. */
  meanConfidence: number | null
  confidenceScale: "tesseract_0_100"
  lowConfidenceWordCount: number
  layout: OcrLayout | null
  warnings: string[]
  source: { mediaType: string; storedWidth: number; storedHeight: number; orientation: number; orientationUnknown: boolean }
  inputSha256: string
  configFingerprint: string
  settingsRevision: number
  durationMs: number
  createdAt: string
}

/* ───────────────────────── Limits ───────────────────────── */

export const OCR_LIMITS = {
  maxTextChars: 20_000,
  maxLines: 400,
  maxWordsPerLine: 120,
  minRegionPixels: 8,
  lowConfidence: 60,
  /** Checked from the file header before any decode, so oversized images never reach the engine. */
  maxPixels: 25_000_000,
  maxSide: 10_000,
  timeoutMs: 30_000,
} as const

/** Formats the self-hosted engine decodes, verified against fixtures in test/alt-text/alt-text-ocr-engine.test.ts. */
export const OCR_SUPPORTED_MEDIA_TYPES = ["image/png", "image/jpeg", "image/webp"] as const

/* ───────────────────────── Request parsing ───────────────────────── */

const REQUEST_ID = /^[A-Za-z0-9_-]{8,36}$/
const REGION_ID = /^rgn_[A-Za-z0-9_-]{4,40}$/
const ALLOWED_FIELDS = new Set(["requestId", "occurrenceId", "regionId", "reprocess", "settingsRevision", "languageMode"])

export type OcrRunRequest = {
  requestId: string
  occurrenceId: number | null
  regionId: string | null
  reprocess: boolean
  settingsRevision: number | null
  /** Per-image/region override of the tenant OCR language mode. Null = tenant setting. */
  languageMode: OcrLanguageMode | null
}
type ParseFailure = { ok: false; status: 400; code: string; error: string; details?: Record<string, unknown> }

/** Strict: unknown fields are rejected so callers cannot pass paths, URLs, raw language codes or engine options. */
export function parseOcrRunRequest(body: unknown): { ok: true; value: OcrRunRequest } | ParseFailure {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, status: 400, code: "INVALID_REQUEST", error: "Expected a JSON object." }
  const b = body as Record<string, unknown>
  const extra = Object.keys(b).filter((k) => !ALLOWED_FIELDS.has(k))
  if (extra.length) return { ok: false, status: 400, code: "INVALID_REQUEST", error: "Unexpected fields.", details: { fields: extra } }
  if (typeof b.requestId !== "string" || !REQUEST_ID.test(b.requestId)) return { ok: false, status: 400, code: "INVALID_REQUEST_ID", error: "A valid requestId is required." }
  const occ = b.occurrenceId
  if (occ !== undefined && occ !== null && !(Number.isInteger(occ) && (occ as number) > 0)) return { ok: false, status: 400, code: "INVALID_REQUEST", error: "occurrenceId must be a positive integer." }
  const rid = b.regionId
  if (rid !== undefined && rid !== null && !(typeof rid === "string" && REGION_ID.test(rid))) return { ok: false, status: 400, code: "INVALID_REQUEST", error: "regionId is not valid." }
  if (b.reprocess !== undefined && typeof b.reprocess !== "boolean") return { ok: false, status: 400, code: "INVALID_REQUEST", error: "reprocess must be a boolean." }
  const rev = b.settingsRevision
  if (rev !== undefined && rev !== null && !(Number.isInteger(rev) && (rev as number) >= 0)) return { ok: false, status: 400, code: "INVALID_REQUEST", error: "settingsRevision must be a non-negative integer." }
  const lm = b.languageMode
  if (lm !== undefined && lm !== null && !isOcrLanguageMode(lm)) return { ok: false, status: 400, code: "INVALID_LANGUAGE_MODE", error: "languageMode must be eng, hin or eng_hin." }
  return {
    ok: true,
    value: {
      requestId: b.requestId,
      occurrenceId: (occ as number | null | undefined) ?? null,
      regionId: (rid as string | null | undefined) ?? null,
      reprocess: b.reprocess === true,
      settingsRevision: (rev as number | null | undefined) ?? null,
      languageMode: (lm as OcrLanguageMode | null | undefined) ?? null,
    },
  }
}

/* ───────────────────────── Text normalisation ───────────────────────── */

// C0/C1 controls except tab and newline, plus bidi overrides that could disguise text in the UI.
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g

/**
 * Strips unsafe control characters only. Every printable character the engine produced is kept,
 * including combining marks, nukta, virama, ZWJ (U+200D) and ZWNJ (U+200C).
 */
export function sanitizeOcrText(raw: string): string {
  return raw.replace(/\r\n?/g, "\n").replace(UNSAFE_CHARS, "")
}

/**
 * Normalised (derived) text. Strategy, documented and tested:
 * 1. Unicode NFC — canonical composition only. Never NFKC/NFKD, so superscripts, subscripts, "×",
 *    fullwidth forms and Devanagari digits are untouched. For Devanagari, NFC leaves matras, anusvara,
 *    chandrabindu, visarga, virama and ZWJ/ZWNJ unchanged; the only effect is that precomposed nukta
 *    letters (U+0958–U+095F, composition exclusions) become base + U+093C, which is canonically equivalent.
 * 2. Whitespace only: trailing spaces per line, runs of blank lines, outer whitespace.
 * Characters are never substituted, transliterated or reordered. Raw engine text is stored separately.
 */
export function normalizeOcrText(raw: string): string {
  return sanitizeOcrText(raw)
    .normalize("NFC")
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/* ───────────────────────── Grapheme-safe operations ───────────────────────── */

const graphemeSegmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null

/** User-perceived characters (extended grapheme clusters), e.g. "क्षे" is one cluster of 4 code points. */
export function graphemes(text: string): string[] {
  if (!graphemeSegmenter) return Array.from(text)
  return Array.from(graphemeSegmenter.segment(text), (s) => s.segment)
}

export const graphemeCount = (text: string) => graphemes(text).length

/**
 * Truncates to at most `max` UTF-16 units without splitting a grapheme cluster (a Devanagari
 * consonant + matra + virama sequence, or a surrogate pair, is kept whole or dropped whole).
 */
export function truncateText(text: string, max: number = OCR_LIMITS.maxTextChars): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false }
  let out = ""
  for (const g of graphemes(text.slice(0, max + 32))) {
    if (out.length + g.length > max) break
    out += g
  }
  return { text: out, truncated: true }
}

/* ───────────────────────── Script hints ───────────────────────── */

const DEVANAGARI_DIGIT = /[\u0966-\u096F]/u
const DEVANAGARI = /[\u0900-\u097F\uA8E0-\uA8FF]/u
const LATIN_LETTER = /\p{Script=Latin}/u
const LETTER = /\p{L}|\p{M}/u

/** Deterministic counts by Unicode script. A hint for reviewers, never a language identification. */
export function deriveScriptHints(text: string): OcrScriptHints {
  const c = { devanagari: 0, latin: 0, latinDigits: 0, devanagariDigits: 0, other: 0 }
  for (const ch of text) {
    if (DEVANAGARI_DIGIT.test(ch)) c.devanagariDigits++
    else if (DEVANAGARI.test(ch)) c.devanagari++
    else if (ch >= "0" && ch <= "9") c.latinDigits++
    else if (LATIN_LETTER.test(ch)) c.latin++
    else if (LETTER.test(ch)) c.other++
  }
  return { basis: "unicode_code_points", summary: summarizeScript(c), ...c }
}

function summarizeScript(c: { devanagari: number; latin: number; latinDigits: number; devanagariDigits: number; other: number }): OcrScriptHints["summary"] {
  const scripts = [c.devanagari > 0, c.latin > 0, c.other > 0].filter(Boolean).length
  if (scripts > 1) return "mixed"
  if (c.devanagari) return "devanagari"
  if (c.latin) return "latin"
  if (c.other) return "other"
  return c.latinDigits || c.devanagariDigits ? "digits_symbols" : "none"
}

const lineScript = (text: string): OcrScriptHint => {
  const s = deriveScriptHints(text).summary
  return s === "none" ? "digits_symbols" : s
}

/* ───────────────────────── Engine output mapping ───────────────────────── */

type EngineBbox = { x0: number; y0: number; x1: number; y1: number }
type EngineWord = { text?: string; confidence?: number; bbox?: EngineBbox }
type EngineLine = EngineWord & { words?: EngineWord[] }
type EngineBlock = { paragraphs?: { lines?: EngineLine[] }[] }

const toBox = (b: EngineBbox | undefined): OcrPixelBox | null => {
  if (!b || ![b.x0, b.y0, b.x1, b.y1].every(Number.isFinite) || b.x1 <= b.x0 || b.y1 <= b.y0) return null
  return { left: b.x0, top: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0 }
}
const roundConf = (c: unknown) => (typeof c === "number" && Number.isFinite(c) ? Math.max(0, Math.min(100, Math.round(c * 10) / 10)) : 0)

const union = (boxes: OcrPixelBox[]): OcrPixelBox => {
  const left = Math.min(...boxes.map((b) => b.left))
  const top = Math.min(...boxes.map((b) => b.top))
  const right = Math.max(...boxes.map((b) => b.left + b.width))
  const bottom = Math.max(...boxes.map((b) => b.top + b.height))
  return { left, top, width: right - left, height: bottom - top }
}

/** Two blocks overlap vertically but not horizontally → side by side (possible columns). */
function sideBySide(boxes: OcrPixelBox[]): boolean {
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]
      const b = boxes[j]
      const vOverlap = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top)
      const hGap = Math.max(a.left, b.left) - Math.min(a.left + a.width, b.left + b.width)
      if (vOverlap > 0.5 * Math.min(a.height, b.height) && hGap > 0) return true
    }
  return false
}

/**
 * Flattens Tesseract's block tree into bounded lines in engine order, keeping the engine's own
 * block/paragraph grouping. Lines or words without a valid box are dropped, never guessed; no line
 * or paragraph box is synthesised except as the union of engine line boxes.
 */
export function mapEngineLayout(blocks: unknown, drawable: boolean): OcrLayout {
  const lines: OcrLine[] = []
  const paragraphs: OcrParagraph[] = []
  const blockBoxes: OcrPixelBox[] = []
  let truncated = false
  const blockList = Array.isArray(blocks) ? (blocks as EngineBlock[]) : []
  for (const [bi, block] of blockList.entries()) {
    const blockLineBoxes: OcrPixelBox[] = []
    for (const [pi, para] of (block.paragraphs ?? []).entries()) {
      const lineIndexes: number[] = []
      for (const line of para.lines ?? []) {
        const text = sanitizeOcrText(String(line.text ?? "")).trim()
        const box = toBox(line.bbox)
        if (!text || !box) continue
        if (lines.length >= OCR_LIMITS.maxLines) {
          truncated = true
          continue
        }
        const allWords = (line.words ?? []).flatMap((w) => {
          const wb = toBox(w.bbox)
          const wt = sanitizeOcrText(String(w.text ?? "")).trim()
          return wb && wt ? [{ text: wt, confidence: roundConf(w.confidence), box: wb }] : []
        })
        if (allWords.length > OCR_LIMITS.maxWordsPerLine) truncated = true
        lineIndexes.push(lines.length)
        blockLineBoxes.push(box)
        lines.push({ text, confidence: roundConf(line.confidence), box, words: allWords.slice(0, OCR_LIMITS.maxWordsPerLine), block: bi, paragraph: pi, script: lineScript(text) })
      }
      if (lineIndexes.length) paragraphs.push({ block: bi, paragraph: pi, lineIndexes, box: union(lineIndexes.map((i) => lines[i].box)) })
    }
    if (blockLineBoxes.length) blockBoxes.push(union(blockLineBoxes))
  }
  return { frame: "stored_pixels", drawable, lines, truncated, paragraphs, blockCount: blockBoxes.length, possibleColumns: sideBySide(blockBoxes) }
}

/** Mean of word confidences (the engine's page score counts empty space). Null when there are no words. */
export function meanWordConfidence(layout: OcrLayout): { mean: number | null; low: number } {
  const words = layout.lines.flatMap((l) => l.words)
  if (!words.length) return { mean: null, low: 0 }
  const mean = words.reduce((s, w) => s + w.confidence, 0) / words.length
  return { mean: Math.round(mean * 10) / 10, low: words.filter((w) => w.confidence < OCR_LIMITS.lowConfidence).length }
}

/* ───────────────────────── Region geometry ───────────────────────── */

/**
 * Converts a normalised region box to a stored-pixel crop. Only valid when the region analysis frame
 * equals the stored frame (orientation 1, known); callers must check that first.
 */
export function regionCrop(box: NormalizedBox, width: number, height: number): OcrPixelBox | null {
  const left = Math.max(0, Math.floor(box.x * width))
  const top = Math.max(0, Math.floor(box.y * height))
  const right = Math.min(width, Math.ceil((box.x + box.width) * width))
  const bottom = Math.min(height, Math.ceil((box.y + box.height) * height))
  const w = right - left
  const h = bottom - top
  if (w < OCR_LIMITS.minRegionPixels || h < OCR_LIMITS.minRegionPixels) return null
  return { left, top, width: w, height: h }
}

/* ───────────────────────── Status ───────────────────────── */

export function deriveOcrStatus(input: { normalizedText: string; meanConfidence: number | null; warnings: string[] }): OcrResultStatus {
  if (!input.normalizedText) return "no_text_detected"
  if (input.warnings.length || (input.meanConfidence !== null && input.meanConfidence < OCR_LIMITS.lowConfidence)) return "completed_with_warnings"
  return "completed"
}

/** A failed attempt never replaces a usable result: the active result is the newest non-failed one. */
export function pickActiveResult<T extends { status: OcrResultStatus; version: number }>(rows: T[]): { active: T | null; latestFailure: T | null } {
  const sorted = [...rows].sort((a, b) => b.version - a.version)
  const active = sorted.find((r) => r.status !== "failed") ?? null
  const newestFailure = sorted[0]?.status === "failed" ? sorted[0] : null
  return { active, latestFailure: newestFailure }
}
