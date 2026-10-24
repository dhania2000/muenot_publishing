"use client"

/**
 * @file components/publishing/alt-text/extracted-images-selection.tsx
 * @module Publishing
 * @kind React client components
 * @summary Selection controls (page / document-wide / clear), the table's tri-state page checkbox
 *   and server-side pagination for the extracted-image review workspace. Document-wide counts come
 *   from the persisted readiness summary, never from the loaded page.
 */
import { useEffect, useRef } from "react"
import { CheckCheck, ChevronLeft, ChevronRight, Loader2, SquareDashed, SquareMinus, SquarePlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { REVIEW_PAGE_SIZES, type ReadinessSummary } from "@/lib/alt-text/document-image-review"
import type { ImageReviewState } from "./use-image-review"

export function PageSelectCheckbox({ review }: { review: ImageReviewState }) {
  const ref = useRef<HTMLInputElement>(null)
  const eligibleOnPage = review.images.filter((i) => i.eligibility.eligible || i.selected).length
  const selectedOnPage = review.pageSelected.length
  const all = eligibleOnPage > 0 && selectedOnPage === eligibleOnPage
  const some = selectedOnPage > 0 && !all
  const busy = review.pendingIds.size > 0 || !!review.bulkPending
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = some
  }, [some])
  return (
    <label className="inline-flex cursor-pointer items-center">
      <input
        ref={ref}
        type="checkbox"
        className="size-4 accent-primary disabled:opacity-40"
        checked={all}
        disabled={!review.canManage || busy || eligibleOnPage === 0}
        onChange={() => (all || some ? review.deselectPage() : review.selectPage())}
      />
      <span className="sr-only">{all || some ? "Deselect eligible images on this page" : "Select eligible images on this page"}</span>
    </label>
  )
}

export function SelectionBar({ review, summary }: { review: ImageReviewState; summary: ReadinessSummary | null }) {
  const busy = review.pendingIds.size > 0 || !!review.bulkPending
  const disabled = !review.canManage || busy
  const selected = summary?.selectedOccurrences ?? 0
  const eligible = summary?.eligibleOccurrences ?? 0
  const spin = (a: string) => (review.bulkPending === a ? <Loader2 className="animate-spin" aria-hidden="true" /> : null)
  return (
    <div className="flex flex-col gap-3 rounded-md border bg-muted/30 px-3 py-2.5 lg:flex-row lg:items-center lg:justify-between">
      <p className="text-sm" aria-live="polite">
        <span className="font-semibold tabular-nums">{selected}</span>
        <span className="text-muted-foreground">{` of ${eligible} eligible image occurrence${eligible === 1 ? "" : "s"} selected in this document`}</span>
      </p>
      <div role="group" aria-label="Selection" className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={disabled || review.pageSelectable.length === 0} onClick={review.selectPage}>
          <SquarePlus aria-hidden="true" />
          {`Select page${review.pageSelectable.length ? ` (${review.pageSelectable.length})` : ""}`}
        </Button>
        <Button size="sm" variant="outline" disabled={disabled || review.pageSelected.length === 0} onClick={review.deselectPage}>
          <SquareMinus aria-hidden="true" />
          Deselect page
        </Button>
        <Button size="sm" variant="outline" disabled={disabled || eligible === 0 || selected === eligible} onClick={review.selectAllEligible}>
          {spin("select_all_eligible") ?? <CheckCheck aria-hidden="true" />}
          Select all eligible
        </Button>
        <Button size="sm" variant="ghost" disabled={disabled || selected === 0} onClick={review.clearSelection}>
          {spin("clear_selection") ?? <SquareDashed aria-hidden="true" />}
          Clear selection
        </Button>
      </div>
      {!review.canManage && <p className="text-xs text-muted-foreground lg:hidden">You can view images but not change their selection.</p>}
    </div>
  )
}

export function ImagePagination({ review }: { review: ImageReviewState }) {
  const { page, pageCount, pageSize, total } = review
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  return (
    <nav aria-label="Image pages" className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-xs text-muted-foreground tabular-nums">{`Showing ${from}–${to} of ${total} matching occurrence${total === 1 ? "" : "s"}`}</p>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Label htmlFor="img-page-size" className="text-xs font-normal text-muted-foreground">
            Per page
          </Label>
          <Select value={String(pageSize)} onValueChange={(v) => review.setPageSize(Number(v))}>
            <SelectTrigger id="img-page-size" size="sm" className="w-18">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REVIEW_PAGE_SIZES.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="outline" className="size-8" disabled={page <= 1} onClick={() => review.setPage(page - 1)}>
            <ChevronLeft aria-hidden="true" />
            <span className="sr-only">Previous page</span>
          </Button>
          <span className="min-w-20 text-center text-xs tabular-nums">{`Page ${page} of ${pageCount}`}</span>
          <Button size="icon" variant="outline" className="size-8" disabled={page >= pageCount} onClick={() => review.setPage(page + 1)}>
            <ChevronRight aria-hidden="true" />
            <span className="sr-only">Next page</span>
          </Button>
        </div>
      </div>
    </nav>
  )
}
