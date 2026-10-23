/**
 * @file lib/alt-text/document-extraction.ts
 * @module Publishing · Alt Text
 * @kind Server-side library
 * @summary Phase 3 — routes an extraction request to the extractor for the document's real
 *   (persisted) type. PPTX (Task 5) and PDF (Task 7) are available; DOCX is not implemented yet.
 * @usedBy app/api/alt-text/documents/[uploadId]/extract/route.ts
 */
import "server-only"
import { getDocumentForExtraction } from "./document-service"
import { fail, type ExtractionResult } from "./document-extraction-run"
import type { DocumentOwnerScope } from "./document-store"
import { extractPdfImages } from "./pdf-extractor"
import { extractPptxImages } from "./pptx-extractor"

export async function extractDocumentImages(documentId: number, scope: DocumentOwnerScope): Promise<ExtractionResult> {
  const doc = await getDocumentForExtraction(documentId, scope)
  if (!doc) return fail(404, "NOT_FOUND", "The document could not be found.")
  if (doc.documentType === "pptx") return extractPptxImages(documentId, scope)
  if (doc.documentType === "pdf") return extractPdfImages(documentId, scope)
  return fail(415, "UNSUPPORTED_DOCUMENT_TYPE", "Word (DOCX) image extraction is not available yet.")
}
