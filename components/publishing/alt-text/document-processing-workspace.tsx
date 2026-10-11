"use client"

/**
 * @file components/publishing/alt-text/document-processing-workspace.tsx
 * @module Publishing
 * @kind React client component
 * @summary Phase 3 Task 1 — Document Processing UI shell (upload area, settings,
 *   extraction summary, extracted-image table, reserved actions). Upload,
 *   extraction and remediation APIs arrive in later tasks, so every
 *   backend-dependent control is disabled and no data is fabricated.
 */
import { useState } from "react"
import {
  CheckCircle2,
  Download,
  FileStack,
  FileUp,
  ImageIcon,
  Images,
  Info,
  ListChecks,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  XCircle,
  Hourglass,
  type LucideIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { DEFAULT_GENERATION_SETTINGS, type GenerationSettings } from "@/lib/alt-text/core"
import { DOCUMENT_MAX_FILE_MB } from "@/lib/alt-text/document-queue"
import { DocumentDropZone, SelectedDocumentsCard } from "./document-selection-panel"
import { GenerationSettingsPanel, SelectField } from "./generation-settings-panel"
import { useDocumentQueue } from "./use-document-queue"
import { useDocumentUploads } from "./use-document-uploads"
import { UploadedDocumentsCard } from "./uploaded-documents-card"

const DOCUMENT_TYPES = {
  auto: "Detect from file",
  pdf: "PDF document",
  pptx: "PowerPoint presentation (PPTX)",
  docx: "Word document (DOCX)",
} as const
type DocumentType = keyof typeof DOCUMENT_TYPES

const SUPPORTED_FORMATS = [
  { ext: "PDF", note: "Alt text review; remediation only where the PDF structure supports it" },
  { ext: "PPTX", note: "Native alt text insertion per slide (planned)" },
  { ext: "DOCX", note: "Native alt text insertion per image (planned)" },
] as const

const SUMMARY: { label: string; icon: LucideIcon }[] = [
  { label: "Total Documents", icon: FileStack },
  { label: "Extracted Images", icon: Images },
  { label: "Pending Processing", icon: Hourglass },
  { label: "Completed Images", icon: CheckCircle2 },
  { label: "Failed Images", icon: XCircle },
  { label: "Approved Alt Text", icon: ShieldCheck },
]

const TABLE_COLUMNS = [
  "Image",
  "Original Document",
  "Page / Slide / Location",
  "Image Type",
  "Processing Status",
  "Alt Text Preview",
  "Actions",
]

const ACTIONS: { label: string; icon: LucideIcon; variant: "default" | "outline" }[] = [
  { label: "Extract Images", icon: ScanSearch, variant: "default" },
  { label: "Generate Alt Text", icon: Sparkles, variant: "outline" },
  { label: "Review Descriptions", icon: ListChecks, variant: "outline" },
  { label: "Download Accessible Document", icon: Download, variant: "outline" },
  { label: "Export Results", icon: FileUp, variant: "outline" },
]

const UNAVAILABLE = "Available once document processing is enabled for this workspace."

function DisabledAction({ label, icon: Icon, variant }: (typeof ACTIONS)[number]) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* Wrapper keeps the tooltip reachable while the button itself is disabled. */}
        <span tabIndex={0} className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Button variant={variant} size="sm" disabled aria-describedby="doc-actions-note">
            <Icon aria-hidden="true" />
            {label}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{UNAVAILABLE}</TooltipContent>
    </Tooltip>
  )
}

export function DocumentProcessingWorkspace() {
  const queue = useDocumentQueue()
  const uploads = useDocumentUploads()
  const [documentType, setDocumentType] = useState<DocumentType>("auto")
  const [settings, setSettings] = useState<GenerationSettings>(DEFAULT_GENERATION_SETTINGS)

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="grid min-w-0 gap-6 lg:grid-cols-5">
        <Card className="min-w-0 lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Document Upload</CardTitle>
            <CardDescription>Add one or more documents to extract their images for alt text.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <DocumentDropZone queue={queue} />

            <div className="flex flex-col gap-2 rounded-md border px-3 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Supported formats</p>
              <ul className="flex flex-col gap-2">
                {SUPPORTED_FORMATS.map((f) => (
                  <li key={f.ext} className="flex items-start gap-2 text-xs">
                    <span className="w-11 shrink-0 rounded border bg-muted/50 px-1.5 py-0.5 text-center font-mono font-medium text-foreground">
                      {f.ext}
                    </span>
                    <span className="leading-relaxed text-muted-foreground">{f.note}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                Up to {DOCUMENT_MAX_FILE_MB} MB per file. Legacy .doc and .ppt files are not supported.
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="flex min-w-0 flex-col gap-4 lg:col-span-3">
          <GenerationSettingsPanel
            settings={settings}
            onChange={setSettings}
            layout="horizontal"
            title="Document Settings"
            description="Context applied to every image extracted from the selected documents. Image Type sets the classification preference."
            footer={
              <div className="flex flex-col gap-4">
                <SelectField id="doc-type" label="Document Type" value={documentType} options={DOCUMENT_TYPES} onChange={setDocumentType} />
                <p className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                  <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  <span>AI model selection follows your organization&apos;s Alt Text governance policy.</span>
                </p>
              </div>
            }
          />
        </div>
      </div>

      <SelectedDocumentsCard queue={queue} uploads={uploads} />

      <UploadedDocumentsCard />

      <section aria-labelledby="doc-summary-heading" className="flex flex-col gap-3">
        <h2 id="doc-summary-heading" className="text-sm font-semibold text-foreground">
          Extraction Summary
        </h2>
        <ul className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {SUMMARY.map(({ label, icon: Icon }) => (
            <li key={label}>
              <Card className="gap-2 py-4">
                <CardContent className="flex flex-col gap-2 px-4">
                  <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <Icon className="size-4" aria-hidden="true" />
                    {label}
                  </div>
                  <p className="text-2xl font-semibold tabular-nums text-foreground" aria-label={`${label}: no data yet`}>
                    {"—"}
                  </p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <Card className="min-w-0">
        <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex flex-col gap-1.5">
            <CardTitle className="text-base">Extracted Images</CardTitle>
            <CardDescription>
              Images will be listed with their original page, slide or location for context-aware descriptions and manual review.
            </CardDescription>
          </div>
          <div role="group" aria-label="Document actions" className="flex flex-wrap gap-2">
            {ACTIONS.map((a) => (
              <DisabledAction key={a.label} {...a} />
            ))}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p id="doc-actions-note" className="sr-only">
            {UNAVAILABLE}
          </p>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  {TABLE_COLUMNS.map((c) => (
                    <TableHead key={c} className="whitespace-nowrap">
                      {c}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={TABLE_COLUMNS.length} className="p-0">
                    <Empty className="py-10">
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <ImageIcon aria-hidden="true" />
                        </EmptyMedia>
                        <EmptyTitle>No extracted images</EmptyTitle>
                        <EmptyDescription>
                          Images appear here after documents are uploaded and extracted.
                        </EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            PPTX and DOCX support native alt text insertion. PDF remediation depends on the document&apos;s tag structure, so not
            every PDF can be remediated automatically.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
