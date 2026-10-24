"use client"

/**
 * @file components/publishing/alt-text/image-review-ui.tsx
 * @module Publishing
 * @kind React client helpers
 * @summary Shared labels, badges, thumbnail and selection checkbox for the extracted-image
 *   gallery, table and details sheet. All values come from persisted occurrence records.
 */
import { FileWarning, ImageOff, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { CONTEXT_STATE_LABEL, REVIEW_STATUS_LABEL, contextState, type ReviewImageRecord } from "@/lib/alt-text/document-image-review"
import { AssetImage } from "./alt-text-history"
import { StatusBadge } from "./document-upload-status"

export function locationLabel(img: ReviewImageRecord) {
  if (img.slideNumber != null) return `Slide ${img.slideNumber}`
  if (img.pageNumber != null) {
    const label = img.sourceMetadata?.pdf?.pageLabel
    return label && label !== String(img.pageNumber) ? `Page ${img.pageNumber} (${label})` : `Page ${img.pageNumber}`
  }
  // DOCX has no reliable page numbers; use structural order instead of fabricating one.
  return `Position ${img.occurrenceIndex + 1}`
}

export function sourceName(img: ReviewImageRecord) {
  const m = img.sourceMetadata
  return m?.name || m?.pdf?.resourceName || m?.mediaPart?.split("/").pop() || `Image ${img.occurrenceIndex + 1}`
}

export function formatLabel(img: ReviewImageRecord) {
  const mime = img.assetMimeType ?? img.sourceMetadata?.detectedFormat ?? null
  if (!mime) return "Unknown"
  return mime.replace(/^image\//, "").toUpperCase()
}

export function imageTypeLabel(img: ReviewImageRecord) {
  if (img.isDecorative) return "Decorative candidate"
  const pdf = img.sourceMetadata?.pdf
  if (pdf?.classification === "likely_scanned_page") return "Likely scanned page"
  if (pdf?.kind === "inline") return "Inline image"
  return "Embedded image"
}

export function dimensionsLabel(img: ReviewImageRecord) {
  const e = img.sourceMetadata?.pdf?.encoding
  return e?.pixelWidth && e?.pixelHeight ? `${e.pixelWidth} × ${e.pixelHeight} px` : null
}

const EXTRACTION_TONE = { pending: "info", extracted: "success", failed: "danger", unsupported: "warning" } as const
const EXTRACTION_LABEL = { pending: "Pending", extracted: "Extracted", failed: "Failed", unsupported: "Unsupported" } as const

export function ExtractionBadge({ img }: { img: ReviewImageRecord }) {
  return <StatusBadge tone={EXTRACTION_TONE[img.extractionStatus]}>{EXTRACTION_LABEL[img.extractionStatus]}</StatusBadge>
}

const CONTEXT_TONE = { ready: "success", unavailable: "neutral", needs_review: "warning", not_analyzed: "neutral" } as const

export function ContextBadge({ img }: { img: ReviewImageRecord }) {
  const s = contextState(img.contextStatus, img.contextConfidence)
  return <StatusBadge tone={CONTEXT_TONE[s]}>{CONTEXT_STATE_LABEL[s]}</StatusBadge>
}

const REVIEW_TONE = { not_reviewed: "neutral", reviewed: "success", needs_attention: "warning" } as const

export function ReviewBadge({ img }: { img: ReviewImageRecord }) {
  return <StatusBadge tone={REVIEW_TONE[img.reviewStatus]}>{REVIEW_STATUS_LABEL[img.reviewStatus]}</StatusBadge>
}

/** Lazy, scan-gated thumbnail. Failed / unsupported occurrences never request a binary. */
export function ImageThumb({ img, className, fit = "cover" }: { img: ReviewImageRecord; className?: string; fit?: "cover" | "contain" }) {
  const label = `${sourceName(img)}, ${locationLabel(img)}`
  if (img.extractionStatus !== "extracted" || !img.altTextAssetId) {
    const unsupported = img.extractionStatus === "unsupported"
    const pending = img.extractionStatus === "pending"
    return (
      <div
        role="img"
        aria-label={`${label}: ${unsupported ? "unsupported format, no preview" : pending ? "extraction pending" : "preview unavailable"}`}
        className={cn("flex flex-col items-center justify-center gap-1 bg-muted text-center text-muted-foreground", className)}
      >
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : unsupported ? <FileWarning className="size-4" aria-hidden="true" /> : <ImageOff className="size-4" aria-hidden="true" />}
        <span className="px-1 text-[10px] font-medium leading-tight">{unsupported ? "Unsupported" : pending ? "Pending" : "No preview"}</span>
      </div>
    )
  }
  return <AssetImage id={img.altTextAssetId} alt={label} className={cn(className, fit === "contain" && "!object-contain")} />
}

export function SelectCheckbox({
  img,
  pending,
  onChange,
  disabled,
}: {
  img: ReviewImageRecord
  pending: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
}) {
  const blocked = !img.eligibility.eligible
  const reason = blocked ? img.eligibility.reasons.map((r) => r.replace(/_/g, " ").toLowerCase()).join(", ") : null
  return (
    <label className={cn("inline-flex items-center", blocked || disabled ? "cursor-not-allowed" : "cursor-pointer")} title={reason ? `Not eligible: ${reason}` : undefined}>
      <input
        type="checkbox"
        className="size-4 accent-primary disabled:opacity-40"
        checked={img.selected}
        disabled={(blocked && !img.selected) || pending || disabled}
        aria-busy={pending}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="sr-only">{`${img.selected ? "Deselect" : "Select"} ${sourceName(img)}, ${locationLabel(img)}${reason ? ` (not eligible: ${reason})` : ""}`}</span>
    </label>
  )
}
