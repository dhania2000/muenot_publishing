"use client"

/**
 * @file components/publishing/conversion/pdf/pdf-processing-components.tsx
 * @module Publishing › Conversion › PDF
 * @kind React client component
 * @summary Processing feedback (status, progress, messages, log, follow-up actions) and Validation & QA UI
 *   (summary, severity, finding, checklist) built on the shared status model (Tasks 8.8, 8.9).
 * @exports PdfProcessingStatusIndicator, PdfProgressIndicator, PdfProcessingMessage, PdfProcessingLog,
 *   PdfActionFeedback, PdfValidationSummary, PdfSeverityIndicator, PdfValidationFindingItem, PdfValidationChecklist
 */
import Link from "next/link"
import { AlertTriangle, CheckCircle2, Eye, FileOutput, Info, RotateCcw, X, XCircle } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { PdfStatusFromMeta, PdfStatusIndicator } from "@/components/publishing/conversion/pdf/pdf-capability-status"
import {
  PDF_CHECK_CATEGORY_META,
  PDF_CHECK_STATUS_META,
  PDF_MESSAGE_TONE_META,
  PDF_PROCESSING_STATUS_META,
  PDF_SEVERITY_META,
  PDF_VALIDATION_STATUS_META,
  resolveCheckStatus,
  resolveProgress,
  type PdfCheckCategory,
  type PdfChecklistItem,
  type PdfFeedbackAction,
  type PdfLogEntry,
  type PdfMessageTone,
  type PdfProcessingStatus,
  type PdfSeverity,
  type PdfValidationFinding,
  type PdfValidationStatus,
} from "@/components/publishing/conversion/pdf/pdf-status-model"
import { cn } from "@/lib/utils"

// ─── Processing ─────────────────────────────────────────────────────────────

export function PdfProcessingStatusIndicator({ status, bordered }: { status: PdfProcessingStatus; bordered?: boolean }) {
  return <PdfStatusFromMeta meta={PDF_PROCESSING_STATUS_META[status]} bordered={bordered} />
}

/**
 * Renders a progress bar only while a job is queued or running. A percentage is shown only when the job
 * reported one; otherwise the bar is indeterminate and labelled as such.
 */
export function PdfProgressIndicator({
  status,
  percent,
  stage,
  label = "Processing progress",
}: {
  status: PdfProcessingStatus
  percent?: number | null
  /** Current stage name reported by the job, e.g. "Extracting text". */
  stage?: string
  label?: string
}) {
  const progress = resolveProgress({ status, percent })
  return (
    <div className="flex flex-col gap-1.5" data-progress-kind={progress.kind}>
      <div className="flex items-center justify-between gap-2">
        <PdfProcessingStatusIndicator status={status} />
        {progress.kind === "determinate" && (
          <span className="text-xs tabular-nums text-muted-foreground">{`${progress.value}%`}</span>
        )}
      </div>
      {progress.kind !== "none" && (
        <Progress
          aria-label={label}
          value={progress.kind === "determinate" ? progress.value : null}
          className={cn(progress.kind === "indeterminate" && "[&_[data-slot=progress-indicator]]:w-1/3 [&_[data-slot=progress-indicator]]:motion-safe:animate-pulse")}
        />
      )}
      {stage && <p className="text-xs text-muted-foreground">{stage}</p>}
    </div>
  )
}

const MESSAGE_ICON = { info: Info, warning: AlertTriangle, error: XCircle, success: CheckCircle2 } as const

export function PdfProcessingMessage({
  tone,
  title,
  description,
  actions,
}: {
  tone: PdfMessageTone
  title: string
  description?: string
  actions?: React.ReactNode
}) {
  const Icon = MESSAGE_ICON[tone]
  return (
    <Alert variant={tone === "error" ? "destructive" : "default"} role={tone === "error" ? "alert" : "status"} data-tone={tone}>
      <Icon aria-hidden="true" />
      <AlertTitle>
        <span className="sr-only">{PDF_MESSAGE_TONE_META[tone].label}: </span>
        {title}
      </AlertTitle>
      {(description || actions) && (
        <AlertDescription className="flex flex-col gap-2">
          {description && <span>{description}</span>}
          {actions}
        </AlertDescription>
      )}
    </Alert>
  )
}

export function PdfProcessingLog({
  entries,
  emptyLabel = "No processing events recorded.",
  caption = "Processing event log",
}: {
  entries: readonly PdfLogEntry[]
  emptyLabel?: string
  caption?: string
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] text-left text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead className="text-muted-foreground">
          <tr className="border-b">
            <th scope="col" className="py-1.5 pr-3 font-medium">Timestamp</th>
            <th scope="col" className="py-1.5 pr-3 font-medium">Severity</th>
            <th scope="col" className="py-1.5 pr-3 font-medium">Event</th>
            <th scope="col" className="py-1.5 font-medium">Description</th>
          </tr>
        </thead>
        <tbody>
          {entries.length === 0 ? (
            <tr>
              <td colSpan={4} className="py-4 text-center text-muted-foreground">
                {emptyLabel}
              </td>
            </tr>
          ) : (
            entries.map((entry) => (
              <tr key={entry.id} className="border-b align-top last:border-b-0">
                <td className="py-1.5 pr-3 whitespace-nowrap tabular-nums text-muted-foreground">
                  <time dateTime={entry.timestamp}>{new Date(entry.timestamp).toLocaleString()}</time>
                </td>
                <td className="py-1.5 pr-3">
                  <PdfStatusFromMeta meta={PDF_MESSAGE_TONE_META[entry.severity]} />
                </td>
                <td className="py-1.5 pr-3 font-medium text-foreground">{entry.event}</td>
                <td className="py-1.5 text-foreground">{entry.description}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

const ACTION_COPY = {
  retry: { label: "Retry", icon: RotateCcw },
  cancel: { label: "Cancel", icon: X },
  "view-error": { label: "View Error Details", icon: Eye },
  "view-output": { label: "View Output", icon: FileOutput },
} as const

/** Follow-up buttons. Actions without a handler or href are not rendered at all. */
export function PdfActionFeedback({ actions }: { actions: readonly PdfFeedbackAction[] }) {
  const wired = actions.filter((a) => a.onAction || a.href)
  if (wired.length === 0) return null
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Follow-up actions">
      {wired.map((action) => {
        const { label, icon: Icon } = ACTION_COPY[action.id]
        const variant = action.id === "view-output" ? "default" : "outline"
        return action.href ? (
          <Button key={action.id} asChild size="sm" variant={variant}>
            <Link href={action.href}>
              <Icon aria-hidden="true" />
              {label}
            </Link>
          </Button>
        ) : (
          <Button key={action.id} size="sm" variant={variant} onClick={action.onAction}>
            <Icon aria-hidden="true" />
            {label}
          </Button>
        )
      })}
    </div>
  )
}

// ─── Validation & QA ────────────────────────────────────────────────────────

export function PdfValidationSummary({
  status,
  counts,
}: {
  status: PdfValidationStatus
  /** Finding counts by severity; only shown when validation produced results. */
  counts?: Partial<Record<PdfSeverity, number>>
}) {
  const meta = PDF_VALIDATION_STATUS_META[status]
  const severities = (Object.keys(PDF_SEVERITY_META) as PdfSeverity[]).filter((s) => counts?.[s] !== undefined)
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3" data-validation-status={status}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-foreground">Validation</span>
        <PdfStatusFromMeta meta={meta} bordered />
      </div>
      {meta.description && <p className="text-xs text-muted-foreground">{meta.description}</p>}
      {severities.length > 0 && (
        <ul aria-label="Findings by severity" className="flex flex-wrap gap-3">
          {severities.map((s) => (
            <li key={s} className="flex items-center gap-1.5 text-xs">
              <PdfSeverityIndicator severity={s} />
              <span className="tabular-nums text-foreground">{counts![s]}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function PdfSeverityIndicator({ severity }: { severity: PdfSeverity }) {
  return <PdfStatusFromMeta meta={PDF_SEVERITY_META[severity]} />
}

export function PdfValidationFindingItem({ finding }: { finding: PdfValidationFinding }) {
  return (
    <li className="flex min-w-0 flex-col gap-1.5 py-2 first:pt-0 last:pb-0" data-severity={finding.severity}>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 text-sm font-medium text-foreground">{finding.title}</p>
        <div className="flex items-center gap-2">
          <PdfSeverityIndicator severity={finding.severity} />
          {finding.status !== "open" && (
            <PdfStatusIndicator label={finding.status === "resolved" ? "Resolved" : "Accepted"} tone="neutral" />
          )}
        </div>
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-muted-foreground">Category</dt>
        <dd>{PDF_CHECK_CATEGORY_META[finding.category].label}</dd>
        {finding.location && (
          <>
            <dt className="text-muted-foreground">Location</dt>
            <dd>{finding.location}</dd>
          </>
        )}
        {finding.expected && (
          <>
            <dt className="text-muted-foreground">Expected</dt>
            <dd className="break-words">{finding.expected}</dd>
          </>
        )}
        {finding.actual && (
          <>
            <dt className="text-muted-foreground">Actual</dt>
            <dd className="break-words">{finding.actual}</dd>
          </>
        )}
      </dl>
    </li>
  )
}

const CATEGORY_ORDER: PdfCheckCategory[] = ["standard", "guidelines", "format"]

/** Checklist grouped by category so standard, guideline and format checks are never mixed together. */
export function PdfValidationChecklist({ items, emptyLabel = "No checks have been run." }: { items: readonly PdfChecklistItem[]; emptyLabel?: string }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{emptyLabel}</p>
  return (
    <div className="flex flex-col gap-4">
      {CATEGORY_ORDER.map((category) => {
        const group = items.filter((i) => i.category === category)
        if (group.length === 0) return null
        return (
          <div key={category} className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-xs">
              <caption className="pb-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {PDF_CHECK_CATEGORY_META[category].label}s
              </caption>
              <thead className="text-muted-foreground">
                <tr className="border-b">
                  <th scope="col" className="py-1.5 pr-3 font-medium">Requirement</th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">Result</th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">Evidence</th>
                  <th scope="col" className="py-1.5 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody>
                {group.map((item) => {
                  const status = resolveCheckStatus(item)
                  return (
                    <tr key={item.id} className="border-b align-top last:border-b-0">
                      <td className="py-1.5 pr-3 text-foreground">{item.requirement}</td>
                      <td className="py-1.5 pr-3">
                        <PdfStatusFromMeta meta={PDF_CHECK_STATUS_META[status]} />
                      </td>
                      <td className="py-1.5 pr-3 text-muted-foreground">{item.evidence || "None recorded"}</td>
                      <td className="py-1.5 text-muted-foreground">{item.notes ?? ""}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}
