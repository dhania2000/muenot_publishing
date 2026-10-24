/**
 * @file components/publishing/conversion/pdf/pdf-status-model.ts
 * @module Publishing › Conversion › PDF
 * @kind Pure configuration
 * @summary Engine-agnostic status contracts shared by the PDF UI: processing, progress, messages, logs,
 *   validation, optional client guidelines and conversion profiles. No data source lives here.
 * @exports PDF_PROCESSING_STATUS_META, PDF_VALIDATION_STATUS_META, PDF_SEVERITY_META, PDF_CHECK_STATUS_META,
 *   PDF_CHECK_CATEGORY_META, PDF_GUIDELINE_*_STATUS_META (aliases), PDF_MESSAGE_TONE_META, PDF_DEFAULT_PROFILES,
 *   resolveProgress, resolveCheckStatus, summarizeValidation, assessGuidelineCompliance, and their types
 *
 * Phase 1 Task 8. These are contracts for later phases. Helpers refuse to manufacture progress, a pass or a
 * compliance result: an unknown percentage is indeterminate, and a "passed" check without evidence is reported
 * as needing review.
 */

/** Restrained tone scale. Every tone is paired with an icon and a text label, never color alone. */
export type PdfStatusTone = "neutral" | "info" | "progress" | "success" | "warning" | "danger"

export type PdfStatusMeta = { label: string; tone: PdfStatusTone; description?: string }

// ─── Processing ─────────────────────────────────────────────────────────────

export type PdfProcessingStatus =
  | "not-started"
  | "ready"
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled"
  | "review-required"

export const PDF_PROCESSING_STATUS_META: Record<PdfProcessingStatus, PdfStatusMeta> = {
  "not-started": { label: "Not started", tone: "neutral" },
  ready: { label: "Ready", tone: "info" },
  queued: { label: "Queued", tone: "info" },
  processing: { label: "Processing", tone: "progress" },
  completed: { label: "Completed", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  "review-required": { label: "Review required", tone: "warning" },
}

export type PdfProgressInput = {
  status: PdfProcessingStatus
  /** Percentage reported by a real processing source. Omit or pass null when unknown. */
  percent?: number | null
}

export type PdfResolvedProgress = { kind: "determinate"; value: number } | { kind: "indeterminate" } | { kind: "none" }

/**
 * Progress is only shown while work is actually queued or running. A number is shown only when the source
 * reported a finite percentage; otherwise the bar is indeterminate. Nothing is ever estimated.
 */
export function resolveProgress({ status, percent }: PdfProgressInput): PdfResolvedProgress {
  if (status !== "processing" && status !== "queued") return { kind: "none" }
  if (status === "processing" && typeof percent === "number" && Number.isFinite(percent)) {
    return { kind: "determinate", value: Math.min(100, Math.max(0, Math.round(percent))) }
  }
  return { kind: "indeterminate" }
}

// ─── Messages and logs ──────────────────────────────────────────────────────

export type PdfMessageTone = "info" | "warning" | "error" | "success"

export const PDF_MESSAGE_TONE_META: Record<PdfMessageTone, PdfStatusMeta> = {
  info: { label: "Information", tone: "info" },
  warning: { label: "Warning", tone: "warning" },
  error: { label: "Error", tone: "danger" },
  success: { label: "Success", tone: "success" },
}

export type PdfLogEntry = {
  id: string
  /** ISO 8601 timestamp from the event source. */
  timestamp: string
  severity: PdfMessageTone
  event: string
  description: string
}

/** Follow-up actions. A UI only renders an action when a handler or href is supplied. */
export type PdfFeedbackActionId = "retry" | "cancel" | "view-error" | "view-output"

export type PdfFeedbackAction = {
  id: PdfFeedbackActionId
  onAction?: () => void
  href?: string
}

// ─── Validation & QA ────────────────────────────────────────────────────────

export type PdfValidationStatus = "not-run" | "running" | "passed" | "failed" | "review-required" | "unsupported"

export const PDF_VALIDATION_STATUS_META: Record<PdfValidationStatus, PdfStatusMeta> = {
  "not-run": { label: "Not run", tone: "neutral", description: "Validation has not been run for this document." },
  running: { label: "Running", tone: "progress", description: "Checks are in progress." },
  passed: { label: "Passed", tone: "success", description: "All applicable checks passed with recorded evidence." },
  failed: { label: "Failed", tone: "danger", description: "One or more checks failed." },
  "review-required": { label: "Review required", tone: "warning", description: "Some results need a human review." },
  unsupported: { label: "Unsupported", tone: "neutral", description: "These checks are not supported for this format." },
}

export type PdfSeverity = "critical" | "major" | "minor" | "info"

export const PDF_SEVERITY_META: Record<PdfSeverity, PdfStatusMeta & { rank: number }> = {
  critical: { label: "Critical", tone: "danger", rank: 0 },
  major: { label: "Major", tone: "warning", rank: 1 },
  minor: { label: "Minor", tone: "neutral", rank: 2 },
  info: { label: "Information", tone: "info", rank: 3 },
}

/** Standard conversion checks, client guideline checks and format compliance checks stay distinguishable. */
export type PdfCheckCategory = "standard" | "guidelines" | "format"

export const PDF_CHECK_CATEGORY_META: Record<PdfCheckCategory, { label: string }> = {
  standard: { label: "Standard conversion check" },
  guidelines: { label: "Client guideline check" },
  format: { label: "Format compliance check" },
}

export type PdfFindingStatus = "open" | "resolved" | "accepted"

export type PdfValidationFinding = {
  id: string
  title: string
  category: PdfCheckCategory
  severity: PdfSeverity
  /** Page number or a readable location such as "Table 3". */
  location?: string
  expected?: string
  actual?: string
  status: PdfFindingStatus
}

export type PdfCheckStatus = "not-checked" | "passed" | "failed" | "review-required" | "unsupported" | "not-applicable"

export const PDF_CHECK_STATUS_META: Record<PdfCheckStatus, PdfStatusMeta> = {
  "not-checked": { label: "Not checked", tone: "neutral" },
  passed: { label: "Passed", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  "review-required": { label: "Review required", tone: "warning" },
  unsupported: { label: "Unsupported", tone: "neutral" },
  "not-applicable": { label: "Not applicable", tone: "neutral" },
}

export type PdfChecklistItem = {
  id: string
  requirement: string
  category: PdfCheckCategory
  status: PdfCheckStatus
  /** Reference to the evidence behind the result (report section, page, log id). Required for "passed". */
  evidence?: string
  notes?: string
}

/** A pass without evidence is unverified, so it is shown as needing review rather than as passed. */
export function resolveCheckStatus(item: Pick<PdfChecklistItem, "status" | "evidence">): PdfCheckStatus {
  if (item.status === "passed" && !item.evidence?.trim()) return "review-required"
  return item.status
}

export function summarizeValidation({
  checks = [],
  findings = [],
  running = false,
}: {
  checks?: readonly PdfChecklistItem[]
  findings?: readonly PdfValidationFinding[]
  running?: boolean
}): PdfValidationStatus {
  if (running) return "running"
  if (checks.length === 0 && findings.length === 0) return "not-run"
  const statuses = checks.map(resolveCheckStatus)
  const openFindings = findings.filter((f) => f.status === "open")
  if (statuses.includes("failed") || openFindings.some((f) => f.severity === "critical" || f.severity === "major")) return "failed"
  if (statuses.includes("review-required") || statuses.includes("not-checked") || openFindings.length > 0) return "review-required"
  const applicable = statuses.filter((s) => s !== "not-applicable")
  if (applicable.length > 0 && applicable.every((s) => s === "unsupported")) return "unsupported"
  if (applicable.length > 0 && applicable.every((s) => s === "passed" || s === "unsupported")) return "passed"
  return "review-required"
}

// ─── Optional client guidelines ─────────────────────────────────────────────
// The guideline contracts are service-independent and live in lib/guidelines (Task 9). The PDF names below are
// aliases so PDF code keeps one import path. Document, rule, application and verification statuses stay separate.

export {
  GUIDELINE_APPLICATION_STATUS_META as PDF_GUIDELINE_APPLICATION_STATUS_META,
  GUIDELINE_COMPLIANCE_VERDICT_META as PDF_GUIDELINE_COMPLIANCE_VERDICT_META,
  GUIDELINE_DOCUMENT_STATUS_META as PDF_GUIDELINE_DOCUMENT_STATUS_META,
  GUIDELINE_RULE_STATUS_META as PDF_GUIDELINE_RULE_STATUS_META,
  GUIDELINE_VERIFICATION_STATUS_META as PDF_GUIDELINE_VERIFICATION_STATUS_META,
  assessGuidelineCompliance,
} from "@/lib/guidelines/guideline-contracts"

export type {
  GuidelineComplianceAssessment as PdfGuidelineCompliance,
  GuidelineConflict as PdfGuidelineConflict,
  GuidelineContext as PdfGuidelineContext,
  GuidelineDocument as PdfGuidelineDocument,
  GuidelineException as PdfGuidelineException,
  GuidelineProfile as PdfGuidelineProfile,
  GuidelineRule as PdfGuidelineRule,
  GuidelineRuleMapping as PdfGuidelineRuleMapping,
  GuidelineRuleStatus as PdfGuidelineRuleStatus,
} from "@/lib/guidelines/guideline-contracts"

// ─── Conversion profiles ────────────────────────────────────────────────────

export type PdfProfileKind = "standard" | "custom" | "company" | "last-used"

export type PdfProfileOption = {
  id: string
  label: string
  kind: PdfProfileKind
  description?: string
  disabled?: boolean
}

export const PDF_PROFILE_KIND_LABEL: Record<PdfProfileKind, string> = {
  standard: "Standard",
  custom: "Custom",
  company: "Company",
  "last-used": "Last used",
}

/** Only the Standard Profile exists today; it is always a valid choice without guidelines. */
export const PDF_DEFAULT_PROFILES: readonly PdfProfileOption[] = [
  { id: "standard", label: "Standard Profile", kind: "standard", description: "Default settings. No guidelines required." },
]
