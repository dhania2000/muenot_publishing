"use client"

/**
 * @file components/publishing/alt-text/alt-text-history.tsx
 * @module Publishing
 * @kind React client component
 * @summary History tab (Task 18): server-paginated, searchable, filterable list of saved
 *   Alt Text assets from GET /api/alt-text/assets, with row actions and the details drawer.
 */
import { useEffect, useState } from "react"
import useSWR from "swr"
import { toast } from "sonner"
import { ChevronLeft, ChevronRight, Download, Eye, History, ImageOff, MoreHorizontal, Pencil, Search, SquarePen } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ErrorState } from "@/components/enterprise/data-state"
import { ASSET_STATUSES, CLASSIFICATION_LABELS, IMAGE_CLASSIFICATIONS, LANGUAGES, type AssetStatus, type ImageClassification } from "@/lib/alt-text/core"
import type { ExportFormat } from "@/lib/alt-text/export"
import type { AltTextAssetList, AltTextAssetView } from "@/lib/alt-text/history"
import {
  AltTextApiError,
  altTextFetcher,
  altTextImageUrl,
  fetchAltTextExport,
  historyListUrl,
  triggerDownload,
  type HistorySort,
} from "@/lib/alt-text/client"
import { AltTextAssetDrawer, type DrawerFocus } from "./alt-text-asset-drawer"
import { Workbench, WorkbenchScroll } from "./workbench"

export const STATUS_LABELS: Record<AssetStatus, string> = {
  uploaded: "Uploaded",
  processing: "Processing",
  in_review: "In review",
  approved: "Approved",
  rejected: "Rejected",
  failed: "Failed",
}

const STATUS_STYLES: Record<AssetStatus, string> = {
  uploaded: "border-slate-200 bg-slate-50 text-slate-700",
  processing: "border-sky-200 bg-sky-50 text-sky-800",
  in_review: "border-amber-200 bg-amber-50 text-amber-800",
  approved: "border-emerald-200 bg-emerald-50 text-emerald-800",
  rejected: "border-rose-200 bg-rose-50 text-rose-800",
  failed: "border-red-200 bg-red-50 text-red-800",
}

export function StatusBadge({ status }: { status: string }) {
  const known = (ASSET_STATUSES as readonly string[]).includes(status) ? (status as AssetStatus) : null
  return (
    <Badge variant="outline" className={known ? STATUS_STYLES[known] : undefined}>
      {known ? STATUS_LABELS[known] : status}
    </Badge>
  )
}

export const classificationLabel = (c: string | null) =>
  c && c in CLASSIFICATION_LABELS ? CLASSIFICATION_LABELS[c as ImageClassification] : c ? c : "Not classified"

export const languageLabel = (l: string) => (l in LANGUAGES ? LANGUAGES[l as keyof typeof LANGUAGES] : l)

export const formatDateTime = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso))

export function AssetImage({ id, alt, className }: { id: number; alt: string; className: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <div className={`${className} flex items-center justify-center bg-muted text-muted-foreground`} role="img" aria-label="Image unavailable">
        <ImageOff className="size-4" aria-hidden="true" />
      </div>
    )
  }
  // Authenticated same-origin endpoint; next/image would re-fetch it without the session cookie.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={altTextImageUrl(id)} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} className={`${className} bg-muted object-cover`} />
}

export async function exportAsset(asset: Pick<AltTextAssetView, "id" | "fileName">, format: ExportFormat) {
  const r = await fetchAltTextExport(asset.id, format)
  if (!r.ok) {
    toast.error("Export failed", { description: r.error.message })
    return
  }
  triggerDownload(r.data.blob, r.data.filename)
  toast.success(`Exported ${asset.fileName} as ${format.toUpperCase()}`)
}

const EXPORT_FORMATS: ExportFormat[] = ["txt", "csv", "json"]
const PAGE_SIZES = [10, 25, 50]
const ALL = "all"

function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

export function AltTextHistory({ onOpenInEditor }: { onOpenInEditor: (asset: AltTextAssetView) => void }) {
  const [searchInput, setSearchInput] = useState("")
  const search = useDebounced(searchInput.trim(), 350)
  const [classification, setClassification] = useState(ALL)
  const [status, setStatus] = useState(ALL)
  const [sort, setSort] = useState<HistorySort>("newest")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [drawer, setDrawer] = useState<{ id: number; focus: DrawerFocus } | null>(null)

  const [filterKey, setFilterKey] = useState("")
  const nextFilterKey = [search, classification, status, sort, pageSize].join("|")
  if (filterKey !== nextFilterKey) {
    setFilterKey(nextFilterKey)
    setPage(1)
  }

  const url = historyListUrl({
    page,
    pageSize,
    search,
    sort,
    status: status === ALL ? undefined : status,
    classification: classification === ALL ? undefined : classification,
  })
  const { data, error, isLoading, isValidating, mutate } = useSWR<AltTextAssetList, AltTextApiError>(url, altTextFetcher, {
    keepPreviousData: true,
    revalidateOnFocus: false,
  })

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const filtered = search !== "" || classification !== ALL || status !== ALL
  const apiError = error?.apiError

  return (
    <Workbench>
      <div role="toolbar" aria-label="History filters" className="flex min-w-0 shrink-0 flex-col gap-2 rounded-lg border bg-card px-3 py-2 shadow-xs xl:flex-row xl:items-center">
        <div className="flex shrink-0 items-baseline gap-2">
          <h2 className="text-sm font-semibold">Saved Generations</h2>
          {data && <span className="text-xs tabular-nums text-muted-foreground">{total} total</span>}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by filename"
              aria-label="Search by filename"
              maxLength={200}
              className="h-8 pl-8"
            />
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:flex">
            <Select value={classification} onValueChange={setClassification}>
              <SelectTrigger className="w-full lg:w-44" aria-label="Filter by classification">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All classifications</SelectItem>
                {IMAGE_CLASSIFICATIONS.map((c) => (
                  <SelectItem key={c} value={c}>
                    {CLASSIFICATION_LABELS[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-full lg:w-36" aria-label="Filter by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All statuses</SelectItem>
                {ASSET_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={(v) => setSort(v as HistorySort)}>
              <SelectTrigger className="w-full lg:w-36" aria-label="Sort order">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest first</SelectItem>
                <SelectItem value="oldest">Oldest first</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <WorkbenchScroll label="Saved generations" className="rounded-lg border bg-card">
        {apiError && !data ? (
          <ErrorState
            title={apiError.status === 401 ? "Session expired" : apiError.status === 403 ? "Access denied" : "Could not load history"}
            message={apiError.message}
            onRetry={() => mutate()}
          />
        ) : isLoading && !data ? (
          <div className="flex flex-col gap-2 p-3" aria-busy="true" aria-label="Loading history">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <Empty className="py-12">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <History aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>{filtered ? "No matching records" : "No saved generations"}</EmptyTitle>
              <EmptyDescription>
                {filtered ? "Try a different filename or clear the filters." : "Alt text you generate and save will appear here."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div aria-busy={isValidating}>
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow className="bg-muted/40">
                  <TableHead className="w-16">Image</TableHead>
                  <TableHead>Filename</TableHead>
                  <TableHead>Classification</TableHead>
                  <TableHead>Language</TableHead>
                  <TableHead className="min-w-56">Short Alt Text</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last updated</TableHead>
                  <TableHead className="w-12 text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <AssetImage id={a.id} alt="" className="size-10 rounded-md border" />
                    </TableCell>
                    <TableCell className="max-w-48">
                      <button
                        type="button"
                        onClick={() => setDrawer({ id: a.id, focus: "view" })}
                        className="block max-w-full truncate text-left font-medium text-foreground hover:underline focus-visible:underline focus-visible:outline-none"
                        title={a.fileName}
                      >
                        {a.fileName}
                      </button>
                      {a.projectName && <span className="block truncate text-xs text-muted-foreground">{a.projectName}</span>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{classificationLabel(a.classification)}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{languageLabel(a.language)}</TableCell>
                    <TableCell className="max-w-72">
                      {a.shortAlt ? (
                        <p className="line-clamp-2 text-sm text-foreground" lang={a.language}>
                          {a.shortAlt}
                        </p>
                      ) : (
                        <span className="text-sm text-muted-foreground">{a.classification === "decorative" ? 'Decorative (alt="")' : "Not generated"}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={a.status} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm tabular-nums text-muted-foreground">
                      <time dateTime={a.updatedAt}>{formatDateTime(a.updatedAt)}</time>
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-8" aria-label={`Actions for ${a.fileName}`}>
                            <MoreHorizontal aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem onSelect={() => setDrawer({ id: a.id, focus: "view" })}>
                            <Eye aria-hidden="true" /> View
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setDrawer({ id: a.id, focus: "edit" })}>
                            <Pencil aria-hidden="true" /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setDrawer({ id: a.id, focus: "versions" })}>
                            <History aria-hidden="true" /> Version History
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => onOpenInEditor(a)}>
                            <SquarePen aria-hidden="true" /> Open in Editor
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Export saved version</DropdownMenuLabel>
                          {EXPORT_FORMATS.map((f) => (
                            <DropdownMenuItem key={f} onSelect={() => void exportAsset(a, f)}>
                              <Download aria-hidden="true" /> Export {f.toUpperCase()}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </WorkbenchScroll>

      {apiError && data && <p className="shrink-0 text-xs text-destructive" role="status">Refresh failed: {apiError.message}</p>}

      {total > 0 && (
          <nav aria-label="History pagination" className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-3">
              <span className="tabular-nums">
                Showing {(page - 1) * pageSize + 1}–{Math.min(total, page * pageSize)} of {total} record{total === 1 ? "" : "s"}
              </span>
              <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                <SelectTrigger size="sm" className="h-8 w-28" aria-label="Rows per page">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZES.map((s) => (
                    <SelectItem key={s} value={String(s)}>
                      {s} / page
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1 || isValidating} onClick={() => setPage(page - 1)}>
                <ChevronLeft aria-hidden="true" /> Previous
              </Button>
              <span className="tabular-nums">
                Page {page} of {pages}
              </span>
              <Button variant="outline" size="sm" disabled={page >= pages || isValidating} onClick={() => setPage(page + 1)}>
                Next <ChevronRight aria-hidden="true" />
              </Button>
            </div>
          </nav>
      )}

      <AltTextAssetDrawer
        assetId={drawer?.id ?? null}
        focus={drawer?.focus ?? "view"}
        onClose={() => setDrawer(null)}
        onOpenInEditor={(a) => {
          setDrawer(null)
          onOpenInEditor(a)
        }}
      />
    </Workbench>
  )
}
