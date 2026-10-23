/**
 * @file lib/alt-text/pptx-extractor.ts
 * @module Publishing · Alt Text
 * @kind Server-side library
 * @summary Phase 3 Task 5 — synchronous PPTX image extraction. Re-checks the document's
 *   security verdict, claims the per-document lock, reads the private original, turns every
 *   picture occurrence into an `alt_text_document_images` row and (for JPEG/PNG/WEBP) a regular
 *   Alt Text asset. Never generates AI text, never approves anything and never modifies the
 *   original PPTX. Safe to repeat: finished occurrences are skipped, failed ones retried.
 *   Format-independent steps live in document-extraction-run.ts (shared with PDF, Task 7).
 * @usedBy lib/alt-text/document-extraction.ts
 */
import "server-only"
import { createHash } from "node:crypto"
import type { DocumentImageRecord, DocumentImageSourceMetadata } from "./document-records"
import { createDocumentImageMapping, updateDocumentImageMapping, type DocumentOwnerScope } from "./document-store"
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
import { classifyMedia } from "./media-format"
import { PptxPackageError, readPptxPackage, type PptxOccurrence, type PptxPackage } from "./pptx-package"

export { deriveDocumentProcessingStatus, type ExtractionFailure, type ExtractionSummary } from "./document-extraction-run"

/** Synchronous ceiling. Larger work belongs to the background queue (a later task). */
export const PPTX_SYNC_LIMITS = { maxDocumentBytes: 25 * MIB, concurrency: 3 } as const

function sourceMetadataFor(o: PptxOccurrence, detectedFormat: string | null): DocumentImageSourceMetadata {
  return {
    shapeId: o.shapeId,
    name: o.name,
    title: o.title,
    originalDescription: o.description,
    mediaPart: o.mediaPart,
    detectedFormat,
    groupPath: o.groupPath,
    slideRelationshipId: o.slideRelationshipId,
  }
}

async function processOccurrence(ctx: RunSettings, pkg: PptxPackage, o: PptxOccurrence): Promise<boolean> {
  const created = await createDocumentImageMapping(ctx.doc.id, {
    sourceLocator: o.sourceLocator,
    occurrenceIndex: o.occurrenceIndex,
    slideNumber: o.slideNumber,
    imageRelationshipId: o.mediaRelationshipId,
    isDecorative: o.decorative === true,
    sourceMetadata: sourceMetadataFor(o, null),
    extractionStatus: "pending",
  })
  if (!created.ok) {
    console.error("[alt-text/extract] occurrence not recorded", created.code)
    return false
  }
  const image = created.image
  if (image.extractionStatus === "extracted" || image.extractionStatus === "unsupported") return true
  const finish = occurrenceFinisher(ctx.doc, image)

  if (o.problem) return finish(o.problem.status, o.problem.code, o.problem.message)
  if (!o.mediaPart) return finish("failed", "MISSING_MEDIA", "The image file is missing from the presentation.")

  let bytes: Buffer
  try {
    bytes = pkg.readMedia(o.mediaPart, ctx.maxImageBytes)
  } catch (err) {
    if (err instanceof PptxPackageError && err.code === "MEDIA_TOO_LARGE") return finish("unsupported", "IMAGE_TOO_LARGE", `Images must be ${Math.floor(ctx.maxImageBytes / MIB)} MB or smaller.`)
    if (err instanceof PptxPackageError && err.code === "MISSING_MEDIA") return finish("failed", "MISSING_MEDIA", err.message)
    return finish("failed", "INVALID_IMAGE", "The embedded image is damaged.")
  }
  if (bytes.length === 0) return finish("failed", "INVALID_IMAGE", "The embedded image is empty.")

  const decision = classifyMedia(bytes)
  if (!decision.ok) {
    const sha = createHash("sha256").update(bytes).digest("hex")
    await updateDocumentImageMapping(ctx.doc.id, image.id, { mediaSha256: sha })
    return finish("unsupported", decision.code, decision.message)
  }
  const label = `${ctx.doc.filename.replace(/\.pptx$/i, "")} - slide ${o.slideNumber} - ${o.name ?? `image ${o.occurrenceIndex + 1}`}`
  return persistOccurrenceImage(ctx, image, { bytes, mimeType: decision.mimeType, label })
}

export async function extractPptxImages(documentId: number, scope: DocumentOwnerScope): Promise<ExtractionResult> {
  const opened = await openDocumentForExtraction(documentId, scope, "pptx", { maxDocumentBytes: PPTX_SYNC_LIMITS.maxDocumentBytes, noun: "presentation" })
  if (!opened.ok) return opened
  if (opened.kind === "done") return summarize(opened.doc, { alreadyProcessed: true, totalSlides: null, notExtracted: null, unrecorded: 0 })
  const { doc, bytes } = opened

  try {
    let pkg: PptxPackage
    try {
      pkg = readPptxPackage(bytes)
    } catch (err) {
      if (err instanceof PptxPackageError) {
        const status = err.code === "TOO_MANY_IMAGES" ? 413 : 422
        return failRun(doc, fail(status, err.code === "TOO_MANY_IMAGES" ? "REQUIRES_BACKGROUND_PROCESSING" : err.code, err.message))
      }
      throw err
    }

    const ctx = await loadRunSettings(doc)
    let unrecorded = 0
    await runPool(pkg.occurrences, PPTX_SYNC_LIMITS.concurrency, async (o) => {
      const recorded = await processOccurrence(ctx, pkg, o).catch((err) => {
        console.error("[alt-text/extract] occurrence failed", logName(err))
        return false
      })
      if (!recorded) unrecorded++
    })
    return finalizeRun(doc, unrecorded, { totalSlides: pkg.totalSlides, notExtracted: pkg.notExtracted })
  } catch (err) {
    console.error("[alt-text/extract] extraction failed", logName(err))
    return failRun(doc, fail(500, "EXTRACTION_FAILED", "Extraction failed. Please try again."))
  }
}

export type { DocumentImageRecord }
