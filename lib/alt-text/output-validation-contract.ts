/**
 * @file lib/alt-text/output-validation-contract.ts
 * @module Publishing · Alt Text
 * @kind Shared contract (client + server)
 * @summary Phase 3 Task 18 — quality-validation report model for accessible DOCX / PPTX / PDF outputs.
 *   Every check keeps its own status; skipped or unsupported checks are never counted as passed and
 *   the pass rate is computed only over checks that actually executed. Nothing here claims WCAG,
 *   PDF/UA or any other formal conformance.
 */
import type { AccessibleExportFormat } from "./docx-export-contract"

export const OUTPUT_VALIDATION_RULE_VERSION = "task18.v1"

export type ValidationCategory = "file_integrity" | "alt_text" | "unapproved_content" | "structure" | "accessibility" | "manual"
export type CheckStatus = "passed" | "failed" | "warning" | "not_executed" | "not_applicable" | "not_verified" | "manual_review"
export type Severity = "critical" | "high" | "medium" | "low"
export type OverallStatus = "passed" | "passed_with_warnings" | "failed" | "not_verified" | "manual_review_required"
export type ReleaseReadiness = "ready" | "download_with_warnings" | "blocked"

export type CheckLocation = { region?: string | null; pageNumber?: number | null; slideNumber?: number | null; part?: string | null }

export type ValidationCheck = {
  /** Unique within one report: rule id, plus `:<occurrenceId>` for per-occurrence checks. */
  id: string
  ruleId: string
  category: ValidationCategory
  severity: Severity
  status: CheckStatus
  title: string
  description: string
  /** false for checks that need human judgment; their outcome never feeds the pass rate. */
  machineCheckable: boolean
  location: CheckLocation | null
  occurrenceId: number | null
  expectedVersionId: number | null
  actual: string
  recommendation: string | null
}

export type ValidationCounts = { passed: number; failed: number; warnings: number; notVerified: number; notExecuted: number; notApplicable: number; manualReview: number }

export type ValidationSummary = {
  overallStatus: OverallStatus
  readiness: ReleaseReadiness
  /** passed / (passed + failed + warnings), as a percentage; null when nothing executed. */
  passRate: number | null
  passRateDenominator: number
  criticalFailures: number
  counts: ValidationCounts
  /** Manual-review items still open (acknowledgements reduce this; they never become "passed"). */
  openManualReview: number
}

export type ManualAcknowledgement = { by: number; at: string; note: string | null }

export type ValidationReport = {
  runId: string
  documentId: number
  outputId: string
  format: AccessibleExportFormat
  ruleVersion: string
  validatedAt: string
  originalFilename: string
  outputFilename: string
  /** Policy references that shaped the checks (no client guideline system exists yet). */
  policy: { exportPolicy: string; shortMaxChars: number; guideline: null; pdfUaValidator: null; renderer: null }
  summary: ValidationSummary
  checks: ValidationCheck[]
  acknowledgements: Record<string, ManualAcknowledgement>
}

export type ValidationRunStatus = "processing" | "completed" | "failed"

export type ValidationResponse = {
  success: true
  replayed?: boolean
  /** null when this output has never been validated. */
  report: Omit<ValidationReport, "checks"> | null
  findings: { items: ValidationCheck[]; total: number; page: number; pageSize: number }
  latestRun: { runId: string; status: ValidationRunStatus; errorCode: string | null; createdAt: string } | null
  /** UI hint only; the server re-checks the approve permission on acknowledgement. */
  canAcknowledge?: boolean
}

export type AcknowledgeRequest = { runId: string; checkId: string; note: string | null }

const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** Check ids are interpolated into a JSON path, so only a safe character set is accepted. */
const CHECK_ID = /^[A-Za-z0-9_.:-]{1,120}$/

export function parseAcknowledgeRequest(body: unknown): { ok: true; request: AcknowledgeRequest } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "The request body must be a JSON object." }
  const b = body as Record<string, unknown>
  if (Object.keys(b).some((k) => !["runId", "checkId", "note"].includes(k))) return { ok: false, error: "The request contains unknown fields." }
  if (typeof b.runId !== "string" || !RUN_ID.test(b.runId)) return { ok: false, error: "A valid validation run id is required." }
  if (typeof b.checkId !== "string" || !CHECK_ID.test(b.checkId)) return { ok: false, error: "A valid check id is required." }
  if (b.note != null && typeof b.note !== "string") return { ok: false, error: "The note must be text." }
  const note = typeof b.note === "string" ? b.note.trim() : ""
  if ([...note].length > 500) return { ok: false, error: "The note must be 500 characters or fewer." }
  return { ok: true, request: { runId: b.runId, checkId: b.checkId, note: note || null } }
}

export const STATUS_LABEL: Record<CheckStatus, string> = {
  passed: "Passed",
  failed: "Failed",
  warning: "Warning",
  not_executed: "Not executed",
  not_applicable: "Not applicable",
  not_verified: "Cannot be verified automatically",
  manual_review: "Manual review",
}
export const OVERALL_LABEL: Record<OverallStatus, string> = {
  passed: "Passed",
  passed_with_warnings: "Passed with warnings",
  failed: "Failed",
  not_verified: "Not verified",
  manual_review_required: "Manual review required",
}
export const READINESS_LABEL: Record<ReleaseReadiness, string> = {
  ready: "Ready for download",
  download_with_warnings: "Download with warnings",
  blocked: "Blocked",
}
export const SEVERITY_LABEL: Record<Severity, string> = { critical: "Critical", high: "High", medium: "Medium", low: "Low" }
export const CATEGORY_LABEL: Record<ValidationCategory, string> = {
  file_integrity: "File integrity",
  alt_text: "Alt text correctness",
  unapproved_content: "Unapproved content",
  structure: "Document structure",
  accessibility: "Accessibility structure",
  manual: "Manual review",
}

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 }
const STATUS_ORDER: Record<CheckStatus, number> = { failed: 0, warning: 1, manual_review: 2, not_verified: 3, not_executed: 4, passed: 5, not_applicable: 6 }
export const compareChecks = (a: ValidationCheck, b: ValidationCheck) =>
  STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.id.localeCompare(b.id)

/**
 * Deterministic scoring. Not Applicable / Not Executed / Not Verified / Manual Review never enter the
 * denominator. Readiness is driven by failures, never by the pass rate.
 */
export function summarizeChecks(checks: ValidationCheck[], acknowledgements: Record<string, ManualAcknowledgement> = {}): ValidationSummary {
  const counts: ValidationCounts = { passed: 0, failed: 0, warnings: 0, notVerified: 0, notExecuted: 0, notApplicable: 0, manualReview: 0 }
  let blocking = 0
  let criticalFailures = 0
  let integrityFailed = false
  let openManualReview = 0
  for (const c of checks) {
    if (c.status === "passed") counts.passed++
    else if (c.status === "failed") {
      counts.failed++
      if (c.severity === "critical") criticalFailures++
      if (c.severity === "critical" || c.severity === "high") blocking++
      if (c.category === "file_integrity") integrityFailed = true
    } else if (c.status === "warning") counts.warnings++
    else if (c.status === "not_verified") counts.notVerified++
    else if (c.status === "not_executed") counts.notExecuted++
    else if (c.status === "not_applicable") counts.notApplicable++
    else if (c.status === "manual_review") {
      counts.manualReview++
      if (!acknowledgements[c.id]) openManualReview++
    }
  }
  const denominator = counts.passed + counts.failed + counts.warnings
  const passRate = denominator === 0 ? null : Math.round((counts.passed / denominator) * 1000) / 10
  const overallStatus: OverallStatus =
    counts.failed > 0
      ? "failed"
      : denominator === 0
        ? "not_verified"
        : counts.warnings > 0
          ? "passed_with_warnings"
          : openManualReview > 0
            ? "manual_review_required"
            : "passed"
  const readiness: ReleaseReadiness =
    integrityFailed || blocking > 0
      ? "blocked"
      : counts.failed > 0 || counts.warnings > 0 || counts.notVerified > 0 || openManualReview > 0
        ? "download_with_warnings"
        : "ready"
  return { overallStatus, readiness, passRate, passRateDenominator: denominator, criticalFailures, counts, openManualReview }
}

export const outputValidationUrl = (documentId: number, outputId: string) =>
  `/api/alt-text/documents/${documentId}/exports/${encodeURIComponent(outputId)}/validation`

export type FindingsQuery = { page: number; pageSize: number; status?: CheckStatus | ""; severity?: Severity | ""; search?: string }

export function outputValidationQueryUrl(documentId: number, outputId: string, q: FindingsQuery) {
  const p = new URLSearchParams({ page: String(q.page), pageSize: String(q.pageSize) })
  if (q.status) p.set("status", q.status)
  if (q.severity) p.set("severity", q.severity)
  if (q.search?.trim()) p.set("search", q.search.trim().slice(0, 100))
  return `${outputValidationUrl(documentId, outputId)}?${p}`
}

export const outputValidationReportUrl = (documentId: number, outputId: string, format: "json" | "csv") =>
  `${outputValidationUrl(documentId, outputId)}?download=${format}`

export function filterChecks(checks: ValidationCheck[], q: Omit<FindingsQuery, "page" | "pageSize">): ValidationCheck[] {
  const s = q.search?.trim().toLowerCase() ?? ""
  return checks.filter(
    (c) =>
      (!q.status || c.status === q.status) &&
      (!q.severity || c.severity === q.severity) &&
      (!s || c.ruleId.toLowerCase().includes(s) || c.title.toLowerCase().includes(s) || (c.occurrenceId != null && String(c.occurrenceId) === s.replace(/^#/, ""))),
  )
}

export const isCheckStatus = (v: unknown): v is CheckStatus => typeof v === "string" && v in STATUS_LABEL
export const isSeverity = (v: unknown): v is Severity => typeof v === "string" && v in SEVERITY_LABEL

/* ---------- CSV ---------- */

/** Neutralise spreadsheet formulas (=, +, -, @, tab, CR) and quote every field. */
export function csvCell(value: unknown): string {
  let s = value == null ? "" : String(value)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return `"${s.replace(/"/g, '""')}"`
}

const describeLocation = (l: CheckLocation | null) =>
  !l ? "" : [l.slideNumber ? `Slide ${l.slideNumber}` : null, l.pageNumber ? `Page ${l.pageNumber}` : null, l.region ?? null].filter(Boolean).join(" · ")
export { describeLocation }

export function findingsCsv(report: ValidationReport): string {
  const head = ["Check ID", "Rule", "Category", "Severity", "Status", "Machine checkable", "Location", "Image occurrence", "Expected approved version", "Title", "Actual outcome", "Recommended action", "Acknowledged by", "Acknowledged at"]
  const rows = report.checks.map((c) => {
    const ack = report.acknowledgements[c.id]
    return [c.id, c.ruleId, CATEGORY_LABEL[c.category], SEVERITY_LABEL[c.severity], STATUS_LABEL[c.status], c.machineCheckable ? "yes" : "no", describeLocation(c.location), c.occurrenceId ?? "", c.expectedVersionId ?? "", c.title, c.actual, c.recommendation ?? "", ack ? ack.by : "", ack ? ack.at : ""]
  })
  return "\uFEFF" + [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n"
}
