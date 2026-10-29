"use client"

/**
 * @file components/publishing/alt-text/document-live-processing.tsx
 * @module Publishing · Alt Text
 * @kind Client component
 * @summary Phase 3 Task 13 — Live Document AI Processing section inside Document Processing.
 *   Composes persisted read-only data: per-document occurrence progress, the Task 11 preparation
 *   status, the Phase 2 BatchProgressDashboard (progress, polling, Pause/Resume/Cancel, Retry,
 *   result viewer) for the document's batch, and batch-attributed AI credit usage.
 *   Opening or polling never creates batches or runs jobs.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import useSWR from "swr"
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Coins,
  FileStack,
  Images,
  ListChecks,
  Loader2,
  RefreshCw,
  Sparkles,
  XCircle,
  type LucideIcon,
} from "lucide-react"
import {
  BATCH_STATUS_LABELS,
  errorRetryDelay,
  fetchBatchJson,
  progressUrl,
  type BatchApiError,
  type BatchProgressView,
} from "@/lib/alt-text/batch-dashboard"
import {
  PROCESSING_PAGE_SIZE,
  PROCESSING_TYPE_FILTERS,
  documentTypeLabel,
  type BatchCreditUsageResponse,
  type DocumentProcessingListResponse,
  type DocumentProcessingRow,
  type ProcessingTypeFilter,
} from "@/lib/alt-text/document-processing-contract"
import { cancelDocumentPreparation } from "@/lib/alt-text/client"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EmptyState, ErrorState } from "@/components/enterprise/data-state"
import { BatchProgressDashboard, type BatchOpenRequest } from "./batch-progress-dashboard"
import { DocumentImageResults } from "./document-image-results"
import { DocumentDescriptionReview } from "./document-description-review"
import { DocumentPreparationStatus } from "./document-preparation-status"
import { useDocumentPreparation } from "./use-document-preparation"
import { formatDateTime } from "./alt-text-history"

const POLL_MS = 5000
const DOC_PARAM = "doc"
const ACTIVE_BATCH = new Set(["queued", "processing", "pause_requested", "cancel_requested"])

const listUrl = (page: number, type: ProcessingTypeFilter) => {
  const sp = new URLSearchParams({ page: String(page), pageSize: String(PROCESSING_PAGE_SIZE) })
  if (type !== "all") sp.set("type", type)
  return `/api/alt-text/documents/processing?${sp}`
}
const creditsUrl = (batchId: string) => `/api/alt-text/batches/${encodeURIComponent(batchId)}/credits`

/** SWR fetcher that aborts its previous in-flight request and any request left over after a key change. */
function useAbortableFetcher<T>(resetKey: unknown) {
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [resetKey])
  return useCallback((url: string) => {
    controller.current?.abort()
    const c = new AbortController()
    controller.current = c
    return fetchBatchJson<T>(url, c.signal)
  }, [])
}

const swrRetry = {
  shouldRetryOnError: true,
  onErrorRetry: (err: BatchApiError, _k: string, _c: unknown, revalidate: (o: { retryCount: number }) => void, { retryCount }: { retryCount: number }) => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return
    const delay = errorRetryDelay(err, retryCount)
    if (delay !== null) setTimeout(() => revalidate({ retryCount }), delay)
  },
}

const rowIsActive = (r: DocumentProcessingRow) =>
  r.counts.processing > 0 ||
  (r.latestBatch != null && ACTIVE_BATCH.has(r.latestBatch.status)) ||
  r.document.processingStatus === "extracting"

type BatchStatus = BatchProgressView["status"]

function processingStatus(r: DocumentProcessingRow): { label: string; className: string } {
  if (r.latestBatch) {
    const s = r.latestBatch.status as BatchStatus
    const label = (BATCH_STATUS_LABELS as Record<string, string>)[s] ?? r.latestBatch.status
    const className =
      s === "completed"
        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
        : s === "failed"
          ? "border-red-200 bg-red-50 text-red-800"
          : s === "partially_completed" || s === "paused" || s === "pause_requested"
            ? "border-amber-200 bg-amber-50 text-amber-800"
            : s === "processing"
              ? "border-sky-200 bg-sky-50 text-sky-800"
              : "border-slate-200 bg-slate-50 text-slate-700"
    return { label: `AI: ${label}`, className }
  }
  const p = r.document.processingStatus
  if (r.document.extractionReady && r.counts.extracted > 0) return { label: "Ready for AI", className: "border-slate-200 bg-slate-50 text-slate-700" }
  if (p === "failed") return { label: "Preparation failed", className: "border-red-200 bg-red-50 text-red-800" }
  if (p === "extracting") return { label: "Preparing", className: "border-sky-200 bg-sky-50 text-sky-800" }
  return { label: "Not prepared", className: "border-slate-200 bg-slate-50 text-slate-700" }
}

function OverviewCard({ label, value, icon: Icon, hint }: { label: string; value: number; icon: LucideIcon; hint: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-md border bg-card px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{label}</span>
      </div>
      <p className="text-xl font-semibold tabular-nums text-foreground">{value.toLocaleString()}</p>
      <p className="truncate text-[11px] text-muted-foreground" title={hint}>
        {hint}
      </p>
    </div>
  )
}

export function DocumentLiveProcessing({ onOpenImages }: { onOpenImages?: () => void }) {
  const [page, setPage] = useState(1)
  const [type, setType] = useState<ProcessingTypeFilter>("all")
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [openRequest, setOpenRequest] = useState<BatchOpenRequest | null>(null)
  const [checkedAt, setCheckedAt] = useState<string | null>(null)

  // Restore the selected document after refresh from the URL (read-only; never triggers processing).
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get(DOC_PARAM)
    if (raw && /^[1-9]\d{0,9}$/.test(raw)) setSelectedId(Number(raw))
  }, [])

  const select = (id: number | null) => {
    setSelectedId(id)
    const url = new URL(window.location.href)
    if (id) url.searchParams.set(DOC_PARAM, String(id))
    else url.searchParams.delete(DOC_PARAM)
    window.history.replaceState(window.history.state, "", url)
  }

  const key = listUrl(page, type)
  const fetcher = useAbortableFetcher<DocumentProcessingListResponse>(key)
  const list = useSWR<DocumentProcessingListResponse, BatchApiError>(key, fetcher, {
    ...swrRetry,
    keepPreviousData: true,
    refreshInterval: (d) => (d?.rows.some(rowIsActive) ? POLL_MS : 0),
    refreshWhenHidden: false,
    revalidateOnFocus: true,
    dedupingInterval: 2000,
    onSuccess: () => setCheckedAt(new Date().toISOString()),
  })
  const data = list.data
  const totals = data?.totals
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  const selectedRow = data?.rows.find((r) => r.document.id === selectedId) ?? null
  const stale = Boolean(data && list.error)

  const batchId = selectedRow?.latestBatch?.id ?? null
  useEffect(() => {
    if (batchId) setOpenRequest((prev) => (prev?.id === batchId ? prev : { id: batchId, nonce: Date.now() }))
  }, [batchId])

  return (
    <Card className="min-w-0" aria-labelledby="live-processing-heading">
      <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1.5">
          <CardTitle id="live-processing-heading" className="text-base">
            Live Processing
          </CardTitle>
          <CardDescription>
            Document preparation and AI Alt Text generation, tracked separately. Counts are image occurrences from saved records.
          </CardDescription>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {stale ? "Connection issue — showing last loaded data" : checkedAt ? `Checked ${formatDateTime(checkedAt)}` : null}
          </span>
          <Button variant="outline" size="sm" onClick={() => void list.mutate()} disabled={list.isValidating}>
            {list.isValidating ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
            Refresh
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        {stale ? (
          <Alert>
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>Live refresh interrupted</AlertTitle>
            <AlertDescription>{list.error?.message} Values below may be out of date; retrying automatically.</AlertDescription>
          </Alert>
        ) : null}

        <section aria-labelledby="overview-heading" className="flex flex-col gap-2">
          <h3 id="overview-heading" className="text-sm font-semibold text-foreground">
            Processing Overview
          </h3>
          {totals ? (
            <div className="alt-stat-grid">
              <OverviewCard label="Total Documents" value={totals.documents} icon={FileStack} hint="Visible to you" />
              <OverviewCard label="Extracted Images" value={totals.extracted} icon={Images} hint="Extracted occurrences" />
              <OverviewCard label="Selected Images" value={totals.selected} icon={ListChecks} hint={`${totals.submitted.toLocaleString()} submitted to AI`} />
              <OverviewCard label="AI Processing" value={totals.processing} icon={Sparkles} hint={`${totals.pending.toLocaleString()} pending`} />
              <OverviewCard label="Completed Images" value={totals.completed} icon={CheckCircle2} hint="Saved AI results" />
              <OverviewCard label="Failed Images" value={totals.failed} icon={XCircle} hint="Currently failed" />
            </div>
          ) : list.error ? (
            <ErrorState title="Could not load processing data" message={list.error.message} onRetry={() => void list.mutate()} />
          ) : (
            <div className="alt-stat-grid">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-[76px]" />
              ))}
            </div>
          )}
        </section>

        <section aria-labelledby="doc-progress-heading" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h3 id="doc-progress-heading" className="text-sm font-semibold text-foreground">
              Document Progress
            </h3>
            <div className="flex flex-col gap-1">
              <Label htmlFor="processing-type" className="text-xs text-muted-foreground">
                Document type
              </Label>
              <Select
                value={type}
                onValueChange={(v) => {
                  setType(v as ProcessingTypeFilter)
                  setPage(1)
                }}
              >
                <SelectTrigger id="processing-type" size="sm" className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PROCESSING_TYPE_FILTERS).map(([v, l]) => (
                    <SelectItem key={v} value={v}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {!data && !list.error ? (
            <Skeleton className="h-40" />
          ) : data && data.rows.length === 0 ? (
            <EmptyState
              title={type === "all" ? "No documents uploaded yet" : `No ${PROCESSING_TYPE_FILTERS[type]} documents`}
              description="Upload a PDF, PPTX or DOCX above to start extracting images."
            />
          ) : data ? (
            <>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Document</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Extracted</TableHead>
                      <TableHead className="text-right">Submitted</TableHead>
                      <TableHead className="text-right">Completed</TableHead>
                      <TableHead className="text-right">Failed</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Last Updated</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.rows.map((r) => {
                      const s = processingStatus(r)
                      const isSel = r.document.id === selectedId
                      return (
                        <TableRow key={r.document.id} data-state={isSel ? "selected" : undefined}>
                          <TableCell className="max-w-56">
                            <span className="block truncate font-medium text-foreground" title={r.document.filename}>
                              {r.document.filename}
                            </span>
                          </TableCell>
                          <TableCell className="font-mono text-xs">{documentTypeLabel(r.document.documentType)}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.counts.extracted}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.counts.submitted}</TableCell>
                          <TableCell className="text-right tabular-nums text-emerald-700">{r.counts.completed}</TableCell>
                          <TableCell className={`text-right tabular-nums ${r.counts.failed ? "text-red-700" : ""}`}>{r.counts.failed}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={s.className}>
                              {s.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(r.lastUpdatedAt)}</TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-1">
                              <Button
                                size="sm"
                                variant={isSel ? "secondary" : "ghost"}
                                onClick={() => select(r.document.id)}
                                aria-pressed={isSel}
                                aria-label={`View progress for ${r.document.filename}`}
                              >
                                View Progress
                              </Button>
                              <Button size="sm" variant="ghost" onClick={onOpenImages} aria-label={`View extracted images for ${r.document.filename}`}>
                                View Images
                              </Button>
                              {r.latestBatch ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => {
                                    select(r.document.id)
                                    requestAnimationFrame(() => document.getElementById("doc-ai-results")?.scrollIntoView({ block: "start" }))
                                  }}
                                  aria-label={`Open AI results for ${r.document.filename}`}
                                >
                                  Open Results
                                </Button>
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  {data.total.toLocaleString()} document{data.total === 1 ? "" : "s"} · Page {data.page} of {pages}
                </span>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
                    <ChevronLeft aria-hidden="true" />
                  </Button>
                  <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
                    <ChevronRight aria-hidden="true" />
                  </Button>
                </div>
              </div>
            </>
          ) : null}
        </section>

        {selectedId == null ? (
          <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            Select <span className="font-medium text-foreground">View Progress</span> on a document to see its preparation and AI generation status.
          </p>
        ) : data && !selectedRow && !list.isValidating ? (
          <Alert>
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>Document not on this page</AlertTitle>
            <AlertDescription>
              The selected document is unavailable, was removed, or is on another page or filter.{" "}
              <button type="button" className="font-medium underline underline-offset-2" onClick={() => select(null)}>
                Clear selection
              </button>
            </AlertDescription>
          </Alert>
        ) : selectedRow ? (
          <SelectedDocumentDetail key={selectedRow.document.id} row={selectedRow} openRequest={openRequest} onSettled={() => void list.mutate()} />
        ) : null}
      </CardContent>
    </Card>
  )
}

function SelectedDocumentDetail({
  row,
  openRequest,
  onSettled,
}: {
  row: DocumentProcessingRow
  openRequest: BatchOpenRequest | null
  onSettled: () => void
}) {
  const doc = row.document
  const prep = useDocumentPreparation(doc.id, onSettled)
  const [cancelling, setCancelling] = useState(false)
  const cancelPrep = async () => {
    setCancelling(true)
    try {
      await cancelDocumentPreparation(doc.id)
      await prep.mutate()
    } finally {
      setCancelling(false)
    }
  }
  const batch = row.latestBatch

  return (
    <div className="flex min-w-0 flex-col gap-6 border-t pt-6">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-foreground">{doc.filename}</h3>
        <p className="text-xs text-muted-foreground">
          {documentTypeLabel(doc.documentType)} · {(doc.size / 1024 / 1024).toFixed(2)} MB · Uploaded {formatDateTime(doc.createdAt)} ·{" "}
          {row.counts.extracted} extracted / {row.counts.selected} selected / {row.counts.submitted} submitted
        </p>
      </div>

      <section aria-labelledby="doc-prep-heading" className="flex flex-col gap-2">
        <h4 id="doc-prep-heading" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Document Preparation
        </h4>
        {prep.preparation && (prep.preparation.jobId || prep.preparation.stage) ? (
          <DocumentPreparationStatus preparation={prep.preparation} stale={prep.stale} cancelling={cancelling} onCancel={() => void cancelPrep()} />
        ) : prep.isLoading ? (
          <Skeleton className="h-24" />
        ) : prep.error ? (
          <ErrorState title="Could not load preparation status" message={prep.error.message} onRetry={() => void prep.mutate()} />
        ) : (
          <p className="rounded-md border px-3 py-3 text-sm text-muted-foreground">
            {doc.extractionReady ? "Preparation has not been started for this document." : "Document is awaiting security scan before preparation can start."}
          </p>
        )}
      </section>

      <section id="doc-ai-results" aria-labelledby="doc-ai-heading" className="flex min-w-0 scroll-mt-4 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 id="doc-ai-heading" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            AI Generation
          </h4>
          {batch && batch.batchCount > 1 ? (
            <span className="text-xs text-muted-foreground">Showing the latest of {batch.batchCount} batches for this document</span>
          ) : null}
        </div>
        {batch && openRequest?.id === batch.id ? (
          <>
            <CreditUsagePanel batchId={batch.id} />
            <BatchProgressDashboard openRequest={openRequest} />
          </>
        ) : (
          <p className="rounded-md border px-3 py-3 text-sm text-muted-foreground">
            AI generation has not been submitted for this document. Select images and use Generate Alt Text in Extracted Images below.
          </p>
        )}
        {row.counts.extracted > 0 ? <DocumentImageResults documentId={doc.id} batchId={batch?.id ?? null} /> : null}
        {row.counts.extracted > 0 && batch ? <DocumentDescriptionReview documentId={doc.id} /> : null}
      </section>
    </div>
  )
}

function CreditUsagePanel({ batchId }: { batchId: string }) {
  // Read the batch progress already polled by BatchProgressDashboard (cache only, no extra polling).
  const progress = useSWR<BatchProgressView>(progressUrl(batchId), null)
  const fetcher = useAbortableFetcher<BatchCreditUsageResponse>(batchId)
  const lastUpdated = progress.data?.lastUpdatedAt ?? "initial"
  const credits = useSWR<BatchCreditUsageResponse, BatchApiError>([creditsUrl(batchId), lastUpdated], ([url]: [string, string]) => fetcher(url), {
    ...swrRetry,
    keepPreviousData: true,
    revalidateOnFocus: false,
  })
  const c = credits.data
  const blocked = progress.data && progress.data.blockedPending > 0

  return (
    <section aria-labelledby="credit-usage-heading" className="flex flex-col gap-3 rounded-md border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h5 id="credit-usage-heading" className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Coins className="size-4 text-muted-foreground" aria-hidden="true" />
          AI Credit Usage
        </h5>
        {c ? (
          <span className="text-xs text-muted-foreground">{c.scope === "own" ? "Your attempts in this batch" : "All attempts in this batch"}</span>
        ) : null}
      </div>
      {blocked ? (
        <Alert>
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>Awaiting credits</AlertTitle>
          <AlertDescription>
            {progress.data?.blockedPending} queued image{progress.data?.blockedPending === 1 ? " is" : "s are"} blocked by the AI credit budget. Completed
            descriptions and queued work are preserved; processing does not resume until credits are available.
          </AlertDescription>
        </Alert>
      ) : null}
      {c ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
          <div className="col-span-2 sm:col-span-3 lg:col-span-2">
            <dt className="text-xs text-muted-foreground">AI Model</dt>
            <dd className="truncate font-medium text-foreground">{c.models.length ? c.models.join(", ") : "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Billed attempts</dt>
            <dd className="font-medium tabular-nums text-foreground">{c.attempts.settled}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Released (not billed)</dt>
            <dd className="font-medium tabular-nums text-foreground">{c.attempts.released}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Credits consumed</dt>
            <dd className="font-medium tabular-nums text-foreground">{c.creditsCharged.toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Reserved (in flight)</dt>
            <dd className="font-medium tabular-nums text-foreground">
              {c.creditsReserved.toLocaleString()} <span className="text-xs text-muted-foreground">({c.attempts.reserved})</span>
            </dd>
          </div>
        </dl>
      ) : credits.error ? (
        <p className="text-sm text-muted-foreground">Credit usage unavailable: {credits.error.message}</p>
      ) : (
        <Skeleton className="h-10" />
      )}
      {c && c.attempts.needsReconciliation > 0 ? (
        <p className="text-xs text-amber-800">
          {c.attempts.needsReconciliation} settled attempt{c.attempts.needsReconciliation === 1 ? "" : "s"} await billing reconciliation.
        </p>
      ) : null}
      {c?.truncated&&<p className="text-xs" role="status">This bounded usage summary reached its 5,000-request limit and may omit older records. Use the existing credit ledger for complete usage.</p>}
      <p className="text-xs text-muted-foreground">
        Attributed from exact ledger reservations linked to this batch and its advanced processing. Remaining tenant balance is shown in AI credit settings. Eligible local retries add no provider charges; a new explicitly requested provider analysis uses the existing credit policy.
      </p>
    </section>
  )
}
