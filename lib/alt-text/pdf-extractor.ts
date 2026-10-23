/**
 * @file lib/alt-text/pdf-extractor.ts
 * @module Publishing · Alt Text
 * @kind Server-side library
 * @summary Phase 3 Task 7 — synchronous PDF image extraction on the same pipeline as PPTX:
 *   every image drawing occurrence becomes an `alt_text_document_images` row; occurrences whose
 *   binary can be preserved (JPEG) or faithfully converted (raw samples → PNG) also become a
 *   regular Alt Text asset. Existing tagged-PDF /Alt is kept as `originalDescription` only when
 *   tied to exactly one occurrence. Never generates AI text, never approves anything and never
 *   modifies the original PDF. Safe to repeat: finished occurrences are skipped.
 * @usedBy lib/alt-text/document-extraction.ts
 */
import "server-only"
import type { DocumentImageSourceMetadata } from "./document-records"
import { createDocumentImageMapping, type DocumentOwnerScope } from "./document-store"
import {
  MIB,
  fail,
  failRun,
  finalizeRun,
  loadRunSettings,
  logName,
  occurrenceFinisher,
  openDocumentForExtraction,
  persistOccurrenceImage,
  runPool,
  summarize,
  type ExtractionResult,
  type RunSettings,
} from "./document-extraction-run"
import { decodePdfImage, describeImageSpec, type DecodeProblem, type DecodedImage } from "./pdf-image-decode"
import { PdfPackageError, readPdfPackage, type PdfOccurrence } from "./pdf-package"

export const PDF_SYNC_LIMITS = {
  maxDocumentBytes: 25 * MIB,
  /** Decoding is CPU-bound; two workers keep storage I/O overlapped without hogging the event loop. */
  concurrency: 2,
  /** Upper bound for decoded pixels of one image (RGBA). */
  maxDecodedBytes: 96 * MIB,
  maxDimension: 12_000,
} as const

const ALT_MAX = 2000
const clip = (s: string | null, max: number) => (s == null ? null : s.length > max ? s.slice(0, max) : s)

const DETECTED_FORMAT: Record<string, string> = {
  DCTDecode: "jpeg",
  JPXDecode: "jpeg2000",
  CCITTFaxDecode: "ccitt",
  JBIG2Decode: "jbig2",
}

function sourceMetadataFor(o: PdfOccurrence): DocumentImageSourceMetadata {
  const enc = o.image ? describeImageSpec(o.image) : null
  const codec = enc?.filters.find((f) => DETECTED_FORMAT[f])
  return {
    name: o.resourceName,
    originalDescription: clip(o.structure.alt, ALT_MAX),
    detectedFormat: codec ? DETECTED_FORMAT[codec] : enc ? "raw" : null,
    pdf: {
      pageIndex: o.pageIndex,
      pageLabel: o.pageLabel,
      objectRef: o.objectRef,
      resourceName: o.resourceName,
      kind: o.kind,
      ordinalOnPage: o.ordinalOnPage,
      parentForms: o.parentForms,
      classification: o.classification,
      pageCoverage: o.pageCoverage,
      artifact: o.artifact,
      encoding: enc ? { ...enc } : null,
      structure: {
        association: o.structure.association,
        mcid: o.structure.mcid,
        structRef: o.structure.structRef,
        actualText: clip(o.structure.actualText, 500),
        markedContentAlt: clip(o.structure.markedContentAlt, 500),
      },
    },
  }
}

type DecodeCache = { results: Map<string, DecodedImage | DecodeProblem>; remaining: Map<string, number> }

/** Decode once per underlying image; release the result after its last drawing occurrence. */
function decodeCached(cache: DecodeCache, o: PdfOccurrence): DecodedImage | DecodeProblem {
  let result = cache.results.get(o.cacheKey)
  if (!result) {
    result = decodePdfImage(o.image!, { maxDecodedBytes: PDF_SYNC_LIMITS.maxDecodedBytes, maxDimension: PDF_SYNC_LIMITS.maxDimension })
    cache.results.set(o.cacheKey, result)
  }
  const left = (cache.remaining.get(o.cacheKey) ?? 1) - 1
  cache.remaining.set(o.cacheKey, left)
  if (left <= 0) cache.results.delete(o.cacheKey)
  return result
}

async function processOccurrence(ctx: RunSettings, cache: DecodeCache, o: PdfOccurrence): Promise<boolean> {
  const created = await createDocumentImageMapping(ctx.doc.id, {
    sourceLocator: o.sourceLocator,
    occurrenceIndex: o.occurrenceIndex,
    pageNumber: o.pageNumber,
    imageRelationshipId: o.objectRef,
    imagePosition: { kind: "pdf_ctm", ctm: o.ctm, pageBox: o.pageBox, rotate: o.rotate },
    isDecorative: o.artifact,
    sourceMetadata: sourceMetadataFor(o),
    extractionStatus: "pending",
  })
  const consume = () => {
    if (!o.image) return
    const left = (cache.remaining.get(o.cacheKey) ?? 1) - 1
    cache.remaining.set(o.cacheKey, left)
    if (left <= 0) cache.results.delete(o.cacheKey)
  }
  if (!created.ok) {
    console.error("[alt-text/extract] occurrence not recorded", created.code)
    consume()
    return false
  }
  const image = created.image
  if (image.extractionStatus === "extracted" || image.extractionStatus === "unsupported") {
    consume()
    return true
  }
  const finish = occurrenceFinisher(ctx.doc, image)
  if (o.problem) return finish(o.problem.status, o.problem.code, o.problem.message)
  if (!o.image) return finish("failed", "INVALID_IMAGE", "The embedded image could not be read.")

  const decoded = decodeCached(cache, o)
  if (!decoded.ok) return finish(decoded.status, decoded.code, decoded.message)
  if (decoded.bytes.length > ctx.maxImageBytes) {
    return finish("unsupported", "IMAGE_TOO_LARGE", `Images must be ${Math.floor(ctx.maxImageBytes / MIB)} MB or smaller.`)
  }
  const where = o.pageLabel && o.pageLabel !== String(o.pageNumber) ? `page ${o.pageNumber} (${o.pageLabel})` : `page ${o.pageNumber}`
  const label = `${ctx.doc.filename.replace(/\.pdf$/i, "")} - ${where} - ${o.resourceName ?? "inline image"} ${o.ordinalOnPage + 1}`
  return persistOccurrenceImage(ctx, image, { bytes: decoded.bytes, mimeType: decoded.mimeType, label })
}

const PACKAGE_STATUS: Record<string, 413 | 422> = { TOO_MANY_IMAGES: 413, TOO_MANY_PAGES: 413, RESOURCE_LIMIT: 413 }

export async function extractPdfImages(documentId: number, scope: DocumentOwnerScope): Promise<ExtractionResult> {
  const opened = await openDocumentForExtraction(documentId, scope, "pdf", { maxDocumentBytes: PDF_SYNC_LIMITS.maxDocumentBytes, noun: "PDF" })
  if (!opened.ok) return opened
  if (opened.kind === "done") return summarize(opened.doc, { alreadyProcessed: true, totalSlides: null, totalPages: null, notExtracted: null, pdfReport: null, unrecorded: 0 })
  const { doc, bytes } = opened

  try {
    let pkg: Awaited<ReturnType<typeof readPdfPackage>>
    try {
      // Parse a copy so the verified original buffer can never be touched by the parser.
      pkg = await readPdfPackage(new Uint8Array(bytes))
    } catch (err) {
      if (err instanceof PdfPackageError) {
        const status = PACKAGE_STATUS[err.code] ?? 422
        const code = err.code === "TOO_MANY_IMAGES" || err.code === "TOO_MANY_PAGES" ? "REQUIRES_BACKGROUND_PROCESSING" : err.code
        return failRun(doc, fail(status, code, err.message))
      }
      throw err
    }

    const ctx = await loadRunSettings(doc)
    const cache: DecodeCache = { results: new Map(), remaining: new Map() }
    for (const o of pkg.occurrences) if (o.image) cache.remaining.set(o.cacheKey, (cache.remaining.get(o.cacheKey) ?? 0) + 1)

    let unrecorded = 0
    await runPool(pkg.occurrences, PDF_SYNC_LIMITS.concurrency, async (o) => {
      const recorded = await processOccurrence(ctx, cache, o).catch((err) => {
        console.error("[alt-text/extract] occurrence failed", logName(err))
        return false
      })
      if (!recorded) unrecorded++
    })
    return finalizeRun(doc, unrecorded, { totalSlides: null, totalPages: pkg.totalPages, notExtracted: null, pdfReport: pkg.report })
  } catch (err) {
    console.error("[alt-text/extract] extraction failed", logName(err))
    return failRun(doc, fail(500, "EXTRACTION_FAILED", "Extraction failed. Please try again."))
  }
}
