"use client"

/**
 * @file components/publishing/alt-text/extracted-images-panel.tsx
 * @module Publishing
 * @kind React client component
 * @summary Phase 3 Task 10 — extracted image review workspace. Runs PDF/PPTX extraction and
 *   context analysis for a security-cleared document, then lets users browse its persisted image
 *   occurrences (gallery or table) with server-side search, filters, sort and pagination, inspect
 *   each one, and persist which eligible occurrences are selected for future alt text generation.
 *   Generation itself stays disabled until Tasks 11–12 consume the selection snapshot.
 */
import { useCallback, useRef, useState } from "react"
import useSWR from "swr"
import { toast } from "sonner"
import { CheckCircle2, Download, FileSearch, FileStack, FileUp, Hourglass, ImageIcon, Images, ListChecks, Loader2, ScanSearch, SearchX, Sparkles, XCircle, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  altTextFetcher,
  analyzeDocumentContext,
  cancelDocumentPreparation,
  describeBatchError,
  documentListUrl,
  documentStatusUrl,
  generateDocumentAltText,
  newIdempotencyKey,
  startDocumentPreparation,
} from "@/lib/alt-text/client"
import { AccessibleDocumentSheet } from "./accessible-document-sheet"
import { isAccessibleExportFormat } from "@/lib/alt-text/docx-export-contract"
import { DocumentPreparationStatus } from "./document-preparation-status"
import { useDocumentPreparation } from "./use-document-preparation"
import type { ReviewImageRecord } from "@/lib/alt-text/document-image-review"
import type { DocumentListResponse, DocumentRecord } from "@/lib/alt-text/document-records"
import { DocumentContextSheet, type ContextSheetTarget } from "./document-context-sheet"
import { ExtractedImagesGallery, type ImageRowActions } from "./extracted-images-gallery"
import { ImagePagination, PageSelectCheckbox, SelectionBar } from "./extracted-images-selection"
import { ExtractedImagesTable } from "./extracted-images-table"
import { DEFAULT_FILTERS, ExtractedImagesToolbar } from "./extracted-images-toolbar"
import { ImageDetailsSheet, type DetailsTarget } from "./image-details-sheet"
import { ImageReadinessSummary } from "./image-readiness-summary"
import { locationLabel, sourceName } from "./image-review-ui"
import { useImageReview } from "./use-image-review"

const EXTRACTABLE = new Set(["pdf", "pptx"])
const REVIEWABLE = new Set(["pdf", "pptx", "docx"])
const isExtractable = (d: DocumentRecord) => d.extractionReady && EXTRACTABLE.has(d.documentType) && d.processingStatus !== "extracting"
const CONTEXT_READY = new Set(["extracted", "partially_extracted", "failed", "unsupported"])

const LATER: { label: string; icon: LucideIcon }[] = [
  { label: "Review Descriptions", icon: ListChecks },
  { label: "Export Results", icon: FileUp },
]
const LATER_NOTE = "Available in a later phase of document processing."

function SummaryTile({ label, icon: Icon, value }: { label: string; icon: LucideIcon; value: number | null }) {
  return (
    <li>
      <Card className="gap-2 py-4">
        <CardContent className="flex flex-col gap-2 px-4">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Icon className="size-4" aria-hidden="true" />
            {label}
          </div>
          <p className="text-2xl font-semibold tabular-nums text-foreground">{value ?? "—"}</p>
        </CardContent>
      </Card>
    </li>
  )
}

function LaterButton({ label, icon: Icon, note = LATER_NOTE }: { label: string; icon: LucideIcon; note?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Button variant="outline" size="sm" disabled>
            <Icon aria-hidden="true" />
            {label}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{note}</TooltipContent>
    </Tooltip>
  )
}

export type DocumentOpenRequest = { id: number; nonce: number }

export function ExtractedImagesPanel({ openRequest }: { openRequest?: DocumentOpenRequest | null } = {}) {
  const docs = useSWR<DocumentListResponse>(documentListUrl(1, 100), altTextFetcher, { revalidateOnFocus: false })
  const [selected, setSelected] = useState<string>("")
  const [running, setRunning] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [generating, setGenerating] = useState(false)
  const generationKey = useRef<string | null>(null)
  const [contextTarget, setContextTarget] = useState<ContextSheetTarget | null>(null)
  const [details, setDetails] = useState<DetailsTarget | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [handledNonce, setHandledNonce] = useState(0)
  if (openRequest && openRequest.nonce !== handledNonce) {
    setHandledNonce(openRequest.nonce)
    setSelected(String(openRequest.id))
    setDetails(null)
    setContextTarget(null)
  }
  const documentId = selected ? Number(selected) : null
  const listed = docs.data?.documents.find((d) => d.id === documentId) ?? null
  // Documents opened from history may be older than the first page of the list; load that record directly.
  const single = useSWR<{ document: DocumentRecord }>(documentId && docs.data && !listed ? documentStatusUrl(String(documentId)) : null, altTextFetcher, { revalidateOnFocus: false })
  const doc = listed ?? single.data?.document ?? null
  const review = useImageReview(documentId)
  const { data } = review
  const counts = data?.counts ?? null
  const summary = data?.summary ?? null
  const listedReviewable = docs.data?.documents.filter((d) => d.extractionReady && REVIEWABLE.has(d.documentType)) ?? []
  const reviewable = doc && !listed && REVIEWABLE.has(doc.documentType) ? [doc, ...listedReviewable] : listedReviewable
  const filtersActive = JSON.stringify({ ...review.filters, sort: DEFAULT_FILTERS.sort }) !== JSON.stringify(DEFAULT_FILTERS)

  function selectDocument(id: string) {
    setSelected(id)
    setDetails(null)
    setContextTarget(null)
  }

  const refreshAfterRun = useCallback(() => {
    void review.revalidateDocument()
    void docs.mutate()
  }, [review.revalidateDocument, docs.mutate])
  const prep = useDocumentPreparation(documentId, refreshAfterRun)

  async function extract() {
    if (!doc || running || prep.active) return
    setRunning(true)
    const r = await startDocumentPreparation(doc.id)
    setRunning(false)
    if (!r.ok) {
      toast.error("Processing could not start", { description: r.error.message })
      return
    }
    await prep.mutate()
    toast.success(r.data.created ? `Processing started for ${doc.filename}` : "Processing is already in progress")
  }

  async function cancelProcessing() {
    if (!doc || cancelling) return
    setCancelling(true)
    const r = await cancelDocumentPreparation(doc.id)
    setCancelling(false)
    await prep.mutate()
    if (!r.ok) {
      toast.error("Could not cancel processing", { description: r.error.message })
      return
    }
    toast.success(r.data.result === "cancelled" ? "Processing cancelled" : "Cancellation requested. Processing stops at the next checkpoint.")
  }

  const canAnalyze = !!doc && CONTEXT_READY.has(doc.processingStatus) && (counts?.total ?? 0) > 0

  async function analyzeContext() {
    if (!doc || analyzing) return
    setAnalyzing(true)
    const r = await analyzeDocumentContext(doc.id)
    setAnalyzing(false)
    await review.revalidateDocument()
    if (!r.ok) {
      toast.error("Context analysis failed", { description: r.error.message })
      return
    }
    const s = r.data.summary
    toast.success(`Analyzed context for ${s.total} image${s.total === 1 ? "" : "s"}`, {
      description: `${s.analyzed} with context, ${s.unavailable} unavailable${s.failed ? `, ${s.failed} failed` : ""}.`,
    })
  }

  const openContext = (img: ReviewImageRecord) => setContextTarget({ documentId: img.documentId, imageId: img.id, label: `${sourceName(img)}, ${locationLabel(img)}` })

  const actions: ImageRowActions = {
    pendingIds: review.pendingIds,
    canManage: review.canManage,
    onToggle: review.toggle,
    onDetails: (img) => setDetails({ img, focus: "details" }),
    onContext: openContext,
    onDuplicates: (img) => setDetails({ img, focus: "duplicates" }),
  }

  // Keep the open drawer in sync with the latest server-confirmed row after a mutation.
  const liveDetails = details ? { ...details, img: review.images.find((i) => i.id === details.img.id) ?? details.img } : null
  const selectedCount = summary?.selectedOccurrences ?? 0
  const hasImages = (counts?.total ?? 0) > 0
  const isDocx = doc?.documentType === "docx"
  const exportFormat = doc && isAccessibleExportFormat(doc.documentType) ? doc.documentType : null
  const eligibleSelected = summary?.selectedOccurrences ?? 0
  const canGenerate = !!doc && doc.securityStatus === "clean" && eligibleSelected > 0 && !generating && !prep.active

  async function generate() {
    if (!doc || !canGenerate) return
    setGenerating(true)
    // One key per click target set: a retried/duplicated request replays the same batch.
    const key = generationKey.current ?? newIdempotencyKey()
    generationKey.current = key
    const r = await generateDocumentAltText(doc.id, key)
    setGenerating(false)
    if (!r.ok) {
      if (r.error.code !== "RATE_LIMITED") generationKey.current = null
      toast.error("Generation could not be queued", { description: describeBatchError(r.error) })
      return
    }
    generationKey.current = null
    await review.revalidateDocument()
    const { acceptedImageCount: n, skippedImageCount: skipped } = r.data
    toast.success(r.data.replayed ? "Generation was already queued" : `Queued ${n} image${n === 1 ? "" : "s"} for alt text generation`, {
      description: `Batch ${r.data.batchId.slice(0, 8)} · ${skipped ? `${skipped} selected image${skipped === 1 ? " was" : "s were"} not eligible. ` : ""}Processing continues in the background.`,
    })
  }

  return (
    <>
      <section aria-labelledby="doc-summary-heading" className="flex flex-col gap-3">
        <h2 id="doc-summary-heading" className="text-sm font-semibold text-foreground">
          Extraction Summary
        </h2>
        <ul className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
          <SummaryTile label="Total Documents" icon={FileStack} value={docs.data?.total ?? null} />
          <SummaryTile label="Image Occurrences" icon={Images} value={counts?.total ?? null} />
          <SummaryTile label="Pending" icon={Hourglass} value={counts?.pending ?? null} />
          <SummaryTile label="Extracted" icon={CheckCircle2} value={counts?.extracted ?? null} />
          <SummaryTile label="Failed / Unsupported" icon={XCircle} value={counts ? counts.failed + counts.unsupported : null} />
        </ul>
      </section>

      <Card className="min-w-0">
        <CardHeader className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <CardTitle className="text-base">Extracted Images</CardTitle>
            <CardDescription>
              Review every image occurrence with its original page, slide or position, then select which ones to send for alt text generation.
            </CardDescription>
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex w-full flex-col gap-1.5">
              <Label htmlFor="extract-doc">Document</Label>
              <Select value={selected} onValueChange={selectDocument} disabled={reviewable.length === 0}>
                <SelectTrigger id="extract-doc" className="w-full md:max-w-sm">
                  <SelectValue placeholder={docs.isLoading ? "Loading documents…" : reviewable.length ? "Select a cleared document" : "No cleared documents"} />
                </SelectTrigger>
                <SelectContent>
                  {reviewable.map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>
                      {`${d.filename} · ${d.documentType.toUpperCase()}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div role="group" aria-label="Document actions" className="flex flex-wrap gap-2">
              <Button size="sm" onClick={extract} disabled={!doc || !isExtractable(doc) || running || prep.active}>
                {running || prep.active ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ScanSearch aria-hidden="true" />}
                {running ? "Starting…" : prep.active ? "Processing…" : "Process Document"}
              </Button>
              <Button size="sm" variant="outline" onClick={analyzeContext} disabled={!canAnalyze || analyzing || prep.active}>
                {analyzing ? <Loader2 className="animate-spin" aria-hidden="true" /> : <FileSearch aria-hidden="true" />}
                {analyzing ? "Analyzing…" : "Analyze Context"}
              </Button>
              <Button size="sm" variant="outline" onClick={generate} disabled={!canGenerate}>
                {generating ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
                {generating ? "Queuing…" : `Generate Alt Text${eligibleSelected ? ` (${eligibleSelected})` : ""}`}
              </Button>
              {exportFormat ? (
                <Button size="sm" variant="outline" onClick={() => setExportOpen(true)} disabled={doc?.securityStatus !== "clean"}>
                  <Download aria-hidden="true" />
                  Download Accessible Document
                </Button>
              ) : (
                <LaterButton label="Download Accessible Document" icon={Download} note="Available for Word, PowerPoint and tagged PDF documents." />
              )}
              {LATER.map((l) => (
                <LaterButton key={l.label} {...l} />
              ))}
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-5">
          {prep.preparation && <DocumentPreparationStatus preparation={prep.preparation} stale={prep.stale} cancelling={cancelling} onCancel={cancelProcessing} />}
          {!documentId || !hasImages ? (
            <Empty className="rounded-md border py-10">
              <EmptyHeader>
                <EmptyMedia variant="icon">{review.list.isLoading ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ImageIcon aria-hidden="true" />}</EmptyMedia>
                <EmptyTitle>{!documentId ? "No document selected" : review.list.error ? "Images could not be loaded" : review.list.isLoading ? "Loading images…" : "No extracted images yet"}</EmptyTitle>
                <EmptyDescription>
                  {!documentId
                    ? "Choose a security-cleared document to view or extract its images."
                    : review.list.error
                      ? "Something went wrong while loading this document's images."
                      : isDocx
                        ? "Image extraction for Word documents is not available yet."
                        : "Run Extract Images to list every image in this document."}
                </EmptyDescription>
              </EmptyHeader>
              {review.list.error && (
                <EmptyContent>
                  <Button size="sm" variant="outline" onClick={() => review.list.mutate()}>
                    Try again
                  </Button>
                </EmptyContent>
              )}
            </Empty>
          ) : (
            <>
              <ImageReadinessSummary summary={summary} />
              <ExtractedImagesToolbar filters={review.filters} onChange={review.setFilters} view={review.view} onViewChange={review.setView} isPdf={doc?.documentType === "pdf"} />
              <SelectionBar review={review} summary={summary} />

              <div aria-busy={review.list.isValidating} className="relative flex flex-col gap-4">
                {review.images.length === 0 ? (
                  <Empty className="rounded-md border py-10">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <SearchX aria-hidden="true" />
                      </EmptyMedia>
                      <EmptyTitle>No images match these filters</EmptyTitle>
                      <EmptyDescription>Try a different search or clear the filters.</EmptyDescription>
                    </EmptyHeader>
                    {filtersActive && (
                      <EmptyContent>
                        <Button size="sm" variant="outline" onClick={() => review.setFilters({ ...DEFAULT_FILTERS, sort: review.filters.sort })}>
                          Clear filters
                        </Button>
                      </EmptyContent>
                    )}
                  </Empty>
                ) : review.view === "gallery" ? (
                  <ExtractedImagesGallery images={review.images} actions={actions} />
                ) : (
                  <ExtractedImagesTable images={review.images} actions={actions} pageHeader={<PageSelectCheckbox review={review} />} />
                )}
                <ImagePagination review={review} />
              </div>
            </>
          )}

          <p className="text-xs leading-relaxed text-muted-foreground">
            Existing alt text is shown only when the source document reliably links it to that image; it is never auto-approved. Selection only
            marks images for a future generation run and does not use credits. PDF remediation depends on the document&apos;s tag structure.
          </p>
        </CardContent>
      </Card>

      <ImageDetailsSheet
        target={liveDetails}
        onClose={() => setDetails(null)}
        onOpen={setDetails}
        onContext={openContext}
        onReview={review.setReview}
        canManage={review.canManage}
      />
      <DocumentContextSheet target={contextTarget} onClose={() => setContextTarget(null)} onAnalyzed={() => review.revalidateDocument()} />
      {exportFormat ? (
        <AccessibleDocumentSheet key={documentId ?? "none"} documentId={documentId} format={exportFormat} open={exportOpen} onOpenChange={setExportOpen} />
      ) : null}
    </>
  )
}
