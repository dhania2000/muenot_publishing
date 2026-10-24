"use client"

/**
 * @file components/publishing/alt-text/extracted-images-gallery.tsx
 * @module Publishing
 * @kind React client component
 * @summary Responsive thumbnail gallery of one page of occurrences. Thumbnails lazy-load from the
 *   scan-gated asset route with preserved aspect ratio; failed/unsupported rows show placeholders.
 */
import { Copy, FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { existingAltText, type ReviewImageRecord } from "@/lib/alt-text/document-image-review"
import { ExtractionBadge, ImageThumb, ReviewBadge, SelectCheckbox, formatLabel, locationLabel, sourceName } from "./image-review-ui"

export type ImageRowActions = {
  pendingIds: ReadonlySet<number>
  canManage: boolean
  onToggle: (img: ReviewImageRecord, next: boolean) => void
  onDetails: (img: ReviewImageRecord) => void
  onContext: (img: ReviewImageRecord) => void
  onDuplicates: (img: ReviewImageRecord) => void
}

export function DuplicateIndicator({ img, onClick }: { img: ReviewImageRecord; onClick: () => void }) {
  if (!img.duplicateCount || img.duplicateCount < 2) return null
  return (
    <Button variant="link" size="sm" className="h-auto gap-1 p-0 text-xs text-muted-foreground" onClick={onClick}>
      <Copy className="size-3" aria-hidden="true" />
      {`Used in ${img.duplicateCount} locations`}
    </Button>
  )
}

export function ExtractedImagesGallery({ images, actions }: { images: ReviewImageRecord[]; actions: ImageRowActions }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {images.map((img) => {
        const alt = existingAltText(img)
        const failed = img.extractionStatus === "failed" || img.extractionStatus === "unsupported"
        return (
          <li key={img.id}>
            <article
              aria-label={`${sourceName(img)}, ${locationLabel(img)}`}
              className={cn(
                "flex h-full flex-col overflow-hidden rounded-lg border bg-card text-card-foreground",
                img.selected && "border-primary ring-1 ring-primary",
                failed && "border-dashed",
              )}
            >
              <div className="relative">
                <button type="button" className="block w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => actions.onDetails(img)}>
                  <ImageThumb img={img} fit="contain" className="aspect-[4/3] w-full" />
                  <span className="sr-only">{`View details for ${sourceName(img)}`}</span>
                </button>
                <div className="absolute left-2 top-2 rounded bg-background/90 p-1 shadow-sm">
                  <SelectCheckbox img={img} pending={actions.pendingIds.has(img.id)} disabled={!actions.canManage} onChange={(v) => actions.onToggle(img, v)} />
                </div>
              </div>
              <div className="flex flex-1 flex-col gap-2 p-3">
                <div className="flex min-w-0 flex-col">
                  <p className="truncate text-sm font-medium" title={sourceName(img)}>
                    {sourceName(img)}
                  </p>
                  <p className="text-xs text-muted-foreground">{`${locationLabel(img)} · ${formatLabel(img)}`}</p>
                </div>
                <div className="flex flex-wrap gap-1">
                  <ExtractionBadge img={img} />
                  <ReviewBadge img={img} />
                </div>
                <p className={cn("flex items-center gap-1 text-xs", alt ? "text-foreground" : "text-muted-foreground")}>
                  <FileText className="size-3 shrink-0" aria-hidden="true" />
                  {alt ? "Has existing alt text" : "No existing alt text"}
                </p>
                <DuplicateIndicator img={img} onClick={() => actions.onDuplicates(img)} />
                <div className="mt-auto flex gap-2 pt-1">
                  <Button size="sm" variant="outline" className="h-7 flex-1 text-xs" onClick={() => actions.onDetails(img)}>
                    Details
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 flex-1 text-xs" onClick={() => actions.onContext(img)}>
                    Context
                  </Button>
                </div>
              </div>
            </article>
          </li>
        )
      })}
    </ul>
  )
}
