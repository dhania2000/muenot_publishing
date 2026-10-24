"use client"

/**
 * @file components/publishing/alt-text/extracted-images-panel.tsx
 * @module Publishing
 * @kind React client component
 * @summary Extraction summary + extracted-image table. Runs synchronous PDF/PPTX extraction for a
 *   selected, security-cleared document and lists every recorded image occurrence with its
 *   page/slide location and status. Later-phase actions stay disabled.
 */
import { useState } from "react"
import useSWR from "swr"
import { toast } from "sonner"
import { CheckCircle2, Download, FileSearch, FileStack, FileUp, Hourglass, ImageIcon, Images, ListChecks, Loader2, ScanSearch, Sparkles, XCircle, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { altTextFetcher, analyzeDocumentContext, documentImagesUrl, documentListUrl, extractDocumentImages } from "@/lib/alt-text/client"
import { CONTEXT_CONFIDENCE_LABEL } from "@/lib/alt-text/document-context"
import type { DocumentImageRecord, DocumentImagesResponse, DocumentListResponse, DocumentRecord } from "@/lib/alt-text/document-records"
import { AssetImage } from "./alt-text-history"
import { CONFIDENCE_TONE, DocumentContextSheet, type ContextSheetTarget } from "./document-context-sheet"
import { StatusBadge } from "./document-upload-status"

const EXTRACTABLE = new Set(["pdf", "pptx"])
const isExtractable = (d: DocumentRecord) => d.extractionReady && EXTRACTABLE.has(d.documentType) && d.processingStatus !== "extracting"
const CONTEXT_READY = new Set(["extracted", "partially_extracted", "failed", "unsupported"])

const LATER: { label: string; icon: LucideIcon }[] = [
  { label: "Generate Alt Text", icon: Sparkles },
  { label: "Review Descriptions", icon: ListChecks },
  { label: "Download Accessible Document", icon: Download },
  { label: "Export Results", icon: FileUp },
]
const LATER_NOTE = "Available in a later phase of document processing."

const COLUMNS = ["Image", "Page / Slide / Location", "Image Type", "Processing Status", "Existing Alt Text", "Document Context"]

function ContextCell({ img }: { img: DocumentImageRecord }) {
  if (img.contextStatus === "failed") return <StatusBadge tone="danger">Analysis failed</StatusBadge>
  if (!img.contextStatus || !img.contextConfidence) return <span className="text-xs text-muted-foreground">Not analyzed</span>
  return <StatusBadge tone={CONFIDENCE_TONE[img.contextConfidence]}>{CONTEXT_CONFIDENCE_LABEL[img.contextConfidence]}</StatusBadge>
}

const STATUS_TONE = { pending: "info", extracted: "success", failed: "danger", unsupported: "warning" } as const

function location(img: DocumentImageRecord) {
  const where = img.slideNumber != null ? `Slide ${img.slideNumber}` : img.pageNumber != null ? `Page ${img.pageNumber}` : "—"
  const label = img.sourceMetadata?.pdf?.pageLabel
  return label && label !== String(img.pageNumber) ? `${where} (${label})` : where
}

function imageType(img: DocumentImageRecord) {
  if (img.isDecorative) return "Decorative candidate"
  const cls = img.sourceMetadata?.pdf?.classification
  if (cls === "likely_scanned_page") return "Likely scanned page"
  if (img.sourceMetadata?.pdf?.kind === "inline") return "Inline image"
  return "Embedded image"
}

function existingAlt(img: DocumentImageRecord) {
  const m = img.sourceMetadata
  return m?.originalDescription ?? m?.pdf?.structure?.actualText ?? m?.pdf?.structure?.markedContentAlt ?? null
}

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

export function ExtractedImagesPanel() {
  const docs = useSWR<DocumentListResponse>(documentListUrl(1, 100), altTextFetcher, { revalidateOnFocus: false })
  const [selected, setSelected] = useState<string>("")
  const [running, setRunning] = useState(false)
  const documentId = selected ? Number(selected) : null
  const doc = docs.data?.documents.find((d) => d.id === documentId) ?? null
  const images = useSWR<DocumentImagesResponse>(documentId ? documentImagesUrl(documentId) : null, altTextFetcher, { revalidateOnFocus: false })
  const counts = images.data?.counts ?? null
  const eligible = docs.data?.documents.filter((d) => d.extractionReady && EXTRACTABLE.has(d.documentType)) ?? []

  async function extract() {
    if (!doc || running) return
    setRunning(true)
    const r = await extractDocumentImages(doc.id)
    setRunning(false)
    await Promise.all([images.mutate(), docs.mutate()])
    if (!r.ok) {
      toast.error("Extraction failed", { description: r.error.message })
      return
    }
    toast.success(r.data.alreadyProcessed ? "Images were already extracted" : `Extracted images from ${doc.filename}`)
  }

  const [analyzing, setAnalyzing] = useState(false)
  const [contextTarget, setContextTarget] = useState<ContextSheetTarget | null>(null)
  const canAnalyze = !!doc && CONTEXT_READY.has(doc.processingStatus) && (counts?.total ?? 0) > 0

  async function analyzeContext() {
    if (!doc || analyzing) return
    setAnalyzing(true)
    const r = await analyzeDocumentContext(doc.id)
    setAnalyzing(false)
    await images.mutate()
    if (!r.ok) {
      toast.error("Context analysis failed", { description: r.error.message })
      return
    }
    const s = r.data.summary
    toast.success(`Analyzed context for ${s.total} image${s.total === 1 ? "" : "s"}`, {
      description: `${s.analyzed} with context, ${s.unavailable} unavailable${s.failed ? `, ${s.failed} failed` : ""}.`,
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
            <CardDescription>Each drawing of an image is listed with its original page or slide for context-aware descriptions and review.</CardDescription>
          </div>
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Label htmlFor="extract-doc">Document</Label>
              <Select value={selected} onValueChange={setSelected} disabled={eligible.length === 0}>
                <SelectTrigger id="extract-doc" className="w-full md:max-w-sm">
                  <SelectValue placeholder={docs.isLoading ? "Loading documents…" : eligible.length ? "Select a cleared PDF or PPTX" : "No cleared PDF or PPTX documents"} />
                </SelectTrigger>
                <SelectContent>
                  {eligible.map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>
                      {d.filename}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div role="group" aria-label="Document actions" className="flex flex-wrap gap-2">
              <Button size="sm" onClick={extract} disabled={!doc || !isExtractable(doc) || running}>
                {running ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ScanSearch aria-hidden="true" />}
                {running ? "Extracting…" : "Extract Images"}
              </Button>
              <Button size="sm" variant="outline" onClick={analyzeContext} disabled={!canAnalyze || analyzing}>
                {analyzing ? <Loader2 className="animate-spin" aria-hidden="true" /> : <FileSearch aria-hidden="true" />}
                {analyzing ? "Analyzing…" : "Analyze Context"}
              </Button>
              {LATER.map(({ label, icon: Icon }) => (
                <Tooltip key={label}>
                  <TooltipTrigger asChild>
                    <span tabIndex={0} className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <Button variant="outline" size="sm" disabled>
                        <Icon aria-hidden="true" />
                        {label}
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{LATER_NOTE}</TooltipContent>
                </Tooltip>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  {COLUMNS.map((c) => (
                    <TableHead key={c} className="whitespace-nowrap">
                      {c}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {images.data && images.data.images.length > 0 ? (
                  images.data.images.map((img) => {
                    const alt = existingAlt(img)
                    return (
                      <TableRow key={img.id}>
                        <TableCell>
                          {img.altTextAssetId ? (
                            <AssetImage id={img.altTextAssetId} alt={`Image ${img.occurrenceIndex + 1}, ${location(img)}`} className="size-12 rounded" />
                          ) : (
                            <div className="flex size-12 items-center justify-center rounded bg-muted text-muted-foreground" aria-label="No preview">
                              <ImageIcon className="size-4" aria-hidden="true" />
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{location(img)}</TableCell>
                        <TableCell className="whitespace-nowrap">{imageType(img)}</TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <StatusBadge tone={STATUS_TONE[img.extractionStatus]}>{img.extractionStatus}</StatusBadge>
                            {img.extractionErrorMessage && <span className="max-w-64 text-xs text-muted-foreground">{img.extractionErrorMessage}</span>}
                          </div>
                        </TableCell>
                        <TableCell className="max-w-72 text-xs text-muted-foreground">
                          {alt ? <span className="line-clamp-2">{alt}</span> : "None in source"}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col items-start gap-1.5">
                            <ContextCell img={img} />
                            <Button
                              variant="link"
                              size="sm"
                              className="h-auto p-0 text-xs"
                              onClick={() => setContextTarget({ documentId: img.documentId, imageId: img.id, label: `Image ${img.occurrenceIndex + 1}, ${location(img)}` })}
                            >
                              View context
                              <span className="sr-only">{` for image ${img.occurrenceIndex + 1}`}</span>
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })
                ) : (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={COLUMNS.length} className="p-0">
                      <Empty className="py-10">
                        <EmptyHeader>
                          <EmptyMedia variant="icon">
                            {images.isLoading ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ImageIcon aria-hidden="true" />}
                          </EmptyMedia>
                          <EmptyTitle>{documentId ? "No extracted images yet" : "No document selected"}</EmptyTitle>
                          <EmptyDescription>
                            {documentId ? "Run Extract Images to list every image in this document." : "Choose a security-cleared document to view or extract its images."}
                          </EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Existing alt text is shown only when the source document reliably links it to that image; it is never auto-approved. PDF remediation
            depends on the document&apos;s tag structure, so not every PDF can be remediated automatically.
          </p>
        </CardContent>
      </Card>
      <DocumentContextSheet target={contextTarget} onClose={() => setContextTarget(null)} onAnalyzed={() => images.mutate()} />
    </>
  )
}
