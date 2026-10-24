"use client"

/**
 * @file components/publishing/alt-text/document-review-sheet.tsx
 * @module Publishing · Alt Text
 * @kind Client component
 * @summary Phase 3 Task 14 — single-occurrence review: image + source context, editable draft (saved as
 *   a new immutable version), word diff against the original AI output, quality checks and the
 *   decision controls. Every save/decision is pinned to the version the reviewer loaded.
 */
import { useState } from "react"
import useSWR from "swr"
import { toast } from "sonner"
import { AlertTriangle, CheckCircle2, OctagonX } from "lucide-react"
import { altTextFetcher, AltTextApiError, isVersionConflict } from "@/lib/alt-text/client"
import {
  COMMENT_CATEGORIES,
  COMMENT_MAX,
  COMMENT_MIN,
  JUSTIFICATION_MIN,
  diffWords,
  hasBlocking,
  type CommentCategory,
  type ReviewAction,
  type ReviewDetailResponse,
} from "@/lib/alt-text/document-approval-contract"
import { reviewDetailUrl, saveReviewDraft, submitReviewDecision } from "@/lib/alt-text/document-review-client"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ErrorState } from "@/components/enterprise/data-state"
import { AssetImage, formatDateTime } from "./alt-text-history"
import { ReviewStatusBadge } from "./review-status-badge"

type Props = { documentId: number; imageId: number | null; onOpenChange: (open: boolean) => void; onChanged: () => void }

export function DocumentReviewSheet({ documentId, imageId, onOpenChange, onChanged }: Props) {
  return (
    <Sheet open={imageId != null} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-2xl">
        <SheetHeader className="border-b p-4">
          <SheetTitle>Review description</SheetTitle>
          <SheetDescription>Edit, then approve the exact saved version that should be inserted later.</SheetDescription>
        </SheetHeader>
        {imageId != null ? <ReviewBody key={imageId} documentId={documentId} imageId={imageId} onChanged={onChanged} /> : null}
      </SheetContent>
    </Sheet>
  )
}

function ReviewBody({ documentId, imageId, onChanged }: { documentId: number; imageId: number; onChanged: () => void }) {
  const { data, error, isLoading, mutate } = useSWR<ReviewDetailResponse>(reviewDetailUrl(documentId, imageId), altTextFetcher, { revalidateOnFocus: false })

  if (error) {
    const message = error instanceof AltTextApiError ? error.apiError.message : "Could not load this description."
    return (
      <div className="p-4">
        <ErrorState title="Unavailable" message={message} onRetry={() => void mutate()} />
      </div>
    )
  }
  if (isLoading || !data) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }
  return (
    <ReviewForm
      key={data.asset.currentVersion}
      data={data}
      documentId={documentId}
      imageId={imageId}
      onSaved={async () => {
        await mutate()
        onChanged()
      }}
    />
  )
}

function ReviewForm({ data, documentId, imageId, onSaved }: { data: ReviewDetailResponse; documentId: number; imageId: number; onSaved: () => Promise<void> }) {
  const { asset, occurrence, review, checks, permissions, originalAi, shortMaxChars } = data
  const [shortAlt, setShortAlt] = useState(asset.shortAlt ?? "")
  const [longDescription, setLongDescription] = useState(asset.longDescription ?? "")
  const [comment, setComment] = useState("")
  const [category, setCategory] = useState<CommentCategory>("general")
  const [decorative, setDecorative] = useState(false)
  const [justification, setJustification] = useState("")
  const [busy, setBusy] = useState(false)

  const dirty = shortAlt !== (asset.shortAlt ?? "") || longDescription !== (asset.longDescription ?? "")
  const blocking = hasBlocking(checks)
  const canDecide = permissions.canReview && !dirty && !busy

  async function handleConflict(message: string) {
    toast.error(message, { description: "The description changed since you opened it. Reloaded the latest version." })
    await onSaved()
  }

  async function saveDraft() {
    setBusy(true)
    const payload: { expectedVersion: number; shortAlt?: string; longDescription?: string } = { expectedVersion: asset.currentVersion }
    if (shortAlt !== (asset.shortAlt ?? "")) payload.shortAlt = shortAlt
    if (longDescription !== (asset.longDescription ?? "")) payload.longDescription = longDescription
    const r = await saveReviewDraft(documentId, imageId, payload)
    setBusy(false)
    if (!r.ok) return isVersionConflict(r.error) ? handleConflict(r.error.message) : void toast.error(r.error.message)
    toast.success(`Saved version ${r.data.currentVersion}`)
    await onSaved()
  }

  async function decide(action: ReviewAction) {
    if ((action === "request_changes" || action === "reject") && comment.trim().length < COMMENT_MIN) {
      toast.error(`Add a comment of at least ${COMMENT_MIN} characters.`)
      return
    }
    if (action === "approve" && decorative && justification.trim().length < JUSTIFICATION_MIN) {
      toast.error(`Explain why the image is decorative (at least ${JUSTIFICATION_MIN} characters).`)
      return
    }
    setBusy(true)
    const r = await submitReviewDecision(documentId, imageId, {
      action,
      expectedVersion: asset.currentVersion,
      ...(action === "request_changes" || action === "reject" ? { comment: comment.trim(), category } : {}),
      ...(action === "approve" && decorative ? { decorative: true, justification: justification.trim() } : {}),
    })
    setBusy(false)
    if (!r.ok) return isVersionConflict(r.error) ? handleConflict(r.error.message) : void toast.error(r.error.message)
    toast.success(r.data.changed ? "Review updated" : "No change — already in that state")
    await onSaved()
  }

  const diff = originalAi && originalAi.version !== asset.currentVersion ? diffWords(originalAi.shortAlt ?? "", asset.shortAlt ?? "") : null
  const location = occurrence.slideNumber != null ? `Slide ${occurrence.slideNumber}` : occurrence.pageNumber != null ? `Page ${occurrence.pageNumber}` : occurrence.sourceLocator

  return (
    <div className="flex flex-col gap-5 p-4">
      <div className="flex flex-col gap-3 sm:flex-row">
        <AssetImage id={asset.id} alt={asset.shortAlt ?? "Image under review"} className="max-h-56 w-full rounded-md border object-contain sm:w-56" />
        <div className="flex min-w-0 flex-1 flex-col gap-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <ReviewStatusBadge status={review.status} />
            <span className="text-muted-foreground">
              v{asset.currentVersion} · {location}
            </span>
          </div>
          <p className="truncate text-muted-foreground" title={occurrence.documentFilename}>
            {occurrence.documentFilename}
          </p>
          {occurrence.context?.caption ? (
            <p>
              <span className="font-medium">Caption: </span>
              {occurrence.context.caption}
            </p>
          ) : null}
          {occurrence.context?.heading ? (
            <p>
              <span className="font-medium">Heading: </span>
              {occurrence.context.heading}
            </p>
          ) : null}
          {review.approval ? (
            <p className={review.approval.superseded ? "text-amber-700" : "text-emerald-700"}>
              {review.approval.superseded ? "Approval superseded by a newer edit" : "Approved"} — v{review.approval.version}
              {review.approval.approvedBy ? ` by ${review.approval.approvedBy.name}` : ""}
              {review.approval.approvedAt ? `, ${formatDateTime(review.approval.approvedAt)}` : ""}
              {review.approval.decorative ? " (decorative)" : ""}
            </p>
          ) : null}
          {review.comment ? (
            <p className="rounded-md bg-muted px-2 py-1.5">
              <span className="font-medium">{review.category ? COMMENT_CATEGORIES[review.category] : "Reviewer note"}: </span>
              {review.comment}
            </p>
          ) : null}
        </div>
      </div>

      <section className="flex flex-col gap-2" aria-labelledby="draft-heading">
        <h4 id="draft-heading" className="text-sm font-semibold">
          Description
        </h4>
        <Label htmlFor="rv-short" className="flex justify-between text-xs">
          <span>Short alt text</span>
          <span className={shortAlt.length > shortMaxChars ? "text-red-700" : "text-muted-foreground"}>
            {shortAlt.length}/{shortMaxChars}
          </span>
        </Label>
        <Textarea id="rv-short" value={shortAlt} onChange={(e) => setShortAlt(e.target.value)} rows={2} readOnly={!permissions.canEdit} />
        <Label htmlFor="rv-long" className="text-xs">
          Long description
        </Label>
        <Textarea id="rv-long" value={longDescription} onChange={(e) => setLongDescription(e.target.value)} rows={5} readOnly={!permissions.canEdit} />
        {permissions.canEdit ? (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={!dirty || busy} onClick={() => void saveDraft()}>
              Save as new version
            </Button>
            {dirty ? <span className="text-xs text-amber-700">Unsaved edits — save before deciding.</span> : null}
          </div>
        ) : null}
        {diff ? (
          <div className="rounded-md border p-2 text-sm leading-relaxed">
            <p className="mb-1 text-xs font-medium text-muted-foreground">Changes from original AI (v{originalAi?.version})</p>
            {diff.map((p, i) =>
              p.type === "same" ? (
                <span key={i}>{p.text}</span>
              ) : p.type === "added" ? (
                <ins key={i} className="bg-emerald-100 text-emerald-900 no-underline">
                  {p.text}
                </ins>
              ) : (
                <del key={i} className="bg-red-100 text-red-900">
                  {p.text}
                </del>
              ),
            )}
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="checks-heading">
        <h4 id="checks-heading" className="text-sm font-semibold">
          Quality checks
        </h4>
        {checks.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-emerald-700">
            <CheckCircle2 className="size-4" aria-hidden /> No issues found.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {checks.map((c) => (
              <li key={c.code} className={`flex items-start gap-2 text-sm ${c.severity === "blocking" ? "text-red-700" : "text-amber-700"}`}>
                {c.severity === "blocking" ? <OctagonX className="mt-0.5 size-4 shrink-0" aria-hidden /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />}
                <span>
                  <span className="sr-only">{c.severity === "blocking" ? "Blocking: " : "Warning: "}</span>
                  {c.message}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {permissions.canReview ? (
        <section className="flex flex-col gap-3 border-t pt-4" aria-labelledby="decision-heading">
          <h4 id="decision-heading" className="text-sm font-semibold">
            Decision
          </h4>
          <div className="flex flex-col gap-1">
            <Label htmlFor="rv-cat" className="text-xs">
              Comment category
            </Label>
            <Select value={category} onValueChange={(v) => setCategory(v as CommentCategory)}>
              <SelectTrigger id="rv-cat" className="h-8 w-60">
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
          <Label htmlFor="rv-comment" className="text-xs">
            Comment (required for changes or rejection)
          </Label>
          <Textarea id="rv-comment" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={COMMENT_MAX} rows={2} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={decorative} onChange={(e) => setDecorative(e.target.checked)} />
            Approve as decorative (empty alt on insertion)
          </label>
          {decorative ? (
            <>
              <Label htmlFor="rv-just" className="text-xs">
                Justification
              </Label>
              <Textarea id="rv-just" value={justification} onChange={(e) => setJustification(e.target.value)} maxLength={COMMENT_MAX} rows={2} />
            </>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {review.status === "not_reviewed" ? (
              <Button size="sm" variant="outline" disabled={!canDecide} onClick={() => void decide("start_review")}>
                Start review
              </Button>
            ) : null}
            <Button size="sm" disabled={!canDecide || (blocking && !decorative)} onClick={() => void decide("approve")}>
              Approve v{asset.currentVersion}
            </Button>
            <Button size="sm" variant="outline" disabled={!canDecide} onClick={() => void decide("request_changes")}>
              Request changes
            </Button>
            <Button size="sm" variant="destructive" disabled={!canDecide} onClick={() => void decide("reject")}>
              Reject
            </Button>
          </div>
          {blocking && !decorative ? <p className="text-xs text-red-700">Resolve blocking checks before approving.</p> : null}
        </section>
      ) : null}
    </div>
  )
}
