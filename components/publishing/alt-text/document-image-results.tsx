"use client"

/**
 * @file components/publishing/alt-text/document-image-results.tsx
 * @module Publishing · Alt Text
 * @kind Client component
 * @summary Phase 3 Task 13 — per-occurrence AI results for one document: page/slide location,
 *   context state, AI status, alt preview, failure detail and actions (View Result, View Context,
 *   Retry). Server-side status filter + pagination; polls only while work is active.
 */
import { useState } from "react"
import useSWR from "swr"
import { ChevronLeft, ChevronRight, Eye, FileSearch } from "lucide-react"
import { errorRetryDelay, fetchBatchJson, type BatchApiError, type BatchProgressView } from "@/lib/alt-text/batch-dashboard"
import {
  IMAGE_RESULTS_PAGE_SIZE,
  IMAGE_RESULT_FILTERS,
  type DocumentImageResultRow,
  type DocumentImageResultsResponse,
  type ImageResultAiStatus,
  type ImageResultFilter,
} from "@/lib/alt-text/document-processing-contract"
import { CONTEXT_STATE_LABEL } from "@/lib/alt-text/document-image-review"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ErrorState } from "@/components/enterprise/data-state"
import { AltTextAssetDrawer } from "./alt-text-asset-drawer"
import { DocumentContextSheet, type ContextSheetTarget } from "./document-context-sheet"
import { RetryImageButton } from "./batch-retry-actions"
import { AssetImage, formatDateTime } from "./alt-text-history"

const POLL_MS = 5000
const COLUMNS = ["Image", "Location", "Context", "AI Status", "Alt Text Preview", "Error / Note", "Attempts", "Updated", "Actions"] as const

const AI_STATUS: Record<ImageResultAiStatus, { label: string; className: string }> = {
  not_submitted: { label: "Not submitted", className: "border-slate-200 bg-slate-50 text-slate-700" },
  pending: { label: "Pending", className: "border-slate-200 bg-slate-50 text-slate-700" },
  processing: { label: "Processing", className: "border-sky-200 bg-sky-50 text-sky-800" },
  completed: { label: "Completed", className: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  failed: { label: "Failed", className: "border-red-200 bg-red-50 text-red-800" },
  cancelled: { label: "Cancelled", className: "border-slate-200 bg-slate-100 text-slate-700" },
}

const CONTEXT_TONE: Record<DocumentImageResultRow["contextState"], string> = {
  ready: "text-emerald-700",
  unavailable: "text-muted-foreground",
  needs_review: "text-amber-700",
  not_analyzed: "text-muted-foreground",
}

const location = (r: DocumentImageResultRow) =>
  r.slideNumber != null ? `Slide ${r.slideNumber}` : r.pageNumber != null ? `Page ${r.pageNumber}` : `Image ${r.occurrenceIndex + 1}`

const resultsUrl = (documentId: number, page: number, filter: ImageResultFilter) => {
  const sp = new URLSearchParams({ page: String(page), pageSize: String(IMAGE_RESULTS_PAGE_SIZE) })
  if (filter !== "all") sp.set("status", filter)
  return `/api/alt-text/documents/${documentId}/results?${sp}`
}

export function DocumentImageResults({ documentId, batchId }: { documentId: number; batchId: string | null }) {
  const [page, setPage] = useState(1)
  const [filter, setFilter] = useState<ImageResultFilter>("all")
  const [viewingAsset, setViewingAsset] = useState<number | null>(null)
  const [contextTarget, setContextTarget] = useState<ContextSheetTarget | null>(null)

  // Revalidate whenever the batch dashboard observes a persisted progress change (cache read only).
  const progress = useSWR<BatchProgressView>(batchId ? `/api/alt-text/batches/${encodeURIComponent(batchId)}/progress` : null, null)
  const tick = progress.data?.lastUpdatedAt ?? "initial"

  const results = useSWR<DocumentImageResultsResponse, BatchApiError>(
    [resultsUrl(documentId, page, filter), tick],
    ([url]: [string, string]) => fetchBatchJson<DocumentImageResultsResponse>(url),
    {
      keepPreviousData: true,
      refreshInterval: (d) => (d?.active ? POLL_MS : 0),
      refreshWhenHidden: false,
      revalidateOnFocus: true,
      dedupingInterval: 2000,
      onErrorRetry: (err, _k, _c, revalidate, { retryCount }) => {
        if (typeof document !== "undefined" && document.visibilityState === "hidden") return
        const delay = errorRetryDelay(err, retryCount)
        if (delay !== null) setTimeout(() => revalidate({ retryCount }), delay)
      },
    },
  )
  const data = results.data
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  const refresh = () => {
    void results.mutate()
    void progress.mutate()
  }

  return (
    <section aria-labelledby="doc-image-results-heading" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h5 id="doc-image-results-heading" className="text-sm font-semibold text-foreground">
          Image Processing Results
        </h5>
        <div className="flex items-center gap-2">
          {data && (
            <span className="text-xs tabular-nums text-muted-foreground">
              {data.total.toLocaleString()} image{data.total === 1 ? "" : "s"}
            </span>
          )}
          <Select
            value={filter}
            onValueChange={(v) => {
              setFilter(v as ImageResultFilter)
              setPage(1)
            }}
          >
            <SelectTrigger size="sm" className="w-48" aria-label="Filter images by AI status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(IMAGE_RESULT_FILTERS).map(([v, l]) => (
                <SelectItem key={v} value={v}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {results.error && !data ? (
        <ErrorState title="Image results unavailable" message={results.error.message} onRetry={refresh} />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table aria-busy={results.isLoading}>
            <TableHeader>
              <TableRow>
                {COLUMNS.map((c) => (
                  <TableHead key={c} className="whitespace-nowrap">
                    {c}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {!data ? (
                Array.from({ length: 4 }, (_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={COLUMNS.length}>
                      <Skeleton className="h-10" />
                    </TableCell>
                  </TableRow>
                ))
              ) : data.rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={COLUMNS.length} className="py-8 text-center text-sm text-muted-foreground">
                    {filter === "all" ? "No extracted images in this document." : `No images match “${IMAGE_RESULT_FILTERS[filter]}”.`}
                  </TableCell>
                </TableRow>
              ) : (
                data.rows.map((r) => {
                  const s = AI_STATUS[r.aiStatus]
                  const label = `${location(r)} image`
                  return (
                    <TableRow key={r.imageId}>
                      <TableCell>
                        {r.assetId ? <AssetImage id={r.assetId} alt="" className="size-10 rounded" /> : <span className="block size-10 rounded bg-muted" aria-hidden="true" />}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        <span className="block">{location(r)}</span>
                        <span className="block max-w-40 truncate font-mono text-[11px] text-muted-foreground" title={r.sourceLocator}>
                          {r.sourceLocator}
                        </span>
                      </TableCell>
                      <TableCell className={`whitespace-nowrap text-xs ${CONTEXT_TONE[r.contextState]}`}>{CONTEXT_STATE_LABEL[r.contextState]}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={s.className}>
                          {s.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-64 text-sm">
                        <span className="line-clamp-2 text-muted-foreground">{r.shortAltPreview ?? "—"}</span>
                      </TableCell>
                      <TableCell className="max-w-56 text-xs">
                        {r.failureReason ? (
                          <span className="flex flex-col gap-0.5">
                            <span className="text-destructive">{r.failureReason}</span>
                            {r.retryBlockedReason && <span className="text-muted-foreground">Not retryable: {r.retryBlockedReason}</span>}
                          </span>
                        ) : r.waitingReason ? (
                          <span className="text-amber-700">Waiting: {r.waitingReason}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{r.assetId ? r.attempts : "—"}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(r.updatedAt)}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setContextTarget({ documentId, imageId: r.imageId, label })}
                          >
                            <FileSearch aria-hidden="true" /> Context<span className="sr-only"> for {label}</span>
                          </Button>
                          {r.retryable && r.batchId && r.assetId && r.batchStatus ? (
                            <RetryImageButton
                              batchId={r.batchId}
                              assetId={r.assetId}
                              fileName={label}
                              batchStatus={r.batchStatus as BatchProgressView["status"]}
                              onChanged={refresh}
                            />
                          ) : (
                            <Button size="sm" variant="outline" disabled={r.aiStatus !== "completed" || !r.assetId} onClick={() => setViewingAsset(r.assetId)}>
                              <Eye aria-hidden="true" /> View Result<span className="sr-only"> for {label}</span>
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {data && pages > 1 && (
        <nav className="flex items-center justify-end gap-2" aria-label="Image results pagination">
          <Button size="sm" variant="outline" onClick={() => setPage((p) => p - 1)} disabled={page <= 1}>
            <ChevronLeft aria-hidden="true" /> Previous
          </Button>
          <span className="text-xs tabular-nums text-muted-foreground">
            Page {page} of {pages}
          </span>
          <Button size="sm" variant="outline" onClick={() => setPage((p) => p + 1)} disabled={page >= pages}>
            Next <ChevronRight aria-hidden="true" />
          </Button>
        </nav>
      )}

      <AltTextAssetDrawer assetId={viewingAsset} focus="view" onClose={() => setViewingAsset(null)} onOpenInEditor={() => setViewingAsset(null)} />
      <DocumentContextSheet target={contextTarget} onClose={() => setContextTarget(null)} onAnalyzed={refresh} />
    </section>
  )
}
