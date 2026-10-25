/**
 * @file lib/alt-text/pdf-page-ocr-contract.ts
 * @module Publishing · Alt Text
 * @kind Pure contract (no I/O)
 * @summary Phase 3 Task 7 — scanned-PDF page OCR: page classification from parser evidence, render
 *   resolution policy, raster↔PDF coordinate conversion, execution identity and progress derivation.
 *
 * Coordinate systems (persisted with every result as `coordinateSystems`):
 * - `raster_px`   OCR raster pixels, origin top-left, y down, exactly the rendered image.
 * - `page_norm`   0..1 of the displayed (rotated, crop-boxed) page, origin top-left, y down.
 * - `pdf_user`    PDF default user space of the page (points, origin bottom-left of the coordinate
 *                 system, y up; includes the CropBox offset and ignores /Rotate).
 * `viewportTransform` [a,b,c,d,e,f] maps pdf_user → raster_px (pdf.js viewport.transform); conversion
 * back uses its inverse. Nothing is converted without that recorded matrix.
 */
import { createHash } from "node:crypto"
import type { OcrLanguageMode, OcrPixelBox } from "./ocr-contract"

export const PAGE_OCR_SCHEMA_VERSION = 1
/** Bump when render or preprocessing behaviour changes so older results are not reused as equivalent. */
export const PAGE_RENDER_POLICY_VERSION = "pdfjs-render-v1"

export const PAGE_OCR_STATUSES = [
  "not_required",
  "eligible",
  "needs_review",
  "queued",
  "rendering",
  "recognizing",
  "completed",
  "completed_with_warnings",
  "no_text_detected",
  "failed",
  "unsupported",
  "cancelled",
] as const
export type PageOcrStatus = (typeof PAGE_OCR_STATUSES)[number]
export const isPageOcrStatus = (v: unknown): v is PageOcrStatus => typeof v === "string" && (PAGE_OCR_STATUSES as readonly string[]).includes(v)

export const PAGE_OCR_STATUS_LABELS: Record<PageOcrStatus, string> = {
  not_required: "Not required",
  eligible: "Eligible",
  needs_review: "Needs review",
  queued: "Queued",
  rendering: "Rendering",
  recognizing: "Recognizing",
  completed: "Completed",
  completed_with_warnings: "Completed with warnings",
  no_text_detected: "No text detected",
  failed: "OCR failed",
  unsupported: "Unsupported",
  cancelled: "Cancelled",
}

export const ACTIVE_PAGE_STATUSES: ReadonlySet<PageOcrStatus> = new Set(["queued", "rendering", "recognizing"])
export const DONE_PAGE_STATUSES: ReadonlySet<PageOcrStatus> = new Set(["completed", "completed_with_warnings", "no_text_detected"])
/** Statuses a user may retry. `no_text_detected` is a real result, not a failure, so it needs an explicit reprocess. */
export const RETRYABLE_PAGE_STATUSES: ReadonlySet<PageOcrStatus> = new Set(["failed", "cancelled"])

export type PageClass = "born_digital" | "scanned" | "scanned_with_text_layer" | "mixed" | "image_dominant" | "blank" | "unsupported"

export const PAGE_CLASS_LABELS: Record<PageClass, string> = {
  born_digital: "Digital text",
  scanned: "Scanned",
  scanned_with_text_layer: "Scanned + text layer",
  mixed: "Mixed",
  image_dominant: "Image-dominant",
  blank: "Blank / vector only",
  unsupported: "Unsupported",
}

export type DocumentClass = "born_digital" | "scanned" | "mixed" | "image_dominant" | "partially_searchable" | "unsupported"

export const DOCUMENT_CLASS_LABELS: Record<DocumentClass, string> = {
  born_digital: "Born-digital PDF",
  scanned: "Scanned PDF",
  mixed: "Mixed PDF",
  image_dominant: "Image-dominant PDF",
  partially_searchable: "Partially searchable PDF",
  unsupported: "Unsupported / protected PDF",
}

/** Evidence the existing PDF parser (pdf-package) already produces per page. No guesses are added. */
export type PageEvidence = {
  pageIndex: number
  /** Non-whitespace characters in decodable, non-artifact text runs. */
  textChars: number
  /** Fraction of the visible page covered by text-run boxes (approximate widths, 0..1). */
  textCoverage: number
  undecodableRuns: number
  imageCount: number
  /** Largest single image coverage of the visible page (0..1). */
  maxImageCoverage: number
  /** True when the parser flagged a full-page raster (`likely_scanned_page`). */
  fullPageRaster: boolean
  /** Page draws vector paths but no raster image (pdf-package report). */
  vectorOnly: boolean
}

export type PageClassification = {
  pageClass: PageClass
  /** Whether automatic mode should OCR this page. */
  ocrRecommended: boolean
  /** Evidence is ambiguous; a person should decide. */
  needsReview: boolean
  reasons: string[]
}

export const CLASSIFICATION_THRESHOLDS = {
  /** Meaningful native text on a page. Fewer characters are typically page numbers or running heads. */
  meaningfulTextChars: 40,
  /** Images at least this large dominate the page without being a full-page scan. */
  dominantImageCoverage: 0.5,
  /** Share of undecodable runs above which an existing text layer is treated as degraded. */
  degradedTextRatio: 0.3,
} as const

/**
 * Page-level classification. Deliberately conservative: only full-page rasters without meaningful
 * native text are auto-eligible. Photos, diagrams and mixed pages are flagged for review instead of
 * being assumed to be text.
 */
export function classifyPage(e: PageEvidence): PageClassification {
  const T = CLASSIFICATION_THRESHOLDS
  const reasons: string[] = []
  const hasText = e.textChars >= T.meaningfulTextChars
  const totalRuns = e.undecodableRuns + (e.textChars > 0 ? 1 : 0)
  const degraded = e.undecodableRuns > 0 && totalRuns > 0 && e.undecodableRuns / Math.max(1, e.undecodableRuns + Math.ceil(e.textChars / 20)) >= T.degradedTextRatio

  if (e.fullPageRaster && !hasText) {
    reasons.push("A raster image covers the page and no meaningful selectable text was found.")
    if (e.textChars > 0) reasons.push(`Only ${e.textChars} selectable characters exist (e.g. a page number).`)
    return { pageClass: "scanned", ocrRecommended: true, needsReview: false, reasons }
  }
  if (e.fullPageRaster && hasText) {
    reasons.push("A full-page raster image already has a selectable text layer.")
    if (degraded) {
      reasons.push("Part of the existing text layer could not be decoded; it may be degraded.")
      return { pageClass: "scanned_with_text_layer", ocrRecommended: false, needsReview: true, reasons }
    }
    return { pageClass: "scanned_with_text_layer", ocrRecommended: false, needsReview: false, reasons }
  }
  if (hasText && e.maxImageCoverage >= T.dominantImageCoverage) {
    reasons.push("The page has selectable text and a large image; the image may contain more text.")
    return { pageClass: "mixed", ocrRecommended: false, needsReview: true, reasons }
  }
  if (hasText) {
    reasons.push("The page has selectable digital text.")
    if (degraded) {
      reasons.push("Part of the text could not be decoded; its fonts may lack a Unicode mapping.")
      return { pageClass: "born_digital", ocrRecommended: false, needsReview: true, reasons }
    }
    return { pageClass: "born_digital", ocrRecommended: false, needsReview: false, reasons }
  }
  if (e.maxImageCoverage >= T.dominantImageCoverage) {
    reasons.push("A large image without selectable text. It may be a photograph or a partial scan; this was not assumed to be text.")
    return { pageClass: "image_dominant", ocrRecommended: false, needsReview: true, reasons }
  }
  if (e.imageCount > 0) {
    reasons.push("Small images and no selectable text.")
    return { pageClass: "image_dominant", ocrRecommended: false, needsReview: true, reasons }
  }
  if (e.vectorOnly) {
    reasons.push("Vector drawing only, with no selectable text. Outlined text cannot be ruled out.")
    return { pageClass: "blank", ocrRecommended: false, needsReview: true, reasons }
  }
  reasons.push("No text and no images were found on this page.")
  return { pageClass: "blank", ocrRecommended: false, needsReview: false, reasons }
}

/** Document-level label from actual page classes, never from the first page alone. */
export function classifyDocument(classes: readonly PageClass[]): DocumentClass {
  if (classes.length === 0) return "unsupported"
  const count = (c: PageClass) => classes.filter((x) => x === c).length
  const scanned = count("scanned")
  const layered = count("scanned_with_text_layer")
  const digital = count("born_digital")
  const imageDom = count("image_dominant")
  const content = classes.length - count("blank")
  if (content === 0) return "born_digital"
  if (scanned === content) return "scanned"
  if (digital === content) return "born_digital"
  if (layered > 0 && scanned === 0 && digital + layered + count("mixed") === content) return "partially_searchable"
  if (imageDom === content) return "image_dominant"
  return "mixed"
}

/* ───────────────────────── Render resolution ───────────────────────── */

export const PAGE_RENDER_LIMITS = {
  targetDpi: 300,
  minDpi: 150,
  maxDpi: 400,
  /** Matches the OCR engine's pixel ceiling so a rendered page is never rejected after rendering. */
  maxPixels: 25_000_000,
  maxSide: 10_000,
  renderTimeoutMs: 30_000,
  ocrTimeoutMs: 120_000,
} as const

export type RenderPlan = { ok: true; dpi: number; scale: number; width: number; height: number; reducedFrom: number | null } | { ok: false; code: "PAGE_PIXEL_LIMIT"; message: string }

/**
 * Picks the highest DPI ≤ target whose raster fits the limits, never below `minDpi` (fine print would
 * become unreadable, so the page is reported unsupported instead of silently downscaled further).
 * Width/height are the displayed (rotated) page in points, already multiplied by /UserUnit.
 */
export function planRender(displayWidthPt: number, displayHeightPt: number, opts: { targetDpi?: number } = {}): RenderPlan {
  const L = PAGE_RENDER_LIMITS
  if (!(displayWidthPt > 0) || !(displayHeightPt > 0) || !Number.isFinite(displayWidthPt) || !Number.isFinite(displayHeightPt)) {
    return { ok: false, code: "PAGE_PIXEL_LIMIT", message: "The page has invalid dimensions." }
  }
  const target = Math.min(L.maxDpi, Math.max(L.minDpi, Math.round(opts.targetDpi ?? L.targetDpi)))
  const at = (dpi: number) => ({ w: Math.ceil((displayWidthPt * dpi) / 72), h: Math.ceil((displayHeightPt * dpi) / 72) })
  const fits = (dpi: number) => {
    const { w, h } = at(dpi)
    return w <= L.maxSide && h <= L.maxSide && w * h <= L.maxPixels
  }
  let dpi = target
  if (!fits(dpi)) {
    const { w, h } = at(1)
    const byPixels = Math.floor(Math.sqrt(L.maxPixels / (w * h)))
    const bySide = Math.floor(L.maxSide / Math.max(w, h))
    dpi = Math.min(target, byPixels, bySide)
    while (dpi >= L.minDpi && !fits(dpi)) dpi--
  }
  if (dpi < L.minDpi) {
    return { ok: false, code: "PAGE_PIXEL_LIMIT", message: `The page is too large to render at ${L.minDpi} DPI within the ${L.maxPixels.toLocaleString("en-US")}-pixel limit.` }
  }
  const { w, h } = at(dpi)
  return { ok: true, dpi, scale: dpi / 72, width: w, height: h, reducedFrom: dpi < target ? target : null }
}

/* ───────────────────────── Coordinates ───────────────────────── */

export type Matrix6 = [number, number, number, number, number, number]
export type PdfRect = { x0: number; y0: number; x1: number; y1: number }
export type NormRect = { x: number; y: number; width: number; height: number }

export type PageGeometry = {
  /** [x0,y0,x1,y1] in pdf_user. */
  mediaBox: [number, number, number, number]
  cropBox: [number, number, number, number]
  rotate: 0 | 90 | 180 | 270
  userUnit: number
  /** Displayed page size in points (after rotation and UserUnit). */
  displayWidthPt: number
  displayHeightPt: number
}

export const COORDINATE_SYSTEMS = {
  raster_px: "OCR raster pixels; origin top-left, y down.",
  page_norm: "0..1 of the displayed page (rotation and CropBox applied); origin top-left, y down.",
  pdf_user: "PDF default user space in points; y up; CropBox offset included; /Rotate not applied.",
} as const

export function invertMatrix(m: Matrix6): Matrix6 | null {
  const [a, b, c, d, e, f] = m
  const det = a * d - b * c
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det]
}

const apply = (m: Matrix6, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

/** raster_px box → pdf_user rectangle via the inverse viewport transform. Null when not invertible or invalid. */
export function rasterBoxToPdf(box: OcrPixelBox, viewportTransform: Matrix6): PdfRect | null {
  const inv = invertMatrix(viewportTransform)
  if (!inv || !(box.width > 0) || !(box.height > 0)) return null
  const pts = [
    apply(inv, box.left, box.top),
    apply(inv, box.left + box.width, box.top),
    apply(inv, box.left, box.top + box.height),
    apply(inv, box.left + box.width, box.top + box.height),
  ]
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const r = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
  return Object.values(r).every(Number.isFinite) ? roundRect(r) : null
}

/** raster_px box → page_norm, validated against the raster bounds. Null when outside the page. */
export function rasterBoxToNorm(box: OcrPixelBox, rasterWidth: number, rasterHeight: number): NormRect | null {
  if (!(rasterWidth > 0) || !(rasterHeight > 0) || !(box.width > 0) || !(box.height > 0)) return null
  if (box.left < 0 || box.top < 0 || box.left + box.width > rasterWidth + 1 || box.top + box.height > rasterHeight + 1) return null
  const r = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 1e5) / 1e5
  return { x: r(box.left / rasterWidth), y: r(box.top / rasterHeight), width: r(box.width / rasterWidth), height: r(box.height / rasterHeight) }
}

const roundRect = (r: PdfRect): PdfRect => ({ x0: round2(r.x0), y0: round2(r.y0), x1: round2(r.x1), y1: round2(r.y1) })
const round2 = (v: number) => Math.round(v * 100) / 100

/* ───────────────────────── Identity & progress ───────────────────────── */

/**
 * OCR execution identity: a completed result is reused only when every input that can change the
 * output is identical (source bytes, page, language, engine + model hashes, render policy, PSM).
 */
export function pageOcrIdentity(input: {
  documentId: number
  sourceSha256: string
  pageIndex: number
  languageMode: OcrLanguageMode
  engineVersion: string
  modelSha256s: readonly string[]
  dpi: number
  segmentation: string
}): string {
  const canonical = JSON.stringify([
    PAGE_OCR_SCHEMA_VERSION,
    PAGE_RENDER_POLICY_VERSION,
    input.documentId,
    input.sourceSha256,
    input.pageIndex,
    input.languageMode,
    input.engineVersion,
    [...input.modelSha256s].sort(),
    input.dpi,
    input.segmentation,
  ])
  return createHash("sha256").update(canonical).digest("hex")
}

export type PageOcrProgress = {
  totalPages: number
  eligible: number
  needsReview: number
  notRequired: number
  queued: number
  rendering: number
  recognizing: number
  completed: number
  completedWithWarnings: number
  noTextDetected: number
  failed: number
  unsupported: number
  cancelled: number
  /** Pages in the current OCR scope (queued + active + finished in this run set). */
  inScope: number
  /** Finished pages in scope / pages in scope; null when nothing is in scope. Never document-wide. */
  scopePercent: number | null
  outcome: "idle" | "running" | "completed" | "partial" | "failed" | "cancelled"
}

export function derivePageOcrProgress(totalPages: number, statuses: readonly PageOcrStatus[]): PageOcrProgress {
  const c = (s: PageOcrStatus) => statuses.filter((x) => x === s).length
  const p = {
    totalPages,
    eligible: c("eligible"),
    needsReview: c("needs_review"),
    notRequired: c("not_required"),
    queued: c("queued"),
    rendering: c("rendering"),
    recognizing: c("recognizing"),
    completed: c("completed"),
    completedWithWarnings: c("completed_with_warnings"),
    noTextDetected: c("no_text_detected"),
    failed: c("failed"),
    unsupported: c("unsupported"),
    cancelled: c("cancelled"),
  }
  const active = p.queued + p.rendering + p.recognizing
  const done = p.completed + p.completedWithWarnings + p.noTextDetected
  const terminal = done + p.failed + p.unsupported + p.cancelled
  const inScope = active + terminal
  const outcome: PageOcrProgress["outcome"] =
    inScope === 0
      ? "idle"
      : active > 0
        ? "running"
        : p.failed + p.unsupported + p.cancelled === 0
          ? "completed"
          : done === 0
            ? p.cancelled > 0 && p.failed === 0
              ? "cancelled"
              : "failed"
            : "partial"
  return { ...p, inScope, scopePercent: inScope ? Math.floor((terminal / inScope) * 100) : null, outcome }
}

/* ───────────────────────── Page quality warnings ───────────────────────── */

/** Characters that commonly indicate mathematical notation. Flags only; Task 8 owns math OCR. */
const MATH_HINT = /[=±×÷√∑∫∂∞≈≠≤≥^]|\b[a-z]\s*[²³]|[α-ωΑ-Ω]/u

/** Warnings from measured page/render evidence. Never invented; each is tied to a concrete check. */
export function pageQualityWarnings(input: {
  sourceImageDpi: number | null
  renderReducedFrom: number | null
  renderDpi: number
  meanConfidence: number | null
  normalizedText: string
  pageClass: PageClass
  rotate: number
}): string[] {
  const w: string[] = []
  if (input.sourceImageDpi != null && input.sourceImageDpi < 150) {
    w.push(`The scanned image is about ${Math.round(input.sourceImageDpi)} DPI (low resolution); small text may be misread.`)
  }
  if (input.renderReducedFrom != null) {
    w.push(`The page was rendered at ${input.renderDpi} DPI instead of ${input.renderReducedFrom} DPI to stay within the pixel limit.`)
  }
  if (input.meanConfidence != null && input.meanConfidence < 50) {
    w.push("Overall engine confidence is low. Contrast, blur, skew or handwriting may be affecting recognition; handwriting is not reliably supported.")
  }
  if (input.pageClass === "scanned_with_text_layer" || input.pageClass === "mixed") {
    w.push("This page already has a selectable text layer. OCR text is kept separately and was not merged with it.")
  }
  if (input.rotate !== 0) w.push(`The page has a /Rotate of ${input.rotate}°; it was rendered in its displayed orientation.`)
  if (input.normalizedText && MATH_HINT.test(input.normalizedText)) {
    w.push("Possible mathematical notation was recognised as plain text. Formulas are not validated in this step.")
  }
  return w
}
