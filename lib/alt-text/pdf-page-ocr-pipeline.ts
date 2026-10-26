import "server-only"
import { createHash } from "node:crypto"
import { PDFName, PDFNumber } from "pdf-lib"
import { readPdfPackage, PdfPackageError } from "./pdf-package"
import { classifyPage, planRender, pageQualityWarnings, COORDINATE_SYSTEMS, rasterBoxToNorm, rasterBoxToPdf } from "./pdf-page-ocr-contract"
import { PDF_PAGE_OCR_LIMITS, type PageOcrPage, type PageOcrRequest, type PageOcrResult } from "./pdf-page-ocr-types"
import { openPdfForRender } from "./pdf-page-renderer"
import { recognizeImage, modelsForMode, OCR_ENGINE_VERSION } from "./ocr-engine"
import { buildRecognitionResult } from "./ocr-service"
import { pageOcrIdentity } from "./pdf-page-ocr-identity"
import { deriveOcrStatus } from "./ocr-contract"

export const sourceHash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")

/** Reuses the bounded document parser; no extraction, new image occurrences or source writes. */
export async function inspectPdfPages(documentId: number, bytes: Uint8Array, confirmedTextImages: ReadonlySet<string> = new Set()): Promise<PageOcrPage[]> {
  const pkg = await readPdfPackage(bytes, { collectText: true, retainDocument: true })
  if (pkg.totalPages > PDF_PAGE_OCR_LIMITS.maxPages) throw new PdfPackageError("PAGE_COUNT_LIMIT", `Page OCR supports at most ${PDF_PAGE_OCR_LIMITS.maxPages} pages.`)
  const hash = sourceHash(bytes)
  return pkg.document!.getPages().map((page, pageIndex) => {
    const text = pkg.text!.pages[pageIndex]
    const nativeText = text.runs.filter((r) => !r.artifact).map((r) => r.text).join("\n").slice(0, 20_000)
    const images = pkg.occurrences.filter((o) => o.pageIndex === pageIndex && o.classification !== "mask")
    const image = images.reduce<(typeof images)[number] | null>((max, o) => !max || o.pageCoverage > max.pageCoverage ? o : max, null)
    const evidence = { pageIndex, textChars: nativeText.replace(/\s/gu, "").length,
      textCoverage: Math.min(1, text.runs.reduce((s, r) => s + Math.max(0, r.box.x1 - r.box.x0) * Math.max(0, r.box.y1 - r.box.y0), 0) / (text.width * text.height)),
      undecodableRuns: text.undecodable, imageCount: images.length,
      totalImagePixels: images.reduce((n,o) => n + (o.image ? o.image.width * o.image.height : 0),0), maxImageCoverage: image?.pageCoverage ?? 0,
      fullPageRaster: images.some((o) => o.classification === "likely_scanned_page"),
      confirmedRasterText: images.some((o) => o.classification === "likely_scanned_page" && confirmedTextImages.has(o.sourceLocator)), vectorOnly: text.vectorOnly === true }
    const classification = classifyPage(evidence)
    if (pkg.text!.truncated) { classification.needsReview = true; classification.ocrRecommended = false; classification.reasons.push("Parser text limits were reached; page evidence may be incomplete.") }
    const media = page.getMediaBox(), crop = page.getCropBox()
    const rotate = ((page.getRotation().angle % 360 + 360) % 360) as 0 | 90 | 180 | 270
    const rawUnit = page.node.lookup(PDFName.of("UserUnit"))
    const userUnit = rawUnit instanceof PDFNumber ? rawUnit.asNumber() : 1
    const width = Math.max(0, Math.min(media.x + media.width, crop.x + crop.width) - Math.max(media.x, crop.x)) * userUnit
    const height = Math.max(0, Math.min(media.y + media.height, crop.y + crop.height) - Math.max(media.y, crop.y)) * userUnit
    const geometry = { mediaBox: [media.x, media.y, media.x + media.width, media.y + media.height] as [number,number,number,number],
      cropBox: [crop.x, crop.y, crop.x + crop.width, crop.y + crop.height] as [number,number,number,number], rotate, userUnit,
      displayWidthPt: rotate % 180 ? height : width, displayHeightPt: rotate % 180 ? width : height }
    const plan = planRender(geometry.displayWidthPt, geometry.displayHeightPt)
    const oversizedImage = evidence.totalImagePixels > 25_000_000
    let sourceImageDpi: number | null = null
    if (image?.image) {
      const [a,b,c,d] = image.ctm
      const dpi = Math.min(image.image.width * 72 / (Math.hypot(a,b) * userUnit), image.image.height * 72 / (Math.hypot(c,d) * userUnit))
      if (Number.isFinite(dpi) && dpi > 0) sourceImageDpi = dpi
    }
    return { pageIndex, pageNumber: pageIndex + 1, sourceSha256: hash, classification, evidence, geometry, nativeText, sourceImageDpi,
      status: !plan.ok || oversizedImage ? "unsupported" : classification.needsReview ? "needs_review" : classification.ocrRecommended ? "eligible" : "not_required",
      attempts: 0, jobId: null, errorCode: !plan.ok ? plan.code : oversizedImage ? "SOURCE_IMAGE_PIXEL_LIMIT" : null, result: null, updatedAt: new Date().toISOString() }
  })
}

export function executionIdentity(documentId: number, page: PageOcrPage, request: Extract<PageOcrRequest, { action: "recognize" }>) {
  return pageOcrIdentity({ documentId, sourceSha256: page.sourceSha256, pageIndex: page.pageIndex, languageMode: request.languageMode,
    dpi: request.dpi, segmentation: request.segmentation, engineVersion: OCR_ENGINE_VERSION, modelSha256s: modelsForMode(request.languageMode).map((m) => m.sha256) })
}

/** One bounded page; status callbacks are durable and fenced by the caller. No source modification. */
export async function recognizePdfPage(input: { documentId: number; page: PageOcrPage; bytes: Uint8Array; runId: number;
  request: Extract<PageOcrRequest, { action: "recognize" }>; onRecognizing: () => Promise<void>; guard: () => Promise<void> }): Promise<PageOcrResult> {
  const { documentId, page, request } = input
  if (sourceHash(input.bytes) !== page.sourceSha256) throw new Error("SOURCE_VERSION_MISMATCH")
  const renderer = await openPdfForRender(input.bytes)
  try {
    // Upsampling a 200-DPI scan to 300/400 adds no evidence and degraded Hindi in the smoke set.
    // Keep the selected DPI as a ceiling, with source-aware rendering and an explicit warning.
    const targetDpi = page.sourceImageDpi == null ? request.dpi : Math.min(request.dpi, Math.max(150, Math.round(page.sourceImageDpi)))
    const raster = await renderer.renderPage(page.pageNumber, { targetDpi })
    await input.guard()
    await input.onRecognizing()
    const rec = await recognizeImage({ bytes: raster.png, languageMode: request.languageMode, segmentation: request.segmentation, timeoutMs: 120_000 })
    await input.guard()
    const built = buildRecognitionResult(rec, { orientationMatches: true, orientation: 1, orientationUnknown: false, languageMode: request.languageMode })
    const warnings = [...built.warnings, ...pageQualityWarnings({ sourceImageDpi: page.sourceImageDpi, renderReducedFrom: raster.reducedFrom,
      renderDpi: raster.dpi, meanConfidence: built.meanConfidence, normalizedText: built.normalizedText, pageClass: page.classification.pageClass, rotate: raster.rotate })]
    if (targetDpi < request.dpi) warnings.push(`Source image resolution limited rendering to ${targetDpi} DPI instead of upsampling to ${request.dpi} DPI.`)
    const lines = (built.layout?.lines ?? []).flatMap((line, lineIndex) => {
      const pageNorm = rasterBoxToNorm(line.box, raster.width, raster.height), pdfUser = rasterBoxToPdf(line.box, raster.viewportTransform)
      return pageNorm && pdfUser ? [{ lineIndex, pageNorm, pdfUser }] : []
    })
    if (lines.length !== (built.layout?.lines.length ?? 0)) warnings.push("Some engine boxes were invalid and could not be mapped to the page.")
    return { ...built, warnings, status: deriveOcrStatus({ normalizedText: built.normalizedText, meanConfidence: built.meanConfidence, warnings }),
      schemaVersion: 1, sourceType: "ocr_page_text", untrustedSource: true, documentId, pageIndex: page.pageIndex, pageNumber: page.pageNumber,
      sourceSha256: page.sourceSha256, runId: input.runId, identity: executionIdentity(documentId, page, request),
      languageMode: rec.languageMode, loadedLanguages: rec.loadedLanguages, models: rec.models, engineVersion: OCR_ENGINE_VERSION,
      segmentation: request.segmentation, createdAt: new Date().toISOString(),
      render: { ...page.geometry, ...raster, png: undefined } as PageOcrResult["render"], coordinateSystems: COORDINATE_SYSTEMS, lines }
  } finally { await renderer.destroy() }
}
