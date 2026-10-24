/**
 * @file lib/guidelines/guideline-contracts.ts
 * @module Shared › Client Guidelines
 * @kind Pure contracts (no I/O)
 * @summary Service-independent contracts for optional client guidelines: documents, versioned profiles, rules,
 *   rule-to-setting mappings, conflicts, exceptions, compliance results, priority levels and the four separate
 *   status models. Usable by Conversion, Editorial and Accessibility services.
 * @see PDF_PHASE1_TASK9_GUIDELINES_ARCHITECTURE.md
 *
 * Permanent rule: client guidelines are optional, compliance with supplied applicable guidelines is required.
 * - No context (null) means Scenario A: Standard Profile, nothing blocked, compliance "Not applicable".
 * - Document, rule, application and verification statuses are separate. "Uploaded" never implies "Applied",
 *   and "Applied" never implies "Verified".
 * - Nothing here parses, interprets, maps or enforces guidelines. Those arrive in Phase 6; this file only
 *   describes and summarizes records a real source supplies.
 */

/** Same tone scale as the PDF status model; every tone is shown with an icon and a text label. */
export type GuidelineStatusTone = "neutral" | "info" | "progress" | "success" | "warning" | "danger"

export type GuidelineStatusMeta = { label: string; tone: GuidelineStatusTone; description?: string }

// ─── Service scope ──────────────────────────────────────────────────────────

export type GuidelineServiceArea = "conversion" | "editorial" | "accessibility"

/** e.g. { area: "conversion", service: "pdf", capability: "pdf-to-docx" }. */
export type GuidelineServiceScope = {
  area: GuidelineServiceArea
  service: string
  capability?: string
}

// ─── Status models (kept separate on purpose) ───────────────────────────────

export type GuidelineDocumentStatus =
  | "not-provided"
  | "selected"
  | "uploaded"
  | "pending-review"
  | "reviewed"
  | "rejected"
  | "unavailable"

export const GUIDELINE_DOCUMENT_STATUS_META: Record<GuidelineDocumentStatus, GuidelineStatusMeta> = {
  "not-provided": { label: "Not provided", tone: "neutral", description: "No guideline document was supplied. This is a valid state." },
  selected: { label: "Selected", tone: "info", description: "A document is chosen but not yet stored." },
  uploaded: { label: "Uploaded", tone: "info", description: "Stored. Its requirements are not yet reviewed or applied." },
  "pending-review": { label: "Pending review", tone: "info", description: "Awaiting review of its requirements." },
  reviewed: { label: "Reviewed", tone: "info", description: "Requirements were reviewed. Application and verification are tracked separately." },
  rejected: { label: "Rejected", tone: "warning", description: "The document was rejected during review." },
  unavailable: { label: "Unavailable", tone: "warning", description: "The document cannot be accessed." },
}

export type GuidelineRuleStatus = "not-extracted" | "pending-review" | "accepted" | "conflict" | "unsupported" | "not-applicable"

export const GUIDELINE_RULE_STATUS_META: Record<GuidelineRuleStatus, GuidelineStatusMeta> = {
  "not-extracted": { label: "Not extracted", tone: "neutral" },
  "pending-review": { label: "Pending review", tone: "info" },
  accepted: { label: "Accepted", tone: "info" },
  conflict: { label: "Conflict", tone: "warning" },
  unsupported: { label: "Unsupported", tone: "warning" },
  "not-applicable": { label: "Not applicable", tone: "neutral" },
}

export type GuidelineApplicationStatus = "not-applied" | "pending-application" | "applied" | "partially-applied" | "failed"

export const GUIDELINE_APPLICATION_STATUS_META: Record<GuidelineApplicationStatus, GuidelineStatusMeta> = {
  "not-applied": { label: "Not applied", tone: "neutral" },
  "pending-application": { label: "Pending application", tone: "info" },
  applied: { label: "Applied, not verified", tone: "info" },
  "partially-applied": { label: "Partially applied", tone: "warning" },
  failed: { label: "Application failed", tone: "danger" },
}

export type GuidelineVerificationStatus = "not-run" | "verification-pending" | "passed" | "failed" | "review-required" | "unsupported"

export const GUIDELINE_VERIFICATION_STATUS_META: Record<GuidelineVerificationStatus, GuidelineStatusMeta> = {
  "not-run": { label: "Not run", tone: "neutral" },
  "verification-pending": { label: "Verification pending", tone: "info" },
  passed: { label: "Passed", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  "review-required": { label: "Review required", tone: "warning" },
  unsupported: { label: "Unsupported", tone: "warning" },
}

// ─── Priority ───────────────────────────────────────────────────────────────

/** Highest priority first. A higher level overrides a lower level's configurable defaults only. */
export type GuidelinePriorityLevel = "job" | "company" | "preset" | "standard"

export const GUIDELINE_PRIORITY_LEVELS: readonly { id: GuidelinePriorityLevel; label: string; rank: number }[] = [
  { id: "job", label: "Job-Specific Guidelines", rank: 1 },
  { id: "company", label: "Selected Company Profile", rank: 2 },
  { id: "preset", label: "Selected Conversion Preset", rank: 3 },
  { id: "standard", label: "Standard Default Settings", rank: 4 },
]

/** Constraints no guideline level can override. */
export const GUIDELINE_NON_OVERRIDABLE = [
  { id: "security", label: "Security restrictions" },
  { id: "mandatory-technical", label: "Mandatory technical requirements" },
] as const

export function guidelinePriorityRank(level: GuidelinePriorityLevel): number {
  return GUIDELINE_PRIORITY_LEVELS.find((l) => l.id === level)!.rank
}

/**
 * Outcome a future resolver must report for one setting. Conflicts, ambiguity and unsupported requirements
 * are surfaced, never silently resolved.
 */
export type GuidelineResolutionOutcome =
  | { kind: "resolved"; settingKey: string; winningRuleId: string; level: GuidelinePriorityLevel }
  | { kind: "standard-default"; settingKey: string }
  | { kind: "conflict"; settingKey: string; ruleIds: readonly string[] }
  | { kind: "review-required"; settingKey: string; ruleIds: readonly string[]; reason: string }
  | { kind: "unsupported"; settingKey: string; ruleIds: readonly string[]; reason: string }
  | { kind: "blocked-by-constraint"; settingKey: string; ruleIds: readonly string[]; constraint: (typeof GUIDELINE_NON_OVERRIDABLE)[number]["id"] }

// ─── Records ────────────────────────────────────────────────────────────────

/** Exact version a job references. Missing values stay undefined; they are never filled in. */
export type GuidelineVersionRef = {
  profileId: string
  versionId: string
  /** ISO 8601 date, only when the source records one. */
  effectiveDate?: string
  supersedesVersionId?: string
}

export type GuidelineDocument = {
  id: string
  title: string
  originalFilename?: string
  /** Extension or MIME type as verified server-side. */
  fileType?: string
  sizeBytes?: number
  companyLabel?: string
  version?: string
  effectiveDate?: string
  description?: string
  scope?: GuidelineServiceScope
  status: GuidelineDocumentStatus
  /** Opaque reference to durable storage. Browser-only state is never a substitute. */
  attachmentRef?: string
}

export type GuidelineProfileAvailability = "available" | "archived" | "unavailable"

export type GuidelineProfile = {
  id: string
  name: string
  companyLabel?: string
  version?: GuidelineVersionRef
  documentIds: readonly string[]
  /** Output formats the profile targets, e.g. ["DOCX", "JATS XML"]. */
  applicableFormats?: readonly string[]
  applicableCapabilities?: readonly string[]
  reviewStatus: GuidelineDocumentStatus
  updatedAt?: string
  updatedBy?: string
  availability: GuidelineProfileAvailability
}

export type GuidelineRequirementLevel = "mandatory" | "recommended" | "optional"

export type GuidelineApplicability = "applicable" | "not-applicable" | "undetermined"

export type GuidelineRule = {
  id: string
  requirement: string
  /** Id from the service's category registry, e.g. "formatting.page-size". */
  categoryId: string
  sourceDocumentId?: string
  /** Page or section, e.g. "§4.2" or "p. 12". */
  sourceLocation?: string
  expectedValue?: string
  targetSettingKey?: string
  level: GuidelineRequirementLevel
  priority: GuidelinePriorityLevel
  applicability: GuidelineApplicability
  status: GuidelineRuleStatus
  verificationStatus: GuidelineVerificationStatus
  evidenceRef?: string
}

/**
 * How a rule relates to a setting. Not every guideline paragraph is an executable setting: "manual-review"
 * covers instructions that need human assessment.
 */
export type GuidelineMappingKind = "mapped" | "manual-review" | "unsupported" | "not-applicable" | "conflict"

export type GuidelineRuleMapping = {
  ruleId: string
  kind: GuidelineMappingKind
  requirement: string
  sourceDocumentId?: string
  sourceLocation?: string
  targetSettingKey?: string
  expectedValue?: string
  configuredValue?: string
  applicability: GuidelineApplicability
  applicationStatus: GuidelineApplicationStatus
  verificationStatus: GuidelineVerificationStatus
}

export type GuidelineSeverity = "critical" | "major" | "minor"

export type GuidelineResolutionStatus = "open" | "resolved" | "exception-approved"

export type GuidelineConflict = {
  id: string
  affectedSettingKey: string
  ruleIds: readonly string[]
  description: string
  severity: GuidelineSeverity
  resolution: GuidelineResolutionStatus
  reviewerNotes?: string
}

/** Explicit record for an unsupported, ambiguous or overridden requirement. Never implies "satisfied". */
export type GuidelineException = {
  id: string
  ruleId: string
  kind: "unsupported" | "ambiguous" | "conflict"
  explanation: string
  suggestedAction?: string
  approval: { status: "pending" | "approved" | "rejected"; approvedBy?: string; approvedAt?: string }
}

export type GuidelineValidationMethod = "automated" | "manual" | "hybrid"

export type GuidelineComplianceResult = {
  ruleId: string
  expected?: string
  actual?: string
  method: GuidelineValidationMethod
  /** Required for a pass to count. */
  evidenceRef?: string
  status: GuidelineVerificationStatus
  error?: string
}

/** Everything known about guidelines for one job. `null` everywhere means no guidelines (Scenario A). */
export type GuidelineContext = {
  scope: GuidelineServiceScope
  profile?: GuidelineProfile | null
  /** Exact version this job is pinned to; updating a profile never rewrites it. */
  versionRef?: GuidelineVersionRef
  documents: readonly GuidelineDocument[]
  rules: readonly GuidelineRule[]
  mappings?: readonly GuidelineRuleMapping[]
  conflicts?: readonly GuidelineConflict[]
  exceptions?: readonly GuidelineException[]
  results?: readonly GuidelineComplianceResult[]
}

export function hasGuidelines(context: GuidelineContext | null | undefined): context is GuidelineContext {
  return !!context && (!!context.profile || context.documents.some((d) => d.status !== "not-provided"))
}

// ─── Verification layers ────────────────────────────────────────────────────

export type GuidelineVerificationLayer = "standard" | "technical" | "guidelines"

export const GUIDELINE_VERIFICATION_LAYERS: Record<GuidelineVerificationLayer, { label: string; description: string }> = {
  standard: { label: "Standard Validation", description: "General format and document checks." },
  technical: { label: "Technical Compliance", description: "Standards such as PDF/A or PDF/UA, where applicable." },
  guidelines: { label: "Company Guidelines", description: "Client-specific requirements, when supplied." },
}

// ─── Compliance assessment (aggregation only) ───────────────────────────────

export type GuidelineComplianceVerdict =
  | "not-applicable"
  | "requirements-pending"
  | "not-verified"
  | "review-required"
  | "failed"
  | "compliant"
  | "compliant-with-exceptions"

export const GUIDELINE_COMPLIANCE_VERDICT_META: Record<GuidelineComplianceVerdict, GuidelineStatusMeta> = {
  "not-applicable": { label: "Not applicable", tone: "neutral", description: "No company guidelines were supplied." },
  "requirements-pending": { label: "Requirements pending", tone: "info", description: "Guidelines were supplied; requirements are not yet identified." },
  "not-verified": { label: "Not verified", tone: "neutral", description: "Applicable requirements have not all been verified." },
  "review-required": { label: "Review required", tone: "warning", description: "Conflicts, ambiguous or unsupported requirements need review." },
  failed: { label: "Failed", tone: "danger", description: "One or more mandatory requirements failed verification." },
  compliant: { label: "Compliant", tone: "success", description: "Every applicable mandatory requirement was verified with evidence." },
  "compliant-with-exceptions": {
    label: "Compliant with approved exceptions",
    tone: "success",
    description: "Verified, except requirements covered by explicitly approved exceptions.",
  },
}

export type GuidelineComplianceCounts = {
  identified: number
  applicable: number
  applied: number
  verified: number
  failed: number
  unsupported: number
  pendingReview: number
  unresolvedConflicts: number
  approvedExceptions: number
}

export type GuidelineComplianceAssessment = { verdict: GuidelineComplianceVerdict; counts: GuidelineComplianceCounts | null }

/** A pass without evidence is unverified. */
export function isVerifiedPass(result: Pick<GuidelineComplianceResult, "status" | "evidenceRef"> | undefined): boolean {
  return result?.status === "passed" && !!result.evidenceRef?.trim()
}

/**
 * Aggregates recorded statuses into a verdict. It never runs a check. "Compliant" requires every applicable
 * mandatory rule to have an evidenced pass or an approved exception; an absence of errors is not enough.
 */
export function assessGuidelineCompliance(context: GuidelineContext | null | undefined): GuidelineComplianceAssessment {
  if (!hasGuidelines(context)) return { verdict: "not-applicable", counts: null }
  const { rules, mappings = [], conflicts = [], exceptions = [], results = [] } = context
  if (rules.length === 0) return { verdict: "requirements-pending", counts: null }

  const resultFor = (ruleId: string) => results.find((r) => r.ruleId === ruleId)
  const approved = new Set(exceptions.filter((e) => e.approval.status === "approved").map((e) => e.ruleId))
  const applicable = rules.filter((r) => r.applicability !== "not-applicable" && r.status !== "not-applicable")
  const unresolvedConflicts =
    conflicts.filter((c) => c.resolution === "open").length +
    applicable.filter((r) => r.status === "conflict" && !approved.has(r.id) && !conflicts.some((c) => c.ruleIds.includes(r.id))).length

  const counts: GuidelineComplianceCounts = {
    identified: rules.length,
    applicable: applicable.length,
    applied: mappings.filter((m) => m.applicationStatus === "applied" || m.applicationStatus === "partially-applied").length,
    verified: applicable.filter((r) => isVerifiedPass(resultFor(r.id))).length,
    failed: applicable.filter((r) => resultFor(r.id)?.status === "failed" || r.verificationStatus === "failed").length,
    unsupported: applicable.filter((r) => r.status === "unsupported").length,
    pendingReview: applicable.filter((r) => r.status === "pending-review" || r.status === "not-extracted" || r.applicability === "undetermined").length,
    unresolvedConflicts,
    approvedExceptions: approved.size,
  }

  const mandatory = applicable.filter((r) => r.level === "mandatory")
  const open = mandatory.filter((r) => !approved.has(r.id))
  if (open.some((r) => resultFor(r.id)?.status === "failed" || r.verificationStatus === "failed")) return { verdict: "failed", counts }
  if (
    unresolvedConflicts > 0 ||
    open.some(
      (r) =>
        r.status !== "accepted" ||
        r.applicability === "undetermined" ||
        resultFor(r.id)?.status === "review-required" ||
        resultFor(r.id)?.status === "unsupported" ||
        (resultFor(r.id)?.status === "passed" && !isVerifiedPass(resultFor(r.id))),
    )
  ) {
    return { verdict: "review-required", counts }
  }
  if (mandatory.length === 0 || open.some((r) => !isVerifiedPass(resultFor(r.id)))) return { verdict: "not-verified", counts }
  return { verdict: open.length === mandatory.length ? "compliant" : "compliant-with-exceptions", counts }
}
