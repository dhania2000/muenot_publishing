"use client"

/**
 * @file components/publishing/alt-text/extracted-images-toolbar.tsx
 * @module Publishing
 * @kind React client component
 * @summary Server-side search, filters, sort and the gallery/table view switcher.
 */
import { LayoutGrid, Rows3, Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { IMAGE_SORTS, IMAGE_SORT_LABEL, SEARCH_MAX, type AltFilter, type ContextFilter, type ExtractionFilter, type ImageSort, type SelectionFilter } from "@/lib/alt-text/document-image-review"

export type ImageFilters = {
  search: string
  extraction: ExtractionFilter | "all"
  alt: AltFilter | "all"
  context: ContextFilter | "all"
  selection: SelectionFilter | "all"
  sort: ImageSort
}
export const DEFAULT_FILTERS: ImageFilters = { search: "", extraction: "all", alt: "all", context: "all", selection: "all", sort: "document" }
export type ImageView = "gallery" | "table"

type Option = { value: string; label: string }
const FILTERS: { key: Exclude<keyof ImageFilters, "search" | "sort">; label: string; options: Option[] }[] = [
  {
    key: "extraction",
    label: "Extraction",
    options: [
      { value: "all", label: "All" },
      { value: "extracted", label: "Extracted" },
      { value: "failed", label: "Failed" },
      { value: "unsupported", label: "Unsupported" },
    ],
  },
  {
    key: "alt",
    label: "Alt text",
    options: [
      { value: "all", label: "All" },
      { value: "has", label: "Has existing alt text" },
      { value: "missing", label: "Missing alt text" },
    ],
  },
  {
    key: "context",
    label: "Context",
    options: [
      { value: "all", label: "All" },
      { value: "ready", label: "Context ready" },
      { value: "unavailable", label: "Context unavailable" },
      { value: "needs_review", label: "Needs review" },
      { value: "not_analyzed", label: "Not analyzed" },
    ],
  },
  {
    key: "selection",
    label: "Selection",
    options: [
      { value: "all", label: "All" },
      { value: "selected", label: "Selected" },
      { value: "not_selected", label: "Not selected" },
    ],
  },
]

export function ExtractedImagesToolbar({
  filters,
  onChange,
  view,
  onViewChange,
  isPdf,
}: {
  filters: ImageFilters
  onChange: (next: ImageFilters) => void
  view: ImageView
  onViewChange: (v: ImageView) => void
  isPdf: boolean
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Label htmlFor="img-search">Search</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              id="img-search"
              type="search"
              className="pl-8"
              maxLength={SEARCH_MAX}
              placeholder="Image name, picture/shape name, document or source locator"
              value={filters.search}
              onChange={(e) => onChange({ ...filters, search: e.target.value })}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5 sm:w-56">
          <Label htmlFor="img-sort">Sort</Label>
          <Select value={filters.sort} onValueChange={(v) => onChange({ ...filters, sort: v as ImageSort })}>
            <SelectTrigger id="img-sort" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {IMAGE_SORTS.map((s) => (
                <SelectItem key={s} value={s}>
                  {IMAGE_SORT_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Tabs value={view} onValueChange={(v) => onViewChange(v as ImageView)}>
          <TabsList aria-label="Image view">
            <TabsTrigger value="gallery">
              <LayoutGrid aria-hidden="true" />
              Gallery
            </TabsTrigger>
            <TabsTrigger value="table">
              <Rows3 aria-hidden="true" />
              Table
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {FILTERS.map((f) => (
          <div key={f.key} className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor={`img-filter-${f.key}`}>{f.label}</Label>
            <Select value={filters[f.key]} onValueChange={(v) => onChange({ ...filters, [f.key]: v })}>
              <SelectTrigger id={`img-filter-${f.key}`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {f.options.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
      {isPdf && filters.sort === "document" && (
        <p className="text-xs text-muted-foreground">
          PDF order follows the page content stream, which is not necessarily the verified tagged reading order.
        </p>
      )}
    </div>
  )
}
