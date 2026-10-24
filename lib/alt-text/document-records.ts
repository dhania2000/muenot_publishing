/**
 * @file lib/alt-text/document-records.ts
 * @module Publishing · Alt Text
 * @kind Browser-safe contract
 * @summary Phase 3 Task 4 — persisted document + image-occurrence record shapes and
 *   the status transition rules shared by the store, API and UI.
 *
 *   Statuses are deliberately separate:
 *   - upload:      alt_text_documents.upload_status        (bytes reached private storage)
 *   - security:    alt_text_documents.security_scan_status  (mirror of file_security_scans)
 *   - processing:  alt_text_documents.processing_status     (document-level extraction lifecycle)
 *   - extraction:  alt_text_document_images.extraction_status (per image occurrence)
 *   - AI:          alt_text_assets.status                   (existing generation/review lifecycle)
 */
import type { DocumentSecurityStatus } from "./document-upload-contract"

export const DOCUMENT_TYPES = ["pdf", "pptx", "docx"] as const
export type DocumentType = (typeof DOCUMENT_TYPES)[number]

export const DOCUMENT_UPLOAD_STATUSES = ["uploaded"] as const
export type DocumentUploadStatus = (typeof DOCUMENT_UPLOAD_STATUSES)[number]

export const DOCUMENT_SECURITY_STATUSES = ["scanning", "clean", "quarantined", "held"] as const satisfies readonly DocumentSecurityStatus[]

/**
 * `partially_extracted`: some occurrences were stored, others failed or are unsupported (retryable).
 * `unsupported`: every occurrence uses a format/structure the asset pipeline cannot accept (terminal).
 */
export const DOCUMENT_PROCESSING_STATUSES = ["pending", "extracting", "extracted", "partially_extracted", "unsupported", "failed"] as const
export type DocumentRecordProcessingStatus = (typeof DOCUMENT_PROCESSING_STATUSES)[number]

/** `unsupported`: recognised but not acceptable by the image asset pipeline (e.g. EMF, external link). Terminal. */
export const IMAGE_EXTRACTION_STATUSES = ["pending", "extracted", "failed", "unsupported"] as const
export type ImageExtractionStatus = (typeof IMAGE_EXTRACTION_STATUSES)[number]

export const DOCUMENT_LIST_LIMITS = { defaultPageSize: 25, maxPageSize: 100 } as const
export const DOCUMENT_IMAGE_PAGE_MAX = 200

/** Security mirror transitions. Quarantined (malware) is terminal: it can never become clean again. */
const SECURITY_NEXT: Record<DocumentSecurityStatus, readonly DocumentSecurityStatus[]> = {
  scanning: ["clean", "quarantined", "held"],
  held: ["scanning", "clean", "quarantined"],
  clean: ["scanning", "held", "quarantined"],
  quarantined: [],
}

const PROCESSING_NEXT: Record<DocumentRecordProcessingStatus, readonly DocumentRecordProcessingStatus[]> = {
  pending: ["extracting"],
  extracting: ["extracted", "partially_extracted", "unsupported", "failed"],
  failed: ["extracting"],
  partially_extracted: ["extracting"],
  extracted: [],
  unsupported: [],
}

const EXTRACTION_NEXT: Record<ImageExtractionStatus, readonly ImageExtractionStatus[]> = {
  pending: ["extracted", "failed", "unsupported"],
  failed: ["pending", "extracted", "unsupported"],
  extracted: [],
  unsupported: [],
}

export const canTransitionSecurity = (from: DocumentSecurityStatus, to: DocumentSecurityStatus) => from === to || SECURITY_NEXT[from].includes(to)
export const canTransitionProcessing = (from: DocumentRecordProcessingStatus, to: DocumentRecordProcessingStatus) => PROCESSING_NEXT[from].includes(to)
export const canTransitionExtraction = (from: ImageExtractionStatus, to: ImageExtractionStatus) => from === to || EXTRACTION_NEXT[from].includes(to)

/** Statuses a document may be in for the target security status to be applied. */
export const securityPredecessors = (to: DocumentSecurityStatus) => DOCUMENT_SECURITY_STATUSES.filter((from) => canTransitionSecurity(from, to))
export const processingPredecessors = (to: DocumentRecordProcessingStatus) => DOCUMENT_PROCESSING_STATUSES.filter((from) => canTransitionProcessing(from, to))

/** Extraction (Task 5+) may start (or retry failed occurrences) only from a verified-clean document. */
export const isExtractionReady = (d: { securityStatus: DocumentSecurityStatus; processingStatus: DocumentRecordProcessingStatus }) =>
  d.securityStatus === "clean" && (d.processingStatus === "pending" || d.processingStatus === "failed" || d.processingStatus === "partially_extracted")

export const isDocumentType = (v: unknown): v is DocumentType => typeof v === "string" && (DOCUMENT_TYPES as readonly string[]).includes(v)
export const isSecurityStatus = (v: unknown): v is DocumentSecurityStatus => typeof v === "string" && (DOCUMENT_SECURITY_STATUSES as readonly string[]).includes(v)
export const isProcessingStatus = (v: unknown): v is DocumentRecordProcessingStatus =>
  typeof v === "string" && (DOCUMENT_PROCESSING_STATUSES as readonly string[]).includes(v)
export const isExtractionStatus = (v: unknown): v is ImageExtractionStatus => typeof v === "string" && (IMAGE_EXTRACTION_STATUSES as readonly string[]).includes(v)

/**
 * Stable, document-specific identifier for one image occurrence (e.g. `ppt/slides/slide3.xml#rId4`,
 * `pdf:p12:xobj:Im3:0`). Printable ASCII without whitespace so it is safe to log and index.
 */
export const SOURCE_LOCATOR_RE = /^[\x21-\x7e]{1,255}$/
export const isSourceLocator = (v: unknown): v is string => typeof v === "string" && SOURCE_LOCATOR_RE.test(v)

/** Persisted document metadata safe to return to authorized clients (no storage keys or bytes). */
export type DocumentRecord = {
  id: number
  uploadId: string
  storageReferenceId: string
  projectId: number | null
  filename: string
  documentType: DocumentType
  mimeType: string
  size: number
  uploadStatus: DocumentUploadStatus
  securityStatus: DocumentSecurityStatus
  processingStatus: DocumentRecordProcessingStatus
  extractionReady: boolean
  extractedImageCount: number
  uploadedBy: number
  createdAt: string
  updatedAt: string
}

export type DocumentImageRecord = {
  id: number
  documentId: number
  altTextAssetId: number | null
  /** alt_text_assets.status of the linked asset (AI lifecycle), null until linked. */
  assetStatus: string | null
  sourceLocator: string
  occurrenceIndex: number
  pageNumber: number | null
  slideNumber: number | null
  imageRelationshipId: string | null
  imagePosition: Record<string, unknown> | null
  isDecorative: boolean
  mediaSha256: string | null
  /** Author-supplied metadata read from the source document. Never AI-generated, never auto-approved. */
  sourceMetadata: DocumentImageSourceMetadata | null
  extractionStatus: ImageExtractionStatus
  extractionErrorCode: string | null
  extractionErrorMessage: string | null
  /** Phase 3 Task 9 summary columns; the full context is served by the context endpoint. */
  contextStatus: "analyzed" | "unavailable" | "failed" | null
  contextConfidence: "high" | "medium" | "low" | "unavailable" | null
  contextAnalyzedAt: string | null
  createdAt: string
  updatedAt: string
}

export type DocumentImageSourceMetadata = {
  /** Picture/shape id (`p:cNvPr/@id`) within its slide. */
  shapeId?: string | null
  /** Original picture name (`p:cNvPr/@name`). */
  name?: string | null
  /** Original picture title (`p:cNvPr/@title`). */
  title?: string | null
  /** Original author alt text (`p:cNvPr/@descr`), preserved verbatim for Task 14 comparison. */
  originalDescription?: string | null
  /** Media part inside the package, e.g. `ppt/media/image3.png`. Not a storage key. */
  mediaPart?: string | null
  /** Format identified from the binary signature, e.g. `png`, `emf`. */
  detectedFormat?: string | null
  /** Ids of enclosing group shapes, outermost first. */
  groupPath?: string[]
  /** Slide relationship id from `p:sldIdLst` (presentation.xml). */
  slideRelationshipId?: string | null
  /** Phase 3 Task 7: PDF-specific source context (page, object, forms, encoding, tagging). */
  pdf?: PdfSourceMetadata
}

export type PdfSourceMetadata = {
  pageIndex: number
  pageLabel: string | null
  /** Indirect object reference of the Image XObject, e.g. `12 0 R` (null for inline images). */
  objectRef: string | null
  resourceName: string | null
  kind: "xobject" | "inline"
  ordinalOnPage: number
  parentForms: { name: string; ref: string | null }[]
  classification: "embedded_image" | "likely_scanned_page" | "mask"
  pageCoverage: number
  /** Drawn inside an /Artifact marked-content sequence (author flagged as non-content). */
  artifact: boolean
  encoding: {
    filters: string[]
    colorSpace: string | null
    bitsPerComponent: number | null
    pixelWidth: number
    pixelHeight: number
    softMask: boolean
    mask: "explicit" | "color_key" | null
    imageMask: boolean
  } | null
  structure: {
    association: "resolved" | "ambiguous" | "unresolved" | "no_figure" | "untagged"
    mcid: number | null
    structRef: string | null
    actualText: string | null
    markedContentAlt: string | null
  }
}

export const SOURCE_METADATA_MAX_JSON = 4096

/** Persisted per-status occurrence counts for one document. */
export type DocumentExtractionCounts = { total: number; pending: number; extracted: number; failed: number; unsupported: number }

export type DocumentImagesResponse = {
  success: true
  documentId: number
  processingStatus: DocumentRecordProcessingStatus
  counts: DocumentExtractionCounts
  images: DocumentImageRecord[]
  limit: number
  offset: number
}

export type DocumentListResponse = {
  success: true
  documents: DocumentRecord[]
  page: number
  pageSize: number
  total: number
}
