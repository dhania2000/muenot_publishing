"use client"

/**
 * @file components/publishing/alt-text/document-history-outputs.tsx
 * @module Publishing · Alt Text
 * @kind Client component
 * @summary Phase 3 Task 19 — accessible output versions and their validation runs. Opening a stored
 *   report reads the persisted run (JSON) through the authorized download route; it never re-validates.
 */
import { useState } from "react"
import useSWR from "swr"
import { AlertTriangle, ArrowLeft, Download, Eye, FileJson, FileSpreadsheet, ShieldCheck } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { toApiError } from "@/lib/alt-text/client"
import { DOCX_EXPORT_POLICY_LABELS, type DocxExportPolicy } from "@/lib/alt-text/docx-export-contract"
import { outputDownloadUrl, validationRunDownloadUrl, type HistoryOutput, type HistoryValidationRun } from "@/lib/alt-text/document-history-contract"
import { OVERALL_LABEL, READINESS_LABEL, STATUS_LABEL, type CheckStatus, type ReleaseReadiness, type ValidationReport } from "@/lib/alt-text/output-validation-contract"
import { actorLabel, downloadWithToast, Fact, fmtBytes, fmtDateTime, GenericStatus, ValidationBadge } from "./document-history-labels"
import { Finding } from "./output-validation-panel"
import {DocumentExportProvenance} from "./document-export-provenance"

const ALL = "all"
const REPORT_PAGE = 20
const policyLabel = (p: string) => DOCX_EXPORT_POLICY_LABELS[p as DocxExportPolicy] ?? p.replace(/_/g, " ")
const versionLabel = (o: Pick<HistoryOutput, "version" | "outputId">) => (o.version ? `Version ${o.version}` : `Output ${o.outputId.slice(0, 8)}`)

export function DocumentHistoryOutputs({ documentId, outputs, onViewValidation }: { documentId: number; outputs: HistoryOutput[]; onViewValidation: (outputId: string) => void }) {
  const [detail, setDetail] = useState<HistoryOutput | null>(null)
  if (outputs.length === 0) return <p className="text-sm text-muted-foreground">No accessible output has been created for this document.</p>
  if (detail) return <OutputDetail documentId={documentId} output={detail} onBack={() => setDetail(null)} onViewValidation={onViewValidation} />

  return (
    <ul className="flex flex-col gap-2">
      {outputs.map((o) => (
        <li key={o.outputId} className="flex flex-col gap-2 rounded-md border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium text-foreground">{`${versionLabel(o)} · ${o.format.toUpperCase()}`}</span>
            <GenericStatus status={o.status} />
          </div>
          <p className="text-xs text-muted-foreground">{`${fmtDateTime(o.createdAt)} · ${actorLabel(o.createdByName, o.createdBy)} · ${fmtBytes(o.sizeBytes)}`}</p>
          <p className="text-xs text-muted-foreground tabular-nums">
            {[`${o.updated} updated`, o.skipped ? `${o.skipped} skipped` : null, o.unsupported ? `${o.unsupported} unsupported` : null, o.failed ? `${o.failed} failed` : null].filter(Boolean).join(" · ")}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <ValidationBadge status={o.latestValidation} />
            {o.validationRuns > 0 && <span className="text-xs text-muted-foreground">{`${o.validationRuns} run${o.validationRuns === 1 ? "" : "s"}`}</span>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setDetail(o)}>
              <Eye aria-hidden="true" /> Details
            </Button>
            <Button size="sm" variant="outline" disabled={o.validationRuns === 0} onClick={() => onViewValidation(o.outputId)}>
              <ShieldCheck aria-hidden="true" /> Validation
            </Button>
            <Button size="sm" variant="outline" disabled={!o.fileAvailable || o.status !== "completed"} onClick={() => void downloadWithToast(outputDownloadUrl(documentId, o.outputId), o.filename)}>
              <Download aria-hidden="true" /> Download
            </Button>
          </div>
          {o.status === "completed" && !o.fileAvailable && <p className="text-xs text-muted-foreground">The stored file is no longer available.</p>}
        </li>
      ))}
    </ul>
  )
}

function OutputDetail({ documentId, output: o, onBack, onViewValidation }: { documentId: number; output: HistoryOutput; onBack: () => void; onViewValidation: (id: string) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <Button size="sm" variant="ghost" className="self-start" onClick={onBack}>
        <ArrowLeft aria-hidden="true" /> All outputs
      </Button>
      <dl>
        <Fact label="Output">{`${versionLabel(o)} · ${o.format.toUpperCase()}`}</Fact>
        <Fact label="Output ID" mono>{o.outputId}</Fact>
        <Fact label="Filename">{o.filename}</Fact>
        <Fact label="Status"><GenericStatus status={o.status} /></Fact>
        <Fact label="Policy">{policyLabel(o.policy)}</Fact>
        <Fact label="Created">{`${fmtDateTime(o.createdAt)} · ${actorLabel(o.createdByName, o.createdBy)}`}</Fact>
        <Fact label="Completed">{fmtDateTime(o.completedAt)}</Fact>
        <Fact label="Size">{fmtBytes(o.sizeBytes)}</Fact>
        <Fact label="Images updated">{o.updated}</Fact>
        <Fact label="Skipped">{o.skipped}</Fact>
        <Fact label="Unsupported">{o.unsupported}</Fact>
        <Fact label="Failed">{o.failed}</Fact>
        {o.preserved != null && <Fact label="Existing alt text preserved">{o.preserved}</Fact>}
        {o.pictureCount != null && <Fact label="Pictures in file">{o.pictureCount}</Fact>}
        {o.errorCode && <Fact label="Error" mono>{o.errorCode}</Fact>}
        <Fact label="Latest validation"><ValidationBadge status={o.latestValidation} /></Fact>
        <Fact label="Stored file">{o.fileAvailable ? "Available" : "Not available"}</Fact>
      </dl>
      {o.status==="completed"&&<DocumentExportProvenance documentId={documentId} outputId={o.outputId}/>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={!o.fileAvailable || o.status !== "completed"} onClick={() => void downloadWithToast(outputDownloadUrl(documentId, o.outputId), o.filename)}>
          <Download aria-hidden="true" /> Download output
        </Button>
        <Button size="sm" variant="outline" disabled={o.validationRuns === 0} onClick={() => onViewValidation(o.outputId)}>
          <ShieldCheck aria-hidden="true" /> View validation
        </Button>
      </div>
    </div>
  )
}

export function DocumentHistoryValidations({
  documentId,
  outputs,
  runs,
  outputFilter,
  onOutputFilterChange,
}: {
  documentId: number
  outputs: HistoryOutput[]
  runs: HistoryValidationRun[]
  outputFilter: string | null
  onOutputFilterChange: (id: string | null) => void
}) {
  const [report, setReport] = useState<HistoryValidationRun | null>(null)
  const shown = outputFilter ? runs.filter((r) => r.outputId === outputFilter) : runs
  if (report) return <StoredReport documentId={documentId} run={report} onBack={() => setReport(null)} />

  return (
    <div className="flex flex-col gap-3">
      {outputs.length > 1 && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="history-validation-output">Output version</Label>
          <Select value={outputFilter ?? ALL} onValueChange={(v) => onOutputFilterChange(v === ALL ? null : v)}>
            <SelectTrigger id="history-validation-output" className="w-full sm:max-w-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All outputs</SelectItem>
              {outputs.map((o) => <SelectItem key={o.outputId} value={o.outputId}>{`${versionLabel(o)} · ${o.format.toUpperCase()}`}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{runs.length ? "No validation runs for this output." : "No output has been validated yet."}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((r) => {
            const done = r.status === "completed"
            return (
              <li key={r.runId} className="flex flex-col gap-1.5 rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">{r.outputVersion ? `Version ${r.outputVersion}` : `Output ${r.outputId.slice(0, 8)}`}</span>
                  {done ? <ValidationBadge status={r.overallStatus} /> : <GenericStatus status={r.status} />}
                </div>
                <p className="text-xs text-muted-foreground">{[fmtDateTime(r.createdAt), r.createdByName, `rules ${r.ruleVersion}`].filter(Boolean).join(" · ")}</p>
                {done && r.counts && (
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {[
                      r.passRate != null ? `${r.passRate}% passed` : "No automated checks ran",
                      `${r.counts.failed} failed`,
                      `${r.counts.warnings} warnings`,
                      r.counts.notVerified ? `${r.counts.notVerified} not verified` : null,
                      r.counts.manualReview ? `${r.counts.manualReview} manual review` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
                {done && r.readiness && <p className="text-xs text-foreground">{READINESS_LABEL[r.readiness as ReleaseReadiness] ?? r.readiness}</p>}
                {r.errorCode && <p className="font-mono text-xs text-destructive">{r.errorCode}</p>}
                {done && (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => setReport(r)}>
                      <Eye aria-hidden="true" /> View report
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void downloadWithToast(validationRunDownloadUrl(documentId, r.outputId, r.runId, "csv"), `validation-${r.runId.slice(0, 8)}.csv`)}>
                      <FileSpreadsheet aria-hidden="true" /> CSV
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void downloadWithToast(validationRunDownloadUrl(documentId, r.outputId, r.runId, "json"), `validation-${r.runId.slice(0, 8)}.json`)}>
                      <FileJson aria-hidden="true" /> JSON
                    </Button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <p className="text-xs text-muted-foreground text-pretty">
        Automated checks confirm what was written to the file. They are not a WCAG or PDF/UA certification; visual and contextual quality needs human review.
      </p>
    </div>
  )
}

async function reportFetcher(url: string): Promise<ValidationReport> {
  const res = await fetch(url, { credentials: "same-origin", cache: "no-store" })
  const body = await res.json().catch(() => null)
  if (!res.ok || !body || !Array.isArray((body as ValidationReport).checks)) throw new Error(toApiError(res.status, body).message)
  return body as ValidationReport
}

function StoredReport({ documentId, run, onBack }: { documentId: number; run: HistoryValidationRun; onBack: () => void }) {
  const { data, error, isLoading } = useSWR<ValidationReport>(validationRunDownloadUrl(documentId, run.outputId, run.runId, "json"), reportFetcher, { revalidateOnFocus: false })
  const [status, setStatus] = useState<CheckStatus | "">("")
  const [page, setPage] = useState(1)
  const checks = data ? (status ? data.checks.filter((c) => c.status === status) : data.checks) : []
  const pages = Math.max(1, Math.ceil(checks.length / REPORT_PAGE))
  const visible = checks.slice((page - 1) * REPORT_PAGE, page * REPORT_PAGE)

  return (
    <div className="flex flex-col gap-3">
      <Button size="sm" variant="ghost" className="self-start" onClick={onBack}>
        <ArrowLeft aria-hidden="true" /> All validation runs
      </Button>
      {isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : error || !data ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>Could not open this report</AlertTitle>
          <AlertDescription>{(error as Error | undefined)?.message ?? "Please try again."}</AlertDescription>
        </Alert>
      ) : (
        <>
          <div className="flex flex-col gap-0.5">
            <span className="text-base font-semibold text-foreground">{OVERALL_LABEL[data.summary.overallStatus]}</span>
            <span className="text-xs text-muted-foreground">{`${data.outputFilename} · validated ${fmtDateTime(data.validatedAt)} · rules ${data.ruleVersion}`}</span>
            <span className="text-xs text-foreground">{READINESS_LABEL[data.summary.readiness]}</span>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="stored-report-status">Status</Label>
            <Select
              value={status || ALL}
              onValueChange={(v) => {
                setStatus(v === ALL ? "" : (v as CheckStatus))
                setPage(1)
              }}
            >
              <SelectTrigger id="stored-report-status" className="w-full sm:w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{`All (${data.checks.length})`}</SelectItem>
                {(Object.keys(STATUS_LABEL) as CheckStatus[]).map((k) => {
                  const n = data.checks.filter((c) => c.status === k).length
                  return n ? <SelectItem key={k} value={k}>{`${STATUS_LABEL[k]} (${n})`}</SelectItem> : null
                })}
              </SelectContent>
            </Select>
          </div>
          {visible.length === 0 ? (
            <p className="text-sm text-muted-foreground">No findings match this filter.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {visible.map((c) => (
                <Finding key={c.id} check={c} acked={data.acknowledgements[c.id]} canAcknowledge={false} onAcknowledge={async () => false} />
              ))}
            </ul>
          )}
          {pages > 1 && (
            <nav aria-label="Report pages" className="flex items-center justify-between">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <span className="text-xs tabular-nums text-muted-foreground">{`Page ${page} of ${pages}`}</span>
              <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
            </nav>
          )}
        </>
      )}
    </div>
  )
}
