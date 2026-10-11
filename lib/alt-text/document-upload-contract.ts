/**
 * @file lib/alt-text/document-upload-contract.ts
 * @module Publishing · Alt Text
 * @kind Browser-safe contract
 * @summary Phase 3 Task 3 — single source of document upload limits, the upload
 *   reference returned to clients, and the scan → security status mapping.
 *   Imported by both the server upload service and the Document Processing UI.
 */

const MIB = 1024 * 1024

/**
 * Feature ceilings. The server additionally clamps the per-file size to the
 * tenant's storage setting (`storage.max_upload_mb`), so the stricter one wins.
 */
export const DOCUMENT_UPLOAD_LIMITS = {
  maxFileMb: 25,
  maxFiles: 10,
  maxSelectionMb: 100,
  maxConcurrentUploads: 2,
} as const

/** Office package (ZIP) inspection ceilings — ZIP-bomb and parser-abuse protection. */
export const DOCUMENT_ARCHIVE_LIMITS = {
  maxEntries: 5000,
  maxUncompressedBytes: 250 * MIB,
  maxEntryRatio: 200,
  maxXmlPartBytes: 4 * MIB,
  maxRelationshipParts: 2000,
  maxXmlBudgetBytes: 32 * MIB,
} as const

/** Security verdict surfaced to clients (derived from the storage scan record). */
export type DocumentSecurityStatus = "scanning" | "clean" | "quarantined" | "held"

/** Whether the stored document may be handed to extraction (Task 4). */
export type DocumentProcessingStatus = "scanning" | "ready_for_processing" | "quarantined" | "held_for_review"

export type DocumentUploadReference = {
  /** Stable server-generated identifier for Task 4 to reference. */
  uploadId: string
  /** Persisted alt_text_documents.id (Task 4); null only for a legacy upload that has no record yet. */
  documentId: number | null
  /** The storage facade's file reference (FILE-000123); never the raw object key. */
  storageReferenceId: string
  filename: string
  extension: string
  mimeType: string
  size: number
  uploadStatus: "uploaded"
  securityStatus: DocumentSecurityStatus
  processingStatus: DocumentProcessingStatus
  securityDetail: string | null
  uploadedAt: string
}

type ScanLike = { scanStatus: "pending" | "scanning" | "clean" | "infected" | "error"; approved: boolean } | null

/**
 * Map the storage scan record to the document security contract. A document is
 * only `ready_for_processing` once the scan is clean or an administrator has
 * released it — never before. Infected files are terminal.
 */
export function deriveDocumentSecurity(scan: ScanLike): {
  securityStatus: DocumentSecurityStatus
  processingStatus: DocumentProcessingStatus
  securityDetail: string | null
} {
  if (!scan || scan.scanStatus === "pending" || scan.scanStatus === "scanning") {
    if (scan?.approved) return { securityStatus: "clean", processingStatus: "ready_for_processing", securityDetail: "Released by an administrator" }
    return { securityStatus: "scanning", processingStatus: "scanning", securityDetail: "Security scan in progress" }
  }
  if (scan.scanStatus === "clean") return { securityStatus: "clean", processingStatus: "ready_for_processing", securityDetail: null }
  if (scan.scanStatus === "infected")
    return { securityStatus: "quarantined", processingStatus: "quarantined", securityDetail: "Malware detected. The document is quarantined." }
  if (scan.approved) return { securityStatus: "clean", processingStatus: "ready_for_processing", securityDetail: "Released by an administrator" }
  return {
    securityStatus: "held",
    processingStatus: "held_for_review",
    securityDetail: "The security scan could not complete. The document is held until it is rescanned or released by an administrator.",
  }
}

export const isDocumentScanSettled = (status: DocumentProcessingStatus) => status !== "scanning"
