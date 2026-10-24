"use client"

/**
 * @file components/publishing/alt-text/accessible-document-sheet.tsx
 * @module Publishing · Alt Text
 * @kind Client component
 * @summary Phase 3 — "Download Accessible Document" for DOCX, PPTX and tagged PDF. Shows the preflight
 *   (readiness totals + dry-run plan), lets the user choose a policy, runs the idempotent export
 *   and offers the download plus a per-image report. The original document is never changed.
 */
import { useRef, useState } from "react"
import useSWR from "swr"
import { toast } from "sonner"
import { AlertTriangle, Download, FileCheck2, Loader2, RefreshCw, ShieldCheck } from "lucide-react"
import { OutputValidationPanel } from "./output-validation-panel"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { altTextFetcher, docxExportPreflightUrl, exportAccessibleDocx, newIdempotencyKey } from "@/lib/alt-text/client"
import {
  DOCX_EXPORT_POLICIES,
  DOCX_EXPORT_POLICY_LABELS,
  PDF_TAGGING_LABELS,
  type AccessibleExportFormat,
  type PdfRemediationDetails,
  type DocxExportItem,
  type DocxExportPolicy,
  type DocxExportPreflight,
  type DocxExportResponse,
} from "@/lib/alt-text/docx-export-contract"

const POLICY_HINTS: Record<DocxExportPolicy, string> = {
  strict: "No document is produced unless every mapped image has an approved description that can be inserted.",
  approved_only: "Approved descriptions are inserted; everything else is listed in the report.",
}

const STATUS_LABEL: Record<DocxExportItem["status"], string> = {
  updated: "Updated",
  unchanged: "Already current",
  skipped: "Skipped",
  unsupported: "Unsupported",
  failed: "Failed",
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums text-foreground">{value}</dd>
    </div>
  )
}

function ItemList({ items }: { items: DocxExportItem[] }) {
  const notable = items.filter((i) => i.status !== "updated" && i.status !== "unchanged")
  if (notable.length === 0) return <p className="text-sm text-muted-foreground">Every eligible image can receive its approved description.</p>
  return (
    <ul className="flex flex-col gap-2" aria-label="Images that will not be updated">
      {notable.slice(0, 50).map((i) => (
        <li key={i.occurrenceId} className="flex flex-col gap-1 rounded-md border px-3 py-2 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-foreground">
              {i.slideNumber != null ? `Slide ${i.slideNumber} · ` : i.pageNumber != null ? `Page ${i.pageNumber} · ` : ""}
              {`Image #${i.occurrenceId}`}
            </span>
            <Badge variant={i.status === "failed" ? "destructive" : "secondary"}>{STATUS_LABEL[i.status]}</Badge>
          </div>
          <p className="text-muted-foreground">{i.message}</p>
        </li>
      ))}
      {notable.length > 50 ? <li className="text-xs text-muted-foreground">{`and ${notable.length - 50} more…`}</li> : null}
    </ul>
  )
}

const FORMAT_LABEL: Record<AccessibleExportFormat, string> = { docx: "DOCX", pptx: "PPTX", pdf: "PDF" }

function PdfAssessment({ details }: { details: PdfRemediationDetails }) {
  const tagged = details.taggingStatus === "tagged"
  return (
    <section aria-labelledby="pdf-assessment" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 id="pdf-assessment" className="text-sm font-semibold text-foreground">
          PDF structure
        </h3>
        <Badge variant={tagged ? "secondary" : "destructive"}>{PDF_TAGGING_LABELS[details.taggingStatus]}</Badge>
      </div>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Pages" value={details.totalPages} />
        <Stat label="Mapped figures" value={details.mappedFigures} />
        <Stat label="Ambiguous" value={details.ambiguousOccurrences} />
        <Stat label="Manual fixes" value={details.manualRemediationRequired} />
      </dl>
      {details.scannedPagesWithoutText > 0 ? (
        <p className="text-xs text-muted-foreground">{`${details.scannedPagesWithoutText} scanned page${details.scannedPagesWithoutText === 1 ? "" : "s"} without a text layer need OCR before they are accessible.`}</p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Alt text is written only to existing Figure tags. Reading order is preserved, not assessed. PDF/UA and WCAG conformance are not verified by this export.
      </p>
    </section>
  )
}

export function AccessibleDocumentSheet({
  documentId,
  format,
  open,
  onOpenChange,
}: {
  documentId: number | null
  format: AccessibleExportFormat
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const pre = useSWR<DocxExportPreflight>(open && documentId ? docxExportPreflightUrl(documentId) : null, altTextFetcher, { revalidateOnFocus: false })
  const [policy, setPolicy] = useState<DocxExportPolicy>("approved_only")
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<DocxExportResponse | null>(null)
  const [failure, setFailure] = useState<{ message: string; items: DocxExportItem[] } | null>(null)
  const [checking, setChecking] = useState<{ outputId: string; filename: string } | null>(null)
  const key = useRef<string | null>(null)
  const data = pre.data

  function change(next: boolean) {
    if (!next) {
      setResult(null)
      setFailure(null)
      setChecking(null)
      key.current = null
    }
    onOpenChange(next)
  }

  async function run() {
    if (!documentId || !data || running) return
    setRunning(true)
    setFailure(null)
    key.current ??= newIdempotencyKey()
    const r = await exportAccessibleDocx(documentId, { format, policy, idempotencyKey: key.current, snapshot: data.snapshot })
    setRunning(false)
    if (!r.ok) {
      if (r.error.code !== "RATE_LIMITED") key.current = null
      const items = Array.isArray(r.error.details?.items) ? (r.error.details.items as DocxExportItem[]) : []
      setFailure({ message: r.error.message, items })
      if (r.error.code === "SNAPSHOT_CHANGED") void pre.mutate()
      return
    }
    key.current = null
    setResult(r.data)
    void pre.mutate()
    toast.success("Accessible document is ready", { description: `${r.data.summary.updated} image${r.data.summary.updated === 1 ? "" : "s"} updated.` })
  }

  const t = data?.totals
  const plan = data?.plan

  return (
    <Sheet open={open} onOpenChange={change}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Download Accessible Document</SheetTitle>
          <SheetDescription>
            Creates a copy of {data?.filename ? <span className="font-medium text-foreground">{data.filename}</span> : "the document"} with approved alt text. The original stays unchanged.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 pb-4">
          {checking && documentId ? (
            <OutputValidationPanel documentId={documentId} outputId={checking.outputId} filename={checking.filename} onBack={() => setChecking(null)} />
          ) : pre.isLoading ? (
            <div className="flex flex-col gap-3" aria-busy="true">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : pre.error ? (
            <Alert variant="destructive">
              <AlertTriangle aria-hidden="true" />
              <AlertTitle>Could not load the export summary</AlertTitle>
              <AlertDescription className="flex flex-col items-start gap-2">
                Please try again.
                <Button size="sm" variant="outline" onClick={() => pre.mutate()}>
                  <RefreshCw aria-hidden="true" />
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          ) : data && t ? (
            <>
              <section aria-labelledby="export-readiness" className="flex flex-col gap-2">
                <h3 id="export-readiness" className="text-sm font-semibold text-foreground">
                  Readiness
                </h3>
                <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label="Approved" value={t.eligible} />
                  <Stat label="Needs review" value={t.pendingReview} />
                  <Stat label="Blocked" value={t.blocked} />
                  <Stat label="Unmapped" value={t.unmapped} />
                </dl>
              </section>

              {data.pdfAssessment ? <PdfAssessment details={data.pdfAssessment} /> : null}

              {!data.supported ? (
                <Alert>
                  <AlertTriangle aria-hidden="true" />
                  <AlertTitle>Export unavailable</AlertTitle>
                  <AlertDescription>{data.unavailableReason}</AlertDescription>
                </Alert>
              ) : null}

              {data.supported ? (
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-2 text-sm font-semibold text-foreground">Export policy</legend>
                  {DOCX_EXPORT_POLICIES.map((p) => (
                    <Label key={p} htmlFor={`policy-${p}`} className="flex cursor-pointer items-start gap-3 rounded-md border p-3 font-normal has-[:checked]:border-primary has-[:checked]:bg-accent">
                      <input
                        id={`policy-${p}`}
                        type="radio"
                        name="export-policy"
                        value={p}
                        checked={policy === p}
                        onChange={() => setPolicy(p)}
                        className="mt-0.5 accent-primary"
                      />
                      <span className="flex flex-col gap-0.5">
                        <span className="text-sm font-medium text-foreground">{DOCX_EXPORT_POLICY_LABELS[p]}</span>
                        <span className="text-xs text-muted-foreground">{POLICY_HINTS[p]}</span>
                      </span>
                    </Label>
                  ))}
                </fieldset>
              ) : null}

              {plan && !result ? (
                <section aria-labelledby="export-plan" className="flex flex-col gap-2">
                  <h3 id="export-plan" className="text-sm font-semibold text-foreground">
                    Planned changes
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {`${plan.updated} to update, ${plan.unchanged} already current, ${plan.skipped} skipped, ${plan.unsupported + plan.failed} cannot be inserted.`}
                  </p>
                  {plan.warnings.map((w) => (
                    <p key={w.code} className="text-xs text-muted-foreground">
                      {w.message}
                    </p>
                  ))}
                  <ItemList items={plan.items} />
                </section>
              ) : null}

              {failure ? (
                <Alert variant="destructive" role="alert">
                  <AlertTriangle aria-hidden="true" />
                  <AlertTitle>No document was produced</AlertTitle>
                  <AlertDescription className="flex flex-col gap-2">
                    {failure.message}
                    {failure.items.length ? <ItemList items={failure.items} /> : null}
                  </AlertDescription>
                </Alert>
              ) : null}

              {result ? (
                <Alert role="status">
                  <FileCheck2 aria-hidden="true" />
                  <AlertTitle>{result.replayed ? "Export already completed" : "Accessible document ready"}</AlertTitle>
                  <AlertDescription className="flex flex-col items-start gap-2">
                    {`${result.summary.updated} updated, ${result.summary.unchanged} already current, ${result.summary.skipped} skipped, ${result.summary.unsupported + result.summary.failed} not inserted.`}
                    <div className="flex flex-wrap gap-2">
                      {result.export.downloadUrl ? (
                        <Button asChild size="sm">
                          <a href={result.export.downloadUrl} download={result.export.filename}>
                            <Download aria-hidden="true" />
                            Download {result.export.filename}
                          </a>
                        </Button>
                      ) : null}
                      <Button size="sm" variant="outline" onClick={() => setChecking({ outputId: result.export.outputId, filename: result.export.filename })}>
                        <ShieldCheck aria-hidden="true" />
                        Quality check
                      </Button>
                    </div>
                  </AlertDescription>
                </Alert>
              ) : null}

              {data.exports.length ? (
                <section aria-labelledby="export-history" className="flex flex-col gap-2">
                  <Separator />
                  <h3 id="export-history" className="text-sm font-semibold text-foreground">
                    Recent exports
                  </h3>
                  <ul className="flex flex-col gap-2">
                    {data.exports.map((e) => (
                      <li key={e.outputId} className="flex items-center justify-between gap-2 text-sm">
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate text-foreground">{new Date(e.createdAt).toLocaleString()}</span>
                          <span className="text-xs text-muted-foreground">
                            {e.status === "completed" ? `${e.updated} updated · ${DOCX_EXPORT_POLICY_LABELS[e.policy]}` : e.status === "failed" ? `Failed (${e.errorCode ?? "error"})` : "In progress"}
                          </span>
                        </span>
                        {e.status === "completed" ? (
                          <span className="flex shrink-0 gap-1">
                            <Button size="sm" variant="outline" onClick={() => setChecking({ outputId: e.outputId, filename: e.filename })} aria-label={`Quality check for export from ${new Date(e.createdAt).toLocaleString()}`}>
                              <ShieldCheck aria-hidden="true" />
                            </Button>
                            {e.downloadUrl ? (
                              <Button asChild size="sm" variant="outline">
                                <a href={e.downloadUrl} download={e.filename} aria-label={`Download export from ${new Date(e.createdAt).toLocaleString()}`}>
                                  <Download aria-hidden="true" />
                                </a>
                              </Button>
                            ) : null}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </>
          ) : null}
        </div>

        <SheetFooter className={checking ? "hidden" : "border-t"}>
          <Button onClick={run} disabled={!data?.supported || running || pre.isLoading}>
            {running ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
            {running ? "Preparing document…" : `Create accessible ${FORMAT_LABEL[format]}`}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
