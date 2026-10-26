/** Browser-safe API contract. Page indexes are zero-based; display numbers are one-based. */
import { isOcrLanguageMode, type OcrLanguageMode, type OcrPageSegmentation, type OcrResult, type OcrModelReference } from "./ocr-contract"
import type { PageClassification, PageEvidence, PageGeometry, PageOcrProgress, PageOcrStatus, Matrix6, NormRect, PdfRect, DocumentClass } from "./pdf-page-ocr-contract"

export const PDF_PAGE_OCR_LIMITS = { maxPages: 500, pageSize: 25, maxAttempts: 3, maxResultBytes: 2_000_000 } as const
export type PageOcrRequest = { action: "inspect" } | {
  action: "recognize"; mode: "auto" | "selected" | "retry" | "reprocess"
  pages: number[]; languageMode: OcrLanguageMode; dpi: number; segmentation: OcrPageSegmentation
}
export function parsePageOcrRequest(body: unknown): PageOcrRequest | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null
  const b = body as Record<string, unknown>
  const allowed = b.action === "inspect" ? ["action"] : ["action", "mode", "pages", "languageMode", "dpi", "segmentation", "confirmReprocess"]
  if (Object.keys(b).some((key) => !allowed.includes(key))) return null
  if (b.action === "inspect") return { action: "inspect" }
  if (b.action !== "recognize" || !["auto", "selected", "retry", "reprocess"].includes(String(b.mode)) || !isOcrLanguageMode(b.languageMode)) return null
  if (!Array.isArray(b.pages) || b.pages.length > PDF_PAGE_OCR_LIMITS.maxPages || b.pages.some((p) => !Number.isInteger(p) || p < 0 || p >= PDF_PAGE_OCR_LIMITS.maxPages)) return null
  if (b.mode === "selected" || b.mode === "reprocess") { if (!b.pages.length) return null }
  if (b.mode === "reprocess" && b.confirmReprocess !== true) return null
  if (!Number.isInteger(b.dpi) || Number(b.dpi) < 150 || Number(b.dpi) > 400) return null
  if (!["auto", "single_block", "single_line", "sparse_text"].includes(String(b.segmentation))) return null
  return { action: "recognize", mode: b.mode as "auto" | "selected" | "retry" | "reprocess", pages: [...new Set(b.pages as number[])].sort((a,b) => a-b), languageMode: b.languageMode, dpi: Number(b.dpi), segmentation: b.segmentation as OcrPageSegmentation }
}
export type PageOcrResult = Pick<OcrResult, "rawText" | "normalizedText" | "layout" | "warnings" | "meanConfidence" | "status" | "scriptHints" | "durationMs"> & {
  schemaVersion: 1; sourceType: "ocr_page_text"; untrustedSource: true
  documentId: number; pageIndex: number; pageNumber: number; runId: number; identity: string
  sourceSha256: string; languageMode: OcrLanguageMode; loadedLanguages: string; models: OcrModelReference[]
  engineVersion: string; createdAt: string; segmentation: OcrPageSegmentation
  render: PageGeometry & { width: number; height: number; dpi: number; reducedFrom: number | null; viewportTransform: Matrix6 }
  coordinateSystems: Record<string, string>
  lines: { lineIndex: number; pageNorm: NormRect; pdfUser: PdfRect }[]
}
export type PageOcrPage = {
  pageIndex: number; pageNumber: number; sourceSha256: string; classification: PageClassification
  evidence: PageEvidence; geometry: PageGeometry; nativeText: string; sourceImageDpi: number | null
  status: PageOcrStatus; attempts: number; jobId: number | null; errorCode: string | null
  result: PageOcrResult | null; updatedAt: string
}
export type PageOcrPolicy = { enabled: boolean; reason: string | null; defaultMode: OcrLanguageMode; modes: { id: OcrLanguageMode; label: string; available: boolean; reason: string | null }[] }
export type PageOcrResponse = {
  pages: PageOcrPage[]; total: number; offset: number; documentClass: DocumentClass
  progress: PageOcrProgress; policy: PageOcrPolicy; canRun: boolean
  job: { id: number; status: string; action: string; outcome: string | null; errorCode: string | null } | null
}

/** Explicit selection is required for photos, mixed pages and existing native text. */
export function canSelectPage(page: Pick<PageOcrPage, "status" | "classification" | "nativeText" | "result">, request: Extract<PageOcrRequest, { action: "recognize" }>): boolean {
  if (["queued", "rendering", "recognizing", "unsupported"].includes(page.status)) return false
  if (request.mode === "reprocess") return true
  if (request.mode === "retry") return ["failed", "cancelled"].includes(page.status)
  if (page.result || page.nativeText.trim()) return false
  if (request.mode === "auto") return page.classification.ocrRecommended && !page.classification.needsReview && page.status === "eligible"
  return ["eligible", "needs_review", "not_required", "failed", "cancelled"].includes(page.status)
}
