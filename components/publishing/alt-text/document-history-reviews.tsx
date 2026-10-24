"use client"

/**
 * @file components/publishing/alt-text/document-history-reviews.tsx
 * @module Publishing · Alt Text
 * @kind Client component
 * @summary Phase 3 Task 19 — per-image alt text history: pick an occurrence, then see its source
 *   alt text, approved version, latest review decision and every saved version (AI or manual).
 */
import { useState } from "react"
import useSWR from "swr"
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { altTextFetcher } from "@/lib/alt-text/client"
import {
  occurrenceHistoryUrl,
  occurrenceOptionsUrl,
  type OccurrenceHistoryResponse,
  type OccurrenceOptionsResponse,
  type OccurrenceVersion,
} from "@/lib/alt-text/document-history-contract"
import { actorLabel, Fact, fmtDateTime, GenericStatus } from "./document-history-labels"

const KIND_LABEL: Record<OccurrenceVersion["kind"], string> = { ai_generated: "AI generated", manual_edit: "Manual edit", other: "Saved version" }

export function DocumentHistoryReviews({ documentId, total }: { documentId: number; total: number }) {
  const [page, setPage] = useState(1)
  const [imageId, setImageId] = useState<number | null>(null)
  const options = useSWR<OccurrenceOptionsResponse>(total > 0 ? occurrenceOptionsUrl(documentId, page) : null, altTextFetcher, { revalidateOnFocus: false, keepPreviousData: true })
  const pages = options.data ? Math.max(1, Math.ceil(options.data.total / options.data.pageSize)) : 1

  if (total === 0) return <p className="text-sm text-muted-foreground">No image occurrences have been extracted from this document.</p>

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="history-occurrence">Image</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={imageId ? String(imageId) : ""} onValueChange={(v) => setImageId(Number(v))} disabled={!options.data}>
            <SelectTrigger id="history-occurrence" className="w-full sm:max-w-sm">
              <SelectValue placeholder={options.isLoading ? "Loading images…" : "Choose an image"} />
            </SelectTrigger>
            <SelectContent>
              {options.data?.items.map((o) => (
                <SelectItem key={o.id} value={String(o.id)}>
                  {`#${o.id} · ${o.label}${o.hasAsset ? "" : " · no alt text yet"}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {pages > 1 && (
            <div className="flex items-center gap-1">
              <Button size="icon" variant="outline" className="size-8" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                <ChevronLeft aria-hidden="true" />
                <span className="sr-only">Previous images</span>
              </Button>
              <span className="text-xs tabular-nums text-muted-foreground">{`${page} / ${pages}`}</span>
              <Button size="icon" variant="outline" className="size-8" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                <ChevronRight aria-hidden="true" />
                <span className="sr-only">Next images</span>
              </Button>
            </div>
          )}
        </div>
        {options.error && <p role="alert" className="text-xs text-destructive">{(options.error as Error).message}</p>}
      </div>

      {imageId ? <OccurrenceHistory documentId={documentId} imageId={imageId} /> : <p className="text-sm text-muted-foreground">Choose an image to see its alt text versions and review decisions.</p>}
    </div>
  )
}

function OccurrenceHistory({ documentId, imageId }: { documentId: number; imageId: number }) {
  const { data, error, isLoading, mutate } = useSWR<OccurrenceHistoryResponse>(occurrenceHistoryUrl(documentId, imageId), altTextFetcher, { revalidateOnFocus: false })
  if (isLoading) return <Skeleton className="h-48 w-full" />
  if (error || !data)
    return (
      <Alert variant="destructive">
        <AlertTriangle aria-hidden="true" />
        <AlertTitle>Could not load this image&apos;s history</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-2">
          {(error as Error | undefined)?.message ?? "Please try again."}
          <Button size="sm" variant="outline" onClick={() => mutate()}>
            <RefreshCw aria-hidden="true" /> Retry
          </Button>
        </AlertDescription>
      </Alert>
    )

  const o = data.occurrence
  const location = o.slideNumber ? `Slide ${o.slideNumber}` : o.pageNumber ? `Page ${o.pageNumber}` : o.sourceLocator
  return (
    <div className="flex flex-col gap-4">
      <dl>
        <Fact label="Location">{location}</Fact>
        <Fact label="Original alt text">{o.sourceAltText ? <q>{o.sourceAltText}</q> : <span className="text-muted-foreground">None in source</span>}</Fact>
        <Fact label="Review status"><GenericStatus status={o.reviewStatus} /></Fact>
        {o.reviewedAt && <Fact label="Last reviewed">{`${fmtDateTime(o.reviewedAt)} · ${actorLabel(o.reviewerName)}${o.reviewVersion ? ` · v${o.reviewVersion}` : ""}`}</Fact>}
        {o.reviewCategory && <Fact label="Review category">{o.reviewCategory.replace(/_/g, " ")}</Fact>}
        {o.reviewComment && <Fact label="Review comment">{o.reviewComment}</Fact>}
        <Fact label="Approved">
          {o.approvedDecorative
            ? "Marked decorative (empty alt)"
            : o.approvedVersion
              ? `Version ${o.approvedVersion}${o.approvedAt ? ` · ${fmtDateTime(o.approvedAt)}` : ""}${o.approvedByName ? ` · ${o.approvedByName}` : ""}`
              : "Not approved"}
        </Fact>
      </dl>

      <section aria-labelledby={`versions-${imageId}`} className="flex flex-col gap-2">
        <h3 id={`versions-${imageId}`} className="text-sm font-semibold text-foreground">{`Versions (${data.versions.length})`}</h3>
        {data.versions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No alt text has been generated or written for this image.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {data.versions.map((v) => (
              <li key={v.versionId} className={`flex flex-col gap-1.5 rounded-md border p-3 ${v.isApproved ? "border-emerald-600/40" : ""}`}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-medium text-foreground">{`v${v.version}`}</span>
                  <Badge variant="outline">{KIND_LABEL[v.kind]}</Badge>
                  {v.isApproved && (
                    <Badge variant="secondary" className="gap-1">
                      <CheckCircle2 className="size-3" aria-hidden="true" /> Approved
                    </Badge>
                  )}
                  {v.isReviewCandidate && !v.isApproved && <Badge variant="outline">Under review</Badge>}
                  {o.currentVersion === v.version && <Badge variant="outline">Current</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">{[fmtDateTime(v.createdAt), v.actorName, v.modelId].filter(Boolean).join(" · ")}</p>
                {v.shortAlt ? <p className="text-sm text-foreground text-pretty">{v.shortAlt}</p> : <p className="text-sm italic text-muted-foreground">Empty alt text</p>}
                {v.longDescription && (
                  <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer select-none">Long description</summary>
                    <p className="mt-1 whitespace-pre-wrap text-pretty">{v.longDescription}</p>
                  </details>
                )}
                {v.note && <p className="text-xs text-muted-foreground">{v.note}</p>}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}
