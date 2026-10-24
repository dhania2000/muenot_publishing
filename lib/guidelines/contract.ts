/**
 * @file lib/guidelines/contract.ts
 * @module Shared › Client Guidelines
 * @kind Pure TypeScript contract (no I/O, no React)
 * @summary Service-independent contract for optional client guidelines: documents, versioned profiles, rules,
 *   rule-to-setting mappings, conflicts, exceptions and compliance results, plus the optional-guidelines policy,
 *   the priority hierarchy and a compliance verdict that only reflects recorded evidence (Phase 1, Task 9).
 *
 * PERMANENT RULE: Client guidelines are optional. Compliance with supplied applicable guidelines is required.
 *  - No guidelines → Standard Profile, normal processing, compliance "Not Applicable" (never "Failed"/"Missing").
 *  - Guidelines supplied → document, rule, application and verification statuses stay separate. Uploading never
 *    implies applied; applied never implies verified.
 *
 * Nothing here uploads, stores, parses, interprets or enforces guidelines. Those arrive in Phase 6+, and they
 * populate these shapes from durable server storage (never browser-only state).
 */

// ─── Service scope ──────────────────────────────────────────────────────────

/** Guidelines are reusable across Conversion, Editorial and Accessibility services. */
export type GuidelineServiceArea = "conversion" | "editorial" | "accessibility"

/** e.g. `{ area: "conversion", service: "pdf" }` or `{ area: "editorial", service: "copy-editing" }`. */
export type GuidelineServiceRef = { area: GuidelineServiceArea; service: string; capability?: string }

// ─── Status models (kept deliberately separate) ─────────────────────────────

export type GuidelineTone = "neutral" | "info" | "success" | "warning" | "danger"
export type GuidelineStatusMeta = { label: string; tone: GuidelineTone; description?: string }

export type GuidelineDocumentStatus =
  | "not-provided"
  | "selected"
  | "uploaded"
  | "pending-review"
  | "reviewed"
  | "rejected"
  | "unavailable"

export type GuidelineRuleStatus = "not-extracted" | "pending-review" | "accepted" | "conflict" | "unsupported" | "not-applicable"

export type GuidelineApplicationStatus = "not-applied" | "pending-application" | "applied" | "partially-applied" | "failed"

export type GuidelineVerificationStatus = "not-run" | "verification-pending" | "passed" | "failed" | "review-required" | "unsupported"

/** Only verification "passed" may use the success tone. "Not provided" is neutral, never an error. */
export const GUIDELINE_DOCUMENT_STATUS_META: Record<GuidelineDocumentStatus, GuidelineStatusMeta> = {
  "not-provided": { label: "Not Provided", tone: "neutral" },
  selected: { label: "Selected", tone: "info" },
  uploaded: { label: "Uploaded", tone: "info", description: "Received. Requirements are not yet reviewed or applied." },
  "pending-review": { label: "Pending Review", tone: "info" },
  reviewed: { label: "Reviewed", tone: "info", description: "Document reviewed. Output is not yet verified." },
  rejected: { label: "Rejected", tone: "warning" },
  unavailable: { label: "Unavailable", tone: "neutral" },
}

export const GUIDELINE_RULE_STATUS_META: Record<GuidelineRuleStatus, GuidelineStatusMeta> = {
  "not-extracted": { label: "Not Extracted", tone: "neutral" },
  "pending-review": { label: "Pending Review", tone: "info" },
  accepted: { label: "Accepted", tone: "info" },
  conflict: { label: "Conflict", tone: "warning" },
  unsupported: { label: "Unsupported", tone: "warning" },
  "not-applicable": { label: "Not Applicable", tone: "neutral" },
}

export const GUIDELINE_APPLICATION_STATUS_META: Record<GuidelineApplicationStatus, GuidelineStatusMeta> = {
  "not-applied": { label: "Not Applied", tone: "neutral" },
  "pending-application": { label: "Pending Application", tone: "info" },
  applied: { label: "Applied", tone: "info", description: "Applied to settings. Not yet verified in the output." },
  "partially-applied": { label: "Partially Applied", tone: "warning" },
  failed: { label: "Failed", tone: "danger" },
}

export const GUIDELINE_VERIFICATION_STATUS_META: Record<GuidelineVerificationStatus, GuidelineStatusMeta> = {
  "not-run": { label: "Not Run", tone: "neutral" },
  "verification-pending": { label: "Verification Pending", tone: "info" },
  passed: { label: "Passed", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  "review-required": { label: "Review Required", tone: "warning" },
  unsupported: { label: "Unsupported", tone: "warning" },
}

// ─── Priority hierarchy ─────────────────────────────────────────────────────

export type GuidelinePriorityLevel = "job" | "company" | "preset" | "standard"

/** Highest priority first (rank 1). Higher levels override lower configurable defaults. */
export const GUIDELINE_PRIORITY_LEVELS: readonly { id: GuidelinePriorityLevel; label: string; rank: number }[] = [
  { id: "job", label: "Job-Specific Guidelines", rank: 1 },
  { id: "company", label: "Selected Company Profile", rank: 2 },
  { id: "preset", label: "Selected Conversion Preset", rank: 3 },
  { id: "standard", label: "Standard Default Settings", rank: 4 },
]

/** Constraints that no guideline level can override. */
export const GUIDELINE_NON_OVERRIDABLE = [
  "Mandatory technical requirements of the target format",
  "Security restrictions",
] as const

export function guidelinePriorityRank(level: GuidelinePriorityLevel): number {
  return GUIDELINE_PRIORITY_LEVELS.find((l) => l.id === level)?.rank ?? Number.POSITIVE_INFINITY
}

/** One candidate value for a single setting, contributed by one priority level. */
export type GuidelinePrecedenceCandidate = {
  ruleId?: string
  level: GuidelinePriorityLevel
  /** Undefined means the instruction exists but defines no value (ambiguous). */
  value?: string
  /** Set by a future capability check; precedence never overrides it. */
  supported?: boolean
}

export type GuidelinePrecedenceOutcome =
  | { kind: "resolved"; value: string; level: GuidelinePriorityLevel; ruleId?: string }
  | { kind: "conflict"; level: GuidelinePriorityLevel; candidates: readonly GuidelinePrecedenceCandidate[] }
  | { kind: "review-required"; reason: "ambiguous"; candidate: GuidelinePrecedenceCandidate }
  | { kind: "unsupported"; candidate: GuidelinePrecedenceCandidate }
  | { kind: "none" }

/**
 * Ordering contract only. It does not read or interpret guideline text: it applies the priority hierarchy to
 * values that are already recorded. It never silently picks between disagreeing values on the same level, and
 * it never treats an ambiguous or unsupported instruction as satisfied.
 */
export function resolveGuidelinePrecedence(candidates: readonly GuidelinePrecedenceCandidate[]): GuidelinePrecedenceOutcome {
  if (candidates.length === 0) return { kind: "none" }
  const topRank = Math.min(...candidates.map((c) => guidelinePriorityRank(c.level)))
  const top = candidates.filter((c) => guidelinePriorityRank(c.level) === topRank)
  const unsupported = top.find((c) => c.supported === false)
  if (unsupported) return { kind: "unsupported", candidate: unsupported }
  const ambiguous = top.find((c) => c.value === undefined)
  if (ambiguous) return { kind: "review-required", reason: "ambiguous", candidate: ambiguous }
  const distinct = new Set(top.map((c) => c.value))
  if (distinct.size > 1) return { kind: "conflict", level: top[0].level, candidates: top }
  const winner = top[0]
  return { kind: "resolved", value: winner.value as string, level: winner.level, ruleId: winner.ruleId }
}

// ─── Documents, versions and profiles ───────────────────────────────────────

/** Opaque pointer to a server-stored attachment. The browser never holds the document as the source of truth. */
export type GuidelineAttachmentRef = { attachmentId: string }

export type GuidelineDocument = {
  id: string
  title: string
  originalFilename: string
  fileType: string
  fileSizeBytes?: number
  companyLabel?: string
  version?: string
  /** ISO 8601 date, only when the source records one. */
  effectiveDate?: string
  description?: string
  applicableServices: readonly GuidelineServiceRef[]
  /** e.g. ["pdf-to-docx", "pdf-to-xml"]; empty means not specified, not "all". */
  applicableConversionTypes?: readonly string[]
  status: GuidelineDocumentStatus
  attachment?: GuidelineAttachmentRef
}

/** A job pins this exact reference so later profile edits never rewrite its historical requirements. */
export type GuidelineVersionRef = { profileId: string; versionId: string }

export type GuidelineProfileVersion = {
  versionId: string
  /** Human label such as "2.1". Missing labels are shown as "Version not recorded", never invented. */
  label?: string
  effectiveDate?: string
  supersedesVersionId?: string
  supersededByVersionId?: string
  documentIds: readonly string[]
  applicableFormats: readonly string[]
  reviewStatus: GuidelineDocumentStatus
  updatedAt?: string
  updatedBy?: string
}

export type GuidelineProfileAvailability = "available" | "draft" | "archived" | "unavailable"

export type GuidelineProfile = {
  id: string
  name: string
  companyLabel: string
  /** Null when the source records no version; such a profile cannot be pinned to a job. */
  version: GuidelineProfileVersion | null
  applicableServices: readonly GuidelineServiceRef[]
  applicableCapabilities?: readonly string[]
  availability: GuidelineProfileAvailability
}

export const GUIDELINE_VERSION_NOT_RECORDED = "Version not recorded"

export function formatGuidelineVersion(version: GuidelineProfileVersion | null | undefined): string {
  return version?.label ?? version?.versionId ?? GUIDELINE_VERSION_NOT_RECORDED
}

/** Only an available profile with a recorded version can be referenced by a job. */
export function pinGuidelineVersion(profile: GuidelineProfile): GuidelineVersionRef | null {
  if (!profile.version || profile.availability !== "available") return null
  return { profileId: profile.id, versionId: profile.version.versionId }
}

// ─── Requirement categories ─────────────────────────────────────────────────

/** Classification only. Categories are service-specific registries built on this shape and never enforce anything. */
export type GuidelineRequirementCategory = {
  id: string
  label: string
  items: readonly { id: string; label: string }[]
}

// ─── Rules and rule-to-setting mapping ──────────────────────────────────────

export type GuidelineRequirementLevel = "mandatory" | "recommended" | "optional"
export type GuidelineApplicability = "applicable" | "not-applicable" | "undetermined"

export type GuidelineSourceRef = {
  documentId: string
  documentTitle?: string
  /** Page or section, e.g. "p. 4" or "§3.2". */
  location?: string
}

export type GuidelineEvidenceRef = { id: string; label: string; location?: string }

export type GuidelineRule = {
  id: string
  requirement: string
  categoryId: string
  categoryItemId?: string
  source: GuidelineSourceRef
  expectedValue?: string
  targetSetting?: string
  level: GuidelineRequirementLevel
  priority: GuidelinePriorityLevel
  applicability: GuidelineApplicability
  ruleStatus: GuidelineRuleStatus
  applicationStatus: GuidelineApplicationStatus
  verificationStatus: GuidelineVerificationStatus
  evidence?: GuidelineEvidenceRef
}

/** Not every guideline paragraph maps to a setting; some require human assessment. */
export type GuidelineMappingKind = "setting" | "manual-review" | "unsupported" | "not-applicable" | "conflict"

export const GUIDELINE_MAPPING_KIND_META: Record<GuidelineMappingKind, GuidelineStatusMeta> = {
  setting: { label: "Mapped to setting", tone: "info" },
  "manual-review": { label: "Manual review", tone: "warning" },
  unsupported: { label: "Unsupported", tone: "warning" },
  "not-applicable": { label: "Not applicable to format", tone: "neutral" },
  conflict: { label: "Conflict", tone: "warning" },
}

export type GuidelineRuleMapping = {
  ruleId: string
  requirement: string
  source: GuidelineSourceRef
  kind: GuidelineMappingKind
  targetSetting?: string
  expectedValue?: string
  configuredValue?: string
  applicability: GuidelineApplicability
  applicationStatus: GuidelineApplicationStatus
  verificationStatus: GuidelineVerificationStatus
  note?: string
}

export function summarizeGuidelineMappings(mappings: readonly GuidelineRuleMapping[]): Record<GuidelineMappingKind, number> {
  const counts: Record<GuidelineMappingKind, number> = { setting: 0, "manual-review": 0, unsupported: 0, "not-applicable": 0, conflict: 0 }
  for (const m of mappings) counts[m.kind] += 1
  return counts
}

// ─── Conflicts and exceptions ───────────────────────────────────────────────

export type GuidelineConflictSeverity = "blocking" | "major" | "minor"
export type GuidelineConflictResolution = "unresolved" | "resolved" | "exception-approved"

export type GuidelineConflict = {
  id: string
  affectedSetting: string
  description: string
  /** Every competing requirement with its source and priority. */
  requirements: readonly {
    ruleId: string
    requirement: string
    expectedValue?: string
    source: GuidelineSourceRef
    priority: GuidelinePriorityLevel
  }[]
  severity: GuidelineConflictSeverity
  resolution: GuidelineConflictResolution
  reviewerNotes?: string
}

export type GuidelineExceptionKind = "unsupported" | "ambiguous" | "conflict" | "waiver"
export type GuidelineExceptionApproval = "pending" | "approved" | "rejected"

/** An explicit, reviewable record. Only an approved exception can qualify a compliance result. */
export type GuidelineException = {
  id: string
  ruleId: string
  kind: GuidelineExceptionKind
  explanation: string
  suggestedAction?: string
  approval: GuidelineExceptionApproval
  approvedBy?: string
  approvedAt?: string
}

// ─── Compliance results and verdict ─────────────────────────────────────────

/** Standard checks, technical standards (PDF/A, PDF/UA…) and client guideline checks stay distinguishable. */
export type GuidelineValidationLayer = "standard" | "technical" | "guideline"

export const GUIDELINE_VALIDATION_LAYER_LABEL: Record<GuidelineValidationLayer, string> = {
  standard: "Standard validation",
  technical: "Technical compliance",
  guideline: "Company guideline verification",
}

export type GuidelineValidationMethod = "automated" | "manual" | "hybrid"

export type GuidelineComplianceResult = {
  ruleId: string
  layer: GuidelineValidationLayer
  expected?: string
  actual?: string
  method: GuidelineValidationMethod
  evidence?: GuidelineEvidenceRef
  status: GuidelineVerificationStatus
  error?: string
}

/** Everything a job knows about its guidelines. `null` everywhere means Scenario A: no guidelines. */
export type GuidelineJobContext = {
  service: GuidelineServiceRef
  profile: GuidelineProfile | null
  pinnedVersion: GuidelineVersionRef | null
  documents: readonly GuidelineDocument[]
  rules: readonly GuidelineRule[]
  conflicts: readonly GuidelineConflict[]
  exceptions: readonly GuidelineException[]
  results: readonly GuidelineComplianceResult[]
}

export type GuidelineScenario = "none" | "provided"

export function resolveGuidelineScenario(ctx: GuidelineJobContext | null | undefined): GuidelineScenario {
  if (!ctx) return "none"
  return ctx.profile || ctx.documents.some((d) => d.status !== "not-provided") ? "provided" : "none"
}

export type GuidelineComplianceVerdict =
  | "not-applicable"
  | "not-verified"
  | "review-required"
  | "non-compliant"
  | "compliant-with-exceptions"
  | "compliant"

export const GUIDELINE_VERDICT_META: Record<GuidelineComplianceVerdict, GuidelineStatusMeta> = {
  "not-applicable": { label: "Not Applicable", tone: "neutral", description: "No company guidelines supplied. Standard settings apply." },
  "not-verified": { label: "Not Verified", tone: "neutral", description: "Guideline requirements have not been verified against the output." },
  "review-required": { label: "Review Required", tone: "warning", description: "Some requirements need manual review, conflict resolution or an approved exception." },
  "non-compliant": { label: "Requirements Failed", tone: "danger", description: "At least one mandatory requirement failed verification." },
  "compliant-with-exceptions": { label: "Verified with Approved Exceptions", tone: "info", description: "All mandatory requirements passed or are covered by an approved exception." },
  compliant: { label: "Verified", tone: "success", description: "Every applicable mandatory requirement passed verification." },
}

export type GuidelineComplianceSummary = {
  verdict: GuidelineComplianceVerdict
  identified: number
  applied: number
  verified: number
  failed: number
  unsupported: number
  pendingReview: number
  exceptions: number
  unresolvedConflicts: number
}

/**
 * Summarizes recorded results; it is not a validation engine. An output is "compliant" only when every applicable
 * mandatory rule passed, or "compliant-with-exceptions" when the remainder is covered by approved exceptions.
 * The absence of errors is never treated as compliance.
 */
export function summarizeGuidelineCompliance(ctx: GuidelineJobContext | null | undefined): GuidelineComplianceSummary {
  const empty = { identified: 0, applied: 0, verified: 0, failed: 0, unsupported: 0, pendingReview: 0, exceptions: 0, unresolvedConflicts: 0 }
  if (resolveGuidelineScenario(ctx) === "none" || !ctx) return { verdict: "not-applicable", ...empty }

  const rules = ctx.rules
  const approved = new Set(ctx.exceptions.filter((e) => e.approval === "approved").map((e) => e.ruleId))
  const counts = {
    identified: rules.length,
    applied: rules.filter((r) => r.applicationStatus === "applied").length,
    verified: rules.filter((r) => r.verificationStatus === "passed").length,
    failed: rules.filter((r) => r.verificationStatus === "failed" || r.applicationStatus === "failed").length,
    unsupported: rules.filter((r) => r.ruleStatus === "unsupported" || r.verificationStatus === "unsupported").length,
    pendingReview: rules.filter((r) => r.ruleStatus === "pending-review" || r.verificationStatus === "review-required").length,
    exceptions: approved.size,
    unresolvedConflicts: ctx.conflicts.filter((c) => c.resolution === "unresolved").length,
  }

  const mandatory = rules.filter((r) => r.level === "mandatory" && r.applicability !== "not-applicable")
  if (mandatory.length === 0) return { verdict: "not-verified", ...counts }
  if (mandatory.some((r) => r.verificationStatus === "failed" && !approved.has(r.id))) return { verdict: "non-compliant", ...counts }
  if (counts.unresolvedConflicts > 0) return { verdict: "review-required", ...counts }

  const outstanding = mandatory.filter((r) => r.verificationStatus !== "passed" && !approved.has(r.id))
  if (outstanding.length === 0) {
    const usedException = mandatory.some((r) => r.verificationStatus !== "passed")
    return { verdict: usedException ? "compliant-with-exceptions" : "compliant", ...counts }
  }
  const needsReview = outstanding.some(
    (r) => r.applicability === "undetermined" || ["review-required", "unsupported"].includes(r.verificationStatus) || ["pending-review", "conflict", "unsupported"].includes(r.ruleStatus),
  )
  return { verdict: needsReview ? "review-required" : "not-verified", ...counts }
}

// ─── Optional-guidelines policy copy ────────────────────────────────────────

export const GUIDELINES_OPTIONAL_MESSAGE = "Company guidelines are optional. Standard conversion settings will be used."
export const GUIDELINES_OPTIONAL_SHORT_MESSAGE = "Company guidelines are optional. Standard settings will be used."
export const GUIDELINES_NOT_APPLICABLE_LABEL = "Company Guidelines: Not Applicable"
