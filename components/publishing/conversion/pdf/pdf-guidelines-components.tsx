/**
 * @file components/publishing/conversion/pdf/pdf-guidelines-components.tsx
 * @module Publishing › Conversion › PDF
 * @kind React server component
 * @summary Optional client-guideline UI built on the shared contracts in lib/guidelines (Tasks 8.6 and 9.6).
 * @exports PdfOptionalGuidelinesNotice, PdfGuidelinesStatus, PdfGuidelinesProfileCard, PdfGuidelineRuleItem,
 *   PdfGuidelineRuleMappingSummary, PdfGuidelineConflictIndicator, PdfGuidelinesConflictPanel,
 *   PdfGuidelinesComplianceSummary
 *
 * Guidelines are optional. "Not provided" is neutral, never an error. Upload, rule, application and
 * verification statuses are shown separately, and nothing reads as compliant without evidenced results.
 * The profile selector is the shared `PdfProfileSelector` in pdf-settings-components.tsx.
 */
import { BookOpenCheck } from "lucide-react"
import { PdfStatusFromMeta, PdfStatusIndicator } from "@/components/publishing/conversion/pdf/pdf-capability-status"
import { PdfInfoCard } from "@/components/publishing/conversion/pdf/pdf-content"
import { findGuidelineCategory } from "@/components/publishing/conversion/pdf/pdf-guideline-categories"
import {
  PDF_VALIDATION_STATUS_META,
  type PdfValidationStatus,
} from "@/components/publishing/conversion/pdf/pdf-status-model"
import {
  deriveGuidelineState,
  PDF_GUIDELINE_PRIORITY,
  PDF_GUIDELINE_STATES,
  resolveSettingsProfile,
  type PdfGuidelineState,
} from "@/components/publishing/conversion/pdf/pdf-workspace-config"
import {
  assessGuidelineCompliance,
  GUIDELINE_APPLICATION_STATUS_META,
  GUIDELINE_COMPLIANCE_VERDICT_META,
  GUIDELINE_DOCUMENT_STATUS_META,
  GUIDELINE_NON_OVERRIDABLE,
  GUIDELINE_RULE_STATUS_META,
  GUIDELINE_VERIFICATION_LAYERS,
  GUIDELINE_VERIFICATION_STATUS_META,
  hasGuidelines,
  isVerifiedPass,
  type GuidelineComplianceResult,
  type GuidelineConflict,
  type GuidelineContext,
  type GuidelineException,
  type GuidelineMappingKind,
  type GuidelineProfile,
  type GuidelineRule,
  type GuidelineRuleMapping,
} from "@/lib/guidelines/guideline-contracts"
import { cn } from "@/lib/utils"

export const OPTIONAL_GUIDELINES_MESSAGE = {
  workspace: "Company guidelines are optional. Standard settings will be used.",
  overview: "Company guidelines are optional. Standard conversion settings will be used.",
} as const

function FactList({ rows, className }: { rows: [string, React.ReactNode | undefined][]; className?: string }) {
  const visible = rows.filter(([, v]) => v !== undefined && v !== null && v !== "")
  if (visible.length === 0) return null
  return (
    <dl className={cn("grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs", className)}>
      {visible.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="text-muted-foreground">{term}</dt>
          <dd className="min-w-0 truncate text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Neutral note for Scenario A. Never styled as a warning. */
export function PdfOptionalGuidelinesNotice({ variant = "workspace", className }: { variant?: keyof typeof OPTIONAL_GUIDELINES_MESSAGE; className?: string }) {
  return (
    <p className={cn("rounded-md bg-muted/50 px-2.5 py-2 text-xs leading-relaxed text-foreground", className)} data-guideline-notice="optional">
      {OPTIONAL_GUIDELINES_MESSAGE[variant]}
    </p>
  )
}

/**
 * Compact guideline summary for the active job. Pass `context` when a real guideline source exists; without it
 * the Standard Profile applies and the summary shows Scenario A.
 */
export function PdfGuidelinesStatus({
  context = null,
  state,
  showPriority = true,
}: {
  context?: GuidelineContext | null
  /** Overrides the derived state; normally omitted. */
  state?: PdfGuidelineState
  showPriority?: boolean
}) {
  const provided = hasGuidelines(context)
  const resolvedState = state ?? deriveGuidelineState(context)
  const meta = PDF_GUIDELINE_STATES[resolvedState]
  const profile = provided ? context.profile : null
  const settingsProfile = resolveSettingsProfile(resolvedState, profile?.name)
  const { counts } = assessGuidelineCompliance(context)

  return (
    <div className="flex flex-col gap-3" data-guideline-state={resolvedState}>
      {provided ? (
        <p className="rounded-md bg-muted/50 px-2.5 py-2 text-xs leading-relaxed text-foreground">{meta.description}</p>
      ) : (
        <PdfOptionalGuidelinesNotice />
      )}
      <FactList
        rows={[
          ["Status", <PdfStatusIndicator key="s" label={meta.label} tone={meta.tone} />],
          ["Profile", settingsProfile.label],
          ...(provided
            ? ([
                ["Company", profile?.companyLabel],
                ["Version", profile?.version?.versionId ?? context.versionRef?.versionId ?? "Not recorded"],
                ["Formats", profile?.applicableFormats?.join(", ")],
                ["Review", profile ? GUIDELINE_DOCUMENT_STATUS_META[profile.reviewStatus].label : undefined],
                ["Documents", `${context.documents.length} attached`],
                ["Rules", counts ? `${counts.identified} identified, ${counts.verified} verified` : "Not yet identified"],
                ["Conflicts", counts && counts.unresolvedConflicts > 0 ? `${counts.unresolvedConflicts} unresolved` : undefined],
              ] as [string, React.ReactNode | undefined][])
            : ([["Rules", "None (standard settings)"]] as [string, React.ReactNode][])),
        ]}
      />
      {showPriority && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Rule priority</span>
          <ol className="flex list-decimal flex-col gap-0.5 pl-4 text-xs text-foreground">
            {PDF_GUIDELINE_PRIORITY.map((rule) => (
              <li key={rule.id}>{rule.label}</li>
            ))}
          </ol>
          <p className="text-xs text-muted-foreground">
            {GUIDELINE_NON_OVERRIDABLE.map((c) => c.label).join(" and ")} always apply. Conflicts are flagged for review.
          </p>
        </div>
      )}
    </div>
  )
}

export function PdfGuidelinesProfileCard({ profile, action }: { profile: GuidelineProfile; action?: React.ReactNode }) {
  return (
    <PdfInfoCard
      icon={BookOpenCheck}
      title={profile.name}
      status={<PdfStatusFromMeta meta={GUIDELINE_DOCUMENT_STATUS_META[profile.reviewStatus]} />}
      meta={[
        ...(profile.companyLabel ? [{ label: "Company", value: profile.companyLabel }] : []),
        // Reused profiles always show their version; a missing version is stated, not invented.
        { label: "Version", value: profile.version?.versionId ?? "Not recorded" },
        ...(profile.version?.effectiveDate ? [{ label: "Effective", value: new Date(profile.version.effectiveDate).toLocaleDateString() }] : []),
        ...(profile.version?.supersedesVersionId ? [{ label: "Supersedes", value: profile.version.supersedesVersionId }] : []),
        ...(profile.applicableFormats?.length ? [{ label: "Formats", value: profile.applicableFormats.join(", ") }] : []),
        ...(profile.updatedAt ? [{ label: "Updated", value: new Date(profile.updatedAt).toLocaleDateString() }] : []),
      ]}
      action={action}
    />
  )
}

/** Guideline requirement row. Rule, application and verification statuses are separate indicators. */
export function PdfGuidelineRuleItem({
  rule,
  mapping,
  result,
}: {
  rule: GuidelineRule
  mapping?: GuidelineRuleMapping
  result?: GuidelineComplianceResult
}) {
  const category = findGuidelineCategory(rule.categoryId)
  const verification = result ? (result.status === "passed" && !isVerifiedPass(result) ? "review-required" : result.status) : rule.verificationStatus
  return (
    <li className="flex min-w-0 flex-col gap-1.5 py-2 first:pt-0 last:pb-0" data-rule-status={rule.status}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="min-w-0 text-sm text-foreground">{rule.requirement}</p>
        <p className="text-xs text-muted-foreground">
          {category ? `${category.group.label} · ${category.item.label}` : "Uncategorized"} · {rule.level}
        </p>
      </div>
      <ul className="flex flex-wrap gap-1.5" aria-label="Requirement status">
        <li>
          <PdfStatusIndicator bordered label={`Rule: ${GUIDELINE_RULE_STATUS_META[rule.status].label}`} tone={GUIDELINE_RULE_STATUS_META[rule.status].tone} />
        </li>
        <li>
          <PdfStatusIndicator
            bordered
            label={GUIDELINE_APPLICATION_STATUS_META[mapping?.applicationStatus ?? "not-applied"].label}
            tone={GUIDELINE_APPLICATION_STATUS_META[mapping?.applicationStatus ?? "not-applied"].tone}
          />
        </li>
        <li>
          <PdfStatusIndicator
            bordered
            label={`Verification: ${GUIDELINE_VERIFICATION_STATUS_META[verification].label}`}
            tone={GUIDELINE_VERIFICATION_STATUS_META[verification].tone}
          />
        </li>
      </ul>
      <FactList
        className="gap-y-0.5"
        rows={[
          ["Source", rule.sourceLocation],
          ["Setting", rule.targetSettingKey],
          ["Expected", rule.expectedValue],
          ["Configured", mapping?.configuredValue],
          ["Actual", result?.actual],
          ["Evidence", result?.evidenceRef ?? rule.evidenceRef],
        ]}
      />
    </li>
  )
}

const MAPPING_KIND_LABEL: Record<GuidelineMappingKind, string> = {
  mapped: "Mapped to settings",
  "manual-review": "Manual review",
  unsupported: "Unsupported",
  "not-applicable": "Not applicable to format",
  conflict: "Conflicting",
}

export function PdfGuidelineRuleMappingSummary({ mappings }: { mappings: readonly GuidelineRuleMapping[] }) {
  if (mappings.length === 0) return <p className="text-xs text-muted-foreground">No rules are mapped to settings yet.</p>
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {(Object.keys(MAPPING_KIND_LABEL) as GuidelineMappingKind[]).map((kind) => (
        <div key={kind} className="flex flex-col gap-0.5 rounded-md border px-3 py-2">
          <dt className="text-xs text-muted-foreground">{MAPPING_KIND_LABEL[kind]}</dt>
          <dd className="text-base font-semibold tabular-nums text-foreground">{mappings.filter((m) => m.kind === kind).length}</dd>
        </div>
      ))}
    </dl>
  )
}

export function PdfGuidelineConflictIndicator({ conflict, rules = [] }: { conflict: GuidelineConflict; rules?: readonly GuidelineRule[] }) {
  const open = conflict.resolution === "open"
  const involved = rules.filter((r) => conflict.ruleIds.includes(r.id))
  return (
    <div role="note" data-resolution={conflict.resolution} className={cn("flex flex-col gap-1.5 rounded-md border p-3", open && "border-foreground/30 bg-muted/40")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-foreground">{conflict.affectedSettingKey}</p>
        <PdfStatusIndicator
          label={open ? "Review required" : conflict.resolution === "resolved" ? "Resolved" : "Exception approved"}
          tone={open ? (conflict.severity === "critical" ? "danger" : "warning") : "neutral"}
        />
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{conflict.description}</p>
      {involved.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-xs" aria-label="Conflicting requirements">
          {involved.map((r) => (
            <li key={r.id} className="truncate">
              <span className="text-foreground">{r.expectedValue ?? r.requirement}</span>
              <span className="text-muted-foreground">
                {" "}
                · {PDF_GUIDELINE_PRIORITY.find((p) => p.id === r.priority)?.label}
                {r.sourceLocation ? ` · ${r.sourceLocation}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
      {conflict.reviewerNotes && <p className="text-xs text-muted-foreground">Reviewer: {conflict.reviewerNotes}</p>}
    </div>
  )
}

export function PdfGuidelinesConflictPanel({
  conflicts = [],
  exceptions = [],
  rules = [],
}: {
  conflicts?: readonly GuidelineConflict[]
  exceptions?: readonly GuidelineException[]
  rules?: readonly GuidelineRule[]
}) {
  if (conflicts.length === 0 && exceptions.length === 0) {
    return <p className="text-xs text-muted-foreground">No conflicts or exceptions recorded.</p>
  }
  return (
    <div className="flex flex-col gap-2">
      {conflicts.map((c) => (
        <PdfGuidelineConflictIndicator key={c.id} conflict={c} rules={rules} />
      ))}
      {exceptions.map((e) => (
        <div key={e.id} role="note" className="flex flex-col gap-1 rounded-md border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium capitalize text-foreground">{e.kind} requirement</p>
            <PdfStatusIndicator
              label={e.approval.status === "approved" ? "Exception approved" : e.approval.status === "rejected" ? "Exception rejected" : "Review required"}
              tone={e.approval.status === "approved" ? "neutral" : "warning"}
            />
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">{e.explanation}</p>
          {e.suggestedAction && <p className="text-xs text-foreground">Suggested: {e.suggestedAction}</p>}
        </div>
      ))}
    </div>
  )
}

/**
 * Verification summary across the three layers. Company guidelines show "Not Applicable" when none were
 * supplied, never "Failed" or "Missing". Counts appear only when rules exist.
 */
export function PdfGuidelinesComplianceSummary({
  context = null,
  standard = "not-run",
  technical = "not-run",
}: {
  context?: GuidelineContext | null
  standard?: PdfValidationStatus
  technical?: PdfValidationStatus
}) {
  const { verdict, counts } = assessGuidelineCompliance(context)
  const layers = [
    { id: "standard", meta: PDF_VALIDATION_STATUS_META[standard] },
    { id: "technical", meta: PDF_VALIDATION_STATUS_META[technical] },
    { id: "guidelines", meta: GUIDELINE_COMPLIANCE_VERDICT_META[verdict] },
  ] as const
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col divide-y rounded-md border" aria-label="Verification layers">
        {layers.map(({ id, meta }) => (
          <li key={id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <div className="flex min-w-0 flex-col">
              <span className="text-sm text-foreground">{GUIDELINE_VERIFICATION_LAYERS[id].label}</span>
              <span className="text-xs text-muted-foreground">{GUIDELINE_VERIFICATION_LAYERS[id].description}</span>
            </div>
            <PdfStatusFromMeta meta={meta} />
          </li>
        ))}
      </ul>
      {counts && (
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {(
            [
              ["Requirements identified", counts.identified],
              ["Applied", counts.applied],
              ["Verified", counts.verified],
              ["Failed", counts.failed],
              ["Unsupported", counts.unsupported],
              ["Pending review", counts.pendingReview],
              ["Unresolved conflicts", counts.unresolvedConflicts],
              ["Approved exceptions", counts.approvedExceptions],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="flex flex-col gap-0.5 rounded-md border px-3 py-2">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="text-base font-semibold tabular-nums text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}
