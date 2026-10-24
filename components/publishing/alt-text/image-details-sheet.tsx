"use client"

/**
 * @file components/publishing/alt-text/image-details-sheet.tsx
 * @module Publishing
 * @kind React client component
 * @summary Image preview/details drawer: secure full preview, persisted source metadata,
 *   eligibility, source-review controls and the occurrences sharing the same binary (fetched
 *   from the list endpoint with a mediaSha256 filter — same tenant and document only).
 *   Never calls an AI provider; context is shown via the existing Task 9 context sheet.
 */
import { useState } from "react"
import useSWR from "swr"
import { AlertTriangle, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { altTextFetcher, documentReviewImagesUrl } from "@/lib/alt-text/client"
import {
  ELIGIBILITY_WARNINGS,
  INELIGIBLE_REASONS,
  REVIEW_STATUSES,
  REVIEW_STATUS_LABEL,
  existingAltText,
  type ReviewImageRecord,
  type ReviewImagesResponse,
  type ReviewStatus,
} from "@/lib/alt-text/document-image-review"
import { ContextBadge, ExtractionBadge, ImageThumb, ReviewBadge, dimensionsLabel, formatLabel, imageTypeLabel, locationLabel, sourceName } from "./image-review-ui"

export type DetailsTarget = { img: ReviewImageRecord; focus: "details" | "duplicates" }

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}

function Occurrences({ img, onOpen }: { img: ReviewImageRecord; onOpen: (o: ReviewImageRecord) => void }) {
  const key = img.mediaSha256 ? documentReviewImagesUrl(img.documentId, { mediaSha256: img.mediaSha256, page: 1, pageSize: 48, sort: "document" }) : null
  const { data, error, isLoading } = useSWR<ReviewImagesResponse>(key, altTextFetcher, { revalidateOnFocus: false })
  if (isLoading) return <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" aria-hidden="true" />Loading occurrences…</p>
  if (error) return <p className="text-xs text-destructive">Could not load occurrences.</p>
  const list = data?.images ?? []
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        {`The same image file (identical SHA-256) appears in ${data?.total ?? list.length} locations in this document. Each occurrence keeps its own context, selection and future description — nothing is copied between them.`}
      </p>
      <ul className="flex flex-col divide-y rounded-md border">
        {list.map((o) => (
          <li key={o.id} className="flex items-center gap-3 p-2">
            <div className="flex min-w-0 flex-1 flex-col gap-1 text-xs">
              <span className="font-medium">{`${locationLabel(o)}${o.id === img.id ? " (this occurrence)" : ""}`}</span>
              <span className="truncate text-muted-foreground" title={o.documentFilename}>{`#${o.id} · ${o.documentFilename}`}</span>
              <div className="flex flex-wrap gap-1">
                <ContextBadge img={o} />
                <span className="text-muted-foreground">{existingAltText(o) ? "Has alt text" : "No alt text"}</span>
                <span className="text-muted-foreground">{o.selected ? "· Selected" : "· Not selected"}</span>
              </div>
            </div>
            {o.id !== img.id && (
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onOpen(o)}>
                Open
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function ImageDetailsSheet({
  target,
  onClose,
  onOpen,
  onContext,
  onReview,
  canManage,
}: {
  target: DetailsTarget | null
  onClose: () => void
  onOpen: (t: DetailsTarget) => void
  onContext: (img: ReviewImageRecord) => void
  onReview: (img: ReviewImageRecord, status: ReviewStatus) => Promise<boolean>
  canManage: boolean
}) {
  const img = target?.img ?? null
  const [saving, setSaving] = useState<ReviewStatus | null>(null)
  const alt = img ? existingAltText(img) : null

  async function review(status: ReviewStatus) {
    if (!img || saving) return
    setSaving(status)
    const ok = await onReview(img, status)
    setSaving(null)
    if (ok) onOpen({ img: { ...img, reviewStatus: status }, focus: target?.focus ?? "details" })
  }

  return (
    <Sheet open={!!img} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        {img && (
          <>
            <SheetHeader>
              <SheetTitle className="truncate">{sourceName(img)}</SheetTitle>
              <SheetDescription>{`${img.documentFilename} · ${locationLabel(img)}`}</SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-5 px-4 pb-6">
              <ImageThumb img={img} fit="contain" className="max-h-80 min-h-40 w-full rounded-md border" />
              {img.extractionStatus === "unsupported" && (
                <p className="flex items-start gap-2 rounded-md border border-amber-600/30 bg-amber-50 p-2 text-xs text-amber-800">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  {img.extractionErrorMessage ?? "This image format cannot be previewed or processed."}
                </p>
              )}
              <dl className="flex flex-col gap-2">
                <Row label="Occurrence ID">{`#${img.id}`}</Row>
                <Row label="Asset ID">{img.altTextAssetId ? `#${img.altTextAssetId}` : "—"}</Row>
                <Row label="Resource name">{img.sourceMetadata?.pdf?.resourceName ?? img.sourceMetadata?.mediaPart ?? "—"}</Row>
                <Row label="Picture / shape">{img.sourceMetadata?.name ?? img.sourceMetadata?.title ?? "—"}</Row>
                <Row label="Source locator">
                  <span className="font-mono text-xs">{img.sourceLocator}</span>
                </Row>
                <Row label="Format">{formatLabel(img)}</Row>
                <Row label="Dimensions">{dimensionsLabel(img) ?? "Not recorded"}</Row>
                <Row label="Image type">{imageTypeLabel(img)}</Row>
                <Row label="Decorative">{img.isDecorative ? "Marked decorative in source" : "Not marked"}</Row>
                <Row label="Extraction">
                  <div className="flex flex-col gap-1">
                    <ExtractionBadge img={img} />
                    {img.extractionErrorMessage && <span className="text-xs text-muted-foreground">{img.extractionErrorMessage}</span>}
                  </div>
                </Row>
                <Row label="Context">
                  <div className="flex flex-col items-start gap-1">
                    <ContextBadge img={img} />
                    <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => onContext(img)}>
                      Open document context
                    </Button>
                  </div>
                </Row>
              </dl>

              <section aria-labelledby="existing-alt" className="flex flex-col gap-1.5">
                <h3 id="existing-alt" className="text-sm font-semibold">
                  Existing alt text (from source)
                </h3>
                {alt ? (
                  <blockquote className="whitespace-pre-wrap rounded-md border-l-2 bg-muted/50 p-2 text-sm">{alt}</blockquote>
                ) : (
                  <p className="text-sm text-muted-foreground">None in the source document.</p>
                )}
              </section>

              <section aria-labelledby="eligibility" className="flex flex-col gap-1.5">
                <h3 id="eligibility" className="text-sm font-semibold">
                  {img.eligibility.eligible ? "Eligible for future generation" : "Not eligible for generation"}
                </h3>
                <ul className="flex flex-col gap-1 text-xs">
                  {img.eligibility.reasons.map((r) => (
                    <li key={r} className="text-destructive">
                      {INELIGIBLE_REASONS[r]}
                    </li>
                  ))}
                  {img.eligibility.warnings.map((w) => (
                    <li key={w} className="text-muted-foreground">
                      {ELIGIBILITY_WARNINGS[w]}
                    </li>
                  ))}
                </ul>
              </section>

              <section aria-labelledby="source-review" className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 id="source-review" className="text-sm font-semibold">
                    Source review
                  </h3>
                  <ReviewBadge img={img} />
                </div>
                <p className="text-xs text-muted-foreground">Records that the source image and context were inspected. This is not alt text approval.</p>
                <div role="group" aria-label="Set review status" className="flex flex-wrap gap-2">
                  {REVIEW_STATUSES.map((s) => (
                    <Button
                      key={s}
                      size="sm"
                      variant={img.reviewStatus === s ? "default" : "outline"}
                      aria-pressed={img.reviewStatus === s}
                      disabled={!canManage || !!saving}
                      onClick={() => review(s)}
                    >
                      {saving === s && <Loader2 className="animate-spin" aria-hidden="true" />}
                      {REVIEW_STATUS_LABEL[s]}
                    </Button>
                  ))}
                </div>
              </section>

              {img.duplicateCount != null && img.duplicateCount > 1 && (
                <>
                  <Separator />
                  <section aria-labelledby="occurrences" className="flex flex-col gap-2">
                    <h3 id="occurrences" className="text-sm font-semibold">{`Used in ${img.duplicateCount} locations`}</h3>
                    <Occurrences img={img} onOpen={(o) => onOpen({ img: o, focus: "duplicates" })} />
                  </section>
                </>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
