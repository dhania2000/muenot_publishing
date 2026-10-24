/**
 * @file lib/alt-text/document-history-contract.ts
 * @module Publishing · Alt Text
 * @kind Shared contract (client + server)
 * @summary Phase 3 Task 19 — Document History types, filter parsing and URL builders.
 *   History is read-only: nothing here triggers extraction, AI generation, export or validation.
 */
import type { DocumentRecordProcessingStatus, DocumentType, DocumentUploadStatus } from "./document-records"
import type { DocumentSecurityStatus } from "./document-upload-contract"
import type { AccessibleExportFormat } from "./docx-export-contract"
import type { CheckStatus, OverallStatus, ValidationCounts } from "./output-validation-contract"

export const HISTORY_DOCUMENT_TYPES = ["pdf", "pptx", "docx"] as const
/** Real alt_text_documents.processing_status values (no fictional "AI processing" document state exists). */
export const HISTORY_PROCESSING_STATUSES = ["pending", "extracting", "extracted", "partially_extracted", "unsupported", "failed"] as const
export const HISTORY_OUTPUT_STATUSES = ["none", "available", "passed", "warnings", "failed", "not_verified"] as const
export const HISTORY_SORTS = ["updated_desc", "created_desc", "created_asc", "name_asc"] as const

export type HistoryOutputStatus = (typeof HISTORY_OUTPUT_STATUSES)[number]
export type HistorySortKey = (typeof HISTORY_SORTS)[number]

export type DocumentHistoryFilter = {
  page: number
  pageSize: number
  search: string | null
  type: DocumentType | null
  status: DocumentRecordProcessingStatus | null
  output: HistoryOutputStatus | null
  projectId: number | null
  /** Inclusive ISO dates (YYYY-MM-DD) on created_at. */
  from: string | null
  to: string | null
  sort: HistorySortKey
}

export const HISTORY_PAGE_SIZES = [10, 25, 50] as const
export const HISTORY_SEARCH_MAX = 120
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const POSITIVE_INT = /^[1-9]\d{0,9}$/

function oneOf<T extends string>(list: readonly T[], raw: string | null): T | null {
  return raw != null && (list as readonly string[]).includes(raw) ? (raw as T) : null
}

function validDate(raw: string | null): string | null {
  if (!raw || !ISO_DATE.test(raw)) return null
  const d = new Date(`${raw}T00:00:00Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw ? null : raw
}

/** Strict, allow-list parsing: unknown values are dropped rather than passed to SQL. */
export function parseHistoryFilter(sp: URLSearchParams, maxPageSize: number): DocumentHistoryFilter | { error: string } {
  const page = POSITIVE_INT.test(sp.get("page") ?? "") ? Math.min(Number(sp.get("page")), 100_000) : 1
  const pageSize = POSITIVE_INT.test(sp.get("pageSize") ?? "") ? Math.min(Number(sp.get("pageSize")), maxPageSize) : 25
  const rawProject = sp.get("projectId")
  if (rawProject != null && !POSITIVE_INT.test(rawProject)) return { error: "projectId must be a positive integer." }
  const from = validDate(sp.get("from"))
  const to = validDate(sp.get("to"))
  if ((sp.get("from") && !from) || (sp.get("to") && !to)) return { error: "Dates must use the YYYY-MM-DD format." }
  if (from && to && from > to) return { error: "The start date must be on or before the end date." }
  const search = (sp.get("search") ?? "").trim().slice(0, HISTORY_SEARCH_MAX)
  return {
    page,
    pageSize,
    search: search || null,
    type: oneOf(HISTORY_DOCUMENT_TYPES, sp.get("type")),
    status: oneOf(HISTORY_PROCESSING_STATUSES, sp.get("status")),
    output: oneOf(HISTORY_OUTPUT_STATUSES, sp.get("output")),
    projectId: rawProject == null ? null : Number(rawProject),
    from,
    to,
    sort: oneOf(HISTORY_SORTS, sp.get("sort")) ?? "updated_desc",
  }
}

export type HistoryDocumentRow = {
  id: number
  uploadId: string
  projectId: number | null
  filename: string
  documentType: DocumentType
  size: number
  uploadStatus: DocumentUploadStatus
  securityStatus: DocumentSecurityStatus
  processingStatus: DocumentRecordProcessingStatus
  preparationStage: string | null
  extractedImages: number
  aiGeneratedImages: number
  approvedImages: number
  completedExports: number
  latestValidation: OverallStatus | null
  uploadedBy: number
  uploaderName: string | null
  createdAt: string
  updatedAt: string
}

export type DocumentHistoryListResponse = {
  success: true
  documents: HistoryDocumentRow[]
  page: number
  pageSize: number
  total: number
}

export type HistoryJob = {
  id: number
  kind: "document_preparation"
  status: string
  attempts: number
  maxAttempts: number
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  updatedAt: string
  /** Safe error code (document-level), only for the job recorded on the document. */
  errorCode: string | null
  isCurrent: boolean
}

export type HistoryBatch = {
  id: string
  name: string
  status: string
  modelId: string | null
  submitted: number
  completed: number
  failed: number
  createdAt: string
  completedAt: string | null
}

export type HistoryOutput = {
  outputId: string
  /** Display sequence among this document's completed outputs (by creation order); null if not completed. */
  version: number | null
  format: AccessibleExportFormat
  status: string
  policy: string
  filename: string
  sizeBytes: number | null
  updated: number
  skipped: number
  unsupported: number
  failed: number
  preserved: number | null
  pictureCount: number | null
  errorCode: string | null
  createdBy: number
  createdByName: string | null
  createdAt: string
  completedAt: string | null
  fileAvailable: boolean
  latestValidation: OverallStatus | null
  validationRuns: number
}

export type HistoryValidationRun = {
  runId: string
  outputId: string
  outputVersion: number | null
  status: string
  ruleVersion: string
  overallStatus: OverallStatus | null
  readiness: string | null
  passRate: number | null
  counts: ValidationCounts | null
  errorCode: string | null
  createdByName: string | null
  createdAt: string
  completedAt: string | null
}

export type TimelineEvent = {
  id: string
  group: "processing" | "review" | "output"
  type: string
  label: string
  at: string
  actor: string | null
  detail: string | null
}

export type DocumentHistoryDetail = {
  success: true
  document: HistoryDocumentRow & {
    mimeType: string
    preparationErrorCode: string | null
    originalAvailable: boolean
    totalOccurrences: number
    decorativeApproved: number
  }
  jobs: HistoryJob[]
  batches: HistoryBatch[]
  outputs: HistoryOutput[]
  validations: HistoryValidationRun[]
  timeline: TimelineEvent[]
  limits: { stageHistoryPersisted: false; downloadAuditPersisted: false; reviewEventsPerVersionOnly: true }
}

export type OccurrenceVersion = {
  versionId: number
  version: number
  action: string
  kind: "ai_generated" | "manual_edit" | "other"
  shortAlt: string | null
  longDescription: string | null
  modelId: string | null
  note: string | null
  actorName: string | null
  createdAt: string
  isApproved: boolean
  isReviewCandidate: boolean
}

export type OccurrenceHistoryResponse = {
  success: true
  occurrence: {
    id: number
    sourceLocator: string
    pageNumber: number | null
    slideNumber: number | null
    altTextAssetId: number | null
    sourceAltText: string | null
    reviewStatus: string
    reviewVersion: number | null
    reviewComment: string | null
    reviewCategory: string | null
    reviewerName: string | null
    reviewedAt: string | null
    approvedVersionId: number | null
    approvedVersion: number | null
    approvedByName: string | null
    approvedAt: string | null
    approvedDecorative: boolean
    currentVersion: number | null
  }
  versions: OccurrenceVersion[]
}

export type OccurrenceOption = { id: number; label: string; reviewStatus: string; hasAsset: boolean }
export type OccurrenceOptionsResponse = { success: true; items: OccurrenceOption[]; total: number; page: number; pageSize: number }

export const historyListUrl = (f: Partial<DocumentHistoryFilter>) => {
  const sp = new URLSearchParams({ view: "history" })
  for (const [k, v] of Object.entries(f)) if (v != null && v !== "") sp.set(k, String(v))
  return `/api/alt-text/documents?${sp}`
}
export const documentHistoryUrl = (documentId: number) => `/api/alt-text/documents/${documentId}/history`
export const occurrenceOptionsUrl = (documentId: number, page: number) => `/api/alt-text/documents/${documentId}/history/images?page=${page}`
export const occurrenceHistoryUrl = (documentId: number, imageId: number) => `/api/alt-text/documents/${documentId}/history/images/${imageId}`
export const originalDownloadUrl = (documentId: number) => `/api/alt-text/documents/${documentId}/original`
export const outputDownloadUrl = (documentId: number, outputId: string) => `/api/alt-text/documents/${documentId}/exports/${outputId}`
export const validationRunDownloadUrl = (documentId: number, outputId: string, runId: string, format: "json" | "csv") =>
  `/api/alt-text/documents/${documentId}/exports/${outputId}/validation/${runId}?format=${format}`

export const VALIDATION_LABELS: Record<OverallStatus, string> = {
  passed: "Validation passed",
  passed_with_warnings: "Passed with warnings",
  failed: "Validation failed",
  not_verified: "Not verified",
  manual_review_required: "Manual review required",
}

export const CHECK_STATUS_LABELS: Record<CheckStatus, string> = {
  passed: "Passed",
  failed: "Failed",
  warning: "Warning",
  not_executed: "Not executed",
  not_applicable: "Not applicable",
  not_verified: "Not verified",
  manual_review: "Manual review",
}
