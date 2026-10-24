"use client"

/**
 * @file components/publishing/alt-text/use-image-review.ts
 * @module Publishing
 * @kind React hook
 * @summary Phase 3 Task 10 — state for the extracted-image review workspace: server-side filters,
 *   debounced search, pagination and view mode over one document's persisted occurrences, plus
 *   server-confirmed selection / source-review mutations. Nothing is applied optimistically: rows
 *   show a pending state until the PATCH resolves, then every cached list for the document is
 *   revalidated so the gallery, table, summary and duplicate lists stay consistent.
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import useSWR, { useSWRConfig } from "swr"
import { toast } from "sonner"
import { altTextFetcher, documentReviewImagesUrl, isPermissionError, updateDocumentImages } from "@/lib/alt-text/client"
import {
  REVIEW_PAGE_SIZES,
  SELECTION_BATCH_MAX,
  type DocumentReviewImagesResponse,
  type ImageMutationRequest,
  type ImageMutationResponse,
  type ReviewImageRecord,
  type ReviewStatus,
} from "@/lib/alt-text/document-image-review"
import { DEFAULT_FILTERS, type ImageFilters, type ImageView } from "./extracted-images-toolbar"

const SEARCH_DEBOUNCE_MS = 300

function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

export function useImageReview(documentId: number | null) {
  const [filters, setFiltersState] = useState<ImageFilters>(DEFAULT_FILTERS)
  const [view, setView] = useState<ImageView>("gallery")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSizeState] = useState<number>(REVIEW_PAGE_SIZES[1])
  const [pendingIds, setPendingIds] = useState<ReadonlySet<number>>(new Set())
  const [bulkPending, setBulkPending] = useState<ImageMutationRequest["action"] | null>(null)
  const [canManage, setCanManage] = useState(true)
  const search = useDebounced(filters.search.trim(), SEARCH_DEBOUNCE_MS)

  // Switching documents resets the view onto the new document's persisted state.
  useEffect(() => {
    setFiltersState(DEFAULT_FILTERS)
    setPage(1)
    setPendingIds(new Set())
  }, [documentId])

  useEffect(() => setPage(1), [search])

  const setFilters = useCallback(
    (next: ImageFilters) => {
      const onlySearch = (Object.keys(next) as (keyof ImageFilters)[]).every((k) => k === "search" || next[k] === filters[k])
      if (!onlySearch) setPage(1)
      setFiltersState(next)
    },
    [filters],
  )

  const setPageSize = useCallback((n: number) => {
    setPageSizeState(n)
    setPage(1)
  }, [])

  const key = documentId
    ? documentReviewImagesUrl(documentId, {
        page,
        pageSize,
        sort: filters.sort,
        search,
        ...(filters.extraction !== "all" ? { extraction: filters.extraction } : {}),
        ...(filters.alt !== "all" ? { alt: filters.alt } : {}),
        ...(filters.context !== "all" ? { context: filters.context } : {}),
        ...(filters.selection !== "all" ? { selection: filters.selection } : {}),
      })
    : null

  const list = useSWR<DocumentReviewImagesResponse>(key, altTextFetcher, { revalidateOnFocus: false, keepPreviousData: true })
  const data = list.data && documentId && list.data.documentId === documentId ? list.data : undefined
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  // A mutation or filter can shrink the result set; never stay on a page past the end.
  useEffect(() => {
    if (data && page > pageCount) setPage(pageCount)
  }, [data, page, pageCount])

  const { mutate } = useSWRConfig()
  const revalidateDocument = useCallback(() => {
    if (!documentId) return Promise.resolve()
    const prefix = `/api/alt-text/documents/${documentId}/images`
    return mutate((k) => typeof k === "string" && k.startsWith(prefix)).then(() => undefined)
  }, [documentId, mutate])

  const run = useCallback(
    async (body: ImageMutationRequest, ids: number[]): Promise<ImageMutationResponse | null> => {
      if (!documentId || !canManage) return null
      const targetDoc = documentId
      if (ids.length) setPendingIds((s) => new Set([...s, ...ids]))
      else setBulkPending(body.action)
      const r = await updateDocumentImages(targetDoc, body)
      if (ids.length)
        setPendingIds((s) => {
          const next = new Set(s)
          for (const id of ids) next.delete(id)
          return next
        })
      else setBulkPending(null)
      await revalidateDocument()
      if (!r.ok) {
        if (isPermissionError(r.error)) setCanManage(false)
        toast.error(body.action === "set_review" ? "Review status was not saved" : "Selection was not updated", { description: r.error.message })
        return null
      }
      const skipped = r.data.ineligible.length + r.data.notFound.length
      if (skipped > 0) {
        toast.warning(`${plural(skipped, "image")} could not be updated`, {
          description: [
            r.data.ineligible.length ? `${r.data.ineligible.length} no longer eligible for processing.` : "",
            r.data.notFound.length ? `${r.data.notFound.length} no longer exist in this document.` : "",
          ]
            .filter(Boolean)
            .join(" "),
        })
      }
      return r.data
    },
    [documentId, canManage, revalidateDocument],
  )

  const images = useMemo(() => data?.images ?? [], [data])
  const pageSelectable = images.filter((i) => i.eligibility.eligible && !i.selected).map((i) => i.id)
  const pageSelected = images.filter((i) => i.selected).map((i) => i.id)

  const toggle = useCallback((img: ReviewImageRecord, next: boolean) => void run({ action: next ? "select" : "deselect", imageIds: [img.id] }, [img.id]), [run])

  const selectPage = useCallback(async () => {
    const ids = pageSelectable.slice(0, SELECTION_BATCH_MAX)
    if (!ids.length) return
    const r = await run({ action: "select", imageIds: ids }, ids)
    if (r) toast.success(`Selected ${plural(r.applied.length, "image")} on this page`)
  }, [pageSelectable, run])

  const deselectPage = useCallback(async () => {
    const ids = pageSelected.slice(0, SELECTION_BATCH_MAX)
    if (!ids.length) return
    const r = await run({ action: "deselect", imageIds: ids }, ids)
    if (r) toast.success(`Deselected ${plural(r.applied.length, "image")} on this page`)
  }, [pageSelected, run])

  const selectAllEligible = useCallback(async () => {
    const r = await run({ action: "select_all_eligible" }, [])
    if (r) toast.success(`${plural(r.summary.selectedOccurrences, "eligible image")} selected in this document`)
  }, [run])

  const clearSelection = useCallback(async () => {
    const r = await run({ action: "clear_selection" }, [])
    if (r) toast.success("Selection cleared for this document")
  }, [run])

  const setReview = useCallback(
    async (img: ReviewImageRecord, status: ReviewStatus) => (await run({ action: "set_review", imageIds: [img.id], reviewStatus: status }, [img.id])) != null,
    [run],
  )

  return {
    list,
    data,
    images,
    total,
    filters,
    setFilters,
    view,
    setView,
    page,
    setPage,
    pageSize,
    setPageSize,
    pageCount,
    pendingIds,
    bulkPending,
    canManage,
    pageSelectable,
    pageSelected,
    toggle,
    selectPage,
    deselectPage,
    selectAllEligible,
    clearSelection,
    setReview,
    revalidateDocument,
  }
}

export type ImageReviewState = ReturnType<typeof useImageReview>
