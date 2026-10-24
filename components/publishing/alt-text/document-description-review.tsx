"use client"

/**
 * @file components/publishing/alt-text/document-description-review.tsx
 * @module Publishing · Alt Text
 * @kind Client component
 * @summary Phase 3 Task 14 — description review queue for one document: summary counts, server-side
 *   status filter + pagination, explicit selection with bulk start/approve/request-changes, and the
 *   per-occurrence review sheet. Approval never inserts alt text into the document.
 */
import { useState } from "react"
import useSWR from "swr"
import { toast } from "sonner"
import { ChevronLeft, ChevronRight, ClipboardCheck } from "lucide-react"
import { altTextFetcher, AltTextApiError } from "@/lib/alt-text/client"
import {
  BULK_MAX,
  COMMENT_CATEGORIES,
  COMMENT_MIN,
  DESCRIPTION_REVIEW_LABEL,
  GENERATION_LABEL,
  REVIEW_QUEUE_FILTERS,
  REVIEW_QUEUE_FILTER_LABEL,
  type BulkReviewAction,
  type CommentCategory,
  type ReviewQueueFilter,
  type ReviewQueueResponse,
  type ReviewQueueRow,
} from "@/lib/alt-text/document-approval-contract"
import { REVIEW_PAGE_SIZE, reviewQueueUrl, submitBulkReview } from "@/lib/alt-text/document-review-client"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { ErrorState } from "@/components/enterprise/data-state"
import { AssetImage, formatDateTime } from "./alt-text-history"
import { ReviewStatusBadge } from "./review-status-badge"
import { DocumentReviewSheet } from "./document-review-sheet"

const location = (r: ReviewQueueRow) =>
  r.slideNumber != null ? `Slide ${r.slideNumber}` : r.pageNumber != null ? `Page ${r.pageNumber}` : `Image ${r.occurrenceIndex + 1}`

const BULK_LABEL: Record<BulkReviewAction, string> = { start_review: "Start review", approve: "Approve", request_changes: "Request changes" }

export function DocumentDescriptionReview({ documentId }: { documentId: number }) {
  const [filter, setFilter] = useState<ReviewQueueFilter>("all")
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Map<number, number>>(new Map())
  const [openImage, setOpenImage] = useState<number | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [changesOpen, setChangesOpen] = useState(false)
  const [comment, setComment] = useState("")
  const [category, setCategory] = useState<CommentCategory>("general")

  const { data, error, isLoading, mutate } = useSWR<ReviewQueueResponse>(reviewQueueUrl(documentId, page, filter), altTextFetcher, { keepPreviousData: true })

  const rows = data?.rows ?? []
  const canReview = data?.permissions.canReview ?? false
  const totalPages = data ? Math.max(1, Math.ceil(data.total / REVIEW_PAGE_SIZE)) : 1
  const reviewable = rows.filter((r) => r.generationStatus === "completed")
  const allOnPage = reviewable.length > 0 && reviewable.every((r) => selected.has(r.imageId))

  const toggle = (r: ReviewQueueRow) =>
    setSelected((prev) => {
      const next = new Map(prev)
      if (next.has(r.imageId)) next.delete(r.imageId)
      else if (next.size < BULK_MAX) next.set(r.imageId, r.currentVersion)
      return next
    })

  const togglePage = () =>
    setSelected((prev) => {
      const next = new Map(prev)
      if (allOnPage) reviewable.forEach((r) => next.delete(r.imageId))
      else reviewable.forEach((r) => next.size < BULK_MAX && next.set(r.imageId, r.currentVersion))
      return next
    })

  async function runBulk(action: BulkReviewAction) {
    if (selected.size === 0) return
    if (action === "request_changes" && comment.trim().length < COMMENT_MIN) {
      toast.error(`Add a comment of at least ${COMMENT_MIN} characters.`)
      return
    }
    setBulkBusy(true)
    const items = [...selected].map(([imageId, expectedVersion]) => ({ imageId, expectedVersion }))
    const r = await submitBulkReview(documentId, {
      action,
      items,
      ...(action === "request_changes" ? { comment: comment.trim(), category } : {}),
    })
    setBulkBusy(false)
    if (!r.ok) {
      toast.error(r.error.message)
      return
    }
    const { accepted, skipped, rejected } = r.data
    const summary = `${BULK_LABEL[action]}: ${accepted} applied, ${skipped} unchanged, ${rejected} not applied`
    if (rejected > 0) toast.warning(summary, { description: r.data.outcomes.find((o) => o.result === "rejected")?.message })
    else toast.success(summary)
    setSelected(new Map())
    setChangesOpen(false)
    setComment("")
    void mutate()
  }

  if (error) {
    const message = error instanceof AltTextApiError ? error.apiError.message : "Could not load the review queue."
    return <ErrorState title="Review queue unavailable" message={message} onRetry={() => void mutate()} />
  }

  const s = data?.stats
  const stats: { label: string; value: number | undefined; tone?: string }[] = [
    { label: "Generated", value: s?.totalGenerated },
    { label: "Pending", value: s?.pending },
    { label: "In review", value: s?.inReview, tone: "text-sky-700" },
    { label: "Changes requested", value: s?.changesRequested, tone: "text-amber-700" },
    { label: "Approved", value: s?.approved, tone: "text-emerald-700" },
    { label: "Rejected", value: s?.rejected, tone: "text-red-700" },
    { label: "Ready for insertion", value: s?.insertionReady, tone: "text-emerald-700" },
  ]

  return (
    <section aria-labelledby={`review-${documentId}`} className="flex flex-col gap-3 rounded-md border p-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="size-4 text-muted-foreground" aria-hidden />
          <h3 id={`review-${documentId}`} className="text-sm font-semibold">
            Description review
          </h3>
        </div>
        <Select
          value={filter}
          onValueChange={(v) => {
            setFilter(v as ReviewQueueFilter)
            setPage(1)
          }}
        >
          <SelectTrigger className="h-8 w-48" aria-label="Filter by review status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REVIEW_QUEUE_FILTERS.map((f) => (
              <SelectItem key={f} value={f}>
                {REVIEW_QUEUE_FILTER_LABEL[f]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </header>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {stats.map((st) => (
          <div key={st.label} className="rounded-md bg-muted/50 px-2 py-1.5">
            <dt className="text-xs text-muted-foreground">{st.label}</dt>
            <dd className={`text-base font-semibold tabular-nums ${st.tone ?? ""}`}>{st.value ?? "—"}</dd>
          </div>
        ))}
      </dl>

      <p className="text-xs text-muted-foreground">
        Approval records which saved version is cleared for insertion. It does not modify the source document.
      </p>

      {canReview && selected.size > 0 ? (
        <div className="flex flex-col gap-2 rounded-md border border-sky-200 bg-sky-50/60 p-2" role="region" aria-label="Bulk review actions">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{selected.size} selected</span>
            <Button size="sm" variant="outline" disabled={bulkBusy} onClick={() => void runBulk("start_review")}>
              Start review
            </Button>
            <Button size="sm" disabled={bulkBusy} onClick={() => void runBulk("approve")}>
              Approve selected
            </Button>
            <Button size="sm" variant="outline" disabled={bulkBusy} onClick={() => setChangesOpen((o) => !o)} aria-expanded={changesOpen}>
              Request changes
            </Button>
            <Button size="sm" variant="ghost" disabled={bulkBusy} onClick={() => setSelected(new Map())}>
              Clear
            </Button>
          </div>
          {changesOpen ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`bulk-cat-${documentId}`} className="text-xs">
                    Category
                  </Label>
                  <Select value={category} onValueChange={(v) => setCategory(v as CommentCategory)}>
                    <SelectTrigger id={`bulk-cat-${documentId}`} className="h-8 w-56">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(COMMENT_CATEGORIES).map(([k, label]) => (
                        <SelectItem key={k} value={k}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Label htmlFor={`bulk-comment-${documentId}`} className="text-xs">
                Comment (required)
              </Label>
              <Textarea id={`bulk-comment-${documentId}`} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={400} rows={2} />
              <div>
                <Button size="sm" disabled={bulkBusy} onClick={() => void runBulk("request_changes")}>
                  Send change request
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {canReview ? (
                <TableHead className="w-8">
                  <input type="checkbox" aria-label="Select all reviewable on this page" checked={allOnPage} onChange={togglePage} disabled={reviewable.length === 0} />
                </TableHead>
              ) : null}
              <TableHead>Image</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Generation</TableHead>
              <TableHead>Review</TableHead>
              <TableHead>Short alt</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && !data
              ? Array.from({ length: 3 }, (_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={canReview ? 9 : 8}>
                      <Skeleton className="h-8 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              : null}
            {data && rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canReview ? 9 : 8} className="py-6 text-center text-sm text-muted-foreground">
                  No descriptions match this filter.
                </TableCell>
              </TableRow>
            ) : null}
            {rows.map((r) => (
              <TableRow key={r.imageId} data-state={selected.has(r.imageId) ? "selected" : undefined}>
                {canReview ? (
                  <TableCell>
                    <input
                      type="checkbox"
                      aria-label={`Select ${location(r)}`}
                      checked={selected.has(r.imageId)}
                      onChange={() => toggle(r)}
                      disabled={r.generationStatus !== "completed"}
                    />
                  </TableCell>
                ) : null}
                <TableCell>
                  <AssetImage id={r.assetId} alt="" className="size-10 rounded border object-cover" />
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm">
                  {location(r)}
                  {r.locationLabel ? <span className="block text-xs text-muted-foreground">{r.locationLabel}</span> : null}
                </TableCell>
                <TableCell className="text-sm">{GENERATION_LABEL[r.generationStatus]}</TableCell>
                <TableCell>
                  <ReviewStatusBadge status={r.reviewStatus} />
                  {r.approvalSuperseded ? <span className="mt-1 block text-xs text-amber-700">Edited after approval</span> : null}
                </TableCell>
                <TableCell className="max-w-64 truncate text-sm" title={r.shortAltPreview ?? undefined}>
                  {r.sourceDecorative ? <span className="text-muted-foreground">Decorative (source)</span> : r.shortAltPreview ?? <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="text-sm tabular-nums">
                  v{r.currentVersion}
                  {r.approvedVersion != null ? <span className="block text-xs text-muted-foreground">approved v{r.approvedVersion}</span> : null}
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(r.updatedAt)}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="outline" onClick={() => setOpenImage(r.imageId)} disabled={r.generationStatus !== "completed"}>
                    Review
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <nav className="flex items-center justify-between text-sm" aria-label="Review queue pagination">
        <span className="text-muted-foreground">
          {data ? `${data.total} ${data.total === 1 ? "occurrence" : "occurrences"} · ${DESCRIPTION_REVIEW_LABEL.approved.toLowerCase()} ${s?.approved ?? 0}` : ""}
        </span>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft className="size-4" />
          </Button>
          <span className="tabular-nums">
            {page} / {totalPages}
          </span>
          <Button size="icon" variant="ghost" aria-label="Next page" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </nav>

      <DocumentReviewSheet documentId={documentId} imageId={openImage} onOpenChange={(o) => !o && setOpenImage(null)} onChanged={() => void mutate()} />
    </section>
  )
}
