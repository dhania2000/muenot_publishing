/**
 * @file lib/alt-text/document-image-review.ts
 * @module Publishing · Alt Text
 * @kind Browser-safe contract
 * @summary Phase 3 Task 10 — extracted-image review workspace contracts: list query (filters,
 *   search, sort), processing eligibility, persisted selection/review state, readiness summary
 *   and the typed selection snapshot consumed by Tasks 11–12. The SQL in
 *   document-image-review-store.ts mirrors `assessEligibility` and `contextState` exactly.
 *
 *   Identity rules: an *occurrence* (alt_text_document_images.id) is the unit of selection and
 *   review. A *binary* (media_sha256) may be shared by many occurrences; it is never selected,
 *   reviewed or described on its own.
 */
import { SUPPORTED_IMAGE_TYPES } from "./core"
import type { DocumentExtractionCounts, DocumentImageRecord, DocumentType } from "./document-records"

export const REVIEW_STATUSES = ["not_reviewed", "reviewed", "needs_attention"] as const
export type ReviewStatus = (typeof REVIEW_STATUSES)[number]
export const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = { not_reviewed: "Not reviewed", reviewed: "Reviewed", needs_attention: "Needs attention" }
export const isReviewStatus = (v: unknown): v is ReviewStatus => typeof v === "string" && (REVIEW_STATUSES as readonly string[]).includes(v)

/** Asset lifecycle states that may still enter AI generation. in_review/approved/rejected already have output. */
export const GENERATABLE_ASSET_STATUSES = ["uploaded", "failed"] as const
export const PIPELINE_MIME_TYPES = SUPPORTED_IMAGE_TYPES

export const EXTRACTION_FILTERS = ["extracted", "failed", "unsupported"] as const
export const ALT_FILTERS = ["has", "missing"] as const
export const CONTEXT_FILTERS = ["ready", "unavailable", "needs_review", "not_analyzed"] as const
export const SELECTION_FILTERS = ["selected", "not_selected"] as const
export const IMAGE_SORTS = ["document", "location", "newest", "oldest"] as const

export type ExtractionFilter = (typeof EXTRACTION_FILTERS)[number]
export type AltFilter = (typeof ALT_FILTERS)[number]
export type ContextFilter = (typeof CONTEXT_FILTERS)[number]
export type SelectionFilter = (typeof SELECTION_FILTERS)[number]
export type ImageSort = (typeof IMAGE_SORTS)[number]

export const IMAGE_SORT_LABEL: Record<ImageSort, string> = {
  document: "Original document order",
  location: "Page / slide number",
  newest: "Newest first",
  oldest: "Oldest first",
}

export const REVIEW_PAGE_SIZES = [12, 24, 48] as const
export const REVIEW_PAGE_MAX = 48
export const SEARCH_MAX = 100
export const SELECTION_BATCH_MAX = 200
export const SELECTION_SNAPSHOT_MAX = 1000

export type ImageListQuery = {
  page: number
  pageSize: number
  sort: ImageSort
  search?: string
  extraction?: ExtractionFilter
  alt?: AltFilter
  context?: ContextFilter
  selection?: SelectionFilter
  /** Restrict to occurrences sharing one binary (duplicate inspection). */
  mediaSha256?: string
}

const SHA256_RE = /^[0-9a-f]{64}$/
const pick = <T extends string>(values: readonly T[], v: string | null): T | undefined => (v && (values as readonly string[]).includes(v) ? (v as T) : undefined)

export type ParsedImageQuery = { ok: true; query: ImageListQuery } | { ok: false; error: string }

/** Strict parser for the list endpoint: unknown values are rejected, never silently widened. */
export function parseImageListQuery(sp: URLSearchParams): ParsedImageQuery {
  const num = (name: string, fallback: number, min: number, max: number) => {
    const raw = sp.get(name)
    if (raw == null || raw === "") return fallback
    if (!/^\d{1,6}$/.test(raw)) return NaN
    const n = Number(raw)
    return n < min || n > max ? NaN : n
  }
  const page = num("page", 1, 1, 100_000)
  const pageSize = num("pageSize", REVIEW_PAGE_SIZES[1], 1, REVIEW_PAGE_MAX)
  if (Number.isNaN(page) || Number.isNaN(pageSize)) return { ok: false, error: "Invalid pagination." }
  const enums: [string, readonly string[]][] = [
    ["sort", IMAGE_SORTS],
    ["extraction", EXTRACTION_FILTERS],
    ["alt", ALT_FILTERS],
    ["context", CONTEXT_FILTERS],
    ["selection", SELECTION_FILTERS],
  ]
  for (const [name, values] of enums) {
    const v = sp.get(name)
    if (v && v !== "all" && !values.includes(v)) return { ok: false, error: `Unknown ${name} filter.` }
  }
  const search = (sp.get("search") ?? "").trim()
  if (search.length > SEARCH_MAX) return { ok: false, error: "Search is too long." }
  const sha = sp.get("mediaSha256")
  if (sha && !SHA256_RE.test(sha)) return { ok: false, error: "Invalid media hash." }
  return {
    ok: true,
    query: {
      page,
      pageSize,
      sort: pick(IMAGE_SORTS, sp.get("sort")) ?? "document",
      ...(search ? { search } : {}),
      ...(pick(EXTRACTION_FILTERS, sp.get("extraction")) ? { extraction: pick(EXTRACTION_FILTERS, sp.get("extraction")) } : {}),
      ...(pick(ALT_FILTERS, sp.get("alt")) ? { alt: pick(ALT_FILTERS, sp.get("alt")) } : {}),
      ...(pick(CONTEXT_FILTERS, sp.get("context")) ? { context: pick(CONTEXT_FILTERS, sp.get("context")) } : {}),
      ...(pick(SELECTION_FILTERS, sp.get("selection")) ? { selection: pick(SELECTION_FILTERS, sp.get("selection")) } : {}),
      ...(sha ? { mediaSha256: sha } : {}),
    },
  }
}

export function imageListSearchParams(q: Partial<ImageListQuery>): URLSearchParams {
  const sp = new URLSearchParams()
  if (q.page) sp.set("page", String(q.page))
  if (q.pageSize) sp.set("pageSize", String(q.pageSize))
  if (q.sort) sp.set("sort", q.sort)
  const search = q.search?.trim().slice(0, SEARCH_MAX)
  if (search) sp.set("search", search)
  for (const k of ["extraction", "alt", "context", "selection", "mediaSha256"] as const) if (q[k]) sp.set(k, q[k] as string)
  return sp
}

// ---------------------------------------------------------------------------
// Eligibility (mirrored in SQL by ELIGIBLE_SQL)
// ---------------------------------------------------------------------------

export const INELIGIBLE_REASONS = {
  DOCUMENT_NOT_CLEAN: "The document has not passed the security scan.",
  NOT_EXTRACTED: "The image was not extracted successfully.",
  MISSING_ASSET: "The stored image asset is missing.",
  UNSUPPORTED_FORMAT: "The image format is not supported by the alt text pipeline (JPG, PNG, WEBP).",
  GENERATION_IN_PROGRESS: "Alt text generation is already in progress for this image.",
  ALREADY_GENERATED: "This image already has generated alt text.",
} as const
export type IneligibleReason = keyof typeof INELIGIBLE_REASONS

export const ELIGIBILITY_WARNINGS = {
  CONTEXT_NOT_ANALYZED: "Document context has not been analyzed; generation can still run without it.",
  CONTEXT_UNAVAILABLE: "No reliable surrounding text was found for this image.",
  CONTEXT_LOW_CONFIDENCE: "Document context is low confidence and may be unrelated.",
  CONTEXT_FAILED: "Context analysis failed; re-analyze before generating if context matters.",
  HAS_EXISTING_ALT: "The source already has author alt text; it will not be overwritten.",
  DECORATIVE_CANDIDATE: "Marked as a decorative candidate in the source.",
  SHARED_BINARY: "The same image file appears in other locations; each occurrence is described separately.",
} as const
export type EligibilityWarning = keyof typeof ELIGIBILITY_WARNINGS

export type Eligibility = { eligible: boolean; reasons: IneligibleReason[]; warnings: EligibilityWarning[] }

export type EligibilityInput = {
  documentSecurityStatus: string
  extractionStatus: string
  altTextAssetId: number | null
  assetExists: boolean
  assetMimeType: string | null
  assetStatus: string | null
  contextStatus: string | null
  contextConfidence: string | null
  hasExistingAlt: boolean
  isDecorative: boolean
  duplicateCount: number
}

export function assessEligibility(i: EligibilityInput): Eligibility {
  const reasons: IneligibleReason[] = []
  if (i.documentSecurityStatus !== "clean") reasons.push("DOCUMENT_NOT_CLEAN")
  if (i.extractionStatus !== "extracted") reasons.push("NOT_EXTRACTED")
  else if (i.altTextAssetId == null || !i.assetExists) reasons.push("MISSING_ASSET")
  else {
    if (!i.assetMimeType || !(PIPELINE_MIME_TYPES as readonly string[]).includes(i.assetMimeType)) reasons.push("UNSUPPORTED_FORMAT")
    if (i.assetStatus === "processing") reasons.push("GENERATION_IN_PROGRESS")
    else if (!i.assetStatus || !(GENERATABLE_ASSET_STATUSES as readonly string[]).includes(i.assetStatus)) reasons.push("ALREADY_GENERATED")
  }
  const warnings: EligibilityWarning[] = []
  const ctx = contextState(i.contextStatus, i.contextConfidence)
  if (ctx === "not_analyzed") warnings.push("CONTEXT_NOT_ANALYZED")
  else if (ctx === "unavailable") warnings.push("CONTEXT_UNAVAILABLE")
  else if (ctx === "needs_review") warnings.push(i.contextStatus === "failed" ? "CONTEXT_FAILED" : "CONTEXT_LOW_CONFIDENCE")
  if (i.hasExistingAlt) warnings.push("HAS_EXISTING_ALT")
  if (i.isDecorative) warnings.push("DECORATIVE_CANDIDATE")
  if (i.duplicateCount > 1) warnings.push("SHARED_BINARY")
  return { eligible: reasons.length === 0, reasons, warnings }
}

/** Context filter bucket for one occurrence (mirrored in SQL by CONTEXT_SQL). */
export function contextState(status: string | null, confidence: string | null): ContextFilter {
  if (status == null) return "not_analyzed"
  if (status === "failed") return "needs_review"
  if (status === "unavailable" || confidence === "unavailable") return "unavailable"
  if (confidence === "low") return "needs_review"
  return status === "analyzed" && (confidence === "high" || confidence === "medium") ? "ready" : "needs_review"
}

export const CONTEXT_STATE_LABEL: Record<ContextFilter, string> = {
  ready: "Context ready",
  unavailable: "Context unavailable",
  needs_review: "Needs review",
  not_analyzed: "Not analyzed",
}

/** Author alt text read from the source document (never AI output). Empty strings count as missing. */
export function existingAltText(img: Pick<DocumentImageRecord, "sourceMetadata">): string | null {
  const m = img.sourceMetadata
  for (const v of [m?.originalDescription, m?.pdf?.structure?.actualText, m?.pdf?.structure?.markedContentAlt]) {
    if (typeof v === "string" && v.trim()) return v
  }
  return null
}

// ---------------------------------------------------------------------------
// API shapes
// ---------------------------------------------------------------------------

export type ReviewImageRecord = DocumentImageRecord & {
  documentFilename: string
  documentType: DocumentType
  /** Format verified at extraction time (pipeline MIME of the linked asset), if any. */
  assetMimeType: string | null
  /** Persisted selection AND currently eligible — the only state that reaches Tasks 11–12. */
  selected: boolean
  /** Persisted flag before eligibility is applied (an asset may have changed state since selection). */
  selectionStored: boolean
  selectionUpdatedAt: string | null
  reviewStatus: ReviewStatus
  reviewedAt: string | null
  /** Occurrences in this document sharing the same binary (1 = unique; null = no hash). */
  duplicateCount: number | null
  contextVersion: number | null
  eligibility: Eligibility
}

export type ReadinessSummary = {
  /** Every persisted occurrence (including pending/failed/unsupported). */
  totalOccurrences: number
  extractedOccurrences: number
  eligibleOccurrences: number
  selectedOccurrences: number
  withExistingAlt: number
  unsupportedOrFailed: number
  /** Extracted occurrences whose source review is not `reviewed`. */
  needingReview: number
  needsAttention: number
  /** Binaries (hash) used by more than one occurrence, and the occurrences they cover. */
  duplicateBinaryGroups: number
  duplicateOccurrences: number
  /** Distinct hashed binaries — a binary count, not an occurrence count. */
  uniqueBinaries: number
}

export type ReviewImagesResponse = {
  success: true
  documentId: number
  processingStatus: string
  images: ReviewImageRecord[]
  page: number
  pageSize: number
  total: number
  summary: ReadinessSummary
}

/** GET /documents/:id/images body: the filtered page plus document-wide per-status counts. */
export type DocumentReviewImagesResponse = ReviewImagesResponse & { counts: DocumentExtractionCounts }

export type SelectionAction = "select" | "deselect" | "select_all_eligible" | "clear_selection" | "set_review"

export type ImageMutationRequest =
  | { action: "select" | "deselect"; imageIds: number[] }
  | { action: "select_all_eligible" | "clear_selection" }
  | { action: "set_review"; imageIds: number[]; reviewStatus: ReviewStatus }

export type ImageMutationResponse = {
  success: true
  action: SelectionAction
  /** Ids now in the requested state (idempotent: already-selected ids are included). */
  applied: number[]
  ineligible: number[]
  notFound: number[]
  /** Rows whose stored value actually changed. */
  changed: number
  summary: ReadinessSummary
}

export type ParsedMutation = { ok: true; request: ImageMutationRequest } | { ok: false; error: string }

export function parseImageMutation(body: unknown): ParsedMutation {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Invalid request body." }
  const b = body as Record<string, unknown>
  const action = b.action
  if (action === "select_all_eligible" || action === "clear_selection") return { ok: true, request: { action } }
  if (action !== "select" && action !== "deselect" && action !== "set_review") return { ok: false, error: "Unknown action." }
  const ids = b.imageIds
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > SELECTION_BATCH_MAX) return { ok: false, error: `Provide 1–${SELECTION_BATCH_MAX} image ids.` }
  if (!ids.every((v) => typeof v === "number" && Number.isSafeInteger(v) && v > 0)) return { ok: false, error: "Invalid image id." }
  const imageIds = [...new Set(ids as number[])]
  if (action === "set_review") {
    if (!isReviewStatus(b.reviewStatus)) return { ok: false, error: "Invalid review status." }
    return { ok: true, request: { action, imageIds, reviewStatus: b.reviewStatus } }
  }
  return { ok: true, request: { action, imageIds } }
}

/**
 * Typed hand-off for Tasks 11–12. One entry per selected, currently eligible occurrence.
 * Tenant identity is resolved server-side from the session and is never sent to the browser.
 */
export type DocumentImageSelectionItem = {
  documentId: number
  imageId: number
  altTextAssetId: number
  sourceLocator: string
  /** Binary identity; shared binaries still yield one item per occurrence. */
  mediaSha256: string | null
  mimeType: string
  context: { imageId: number; status: string | null; confidence: string | null; version: number | null }
  eligibility: Eligibility
}

export type SelectionSnapshotResponse = {
  success: true
  documentId: number
  total: number
  truncated: boolean
  items: DocumentImageSelectionItem[]
}
