"use client"

/**
 * @file components/publishing/alt-text/batch-history.tsx
 * @module Publishing · Alt Text
 * @kind Client component
 * @summary Phase 2 Task 17 — Bulk Batch History: scoped, paginated list of persisted batches with a details drawer.
 * Read-only by default; Resume / Retry Failed / Export reuse the existing guarded actions and require explicit clicks.
 */
import { useEffect, useState } from "react"
import useSWR from "swr"
import { ChevronLeft, ChevronRight, Eye, FolderOpen, RefreshCw, Search } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EmptyState, ErrorState } from "@/components/enterprise/data-state"
import { BATCH_STATUS_LABELS, fetchBatchJson, progressUrl, type BatchProgressView } from "@/lib/alt-text/batch-dashboard"
import { batchHistoryUrl, type BatchHistoryFilters, type BatchHistoryItem, type BatchHistoryList, type BatchHistoryRange, type BatchHistorySort } from "@/lib/alt-text/batch-history-types"
import type { BatchStatus } from "@/lib/alt-text/store"
import { DESCRIPTION_MODES, LANGUAGES, SUBJECTS } from "@/lib/alt-text/core"
import { BatchControlActions } from "./batch-control-actions"
import { BatchExportAction } from "./batch-export-action"
import { RetryFailedAction } from "./batch-retry-actions"

const PAGE_SIZE = 20
const RANGE_LABELS: Record<BatchHistoryRange, string> = { all: "All time", "7d": "Last 7 days", "30d": "Last 30 days", custom: "Custom range" }
const SORT_LABELS: Record<BatchHistorySort, string> = { newest: "Newest first", oldest: "Oldest first", updated: "Recently updated" }
const DEFAULT_FILTERS: BatchHistoryFilters = { page: 1, pageSize: PAGE_SIZE, search: "", status: "all", range: "all", from: "", to: "", sort: "newest" }

const fetcher = <T,>(url: string) => fetchBatchJson<T>(url)
const fmtDate = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })

function statusVariant(s: BatchStatus): "default" | "secondary" | "destructive" | "outline" {
  if (s === "completed") return "default"
  if (s === "failed" || s === "cancelled") return "destructive"
  if (s === "draft") return "outline"
  return "secondary"
}

export function BatchHistory({ onOpenBatch }: { onOpenBatch: (batchId: string) => void }) {
  const [filters, setFilters] = useState<BatchHistoryFilters>(DEFAULT_FILTERS)
  const [searchInput, setSearchInput] = useState("")
  const [selected, setSelected] = useState<BatchHistoryItem | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.search === searchInput ? f : { ...f, search: searchInput, page: 1 })), 350)
    return () => clearTimeout(t)
  }, [searchInput])

  const customIncomplete = filters.range === "custom" && (!filters.from || !filters.to)
  const key = customIncomplete ? null : batchHistoryUrl(filters)
  const { data, error, isLoading, isValidating, mutate } = useSWR<BatchHistoryList>(key, fetcher, { keepPreviousData: true, revalidateOnFocus: false })

  const set = (patch: Partial<BatchHistoryFilters>) => setFilters((f) => ({ ...f, ...patch, page: patch.page ?? 1 }))
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  const hasFilters = filters.search || filters.status !== "all" || filters.range !== "all"

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle>Batch History</CardTitle>
          <CardDescription>Previously created bulk batches. Opening a batch shows saved progress and results only.</CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={() => mutate()} disabled={isValidating}>
          <RefreshCw className={isValidating ? "animate-spin" : undefined} aria-hidden="true" /> Refresh
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-1">
            <Label htmlFor="batch-history-search">Search</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input id="batch-history-search" className="pl-8" placeholder="Batch name or ID" maxLength={120} value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="batch-history-status">Status</Label>
            <Select value={filters.status} onValueChange={(v) => set({ status: v as BatchHistoryFilters["status"] })}>
              <SelectTrigger id="batch-history-status" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {(Object.keys(BATCH_STATUS_LABELS) as BatchStatus[]).map((s) => (
                  <SelectItem key={s} value={s}>{BATCH_STATUS_LABELS[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="batch-history-range">Created</Label>
            <Select value={filters.range} onValueChange={(v) => set({ range: v as BatchHistoryRange })}>
              <SelectTrigger id="batch-history-range" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(RANGE_LABELS) as BatchHistoryRange[]).map((r) => (
                  <SelectItem key={r} value={r}>{RANGE_LABELS[r]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="batch-history-sort">Sort</Label>
            <Select value={filters.sort} onValueChange={(v) => set({ sort: v as BatchHistorySort })}>
              <SelectTrigger id="batch-history-sort" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(SORT_LABELS) as BatchHistorySort[]).map((s) => (
                  <SelectItem key={s} value={s}>{SORT_LABELS[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {filters.range === "custom" && (
            <div className="flex flex-wrap items-end gap-3 sm:col-span-2 lg:col-span-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="batch-history-from">From</Label>
                <Input id="batch-history-from" type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => set({ from: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="batch-history-to">To</Label>
                <Input id="batch-history-to" type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => set({ to: e.target.value })} />
              </div>
              {customIncomplete && <p className="pb-2 text-xs text-muted-foreground">Choose both dates to apply the range.</p>}
            </div>
          )}
        </div>

        {error && !data ? (
          <ErrorState title="Could not load batch history" message={(error as Error).message} onRetry={() => mutate()} />
        ) : isLoading && !data ? (
          <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading batch history">
            {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : data && data.items.length === 0 ? (
          <EmptyState
            title={hasFilters ? "No batches match these filters" : "No batches yet"}
            description={hasFilters ? "Try a different search, status or date range." : "Batches you create in Current Batch will appear here."}
          />
        ) : data ? (
          <>
            {error && <p role="alert" className="text-xs text-destructive">Showing previous results — refresh failed: {(error as Error).message}</p>}
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Batch</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Images</TableHead>
                    <TableHead className="text-right">Completed</TableHead>
                    <TableHead className="text-right">Failed</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell className="max-w-56">
                        <div className="truncate font-medium" title={b.name}>{b.name}</div>
                        <div className="truncate font-mono text-xs text-muted-foreground" title={b.id}>{b.id.slice(0, 8)}</div>
                      </TableCell>
                      <TableCell><Badge variant={statusVariant(b.status)}>{BATCH_STATUS_LABELS[b.status]}</Badge></TableCell>
                      <TableCell className="text-right tabular-nums">{b.total}</TableCell>
                      <TableCell className="text-right tabular-nums">{b.completed}</TableCell>
                      <TableCell className={`text-right tabular-nums ${b.failed ? "text-destructive" : ""}`}>{b.failed}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{fmtDate(b.createdAt)}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{fmtDate(b.updatedAt)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="ghost" onClick={() => setSelected(b)}>
                            <Eye aria-hidden="true" /> Details<span className="sr-only"> for {b.name}</span>
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => onOpenBatch(b.id)}>
                            <FolderOpen aria-hidden="true" /> Open<span className="sr-only"> {b.name}</span>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <nav className="flex flex-wrap items-center justify-between gap-2" aria-label="Batch history pagination">
              <span className="text-xs tabular-nums text-muted-foreground">{data.total.toLocaleString()} batches</span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => set({ page: filters.page - 1 })} disabled={filters.page <= 1}>
                  <ChevronLeft aria-hidden="true" /> Previous
                </Button>
                <span className="text-xs tabular-nums text-muted-foreground">Page {filters.page} of {pages}</span>
                <Button size="sm" variant="outline" onClick={() => set({ page: filters.page + 1 })} disabled={filters.page >= pages}>
                  Next <ChevronRight aria-hidden="true" />
                </Button>
              </div>
            </nav>
          </>
        ) : null}
      </CardContent>

      <BatchDetailsSheet
        item={selected}
        onClose={() => setSelected(null)}
        onOpenBatch={(id) => {
          setSelected(null)
          onOpenBatch(id)
        }}
        onChanged={() => mutate()}
      />
    </Card>
  )
}

function BatchDetailsSheet({
  item,
  onClose,
  onOpenBatch,
  onChanged,
}: {
  item: BatchHistoryItem | null
  onClose: () => void
  onOpenBatch: (id: string) => void
  onChanged: () => void
}) {
  const progress = useSWR<BatchProgressView>(item ? progressUrl(item.id) : null, fetcher, { revalidateOnFocus: false })
  const refresh = () => {
    progress.mutate()
    onChanged()
  }
  const facts: [string, string][] = item
    ? [
        ["Batch ID", item.id],
        ["Project", item.projectName ?? "—"],
        ["Created", fmtDate(item.createdAt)],
        ["Last updated", fmtDate(item.updatedAt)],
        ["Created by", item.createdByMe ? "You" : item.createdById ? `User #${item.createdById}` : "Another user"],
        ["Language", LANGUAGES[item.settings.outputLanguage] ?? item.settings.outputLanguage],
        ["Subject", SUBJECTS[item.settings.subject] ?? item.settings.subject],
        ["Description mode", DESCRIPTION_MODES[item.settings.descriptionMode] ?? item.settings.descriptionMode],
      ]
    : []

  return (
    <Sheet open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        {item && (
          <>
            <SheetHeader>
              <SheetTitle className="break-words">{item.name}</SheetTitle>
              <SheetDescription>{item.description || "Saved batch details. No processing runs until you choose an action."}</SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-6 px-4 pb-6">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={statusVariant(progress.data?.status ?? item.status)}>{BATCH_STATUS_LABELS[progress.data?.status ?? item.status]}</Badge>
              </div>
              <dl className="grid grid-cols-4 gap-2 text-center">
                {(
                  [
                    ["Total", progress.data?.total ?? item.total],
                    ["Completed", progress.data?.completed ?? item.completed],
                    ["Failed", progress.data?.failed ?? item.failed],
                    ["Pending", progress.data?.pending ?? item.pending + item.processing],
                  ] as const
                ).map(([label, n]) => (
                  <div key={label} className="rounded-md border p-2">
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="text-lg font-semibold tabular-nums">{n}</dd>
                  </div>
                ))}
              </dl>
              <dl className="flex flex-col gap-2 text-sm">
                {facts.map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4 border-b pb-2 last:border-0">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className={`text-right break-all ${k === "Batch ID" ? "font-mono text-xs" : ""}`}>{v}</dd>
                  </div>
                ))}
              </dl>
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-medium">Actions</h3>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => onOpenBatch(item.id)}>
                    <FolderOpen aria-hidden="true" /> Open Batch
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => onOpenBatch(item.id)}>
                    <Eye aria-hidden="true" /> View Images
                  </Button>
                </div>
                {progress.error ? (
                  <p role="alert" className="text-xs text-destructive">Could not load live batch state: {(progress.error as Error).message}</p>
                ) : progress.data ? (
                  <div className="flex flex-wrap gap-2">
                    <BatchControlActions view={progress.data} onChanged={refresh} />
                    <RetryFailedAction view={progress.data} onChanged={refresh} />
                    <BatchExportAction view={progress.data} />
                  </div>
                ) : (
                  <Skeleton className="h-8 w-full" />
                )}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
