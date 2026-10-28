/**
 * @file lib/alt-text/document-context-service.ts
 * @module Publishing · Alt Text
 * @kind Server service
 * @summary Phase 3 Task 9 — analyze document text around each extracted image occurrence and persist a
 *   bounded, untrusted, provenance-tagged context on the existing `alt_text_document_images` row.
 *   Reuses the Task 7/8 package readers (`collectText`) once per document — never once per image —
 *   and never changes extraction state, source alt text, assets, credits or billing. No AI calls.
 */
import "server-only"
import { createHash } from "node:crypto"
import { documentContextSource, contextSourceMatches, contextOcrMatches } from "./document-context-source"
import { buildDocumentContextPacket } from "./document-context-packet"
import { getSettingsRecord } from "./store"
import { normalizeAccessibilityPreferences } from "./accessibility-settings"
import type { DocumentOwnerScope } from "./document-store"
import { getDocumentImage, getDocumentImageContext, getDocumentImages, saveDocumentImageContexts, type SaveImageContextInput } from "./document-store"
import { DOCUMENT_IMAGE_PAGE_MAX, type DocumentImageRecord } from "./document-records"
import { getDocumentForExtraction } from "./document-service"
import { fail, logName, readVerifiedOriginal, type ExtractionFailure } from "./document-extraction-run"
import {
  buildDocumentImageContext,
  DOCUMENT_CONTEXT_VERSION,
  parseStoredContext,
  type ContextEvidence,
  type ContextLimits,
  type DocumentImageContext,
} from "./document-context"
import { buildPdfContextEvidence } from "./pdf-context"
import { buildPptxContextEvidence } from "./pptx-context"
import { readPdfPackage } from "./pdf-package"
import { readPptxPackage } from "./pptx-package"
import { getSettings } from "./store"
import { ALT_TEXT_UPLOAD_MAX_MB } from "./upload"
import { addPageOcrEvidence } from "./pdf-page-ocr-context"

export const CONTEXT_ANALYSIS_LIMITS = {
  /** Same synchronous ceiling as extraction; larger files need background processing (not in scope). */
  maxDocumentBytes: ALT_TEXT_UPLOAD_MAX_MB * 1024 * 1024,
  /** Occurrences analyzed per request. Above this the request is rejected rather than half-done. */
  maxImages: 2000,
} as const

export type ContextAnalysisSummary = { analyzed: number; unavailable: number; failed: number; total: number }
export type ContextAnalysisResult = { ok: true; summary: ContextAnalysisSummary; context?: DocumentImageContext | null } | ExtractionFailure

const READY_STATUSES = new Set(["extracted", "partially_extracted", "failed", "unsupported"])

async function loadOccurrences(documentId: number, imageId: number | undefined): Promise<DocumentImageRecord[] | ExtractionFailure> {
  if (imageId != null) {
    const one = await getDocumentImage(documentId, imageId)
    return one ? [one] : fail(404, "NOT_FOUND", "The image could not be found.")
  }
  const all: DocumentImageRecord[] = []
  for (let offset = 0; ; offset += DOCUMENT_IMAGE_PAGE_MAX) {
    const page = await getDocumentImages(documentId, { limit: DOCUMENT_IMAGE_PAGE_MAX, offset })
    all.push(...page)
    if (all.length > CONTEXT_ANALYSIS_LIMITS.maxImages) return fail(413, "TOO_MANY_IMAGES", "This document has too many images to analyze at once.")
    if (page.length < DOCUMENT_IMAGE_PAGE_MAX) return all
  }
}

/** Parse the stored original once and return evidence keyed by occurrence `sourceLocator`. */
async function readEvidence(type: "pdf" | "pptx", bytes: Buffer): Promise<{ ok: true; map: Map<string, ContextEvidence> } | ExtractionFailure> {
  try {
    // All occurrences are passed (not only the requested one) so caption sharing / multi-image warnings stay correct.
    if (type === "pdf") {
      const pkg = await readPdfPackage(new Uint8Array(bytes), { collectText: true })
      return { ok: true, map: buildPdfContextEvidence(pkg.occurrences, pkg.text) }
    }
    const pkg = readPptxPackage(bytes, { collectText: true })
    return { ok: true, map: buildPptxContextEvidence(pkg.occurrences, pkg.text) }
  } catch (err) {
    console.error("[alt-text/context] parse failed", logName(err))
    return fail(422, "INVALID_DOCUMENT", "The document text could not be read for context analysis.")
  }
}

/**
 * Analyze every occurrence of a document (or one, with `imageId`). Idempotent: each run overwrites the
 * context of the same rows; nothing else on the row changes. Safe to retry after interruption.
 */
export async function analyzeDocumentContexts(
  documentId: number,
  scope: DocumentOwnerScope,
  opts: { imageId?: number; limits?: Partial<ContextLimits> } = {},
): Promise<ContextAnalysisResult> {
  const doc = await getDocumentForExtraction(documentId, scope)
  if (!doc) return fail(404, "NOT_FOUND", "The document could not be found.")
  if (doc.securityStatus !== "clean") return fail(409, "DOCUMENT_NOT_CLEAN", "The document has not passed the security scan.")
  if (doc.documentType === "docx") return fail(415, "CONTEXT_NOT_SUPPORTED", "DOCX image extraction is not available yet, so there are no images to analyze.")
  if (!READY_STATUSES.has(doc.processingStatus)) return fail(409, "EXTRACTION_REQUIRED", "Extract the document images before analyzing context.")

  const occurrences = await loadOccurrences(doc.id, opts.imageId)
  if (!Array.isArray(occurrences)) return occurrences
  if (occurrences.length === 0) return { ok: true, summary: { analyzed: 0, unavailable: 0, failed: 0, total: 0 }, context: opts.imageId != null ? null : undefined }

  const original = await readVerifiedOriginal(doc, CONTEXT_ANALYSIS_LIMITS.maxDocumentBytes)
  if (!original.ok) return original
  const source = await documentContextSource(doc)
  if (!source) return fail(409,"DOCUMENT_SOURCE_CHANGED","The document source is no longer current. Reload before analyzing context.")
  const sourceSha256 = createHash("sha256").update(original.bytes).digest("hex")
  if (source.sourceSha256 && source.sourceSha256 !== sourceSha256) return fail(409,"DOCUMENT_SOURCE_CHANGED","The source document changed while its context was being analyzed.")

  const evidence = await readEvidence(doc.documentType, original.bytes)
  if (!evidence.ok) return evidence
  const byLocator = evidence.map

  const settings = await getSettings()
  const contextSettings = {
    outputLanguage: settings.defaultLanguage,
    targetAudience: settings.defaultAudience,
    // No separate title column; the embedded PDF/PPTX title (from the package reader) takes precedence in the builder.
    documentTitle: doc.filename.replace(/\.[a-z0-9]{1,5}$/i, "") || null,
    subject: null,
    grade: null,
    topic: null,
  }

  const entries: SaveImageContextInput[] = []
  const summary: ContextAnalysisSummary = { analyzed: 0, unavailable: 0, failed: 0, total: occurrences.length }
  let single: DocumentImageContext | null = null
  for (const occ of occurrences) {
    let ev = byLocator.get(occ.sourceLocator)
    if (!ev) {
      // The occurrence no longer maps to the parsed document (should not happen for an unchanged original).
      entries.push({ imageId: occ.id, status: "failed", confidence: "unavailable", version: DOCUMENT_CONTEXT_VERSION, context: null })
      summary.failed++
      continue
    }
    if (doc.documentType === "pdf" && ev.location?.page != null) ev = await addPageOcrEvidence(doc.id, ev.location.page, ev, {sourceSha256,imagePosition:occ.imagePosition})
    const meta = occ.sourceMetadata as Record<string, unknown> | null
    const rawAlt = meta?.originalDescription ?? meta?.altText
    const sourceAlt = typeof rawAlt === "string" && rawAlt.trim() ? rawAlt : null
    const merged: ContextEvidence = ev.existingAlt || !sourceAlt ? ev : { ...ev, existingAlt: { text: sourceAlt, source: { kind: "source_metadata", ref: occ.sourceLocator } } }
    const ctx = buildDocumentImageContext({ documentId: doc.id, imageOccurrenceId: occ.id, documentType: doc.documentType, evidence: merged, settings: contextSettings, limits: opts.limits,sourceBinding:{sourceSha256,sourceRevision:source.sourceRevision,sourceLocator:occ.sourceLocator,imageSha256:occ.mediaSha256??null} })
    const status = ctx.confidence === "unavailable" ? "unavailable" : "analyzed"
    summary[status === "analyzed" ? "analyzed" : "unavailable"]++
    entries.push({ imageId: occ.id, status, confidence: ctx.confidence, version: DOCUMENT_CONTEXT_VERSION, context: ctx as unknown as Record<string, unknown> })
    if (opts.imageId === occ.id) single = ctx
  }

  const saved = await saveDocumentImageContexts(doc.id, entries)
  if (!saved.ok) return fail(500, "CONTEXT_SAVE_FAILED", "The document context could not be saved.")
  return { ok: true, summary, ...(opts.imageId != null ? { context: single } : {}) }
}

export function analyzeDocumentImageContext(documentId: number, imageId: number, scope: DocumentOwnerScope, limits?: Partial<ContextLimits>) {
  return analyzeDocumentContexts(documentId, scope, { imageId, limits })
}

export type ImageContextView =
  | { ok: true; imageId: number; imageAssetId?:number|null; packet?:import("./document-context-packet").DocumentContextPacket|null; status: "analyzed" | "unavailable" | "failed" | "not_analyzed"; analyzedAt: string | null; stale: boolean; context: DocumentImageContext | null }
  | ExtractionFailure

/** Read the stored context only — never triggers analysis. */
export async function readDocumentImageContext(documentId: number, imageId: number, scope: DocumentOwnerScope): Promise<ImageContextView> {
  const doc = await getDocumentForExtraction(documentId, scope)
  if (!doc) return fail(404, "NOT_FOUND", "The document could not be found.")
  if (doc.securityStatus !== "clean") return fail(409,"DOCUMENT_NOT_CLEAN","The source document has not passed its security scan.")
  const stored = await getDocumentImageContext(doc.id, imageId)
  if (!stored) return fail(404, "NOT_FOUND", "The image could not be found.")
  const context = parseStoredContext(stored.context)
  const occurrence = context ? await getDocumentImage(doc.id,imageId) : null
  const source = context ? await documentContextSource(doc) : null
  const stale = stored.status != null && (stored.version !== DOCUMENT_CONTEXT_VERSION || !context || context.documentId !== documentId || context.imageOccurrenceId !== imageId || !occurrence || !contextSourceMatches(context,source,occurrence) || !await contextOcrMatches(context))
  let packet=null
  if(context&&!stale){const record=await getSettingsRecord(),p=normalizeAccessibilityPreferences(record.accessibility).preferences.descriptions;packet=buildDocumentContextPacket(context,{enabled:p.useDocumentContext,speakerNotes:p.includeSpeakerNotes,sourceAlt:p.preserveExistingAlt})}
  return { ok: true, imageId: stored.imageId, status: stored.status ?? "not_analyzed", analyzedAt: stored.analyzedAt, stale, context: !stale ? context : null, ...(context&&!stale?{imageAssetId:occurrence?.altTextAssetId??null,packet}:{}) }
}
