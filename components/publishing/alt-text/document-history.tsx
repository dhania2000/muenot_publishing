"use client"

/**
 * @file components/publishing/alt-text/document-history.tsx
 * @module Publishing · Alt Text
 * @kind Client component
 * @summary Phase 3 Task 19 — Document History: tenant-scoped, server-filtered and paginated list of
 *   processed documents with a read-only details drawer. Opening, viewing or downloading never
 *   re-runs extraction, AI generation, export or validation.
 */
import { useEffect, useState } from "react"
import useSWR from "swr"
import { ChevronLeft, ChevronRight, Download, Eye, FileClock, FolderOpen, Images, MoreHorizontal, RefreshCw, Search, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EmptyState, ErrorState } from "@/components/enterprise/data-state"
import { altTextFetcher } from "@/lib/alt-text/client"
import {
  HISTORY_DOCUMENT_TYPES,
  HISTORY_OUTPUT_STATUSES,
  HISTORY_PAGE_SIZES,
  HISTORY_PROCESSING_STATUSES,
  HISTORY_SEARCH_MAX,
  HISTORY_SORTS,
  historyListUrl,
  originalDownloadUrl,
  type DocumentHistoryFilter,
  type DocumentHistoryListResponse,
  type HistoryDocumentRow,
} from "@/lib/alt-text/document-history-contract"
import { StatusBadge } from "./document-upload-status"
import { DocumentHistorySheet, type HistorySheetTab } from "./document-history-sheet"
import { actorLabel, downloadWithToast, fmtBytes, fmtDateTime, OUTPUT_FILTER_LABELS, PROCESSING_LABELS, SORT_LABELS, ValidationBadge } from "./document-history-labels"

type Range = "all" | "7d" | "30d" | "custom"
const RANGE_LABELS: Record<Range, string> = { all: "All time", "7d": "Last 7 days", "30d": "Last 30 days", custom: "Custom range" }
const ALL = "all"

type UiFilters = Omit<DocumentHistoryFilter, "from" | "to"> & { range: Range; from: string; to: string }
const DEFAULT_FILTERS: UiFilters = { page: 1, pageSize: 25, search: null, type: null, status: null, output: null, projectId: null, sort: "updated_desc", range: "all", from: "", to: "" }

const isoDaysAgo = (days: number) => {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function toQuery(f: UiFilters): Partial<DocumentHistoryFilter> | null {
  const { range, from, to, ...rest } = f
  if (range === "custom") {
    if (!from || !to || from > to) return null
    return { ...rest, from, to }
  }
  if (range === "7d") return { ...rest, from: isoDaysAgo(7), to: null }
  if (range === "30d") return { ...rest, from: isoDaysAgo(30), to: null }
  return { ...rest, from: null, to: null }
}

export type DocumentHistoryProps = {
  onOpenDocument: (documentId: number) => void
  onOpenBatch?: (batchId: string) => void
}

export function DocumentHistory({ onOpenDocument, onOpenBatch }: DocumentHistoryProps) {
  const [filters, setFilters] = useState<UiFilters>(DEFAULT_FILTERS)
  const [searchInput, setSearchInput] = useState("")
  const [projectInput, setProjectInput] = useState("")
  const [sheet, setSheet] = useState<{ id: number; tab: HistorySheetTab } | null>(null)

  useEffect(() => {
    const t = setTimeout(() => {
      const search = searchInput.trim() || null
      const projectId = /^[1-9]\d{0,9}$/.test(projectInput.trim()) ? Number(projectInput.trim()) : null
      setFilters((f) => (f.search === search && f.projectId === projectId ? f : { ...f, search, projectId, page: 1 }))
    }, 350)
    return () => clearTimeout(t)
  }, [searchInput, projectInput])

  const query = toQuery(filters)
  const key = query ? historyListUrl(query) : null
  const { data, error, isLoading, isValidating, mutate } = useSWR<DocumentHistoryListResponse>(key, altTextFetcher, { keepPreviousData: true, revalidateOnFocus: false })

  const set = (patch: Partial<UiFilters>) => setFilters((f) => ({ ...f, ...patch, page: patch.page ?? 1 }))
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  const hasFilters = Boolean(filters.search || filters.type || filters.status || filters.output || filters.projectId || filters.range !== "all")
  const customInvalid = filters.range === "custom" && (!filters.from || !filters.to || filters.from > filters.to)
  const projectInvalid = projectInput.trim() !== "" && !/^[1-9]\d{0,9}$/.test(projectInput.trim())

  const reset = () => {
    setSearchInput("")
    setProjectInput("")
    setFilters(DEFAULT_FILTERS)
  }

  return (
    <Card className="min-w-0">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle className="text-base">Document History</CardTitle>
          <CardDescription>
            Documents you can access, with their processing, review, output and validation records. Viewing history never re-runs processing.
          </CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={() => mutate()} disabled={isValidating || !key}>
          <RefreshCw className={isValidating ? "animate-spin" : undefined} aria-hidden="true" /> Refresh
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="doc-history-search">Search</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                id="doc-history-search"
                type="search"
                className="pl-8"
                placeholder="Filename or document ID"
                maxLength={HISTORY_SEARCH_MAX}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </div>
          </div>
          <FilterSelect id="doc-history-type" label="Type" value={filters.type} options={Object.fromEntries(HISTORY_DOCUMENT_TYPES.map((t) => [t, t.toUpperCase()]))} allLabel="All types" onChange={(v) => set({ type: v as UiFilters["type"] })} />
          <FilterSelect id="doc-history-status" label="Processing" value={filters.status} options={Object.fromEntries(HISTORY_PROCESSING_STATUSES.map((s) => [s, PROCESSING_LABELS[s].label]))} allLabel="All statuses" onChange={(v) => set({ status: v as UiFilters["status"] })} />
          <FilterSelect id="doc-history-output" label="Output / validation" value={filters.output} options={Object.fromEntries(HISTORY_OUTPUT_STATUSES.map((s) => [s, OUTPUT_FILTER_LABELS[s]]))} allLabel="Any output" onChange={(v) => set({ output: v as UiFilters["output"] })} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="doc-history-project">Project ID</Label>
            <Input
              id="doc-history-project"
              inputMode="numeric"
              placeholder="Any project"
              maxLength={10}
              value={projectInput}
              aria-invalid={projectInvalid || undefined}
              aria-describedby={projectInvalid ? "doc-history-project-error" : undefined}
              onChange={(e) => setProjectInput(e.target.value)}
            />
            {projectInvalid && <p id="doc-history-project-error" className="text-xs text-destructive">Enter a numeric project ID.</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="doc-history-range">Uploaded</Label>
            <Select value={filters.range} onValueChange={(v) => set({ range: v as Range })}>
              <SelectTrigger id="doc-history-range" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(RANGE_LABELS) as Range[]).map((r) => <SelectItem key={r} value={r}>{RANGE_LABELS[r]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="doc-history-sort">Sort</Label>
            <Select value={filters.sort} onValueChange={(v) => set({ sort: v as UiFilters["sort"] })}>
              <SelectTrigger id="doc-history-sort" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {HISTORY_SORTS.map((s) => <SelectItem key={s} value={s}>{SORT_LABELS[s]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {filters.range === "custom" && (
            <div className="flex flex-wrap items-end gap-3 sm:col-span-2 lg:col-span-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="doc-history-from">From</Label>
                <Input id="doc-history-from" type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => set({ from: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="doc-history-to">To</Label>
                <Input id="doc-history-to" type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => set({ to: e.target.value })} />
              </div>
              {customInvalid && <p className="pb-2 text-xs text-muted-foreground">Choose a start date on or before the end date.</p>}
            </div>
          )}
        </div>
        {hasFilters && (
          <Button size="sm" variant="ghost" className="self-start" onClick={reset}>
            Clear filters
          </Button>
        )}

        {error && !data ? (
          <ErrorState title="Could not load document history" message={(error as Error).message} onRetry={() => mutate()} />
        ) : (isLoading || !key) && !data ? (
          key ? (
            <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading document history">
              {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : null
        ) : data && data.documents.length === 0 ? (
          <EmptyState
            title={hasFilters ? "No documents match these filters" : "No documents yet"}
            description={hasFilters ? "Try a different search, status or date range." : "Documents you upload in Current Document will appear here."}
          />
        ) : data ? (
          <>
            {error && <p role="alert" className="text-xs text-destructive">Showing previous results — refresh failed: {(error as Error).message}</p>}
            <div className="overflow-x-auto rounded-md border" aria-busy={isValidating}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Document</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead className="text-right">Size</TableHead>
                    <TableHead className="text-right">Images</TableHead>
                    <TableHead className="text-right">AI results</TableHead>
                    <TableHead className="text-right">Approved</TableHead>
                    <TableHead>Processing</TableHead>
                    <TableHead>Output / validation</TableHead>
                    <TableHead>Uploaded</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.documents.map((d) => (
                    <HistoryRow key={d.id} doc={d} onOpenSheet={(tab) => setSheet({ id: d.id, tab })} onOpenDocument={() => onOpenDocument(d.id)} />
                  ))}
                </TableBody>
              </Table>
            </div>
            <nav className="flex flex-wrap items-center justify-between gap-2" aria-label="Document history pagination">
              <div className="flex items-center gap-2">
                <span className="text-xs tabular-nums text-muted-foreground">{data.total.toLocaleString()} documents</span>
                <Select value={String(filters.pageSize)} onValueChange={(v) => set({ pageSize: Number(v) })}>
                  <SelectTrigger size="sm" className="w-28" aria-label="Rows per page"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {HISTORY_PAGE_SIZES.map((n) => <SelectItem key={n} value={String(n)}>{`${n} / page`}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => set({ page: filters.page - 1 })} disabled={filters.page <= 1}>
                  <ChevronLeft aria-hidden="true" /> Previous
                </Button>
                <span className="text-xs tabular-nums text-muted-foreground">{`Page ${filters.page} of ${pages}`}</span>
                <Button size="sm" variant="outline" onClick={() => set({ page: filters.page + 1 })} disabled={filters.page >= pages}>
                  Next <ChevronRight aria-hidden="true" />
                </Button>
              </div>
            </nav>
          </>
        ) : null}
      </CardContent>

      <DocumentHistorySheet
        target={sheet}
        onClose={() => setSheet(null)}
        onOpenDocument={(id) => {
          setSheet(null)
          onOpenDocument(id)
        }}
        onOpenBatch={
          onOpenBatch
            ? (id) => {
                setSheet(null)
                onOpenBatch(id)
              }
            : undefined
        }
      />
    </Card>
  )
}

function FilterSelect({ id, label, value, options, allLabel, onChange }: { id: string; label: string; value: string | null; options: Record<string, string>; allLabel: string; onChange: (v: string | null) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? null : v)}>
        <SelectTrigger id={id} className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{allLabel}</SelectItem>
          {Object.entries(options).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )
}

function HistoryRow({ doc, onOpenSheet, onOpenDocument }: { doc: HistoryDocumentRow; onOpenSheet: (tab: HistorySheetTab) => void; onOpenDocument: () => void }) {
  const processing = PROCESSING_LABELS[doc.processingStatus]
  return (
    <TableRow>
      <TableCell className="max-w-60">
        <button type="button" onClick={() => onOpenSheet("overview")} className="block max-w-full truncate text-left font-medium hover:underline focus-visible:underline focus-visible:outline-none" title={doc.filename}>
          {doc.filename}
        </button>
        <span className="font-mono text-xs text-muted-foreground">#{doc.id}</span>
      </TableCell>
      <TableCell className="uppercase text-muted-foreground">{doc.documentType}</TableCell>
      <TableCell className="text-muted-foreground">{doc.projectId ? `#${doc.projectId}` : "—"}</TableCell>
      <TableCell className="text-right whitespace-nowrap text-muted-foreground tabular-nums">{fmtBytes(doc.size)}</TableCell>
      <TableCell className="text-right tabular-nums">{doc.extractedImages}</TableCell>
      <TableCell className="text-right tabular-nums">{doc.aiGeneratedImages}</TableCell>
      <TableCell className="text-right tabular-nums">{doc.approvedImages}</TableCell>
      <TableCell>
        <StatusBadge tone={processing.tone} spinning={doc.processingStatus === "extracting"}>{processing.label}</StatusBadge>
      </TableCell>
      <TableCell>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{doc.completedExports ? `${doc.completedExports} output${doc.completedExports === 1 ? "" : "s"}` : "No output"}</span>
          {doc.completedExports > 0 && <ValidationBadge status={doc.latestValidation} />}
        </div>
      </TableCell>
      <TableCell className="whitespace-nowrap text-xs">
        <div>{fmtDateTime(doc.createdAt)}</div>
        <div className="text-muted-foreground">{actorLabel(doc.uploaderName, doc.uploadedBy)}</div>
      </TableCell>
      <TableCell className="whitespace-nowrap text-xs">{fmtDateTime(doc.updatedAt)}</TableCell>
      <TableCell className="text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" className="size-8">
              <MoreHorizontal aria-hidden="true" />
              <span className="sr-only">{`Actions for ${doc.filename}`}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onOpenSheet("overview")}><Eye aria-hidden="true" /> View details</DropdownMenuItem>
            <DropdownMenuItem onSelect={onOpenDocument}><FolderOpen aria-hidden="true" /> Open document</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onOpenSheet("reviews")}><Images aria-hidden="true" /> View images & reviews</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onOpenSheet("processing")}><FileClock aria-hidden="true" /> Processing history</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onOpenSheet("outputs")}><Sparkles aria-hidden="true" /> Outputs & validation</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void downloadWithToast(originalDownloadUrl(doc.id), doc.filename)}><Download aria-hidden="true" /> Download original</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  )
}
