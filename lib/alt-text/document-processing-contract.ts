/**
 * @file lib/alt-text/document-processing-contract.ts
 * @module Publishing · Alt Text
 * @kind Shared contract (client-safe)
 * @summary Phase 3 Task 13 — read-only shapes for the Live Document AI Processing dashboard.
 *   Every count is an occurrence count (never unique binaries) derived from persisted rows.
 */
import type { DocumentRecord, DocumentType } from "./document-records"

export const PROCESSING_TYPE_FILTERS = { all: "All types", pdf: "PDF", pptx: "PPTX", docx: "DOCX" } as const
export type ProcessingTypeFilter = keyof typeof PROCESSING_TYPE_FILTERS
export const isProcessingTypeFilter = (v: unknown): v is ProcessingTypeFilter => typeof v === "string" && v in PROCESSING_TYPE_FILTERS

/** Occurrence-level counts. "Submitted" = occurrence whose linked asset belongs to a generation batch. */
export type OccurrenceProcessingCounts = {
  extracted: number
  selected: number
  submitted: number
  pending: number
  processing: number
  completed: number
  failed: number
  cancelled: number
}

export type DocumentProcessingRow = {
  document: DocumentRecord
  counts: OccurrenceProcessingCounts
  /** Most recently created generation batch that contains this document's occurrences. */
  latestBatch: { id: string; status: string; batchCount: number } | null
  lastUpdatedAt: string
}

export type DocumentProcessingListResponse = {
  success: true
  rows: DocumentProcessingRow[]
  /** Totals across every document visible to the caller (respects the type filter). */
  totals: OccurrenceProcessingCounts & { documents: number }
  page: number
  pageSize: number
  total: number
}

export const PROCESSING_PAGE_SIZE = 10
export const PROCESSING_PAGE_MAX = 50

export type BatchCreditUsageResponse = {
  success: true
  batchId: string
  /** "own": only the caller's own reservations (non-`all` view scope). */
  scope: "batch" | "own"
  attribution: "request_id"
  models: string[]
  attempts: { total: number; settled: number; reserved: number; released: number; needsReconciliation: number }
  creditsCharged: number
  creditsReserved: number
}

export const documentTypeLabel = (t: DocumentType) => t.toUpperCase()
