/**
 * @file components/publishing/alt-text/output-validation-panel.tsx
 * @module Publishing · Alt Text
 * @kind Client component
 * @summary Phase 3 Task 18 — quality validation dashboard for one accessible output: summary,
 *   release readiness, filterable/paginated findings, manual-review acknowledgement and report export.
 *   Automated results never claim WCAG or PDF/UA certification.
 */
"use client"

import { useDeferredValue, useState } from "react"
import useSWR from "swr"
import { toast } from "sonner"
import { AlertTriangle, ArrowLeft, Check, ChevronLeft, ChevronRight, FileJson, FileSpreadsheet, Loader2, RefreshCw, ShieldCheck } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { acknowledgeValidationCheck, altTextFetcher, runOutputValidationRequest } from "@/lib/alt-text/client"
import {
  CATEGORY_LABEL,
  describeLocation,
  OVERALL_LABEL,
  outputValidationQueryUrl,
  outputValidationReportUrl,
  READINESS_LABEL,
  SEVERITY_LABEL,
  STATUS_LABEL,
  type CheckStatus,
  type FindingsQuery,
  type OverallStatus,
  type ReleaseReadiness,
  type Severity,
  type ValidationCheck,
  type ValidationResponse,
} from "@/lib/alt-text/output-validation-contract"

const PAGE_SIZE = 20
const ALL = "all"

const STATUS_VARIANT: Record<CheckStatus, "default" | "secondary" | "destructive" | "outline"> = {
  passed: "secondary",
  failed: "destructive",
  warning: "outline",
  manual_review: "outline",
  not_verified: "outline",
  not_executed: "outline",
  not_applicable: "outline",
}
const OVERALL_TONE: Record<OverallStatus, string> = {
  passed: "text-emerald-700 dark:text-emerald-400",
  passed_with_warnings: "text-amber-700 dark:text-amber-400",
  failed: "text-destructive",
  not_verified: "text-muted-foreground",
  manual_review_required: "text-amber-700 dark:text-amber-400",
}
const READINESS_VARIANT: Record<ReleaseReadiness, "secondary" | "outline" | "destructive"> = { ready: "secondary", download_with_warnings: "outline", blocked: "destructive" }

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col rounded-md border px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-base font-semibold tabular-nums text-foreground">{value}</dd>
    </div>
  )
}

export function Finding({ check, acked, canAcknowledge, onAcknowledge }: { check: ValidationCheck; acked: { at: string; note: string | null } | undefined; canAcknowledge: boolean; onAcknowledge: (note: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState("")
  const [saving, setSaving] = useState(false)
  const loc = describeLocation(check.location)
  return (
    <li className="flex flex-col gap-1.5 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={STATUS_VARIANT[check.status]}>{STATUS_LABEL[check.status]}</Badge>
        <Badge variant="outline">{SEVERITY_LABEL[check.severity]}</Badge>
        <span className="text-xs text-muted-foreground">{CATEGORY_LABEL[check.category]}</span>
      </div>
      <p className="text-sm font-medium text-foreground">{check.title}</p>
      <p className="text-xs text-muted-foreground">
        {[loc, check.occurrenceId != null ? `Image #${check.occurrenceId}` : null, check.expectedVersionId != null ? `Approved version #${check.expectedVersionId}` : null].filter(Boolean).join(" · ") || "Whole document"}
      </p>
      <p className="text-sm text-foreground text-pretty">{check.actual}</p>
      {check.recommendation ? <p className="text-xs text-muted-foreground text-pretty">{check.recommendation}</p> : null}
      {check.status === "manual_review" ? (
        acked ? (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Check className="size-3.5" aria-hidden="true" />
            {`Acknowledged ${new Date(acked.at).toLocaleString()}${acked.note ? ` — ${acked.note}` : ""}`}
          </p>
        ) : canAcknowledge ? (
          open ? (
            <form
              className="flex flex-col gap-2"
              onSubmit={async (e) => {
                e.preventDefault()
                setSaving(true)
                const ok = await onAcknowledge(note)
                setSaving(false)
                if (ok) setOpen(false)
              }}
            >
              <Label htmlFor={`ack-${check.id}`} className="text-xs">
                Review note (optional)
              </Label>
              <Textarea id={`ack-${check.id}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} />
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={saving}>
                  {saving ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
                  Mark reviewed
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <Button size="sm" variant="outline" className="self-start" onClick={() => setOpen(true)}>
              Acknowledge review
            </Button>
          )
        ) : null
      ) : null}
    </li>
  )
}

export function OutputValidationPanel({ documentId, outputId, filename, onBack }: { documentId: number; outputId: string; filename: string; onBack: () => void }) {
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<CheckStatus | "">("")
  const [severity, setSeverity] = useState<Severity | "">("")
  const [search, setSearch] = useState("")
  const deferredSearch = useDeferredValue(search)
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)

  const query: FindingsQuery = { page, pageSize: PAGE_SIZE, status, severity, search: deferredSearch }
  const swr = useSWR<ValidationResponse>(outputValidationQueryUrl(documentId, outputId, query), altTextFetcher, { revalidateOnFocus: false, keepPreviousData: true })
  const data = swr.data
  const report = data?.report ?? null
  const s = report?.summary

  async function validate(force: boolean) {
    setRunning(true)
    setRunError(null)
    const r = await runOutputValidationRequest(documentId, outputId, query, force)
    setRunning(false)
    if (!r.ok) {
      setRunError(r.error.message)
      return
    }
    await swr.mutate(r.data, { revalidate: false })
    toast.success(r.data.replayed ? "Nothing changed since the last validation" : "Validation complete")
  }

  async function acknowledge(checkId: string, note: string) {
    if (!report) return false
    const r = await acknowledgeValidationCheck(documentId, outputId, query, { runId: report.runId, checkId, note: note.trim() || null })
    if (!r.ok) {
      toast.error(r.error.message)
      if (r.error.code === "STALE_RUN") void swr.mutate()
      return false
    }
    await swr.mutate(r.data, { revalidate: false })
    return true
  }

  const total = data?.findings.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const setFilter = <T,>(set: (v: T) => void) => (v: T) => {
    set(v)
    setPage(1)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={onBack}>
          <ArrowLeft aria-hidden="true" />
          Back
        </Button>
        <h3 className="min-w-0 truncate text-sm font-semibold text-foreground">Quality check · {filename}</h3>
      </div>

      {swr.isLoading ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : swr.error ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>Could not load the validation report</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            Please try again.
            <Button size="sm" variant="outline" onClick={() => swr.mutate()}>
              <RefreshCw aria-hidden="true" />
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <>
          {runError ? (
            <Alert variant="destructive" role="alert">
              <AlertTriangle aria-hidden="true" />
              <AlertTitle>Validation did not run</AlertTitle>
              <AlertDescription>{runError}</AlertDescription>
            </Alert>
          ) : null}
          {data?.latestRun?.status === "failed" && !runError ? (
            <Alert>
              <AlertTriangle aria-hidden="true" />
              <AlertTitle>The last validation attempt failed</AlertTitle>
              <AlertDescription>{report ? "The report below is from the previous successful run." : "Run the validation again."}</AlertDescription>
            </Alert>
          ) : null}

          {!report || !s ? (
            <div className="flex flex-col items-start gap-3 rounded-md border border-dashed p-4">
              <p className="text-sm text-muted-foreground text-pretty">
                Check this output against the original and the approved descriptions: file integrity, exact alt text, unapproved changes and document structure.
              </p>
              <Button onClick={() => validate(false)} disabled={running}>
                {running ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
                {running ? "Validating…" : "Run quality check"}
              </Button>
            </div>
          ) : (
            <>
              <section aria-labelledby="validation-summary" className="flex flex-col gap-3">
                <h4 id="validation-summary" className="sr-only">
                  Summary
                </h4>
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div className="flex flex-col">
                    <span className={`text-lg font-semibold ${OVERALL_TONE[s.overallStatus]}`}>{OVERALL_LABEL[s.overallStatus]}</span>
                    <span className="text-xs text-muted-foreground">
                      {`Validated ${new Date(report.validatedAt).toLocaleString()} · rules ${report.ruleVersion}`}
                    </span>
                  </div>
                  <Badge variant={READINESS_VARIANT[s.readiness]}>{READINESS_LABEL[s.readiness]}</Badge>
                </div>
                <p className="text-sm text-foreground">
                  {s.passRate == null ? "No automated checks could run." : `${s.passRate}% of ${s.passRateDenominator} automated checks passed`}
                  {s.criticalFailures ? <span className="text-destructive">{` · ${s.criticalFailures} critical`}</span> : null}
                </p>
                <dl className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                  <Count label="Passed" value={s.counts.passed} />
                  <Count label="Failed" value={s.counts.failed} />
                  <Count label="Warnings" value={s.counts.warnings} />
                  <Count label="Not verified" value={s.counts.notVerified} />
                  <Count label="Manual" value={s.openManualReview} />
                  <Count label="N/A" value={s.counts.notApplicable + s.counts.notExecuted} />
                </dl>
                <p className="text-xs text-muted-foreground text-pretty">
                  Automated checks confirm what was written to the file. They are not a WCAG or PDF/UA certification; visual and contextual quality needs human review.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => validate(true)} disabled={running}>
                    {running ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
                    Re-validate
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <a href={outputValidationReportUrl(documentId, outputId, "csv")} download>
                      <FileSpreadsheet aria-hidden="true" />
                      CSV
                    </a>
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <a href={outputValidationReportUrl(documentId, outputId, "json")} download>
                      <FileJson aria-hidden="true" />
                      JSON
                    </a>
                  </Button>
                </div>
              </section>

              <section aria-labelledby="validation-findings" className="flex flex-col gap-3">
                <h4 id="validation-findings" className="text-sm font-semibold text-foreground">
                  Findings
                </h4>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Select value={status || ALL} onValueChange={(v) => setFilter(setStatus)(v === ALL ? "" : (v as CheckStatus))}>
                    <SelectTrigger className="sm:w-40" aria-label="Filter by status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>All statuses</SelectItem>
                      {(Object.keys(STATUS_LABEL) as CheckStatus[]).map((k) => (
                        <SelectItem key={k} value={k}>
                          {STATUS_LABEL[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={severity || ALL} onValueChange={(v) => setFilter(setSeverity)(v === ALL ? "" : (v as Severity))}>
                    <SelectTrigger className="sm:w-36" aria-label="Filter by severity">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>All severities</SelectItem>
                      {(Object.keys(SEVERITY_LABEL) as Severity[]).map((k) => (
                        <SelectItem key={k} value={k}>
                          {SEVERITY_LABEL[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="search"
                    placeholder="Search rule, title or #image"
                    aria-label="Search findings"
                    value={search}
                    maxLength={100}
                    onChange={(e) => setFilter(setSearch)(e.target.value)}
                  />
                </div>
                {data && data.findings.items.length ? (
                  <ul className="flex flex-col gap-2" aria-live="polite">
                    {data.findings.items.map((c) => (
                      <Finding key={c.id} check={c} acked={report.acknowledgements[c.id]} canAcknowledge={Boolean(data.canAcknowledge)} onAcknowledge={(note) => acknowledge(c.id, note)} />
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">No findings match these filters.</p>
                )}
                {total > PAGE_SIZE ? (
                  <nav aria-label="Findings pages" className="flex items-center justify-between">
                    <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                      <ChevronLeft aria-hidden="true" />
                      Previous
                    </Button>
                    <span className="text-xs text-muted-foreground tabular-nums">{`Page ${page} of ${pages} · ${total} findings`}</span>
                    <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                      Next
                      <ChevronRight aria-hidden="true" />
                    </Button>
                  </nav>
                ) : null}
              </section>
            </>
          )}
        </>
      )}
    </div>
  )
}
