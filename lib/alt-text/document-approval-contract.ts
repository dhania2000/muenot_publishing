/**
 * @file lib/alt-text/document-approval-contract.ts
 * @module Publishing · Alt Text
 * @kind Pure domain logic (browser-safe, no I/O)
 * @summary Phase 3 Task 14 — human review & approval of document image descriptions: status
 *   vocabularies, request parsing, deterministic quality checks, word diff and the read-only
 *   insertion-readiness rules consumed by Tasks 15–17.
 *
 * Generation status (from the linked alt_text_assets row) and human review status (persisted per
 * occurrence on alt_text_document_images) are separate. A review decision always names the saved
 * asset version it applies to; a later version never inherits it.
 */
import { COMPLEX_CLASSIFICATIONS, IMAGE_CLASSIFICATIONS, LANGUAGES, type ImageClassification } from "./core"

/* ---------- Statuses ---------- */

export const DESCRIPTION_REVIEW_STATUSES = ["not_reviewed", "in_review", "changes_requested", "approved", "rejected"] as const
export type DescriptionReviewStatus = (typeof DESCRIPTION_REVIEW_STATUSES)[number]

export const DESCRIPTION_REVIEW_LABEL: Record<DescriptionReviewStatus, string> = {
  not_reviewed: "Not Reviewed",
  in_review: "In Review",
  changes_requested: "Changes Requested",
  approved: "Approved",
  rejected: "Rejected",
}

export const GENERATION_STATUSES = ["pending", "processing", "completed", "failed"] as const
export type GenerationStatus = (typeof GENERATION_STATUSES)[number]

export const GENERATION_LABEL: Record<GenerationStatus, string> = { pending: "Pending", processing: "Processing", completed: "Completed", failed: "Failed" }

/** Maps the asset's processing status only; review decisions never change the generation outcome. */
export function generationStatusOf(assetStatus: string | null, currentVersion: number): GenerationStatus {
  if (assetStatus === "processing") return "processing"
  if (currentVersion > 0) return "completed"
  if (assetStatus === "failed") return "failed"
  return "pending"
}

/**
 * The stored decision only applies to the version it names. When the candidate moved on (manual
 * edit or regeneration), a decided occurrence returns to "In Review" for the new version and an
 * untouched one stays "Not Reviewed" — an old approval never authorises a newer version.
 */
export function effectiveReviewStatus(stored: string | null, storedVersion: number | null, currentVersion: number): DescriptionReviewStatus {
  const s = (DESCRIPTION_REVIEW_STATUSES as readonly string[]).includes(stored ?? "") ? (stored as DescriptionReviewStatus) : "not_reviewed"
  if (currentVersion <= 0) return "not_reviewed"
  if (storedVersion === currentVersion) return s
  return s === "not_reviewed" ? "not_reviewed" : "in_review"
}

/** SQL twin of effectiveReviewStatus (i = occurrence, a = linked asset). Constant text, no input. */
export const EFFECTIVE_REVIEW_SQL = `(CASE
  WHEN a.id IS NULL OR a.current_version = 0 THEN 'not_reviewed'
  WHEN i.alt_review_version = a.current_version THEN i.alt_review_status
  WHEN i.alt_review_status = 'not_reviewed' THEN 'not_reviewed'
  ELSE 'in_review' END)`

export const REVIEW_QUEUE_FILTERS = ["all", "pending", "in_review", "changes_requested", "approved", "rejected"] as const
export type ReviewQueueFilter = (typeof REVIEW_QUEUE_FILTERS)[number]
export const REVIEW_QUEUE_FILTER_LABEL: Record<ReviewQueueFilter, string> = {
  all: "All",
  pending: "Pending Review",
  in_review: "In Review",
  changes_requested: "Changes Requested",
  approved: "Approved",
  rejected: "Rejected",
}
export const isReviewQueueFilter = (v: string): v is ReviewQueueFilter => (REVIEW_QUEUE_FILTERS as readonly string[]).includes(v)
export const filterToStatus = (f: ReviewQueueFilter): DescriptionReviewStatus | null => (f === "all" ? null : f === "pending" ? "not_reviewed" : f)

/* ---------- Decisions ---------- */

export const REVIEW_ACTIONS = ["start_review", "approve", "request_changes", "reject"] as const
export type ReviewAction = (typeof REVIEW_ACTIONS)[number]
export const ACTION_TO_STATUS: Record<ReviewAction, DescriptionReviewStatus> = {
  start_review: "in_review",
  approve: "approved",
  request_changes: "changes_requested",
  reject: "rejected",
}

export const COMMENT_CATEGORIES = {
  general: "General correction",
  scientific_accuracy: "Scientific accuracy",
  accessibility: "Accessibility concern",
  missing_labels: "Missing labels",
  terminology: "Terminology issue",
  context_mismatch: "Caption/context mismatch",
  length: "Description length",
} as const
export type CommentCategory = keyof typeof COMMENT_CATEGORIES

/** alt_text_versions.note is VARCHAR(500); the stored note adds a short occurrence/category prefix. */
export const COMMENT_MAX = 400
export const COMMENT_MIN = 10
export const JUSTIFICATION_MIN = 10
export const BULK_MAX = 100

export type DecisionRequest = {
  action: ReviewAction
  expectedVersion: number
  comment: string | null
  category: CommentCategory | null
  decorative: boolean
  justification: string | null
}

type Parsed<T> = { ok: true; value: T } | { ok: false; code: string; error: string; field?: string }

const DECISION_KEYS = new Set(["action", "expectedVersion", "comment", "category", "decorative", "justification"])
const BULK_KEYS = new Set(["action", "items", "comment", "category"])

/** NFC, unified line endings, C0/C1 controls (except \n, \t) removed, trimmed — same rules as Phase 1 edits. */
export function cleanReviewText(s: string): string {
  return s
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
    .trim()
}

const isVersion = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0

function parseComment(raw: unknown, required: boolean): Parsed<string | null> {
  if (raw === undefined || raw === null || raw === "") {
    return required ? { ok: false, code: "COMMENT_REQUIRED", error: `A reviewer comment of at least ${COMMENT_MIN} characters is required.`, field: "comment" } : { ok: true, value: null }
  }
  if (typeof raw !== "string") return { ok: false, code: "INVALID_REQUEST", error: "comment must be a string.", field: "comment" }
  const text = cleanReviewText(raw)
  if (text.length > COMMENT_MAX) return { ok: false, code: "FIELD_TOO_LONG", error: `comment must be at most ${COMMENT_MAX} characters.`, field: "comment" }
  if (required && [...text].length < COMMENT_MIN) {
    return { ok: false, code: "COMMENT_REQUIRED", error: `A reviewer comment of at least ${COMMENT_MIN} characters is required.`, field: "comment" }
  }
  return { ok: true, value: text || null }
}

function parseCategory(raw: unknown): Parsed<CommentCategory | null> {
  if (raw === undefined || raw === null || raw === "") return { ok: true, value: null }
  if (typeof raw !== "string" || !(raw in COMMENT_CATEGORIES)) return { ok: false, code: "INVALID_REQUEST", error: "Unknown comment category.", field: "category" }
  return { ok: true, value: raw as CommentCategory }
}

const needsComment = (a: ReviewAction) => a === "request_changes" || a === "reject"

export function parseDecisionRequest(body: unknown): Parsed<DecisionRequest> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, code: "INVALID_REQUEST", error: "Send a JSON object." }
  const b = body as Record<string, unknown>
  const extra = Object.keys(b).filter((k) => !DECISION_KEYS.has(k))
  if (extra.length) return { ok: false, code: "INVALID_REQUEST", error: "Unexpected fields in request." }
  if (typeof b.action !== "string" || !(REVIEW_ACTIONS as readonly string[]).includes(b.action)) return { ok: false, code: "INVALID_REQUEST", error: "Unknown review action." }
  const action = b.action as ReviewAction
  if (!isVersion(b.expectedVersion)) {
    return { ok: false, code: "EXPECTED_VERSION_REQUIRED", error: "expectedVersion (the saved version you reviewed) is required." }
  }
  const comment = parseComment(b.comment, needsComment(action))
  if (!comment.ok) return comment
  const category = parseCategory(b.category)
  if (!category.ok) return category
  if (b.decorative !== undefined && typeof b.decorative !== "boolean") return { ok: false, code: "INVALID_REQUEST", error: "decorative must be a boolean.", field: "decorative" }
  const decorative = b.decorative === true
  if (decorative && action !== "approve") return { ok: false, code: "INVALID_DECORATIVE_APPROVAL", error: "Decorative status can only be confirmed with an approval.", field: "decorative" }
  let justification: string | null = null
  if (decorative) {
    if (typeof b.justification !== "string") return { ok: false, code: "JUSTIFICATION_REQUIRED", error: "Explain why this image is decorative.", field: "justification" }
    justification = cleanReviewText(b.justification)
    if ([...justification].length < JUSTIFICATION_MIN) return { ok: false, code: "JUSTIFICATION_REQUIRED", error: `The decorative justification needs at least ${JUSTIFICATION_MIN} characters.`, field: "justification" }
    if (justification.length > COMMENT_MAX) return { ok: false, code: "FIELD_TOO_LONG", error: `justification must be at most ${COMMENT_MAX} characters.`, field: "justification" }
  } else if (b.justification !== undefined && b.justification !== null && b.justification !== "") {
    return { ok: false, code: "INVALID_REQUEST", error: "justification is only accepted with a decorative approval.", field: "justification" }
  }
  return { ok: true, value: { action, expectedVersion: b.expectedVersion, comment: comment.value, category: category.value, decorative, justification } }
}

export type BulkReviewAction = Exclude<ReviewAction, "reject">
export type BulkReviewRequest = { action: BulkReviewAction; items: { imageId: number; expectedVersion: number }[]; comment: string | null; category: CommentCategory | null }

export function parseBulkReviewRequest(body: unknown): Parsed<BulkReviewRequest> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, code: "INVALID_REQUEST", error: "Send a JSON object." }
  const b = body as Record<string, unknown>
  if (Object.keys(b).some((k) => !BULK_KEYS.has(k))) return { ok: false, code: "INVALID_REQUEST", error: "Unexpected fields in request." }
  if (b.action !== "start_review" && b.action !== "approve" && b.action !== "request_changes") {
    return { ok: false, code: "INVALID_REQUEST", error: "Bulk action must be start_review, approve or request_changes." }
  }
  if (!Array.isArray(b.items) || b.items.length === 0) return { ok: false, code: "INVALID_REQUEST", error: "Select at least one image." }
  if (b.items.length > BULK_MAX) return { ok: false, code: "TOO_MANY_ITEMS", error: `Select at most ${BULK_MAX} images per bulk action.` }
  const seen = new Set<number>()
  const items: BulkReviewRequest["items"] = []
  for (const raw of b.items) {
    const it = raw as Record<string, unknown> | null
    if (!it || typeof it !== "object" || !isVersion(it.imageId) || !isVersion(it.expectedVersion)) {
      return { ok: false, code: "INVALID_REQUEST", error: "Each item needs a positive imageId and expectedVersion." }
    }
    if (seen.has(it.imageId)) continue
    seen.add(it.imageId)
    items.push({ imageId: it.imageId, expectedVersion: it.expectedVersion })
  }
  const comment = parseComment(b.comment, b.action === "request_changes")
  if (!comment.ok) return comment
  const category = parseCategory(b.category)
  if (!category.ok) return category
  return { ok: true, value: { action: b.action, items, comment: comment.value, category: category.value } }
}

/* ---------- Quality checks ---------- */

export type QualityCheckCode =
  | "MISSING_SHORT_ALT"
  | "SHORT_ALT_TOO_LONG"
  | "MISSING_DETAILED_DESCRIPTION"
  | "PLACEHOLDER_TEXT"
  | "REDUNDANT_PHRASE"
  | "DUPLICATE_DESCRIPTION"
  | "CONTEXT_UNRESOLVED"
  | "INVALID_ENCODING"
  | "UNSUPPORTED_LANGUAGE"
  | "LANGUAGE_SCRIPT_MISMATCH"
  | "DECORATIVE_HAS_TEXT"
  | "DECORATIVE_UNCONFIRMED"
  | "SOURCE_MARKED_DECORATIVE"

export type QualityCheck = { code: QualityCheckCode; severity: "blocking" | "warning"; message: string }

export type QualityInput = {
  classification: string | null
  shortAlt: string | null
  longDescription: string | null
  language: string
  shortMaxChars: number
  /** Other extracted occurrences in the same document whose current Short Alt Text is identical. */
  duplicateCount: number
  /** Task 9 context state for the occurrence. */
  contextState: "not_analyzed" | "analyzed" | "needs_review" | "unavailable" | string
  /** Author decorative flag read from the source document (never trusted as a decision). */
  sourceDecorative: boolean
  /** true when the reviewer is confirming decorative treatment for this version. */
  decorativeConfirmation: boolean
}

const REDUNDANT = /^\s*(an?\s+)?(image|picture|photo|photograph|graphic|illustration)\s+(of|showing|shows|depicting)\b/i
const PLACEHOLDERS = [
  /lorem ipsum/i,
  /\b(todo|tbd|fixme)\b/i,
  /^\s*(alt( text)?|image|picture|photo|graphic|placeholder|untitled|description|n\/?a|none|null|undefined)\s*\.?\s*$/i,
  /\[[^\]]*(insert|placeholder|describe)[^\]]*\]/i,
  /^\s*[\w-]+\.(png|jpe?g|gif|webp|bmp|tiff?|svg|emf|wmf)\s*$/i,
  /^\s*(x{3,}|\?{2,}|-{3,}|\.{3,})\s*$/i,
]
const DEVANAGARI = /[\u0900-\u097F]/

function hasInvalidEncoding(s: string) {
  if (s.includes("\uFFFD")) return true
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/.test(s)) return true
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = s.charCodeAt(i + 1)
      if (!(n >= 0xdc00 && n <= 0xdfff)) return true
      i++
    } else if (c >= 0xdc00 && c <= 0xdfff) return true
  }
  return false
}

/**
 * Deterministic editorial checks. Passing them is not a WCAG conformance claim and does not
 * verify scientific accuracy — that remains a human judgement.
 */
export function runQualityChecks(q: QualityInput): QualityCheck[] {
  const out: QualityCheck[] = []
  const shortAlt = q.shortAlt ?? ""
  const longDescription = q.longDescription ?? ""
  const decorative = q.classification === "decorative"
  const add = (code: QualityCheckCode, severity: QualityCheck["severity"], message: string) => out.push({ code, severity, message })

  if (hasInvalidEncoding(shortAlt) || hasInvalidEncoding(longDescription)) add("INVALID_ENCODING", "blocking", "The description contains invalid or replacement characters. Retype the affected text.")
  if (!(q.language in LANGUAGES)) add("UNSUPPORTED_LANGUAGE", "blocking", `Output language "${q.language}" is not supported.`)

  if (decorative) {
    if (shortAlt.trim()) add("DECORATIVE_HAS_TEXT", "blocking", 'Decorative images need intentionally empty Short Alt Text (alt=""). Clear it and save, or change the classification.')
    if (!q.decorativeConfirmation) add("DECORATIVE_UNCONFIRMED", "blocking", "A reviewer must explicitly confirm decorative treatment with a justification.")
  } else {
    if (!shortAlt.trim()) add("MISSING_SHORT_ALT", "blocking", "Short Alt Text is empty. Write a description, or classify the image as decorative and confirm it.")
    if ([...shortAlt].length > q.shortMaxChars) add("SHORT_ALT_TOO_LONG", "blocking", `Short Alt Text exceeds the configured ${q.shortMaxChars}-character limit. Move detail to the Detailed Description.`)
    if (COMPLEX_CLASSIFICATIONS.includes(q.classification as ImageClassification) && !longDescription.trim()) {
      add("MISSING_DETAILED_DESCRIPTION", "blocking", "This complex image type needs a Detailed Description.")
    }
    if (shortAlt.trim() && PLACEHOLDERS.some((p) => p.test(shortAlt))) add("PLACEHOLDER_TEXT", "blocking", "Short Alt Text looks like placeholder text or a file name.")
    if (longDescription.trim() && PLACEHOLDERS.slice(0, 2).some((p) => p.test(longDescription))) add("PLACEHOLDER_TEXT", "blocking", "Detailed Description contains placeholder text.")
    if (REDUNDANT.test(shortAlt)) add("REDUNDANT_PHRASE", "warning", 'Avoid openings like "Image of" — screen readers already announce the image.')
  }
  if (q.decorativeConfirmation && !decorative) {
    add("DECORATIVE_UNCONFIRMED", "blocking", 'Set the classification to "Decorative image" and save before confirming decorative treatment.')
  }
  if (q.sourceDecorative && !decorative) add("SOURCE_MARKED_DECORATIVE", "warning", "The source document marks this image as decorative. Confirm that a description is really needed.")
  if (q.duplicateCount > 0 && shortAlt.trim()) {
    add("DUPLICATE_DESCRIPTION", "warning", `The same Short Alt Text is used for ${q.duplicateCount} other image occurrence${q.duplicateCount === 1 ? "" : "s"} in this document. Check each one fits its own context.`)
  }
  if (q.contextState === "needs_review" || q.contextState === "unavailable" || q.contextState === "not_analyzed") {
    add("CONTEXT_UNRESOLVED", "warning", "Document context is missing or uncertain for this image. Verify the description against the source page.")
  }
  if (q.language === "hi" && shortAlt.trim() && !DEVANAGARI.test(shortAlt)) {
    add("LANGUAGE_SCRIPT_MISMATCH", "warning", "Output language is Hindi but the Short Alt Text contains no Devanagari text.")
  }
  return out
}

export const hasBlocking = (checks: QualityCheck[]) => checks.some((c) => c.severity === "blocking")

/* ---------- Word diff (no dependency) ---------- */

export type DiffPart = { type: "same" | "added" | "removed"; text: string }

const DIFF_CELL_LIMIT = 4_000_000

/** Word/whitespace-level LCS diff. Falls back to a whole replacement for very large inputs. */
export function diffWords(before: string, after: string): DiffPart[] {
  if (before === after) return before ? [{ type: "same", text: before }] : []
  const a = before.match(/\s+|[^\s]+/g) ?? []
  const b = after.match(/\s+|[^\s]+/g) ?? []
  if ((a.length + 1) * (b.length + 1) > DIFF_CELL_LIMIT) {
    return [...(before ? [{ type: "removed" as const, text: before }] : []), ...(after ? [{ type: "added" as const, text: after }] : [])]
  }
  const w = b.length + 1
  const dp = new Uint32Array((a.length + 1) * w)
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i * w + j] = a[i] === b[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1])
    }
  }
  const parts: DiffPart[] = []
  const push = (type: DiffPart["type"], text: string) => {
    const last = parts[parts.length - 1]
    if (last && last.type === type) last.text += text
    else parts.push({ type, text })
  }
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) push("same", a[i++]), j++
    else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) push("removed", a[i++])
    else push("added", b[j++])
  }
  while (i < a.length) push("removed", a[i++])
  while (j < b.length) push("added", b[j++])
  return parts
}

/* ---------- Insertion readiness (Tasks 15–17 contract) ---------- */

export type InsertionBlocker =
  | "NO_SOURCE_MAPPING"
  | "NO_AI_RESULT"
  | "NOT_APPROVED"
  | "APPROVAL_SUPERSEDED"
  | "APPROVED_VERSION_MISSING"
  | "GENERATION_IN_PROGRESS"
  | "VALIDATION_FAILED"

export const INSERTION_BLOCKER_MESSAGES: Record<InsertionBlocker, string> = {
  NO_SOURCE_MAPPING: "The image's location in the source document is missing or could not be extracted.",
  NO_AI_RESULT: "No saved description exists for this image.",
  NOT_APPROVED: "The current description version has not been approved.",
  APPROVAL_SUPERSEDED: "A newer version replaced the approved description and needs review.",
  APPROVED_VERSION_MISSING: "The approved version record could not be found.",
  GENERATION_IN_PROGRESS: "A generation is in progress for this image.",
  VALIDATION_FAILED: "The approved description no longer passes the required checks.",
}

export type ReadinessFacts = {
  extractionStatus: string
  sourceLocator: string
  assetId: number | null
  assetStatus: string | null
  currentVersion: number
  reviewStatus: string | null
  reviewVersion: number | null
  approvedVersionId: number | null
  approvedVersion: number | null
  approvedVersionFound: boolean
  approvedDecorative: boolean
  approvedClassification: string | null
  approvedShortAlt: string | null
  approvedLongDescription: string | null
  language: string
  shortMaxChars: number
}

/** First blocking reason, or null when the occurrence may be inserted. Pure — callers enforce scope. */
export function insertionBlocker(f: ReadinessFacts): InsertionBlocker | null {
  if (f.extractionStatus !== "extracted" || !f.sourceLocator.trim()) return "NO_SOURCE_MAPPING"
  if (f.assetId == null || f.currentVersion <= 0) return "NO_AI_RESULT"
  if (f.assetStatus === "processing") return "GENERATION_IN_PROGRESS"
  if (f.approvedVersionId == null || f.approvedVersion == null) return "NOT_APPROVED"
  if (f.approvedVersion !== f.currentVersion) return "APPROVAL_SUPERSEDED"
  if (f.reviewStatus !== "approved" || f.reviewVersion !== f.approvedVersion) return "NOT_APPROVED"
  if (!f.approvedVersionFound) return "APPROVED_VERSION_MISSING"
  const checks = runQualityChecks({
    classification: f.approvedClassification,
    shortAlt: f.approvedShortAlt,
    longDescription: f.approvedLongDescription,
    language: f.language,
    shortMaxChars: f.shortMaxChars,
    duplicateCount: 0,
    contextState: "analyzed",
    sourceDecorative: false,
    decorativeConfirmation: f.approvedDecorative,
  })
  return hasBlocking(checks) ? "VALIDATION_FAILED" : null
}

/* ---------- API shapes ---------- */

export type ReviewQueueRow = {
  imageId: number
  assetId: number
  documentId: number
  documentFilename: string
  documentType: string
  pageNumber: number | null
  slideNumber: number | null
  locationLabel: string | null
  occurrenceIndex: number
  classification: string | null
  shortAltPreview: string | null
  generationStatus: GenerationStatus
  reviewStatus: DescriptionReviewStatus
  currentVersion: number
  approvedVersion: number | null
  approvalSuperseded: boolean
  sourceDecorative: boolean
  updatedAt: string
}

export type ReviewStats = {
  totalGenerated: number
  pending: number
  inReview: number
  changesRequested: number
  approved: number
  rejected: number
  insertionReady: number
}

export type ReviewQueueResponse = {
  success: true
  documentId: number
  rows: ReviewQueueRow[]
  page: number
  pageSize: number
  total: number
  stats: ReviewStats
  permissions: { canEdit: boolean; canReview: boolean }
}

export type ReviewState = {
  status: DescriptionReviewStatus
  storedStatus: DescriptionReviewStatus
  decidedVersion: number | null
  comment: string | null
  category: CommentCategory | null
  reviewedBy: { id: number; name: string } | null
  reviewedAt: string | null
  approval: {
    versionId: number
    version: number
    approvedBy: { id: number; name: string } | null
    approvedAt: string | null
    decorative: boolean
    justification: string | null
    superseded: boolean
  } | null
}

export type ReviewVersionSnapshot = {
  versionId: number
  version: number
  source: "ai" | "manual"
  classification: string | null
  shortAlt: string | null
  longDescription: string | null
  modelId: string | null
  createdAt: string
}

export type ReviewDetailResponse = {
  success: true
  occurrence: {
    imageId: number
    documentId: number
    documentFilename: string
    documentType: string
    sourceLocator: string
    pageNumber: number | null
    slideNumber: number | null
    locationLabel: string | null
    sourceDecorative: boolean
    contextState: string
    context: {
      caption: string | null
      heading: string | null
      pageTitle: string | null
      nearbyText: string[]
      confidence: string | null
      warnings: string[]
    } | null
    sourceAltText: string | null
  }
  asset: {
    id: number
    imageUrl: string
    status: string
    generationStatus: GenerationStatus
    classification: string | null
    shortAlt: string | null
    longDescription: string | null
    extractedText: string | null
    warnings: string[]
    language: string
    modelId: string | null
    currentVersion: number
    updatedAt: string
  }
  originalAi: ReviewVersionSnapshot | null
  approvedSnapshot: ReviewVersionSnapshot | null
  review: ReviewState
  checks: QualityCheck[]
  shortMaxChars: number
  permissions: { canEdit: boolean; canReview: boolean }
}

export type DecisionResponse = { success: true; changed: boolean; auditId: number | null; review: ReviewState; currentVersion: number }

export type DraftSaveResponse = { success: true; savedVersionId: number | null; currentVersion: number; review: ReviewState }

export type BulkOutcome = { imageId: number; result: "accepted" | "skipped" | "rejected"; code?: string; message?: string }
export type BulkReviewResponse = { success: true; action: BulkReviewAction; accepted: number; skipped: number; rejected: number; outcomes: BulkOutcome[]; stats: ReviewStats }

export type InsertionReadinessRow = {
  documentId: number
  imageOccurrenceId: number
  sourceLocator: string
  approvedVersionId: number | null
  approvedVersion: number | null
  approvedShortAlt: string | null
  approvedLongDescription: string | null
  decorativeApproved: boolean
  reviewerId: number | null
  approvedAt: string | null
  eligible: boolean
  blockingReason: InsertionBlocker | null
  blockingMessage: string | null
}

export type InsertionReadinessResponse = { success: true; documentId: number; rows: InsertionReadinessRow[]; page: number; pageSize: number; total: number; eligible: number }

export const isClassification = (v: unknown): v is ImageClassification => typeof v === "string" && (IMAGE_CLASSIFICATIONS as readonly string[]).includes(v)
