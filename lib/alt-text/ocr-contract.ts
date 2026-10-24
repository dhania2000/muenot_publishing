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

export const OCR_SCHEMA_VERSION = 1
export const OCR_PROVIDER_ID = "tesseract_js"
export const OCR_PROVIDER_LABEL = "Tesseract.js (self-hosted)"

/** Languages with an installed, integrity-checked pack. Multilingual OCR is a later task. */
export const OCR_IMPLEMENTED_LANGUAGES = ["en"] as const
export type OcrImplementedLanguage = (typeof OCR_IMPLEMENTED_LANGUAGES)[number]

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
  "flowchart_node",
  "mixed_content_region",
]

/** Pixel rectangle in the stored image frame (what the decoder sees, before EXIF orientation). */
export type OcrPixelBox = { left: number; top: number; width: number; height: number }

export type OcrWord = { text: string; confidence: number; box: OcrPixelBox }
export type OcrLine = { text: string; confidence: number; box: OcrPixelBox; words: OcrWord[] }

export type OcrLayout = {
  /** Boxes are engine output in stored-pixel coordinates; `drawable` is false when display orientation differs. */
  frame: "stored_pixels"
  drawable: boolean
  lines: OcrLine[]
  truncated: boolean
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
  language: OcrImplementedLanguage
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
const ALLOWED_FIELDS = new Set(["requestId", "occurrenceId", "regionId", "reprocess", "settingsRevision"])

export type OcrRunRequest = { requestId: string; occurrenceId: number | null; regionId: string | null; reprocess: boolean; settingsRevision: number | null }
type ParseFailure = { ok: false; status: 400; code: string; error: string; details?: Record<string, unknown> }

/** Strict: unknown fields are rejected so callers cannot pass paths, URLs, languages or engine options. */
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
  return {
    ok: true,
    value: {
      requestId: b.requestId,
      occurrenceId: (occ as number | null | undefined) ?? null,
      regionId: (rid as string | null | undefined) ?? null,
      reprocess: b.reprocess === true,
      settingsRevision: (rev as number | null | undefined) ?? null,
    },
  }
}

/* ───────────────────────── Text normalisation ───────────────────────── */

// C0/C1 controls except tab and newline, plus bidi overrides that could disguise text in the UI.
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g

/** Strips unsafe control characters only. Every printable character the engine produced is kept. */
export function sanitizeOcrText(raw: string): string {
  return raw.replace(/\r\n?/g, "\n").replace(UNSAFE_CHARS, "")
}

/**
 * Whitespace-only normalisation: trailing spaces per line, runs of blank lines, outer whitespace.
 * Characters are never substituted, so symbols, units, subscripts and digits survive exactly as
 * recognised — no "corrections" that could change meaning.
 */
export function normalizeOcrText(raw: string): string {
  return sanitizeOcrText(raw)
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export function truncateText(text: string, max: number = OCR_LIMITS.maxTextChars): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false }
  return { text: text.slice(0, max), truncated: true }
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

/** Flattens Tesseract's block tree into bounded lines. Lines or words without a valid box are dropped, never guessed. */
export function mapEngineLayout(blocks: unknown, drawable: boolean): OcrLayout {
  const lines: OcrLine[] = []
  let truncated = false
  for (const block of Array.isArray(blocks) ? (blocks as EngineBlock[]) : []) {
    for (const para of block.paragraphs ?? []) {
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
        lines.push({ text, confidence: roundConf(line.confidence), box, words: allWords.slice(0, OCR_LIMITS.maxWordsPerLine) })
      }
    }
  }
  return { frame: "stored_pixels", drawable, lines, truncated }
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
