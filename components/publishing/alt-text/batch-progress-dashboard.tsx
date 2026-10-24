"use client"

/**
 * @file components/publishing/alt-text/batch-progress-dashboard.tsx
 * @module Publishing
 * @kind React client component
 * @summary Phase 2 Task 12 — live batch progress + per-image results, polling the Task 11
 *   progress/assets APIs via SWR. Pause/Resume/Cancel are live (Task 13); Retry/Export stay disabled until Tasks 14–16.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import useSWR from "swr"
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eye,
  Images,
  Info,
  Loader2,
  Percent,
  RefreshCw,
  RotateCcw,
  Search,
  XCircle,
  type LucideIcon,
} from "lucide-react"
import type { AltTextAssetView } from "@/lib/alt-text/history"
import {
  ASSET_FILTERS,
  BATCH_ID_PATTERN,
  BATCH_STATUS_LABELS,
  errorRetryDelay,
  fetchBatchJson,
  isTerminalBatch,
  pollInterval,
  progressSegments,
  progressUrl,
  assetsUrl,
  syncNotice,
  totalPages,
  type AssetFilter,
  type BatchApiError,
  type BatchAssetStatusList,
  type BatchProgressView,
} from "@/lib/alt-text/batch-dashboard"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ErrorState } from "@/components/enterprise/data-state"
import { AltTextAssetDrawer } from "./alt-text-asset-drawer"
import { BatchControlActions } from "./batch-control-actions"
import { BatchExportAction } from "./batch-export-action"
import { RetryFailedAction, RetryImageButton } from "./batch-retry-actions"
import { AssetImage, StatusBadge, classificationLabel, formatDateTime } from "./alt-text-history"

const PAGE_SIZE = 25
const COLUMNS = ["Image", "Filename", "Classification", "Status", "Alt Text Preview", "Error / Note", "Last Updated", "Actions"] as const

const BATCH_STATUS_STYLES: Record<BatchProgressView["status"], string> = {
  draft: "border-slate-200 bg-slate-50 text-slate-700",
  queued: "border-slate-200 bg-slate-50 text-slate-700",
  processing: "border-sky-200 bg-sky-50 text-sky-800",
  completed: "border-emerald-200 bg-emerald-50 text-emerald-800",
  partially_completed: "border-amber-200 bg-amber-50 text-amber-800",
  failed: "border-red-200 bg-red-50 text-red-800",
  cancelled: "border-slate-200 bg-slate-100 text-slate-700",
  pause_requested: "border-amber-200 bg-amber-50 text-amber-800",
  paused: "border-amber-200 bg-amber-50 text-amber-800",
  cancel_requested: "border-slate-200 bg-slate-100 text-slate-700",
}

/** SWR fetcher that cancels its own previous in-flight request and aborts on unmount / batch change. */
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
  onErrorRetry: (err: BatchApiError, _key: string, _cfg: unknown, revalidate: (o: { retryCount: number }) => void, { retryCount }: { retryCount: number }) => {
    // Hidden tabs skip retries; focus revalidation refreshes immediately on return.
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return
    const delay = errorRetryDelay(err, retryCount)
    if (delay !== null) setTimeout(() => revalidate({ retryCount }), delay)
  },
}

function StatCard({ label, value, icon: Icon, tone }: { label: string; value: string | number; icon: LucideIcon; tone: string }) {
  return (
    <div className="flex items-center gap-3 rounded-md border bg-card px-3 py-2.5">
      <span className={`flex size-8 shrink-0 items-center justify-center rounded-md ${tone}`}>
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <dt className="truncate text-xs text-muted-foreground">{label}</dt>
        <dd className="text-lg font-semibold leading-tight tabular-nums">{value}</dd>
      </div>
    </div>
  )
}

function ProgressBar({ view }: { view: BatchProgressView }) {
  const seg = progressSegments(view)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-medium">Overall progress</span>
        <span className="tabular-nums text-muted-foreground">
          {view.progressPercent}% processed · {view.successPercent}% successful
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="Batch processing progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={view.progressPercent}
        aria-valuetext={`${view.progressPercent}% processed: ${view.completed} completed, ${view.failed} failed, ${seg.remaining} remaining`}
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full bg-emerald-500 transition-[width] duration-500" style={{ width: `${seg.completedPct}%` }} />
        <div className="h-full bg-red-500 transition-[width] duration-500" style={{ width: `${seg.failedPct}%` }} />
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <li className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-emerald-500" aria-hidden="true" /> Completed {view.completed}
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-red-500" aria-hidden="true" /> Failed {view.failed}
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-muted-foreground/30" aria-hidden="true" /> Remaining {seg.remaining}
        </li>
      </ul>
    </div>
  )
}

function progressErrorTitle(e: BatchApiError) {
  if (e.status === 404) return "Batch not found"
  if (e.status === 401 || e.status === 403) return "Access denied"
  if (e.status === 429) return "Rate limited"
  return "Progress unavailable"
}

export type BatchOpenRequest = { id: string; nonce: number }

export function BatchProgressDashboard({
  onOpenInEditor,
  openRequest,
}: {
  onOpenInEditor?: (asset: AltTextAssetView) => void
  /** Task 17: Batch History "Open Batch" — loads persisted progress/results only; never triggers processing. */
  openRequest?: BatchOpenRequest | null
}) {
  const [batchInput, setBatchInput] = useState("")
  const [inputError, setInputError] = useState<string | null>(null)
  const [batchId, setBatchId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [filter, setFilter] = useState<AssetFilter>("all")
  const [viewingId, setViewingId] = useState<number | null>(null)
  const [checkedAt, setCheckedAt] = useState<string | null>(null)
  const [handledRequest, setHandledRequest] = useState<BatchOpenRequest | null>(null)
  if (openRequest && openRequest !== handledRequest && BATCH_ID_PATTERN.test(openRequest.id)) {
    setHandledRequest(openRequest)
    setBatchInput(openRequest.id)
    setInputError(null)
    setPage(1)
    setFilter("all")
    if (openRequest.id !== batchId) setCheckedAt(null)
    setBatchId(openRequest.id)
  }

  const progressFetcher = useAbortableFetcher<BatchProgressView>(batchId)
  const assetsFetcher = useAbortableFetcher<BatchAssetStatusList>(batchId)

  const progress = useSWR<BatchProgressView, BatchApiError>(batchId ? progressUrl(batchId) : null, progressFetcher, {
    ...swrRetry,
    refreshInterval: pollInterval,
    refreshWhenHidden: false,
    revalidateOnFocus: true,
    dedupingInterval: 2000,
    onSuccess: () => setCheckedAt(new Date().toISOString()),
  })
  const view = progress.data
  const assets = useSWR<BatchAssetStatusList, BatchApiError>(batchId ? assetsUrl(batchId, page, PAGE_SIZE, filter) : null, assetsFetcher, {
    ...swrRetry,
    keepPreviousData: true,
    revalidateOnFocus: false,
    dedupingInterval: 2000,
  })

  // Refetch the visible page only when persisted progress actually changed.
  const lastUpdatedAt = view?.lastUpdatedAt
  const { mutate: mutateAssets } = assets
  useEffect(() => {
    if (lastUpdatedAt) void mutateAssets()
  }, [lastUpdatedAt, mutateAssets])

  const openBatch = (e: FormEvent) => {
    e.preventDefault()
    const id = batchInput.trim()
    if (!BATCH_ID_PATTERN.test(id)) return setInputError("Enter a valid batch ID.")
    setInputError(null)
    setPage(1)
    setFilter("all")
    setCheckedAt(null)
    setBatchId(id)
  }
  const refresh = () => {
    void progress.mutate()
    void assets.mutate()
  }

  const stale = Boolean(view && progress.error)
  const polling = Boolean(view && pollInterval(view) > 0 && !progress.error)
  const notice = view ? syncNotice(view) : null
  const pages = totalPages(assets.data)
  const busy = progress.isValidating || assets.isValidating

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Card>
        <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-col gap-1.5">
            <CardTitle className="text-base">Processing Summary</CardTitle>
            <CardDescription className="truncate">
              {view ? view.name : "Open a submitted batch to track live progress."}
            </CardDescription>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {view && (
              <Badge variant="outline" className={BATCH_STATUS_STYLES[view.status]}>
                {BATCH_STATUS_LABELS[view.status]}
              </Badge>
            )}
            {view && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
                <span className={`size-2 rounded-full ${stale ? "bg-amber-500" : polling ? "animate-pulse bg-emerald-500" : "bg-muted-foreground/40"}`} aria-hidden="true" />
                {stale ? "Stale" : polling ? "Live" : isTerminalBatch(view.status) ? "Final" : "Not polling"}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form onSubmit={openBatch} className="flex flex-col gap-2 sm:flex-row sm:items-end" noValidate>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Label htmlFor="batch-progress-id">Batch ID</Label>
              <Input
                id="batch-progress-id"
                value={batchInput}
                onChange={(e) => setBatchInput(e.target.value)}
                placeholder="e.g. 3f2b8c1e-…"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={inputError ? true : undefined}
                aria-describedby={inputError ? "batch-progress-id-error" : undefined}
              />
              {inputError && (
                <p id="batch-progress-id-error" className="text-xs text-destructive">
                  {inputError}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="submit" size="sm" variant="outline">
                <Search aria-hidden="true" /> Open Batch
              </Button>
              <Button type="button" size="sm" onClick={refresh} disabled={!batchId || busy}>
                <RefreshCw className={busy ? "animate-spin" : undefined} aria-hidden="true" /> Refresh
              </Button>
            </div>
          </form>

          {!batchId ? (
            <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">No batch selected.</p>
          ) : !view && progress.error ? (
            <ErrorState
              title={progressErrorTitle(progress.error)}
              message={progress.error.message}
              onRetry={[400, 401, 403, 404].includes(progress.error.status) ? undefined : refresh}
            />
          ) : !view ? (
            <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading batch progress">
              <div className="alt-stat-grid">
                {Array.from({ length: 6 }, (_, i) => (
                  <Skeleton key={i} className="h-14" />
                ))}
              </div>
              <Skeleton className="h-2.5" />
            </div>
          ) : (
            <>
              {stale && (
                <Alert>
                  <AlertTriangle aria-hidden="true" />
                  <AlertTitle>Showing last retrieved data</AlertTitle>
                  <AlertDescription>
                    {progress.error?.message} Last successful check {checkedAt ? formatDateTime(checkedAt) : "unknown"}. Retrying automatically.
                  </AlertDescription>
                </Alert>
              )}
              {notice && (
                <Alert variant={notice.tone === "error" ? "destructive" : "default"}>
                  {notice.tone === "info" ? <Info aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}
                  <AlertTitle>{notice.title}</AlertTitle>
                  <AlertDescription>
                    {notice.message}
                    {view.blockedPending > 0 && ` ${view.blockedPending} pending image${view.blockedPending === 1 ? " is" : "s are"} waiting on a blocker (see table).`}
                  </AlertDescription>
                </Alert>
              )}
              <dl className="alt-stat-grid">
                <StatCard label="Total Images" value={view.total} icon={Images} tone="bg-slate-100 text-slate-700" />
                <StatCard label="Pending" value={view.pending} icon={Clock} tone="bg-slate-100 text-slate-600" />
                <StatCard label="Processing" value={view.processing} icon={Loader2} tone="bg-sky-50 text-sky-700" />
                <StatCard label="Completed" value={view.completed} icon={CheckCircle2} tone="bg-emerald-50 text-emerald-700" />
                <StatCard label="Failed" value={view.failed} icon={XCircle} tone="bg-red-50 text-red-700" />
                <StatCard label="Success Rate" value={`${view.successPercent}%`} icon={Percent} tone="bg-amber-50 text-amber-700" />
              </dl>
              <ProgressBar view={view} />
              <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
                {[
                  ["Started", view.startedAt],
                  ["Last updated", view.lastUpdatedAt],
                  ["Completed", view.completedAt],
                ].map(([label, iso]) => (
                  <div key={label} className="flex gap-1.5">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="font-medium">{iso ? formatDateTime(iso) : "—"}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
        </CardContent>
      </Card>

      {batchId && view && (
        <Card>
          <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex flex-col gap-1.5">
              <CardTitle className="text-base">Batch Results</CardTitle>
              <CardDescription>Per-image processing status from the server.</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Batch actions">
              <BatchControlActions view={view} onChanged={refresh} />
              <RetryFailedAction view={view} onChanged={refresh} />
              <BatchExportAction view={view} />
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Select
                value={filter}
                onValueChange={(v) => {
                  setFilter(v as AssetFilter)
                  setPage(1)
                }}
              >
                <SelectTrigger className="w-44" aria-label="Filter by status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ASSET_FILTERS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {assets.data && <span className="text-xs tabular-nums text-muted-foreground">{assets.data.total} image{assets.data.total === 1 ? "" : "s"}</span>}
            </div>

            {assets.error && !assets.data ? (
              <ErrorState title="Images unavailable" message={assets.error.message} onRetry={() => void assets.mutate()} />
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <Table aria-busy={assets.isLoading}>
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
                    {!assets.data ? (
                      Array.from({ length: 5 }, (_, i) => (
                        <TableRow key={i}>
                          <TableCell colSpan={COLUMNS.length}>
                            <Skeleton className="h-10" />
                          </TableCell>
                        </TableRow>
                      ))
                    ) : assets.data.items.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={COLUMNS.length} className="py-10 text-center text-sm text-muted-foreground">
                          {filter === "all" ? "This batch has no images." : `No ${ASSET_FILTERS[filter].toLowerCase()} images.`}
                        </TableCell>
                      </TableRow>
                    ) : (
                      assets.data.items.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell>
                            <AssetImage id={a.id} alt="" className="size-10 rounded" />
                          </TableCell>
                          <TableCell className="max-w-48 truncate text-sm" title={a.fileName}>
                            {a.fileName}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm">{classificationLabel(a.classification)}</TableCell>
                          <TableCell>
                            <StatusBadge status={a.status} />
                          </TableCell>
                          <TableCell className="max-w-64 text-sm">
                            <span className="line-clamp-2 text-muted-foreground">{a.shortAltPreview ?? "—"}</span>
                          </TableCell>
                          <TableCell className="max-w-56 text-xs">
                            {a.failureReason ? (
                              <span className="flex flex-col gap-0.5">
                                <span className="text-destructive">{a.failureReason}</span>
                                {a.retryBlockedReason && <span className="text-muted-foreground">Not retryable: {a.retryBlockedReason}</span>}
                              </span>
                            ) : a.blockedReason ? (
                              <span className="text-amber-700">Waiting: {a.blockedReason}</span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(a.updatedAt)}</TableCell>
                          <TableCell>
                            {a.retryable ? (
                              <RetryImageButton batchId={view.batchId} assetId={a.id} fileName={a.fileName} batchStatus={view.status} onChanged={refresh} />
                            ) : (
                              <Button size="sm" variant="outline" disabled={a.progressStatus !== "completed"} onClick={() => setViewingId(a.id)}>
                                <Eye aria-hidden="true" /> View Result<span className="sr-only"> for {a.fileName}</span>
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            )}

            {assets.data && pages > 1 && (
              <nav className="flex items-center justify-end gap-2" aria-label="Batch results pagination">
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
          </CardContent>
        </Card>
      )}

      <AltTextAssetDrawer assetId={viewingId} focus="view" onClose={() => setViewingId(null)} onOpenInEditor={onOpenInEditor ?? (() => setViewingId(null))} />
    </div>
  )
}
