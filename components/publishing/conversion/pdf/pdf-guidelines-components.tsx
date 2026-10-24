/**
 * @file components/publishing/conversion/pdf/pdf-guidelines-components.tsx
 * @module Publishing › Conversion › PDF
 * @kind React server component
 * @summary Optional client-guideline UI: status block, guideline profile card, rule item, conflict indicator and
 *   compliance summary (Task 8.6).
 * @exports PdfGuidelinesStatus, PdfGuidelinesProfileCard, PdfGuidelineRuleItem, PdfGuidelineConflictIndicator,
 *   PdfGuidelinesComplianceSummary
 *
 * Guidelines are optional. "Not provided" is neutral, never an error. Nothing reads as compliant or verified
 * unless the rule records say so.
 */
import { BookOpenCheck } from "lucide-react"
import { PdfStatusFromMeta, PdfStatusIndicator } from "@/components/publishing/conversion/pdf/pdf-capability-status"
import { PdfInfoCard } from "@/components/publishing/conversion/pdf/pdf-content"
import {
  PDF_GUIDELINE_RULE_STATUS_META,
  type PdfGuidelineCompliance,
  type PdfGuidelineConflict,
  type PdfGuidelineProfile,
  type PdfGuidelineRule,
} from "@/components/publishing/conversion/pdf/pdf-status-model"
import {
  PDF_GUIDELINE_PRIORITY,
  PDF_GUIDELINE_STATES,
  resolveSettingsProfile,
  type PdfGuidelineState,
} from "@/components/publishing/conversion/pdf/pdf-workspace-config"
import { cn } from "@/lib/utils"

/** Status note + key facts + rule priority for the active job. */
export function PdfGuidelinesStatus({
  state,
  companyProfile,
  ruleCount,
  showPriority = true,
}: {
  state: PdfGuidelineState
  companyProfile?: string
  /** Number of mapped rules, only when known. */
  ruleCount?: number
  showPriority?: boolean
}) {
  const meta = PDF_GUIDELINE_STATES[state]
  const profile = resolveSettingsProfile(state)
  return (
    <div className="flex flex-col gap-3" data-guideline-state={state}>
      <p className="rounded-md bg-muted/50 px-2.5 py-2 text-xs leading-relaxed text-foreground">{meta.description}</p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Guideline status</dt>
        <dd>
          <PdfStatusIndicator label={meta.label} tone={meta.tone} />
        </dd>
        <dt className="text-muted-foreground">Profile in effect</dt>
        <dd className="text-foreground">{profile.label}</dd>
        <dt className="text-muted-foreground">Company profile</dt>
        <dd className="truncate text-foreground">{companyProfile ?? "None selected"}</dd>
        <dt className="text-muted-foreground">Applicable rules</dt>
        <dd className="text-foreground">
          {ruleCount === undefined || state === "not-provided" ? "None (standard settings)" : `${ruleCount} mapped`}
        </dd>
      </dl>
      {showPriority && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Rule priority</span>
          <ol className="flex list-decimal flex-col gap-0.5 pl-4 text-xs text-foreground">
            {PDF_GUIDELINE_PRIORITY.map((rule) => (
              <li key={rule.id}>{rule.label}</li>
            ))}
          </ol>
          <p className="text-xs text-muted-foreground">Safety and mandatory technical requirements always apply. Conflicts are flagged for review.</p>
        </div>
      )}
    </div>
  )
}

export function PdfGuidelinesProfileCard({ profile, action }: { profile: PdfGuidelineProfile; action?: React.ReactNode }) {
  const meta = PDF_GUIDELINE_STATES[profile.status]
  return (
    <PdfInfoCard
      icon={BookOpenCheck}
      title={profile.name}
      status={<PdfStatusIndicator label={meta.label} tone={meta.tone} />}
      meta={[
        { label: "Company", value: profile.companyLabel },
        ...(profile.version ? [{ label: "Version", value: profile.version }] : []),
        ...(profile.applicableFormat ? [{ label: "Format", value: profile.applicableFormat }] : []),
        ...(profile.updatedAt ? [{ label: "Updated", value: new Date(profile.updatedAt).toLocaleDateString() }] : []),
      ]}
      action={action}
    />
  )
}

export function PdfGuidelineRuleItem({ rule }: { rule: PdfGuidelineRule }) {
  const rows: [string, string | undefined][] = [
    ["Source", rule.sourceReference],
    ["Expected", rule.expectedSetting],
    ["Applied", rule.appliedSetting],
  ]
  return (
    <li className="flex min-w-0 flex-col gap-1.5 py-2 first:pt-0 last:pb-0" data-rule-status={rule.status}>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 text-sm text-foreground">{rule.requirement}</p>
        <PdfStatusFromMeta meta={PDF_GUIDELINE_RULE_STATUS_META[rule.status]} bordered />
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
        {rows
          .filter(([, v]) => v)
          .map(([term, value]) => (
            <div key={term} className="contents">
              <dt className="text-muted-foreground">{term}</dt>
              <dd className="truncate text-foreground">{value}</dd>
            </div>
          ))}
      </dl>
    </li>
  )
}

export function PdfGuidelineConflictIndicator({ conflict }: { conflict: PdfGuidelineConflict }) {
  return (
    <div
      role="note"
      data-resolved={conflict.resolved || undefined}
      className={cn("flex flex-col gap-1.5 rounded-md border p-3", !conflict.resolved && "border-foreground/30 bg-muted/40")}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-foreground">{conflict.requirement}</p>
        <PdfStatusIndicator label={conflict.resolved ? "Resolved" : "Review required"} tone={conflict.resolved ? "neutral" : "warning"} />
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{conflict.explanation}</p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-muted-foreground">Guideline</dt>
        <dd className="truncate">{conflict.sourceGuideline}</dd>
        <dt className="text-muted-foreground">Affected setting</dt>
        <dd className="truncate">{conflict.affectedSetting}</dd>
      </dl>
    </div>
  )
}

/**
 * Counts come from `summarizeGuidelineCompliance`. With no rules (null) the summary says so plainly instead
 * of showing zeros that could be read as a result.
 */
export function PdfGuidelinesComplianceSummary({ compliance }: { compliance: PdfGuidelineCompliance | null }) {
  if (!compliance) {
    return <p className="text-xs text-muted-foreground">No guideline rules recorded. Standard settings apply.</p>
  }
  const rows: [string, number][] = [
    ["Requirements identified", compliance.identified],
    ["Applied", compliance.applied],
    ["Verified", compliance.verified],
    ["Failed", compliance.failed],
    ["Unsupported", compliance.unsupported],
    ["Unresolved conflicts", compliance.unresolvedConflicts],
  ]
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {rows.map(([label, value]) => (
        <div key={label} className="flex flex-col gap-0.5 rounded-md border px-3 py-2">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="text-base font-semibold tabular-nums text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  )
}
