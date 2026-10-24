"use client"

/**
 * @file components/publishing/alt-text/document-processing-workspace.tsx
 * @module Publishing
 * @kind React client component
 * @summary Phase 3 Task 1 — Document Processing UI shell (upload area, settings,
 *   extraction summary and extracted-image table). Remediation actions
 *   remain disabled until their APIs exist; no data is fabricated.
 */
import { useState } from "react"
import { FileText, History, Info } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DocumentHistory } from "./document-history"
import { DEFAULT_GENERATION_SETTINGS, type GenerationSettings } from "@/lib/alt-text/core"
import { DOCUMENT_MAX_FILE_MB } from "@/lib/alt-text/document-queue"
import { DocumentDropZone, SelectedDocumentsCard } from "./document-selection-panel"
import { GenerationSettingsPanel, SelectField } from "./generation-settings-panel"
import { useDocumentQueue } from "./use-document-queue"
import { useDocumentUploads } from "./use-document-uploads"
import { UploadedDocumentsCard } from "./uploaded-documents-card"
import { ExtractedImagesPanel, type DocumentOpenRequest } from "./extracted-images-panel"
import { DocumentLiveProcessing } from "./document-live-processing"

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

export function DocumentProcessingWorkspace({ onOpenBatch }: { onOpenBatch?: (batchId: string) => void } = {}) {
  const [view, setView] = useState<"current" | "history">("current")
  const [openRequest, setOpenRequest] = useState<DocumentOpenRequest | null>(null)

  const openDocument = (id: number) => {
    setOpenRequest((prev) => ({ id, nonce: (prev?.nonce ?? 0) + 1 }))
    setView("current")
    requestAnimationFrame(() => document.getElementById("extracted-images")?.scrollIntoView({ behavior: "smooth", block: "start" }))
  }

  return (
    <Tabs value={view} onValueChange={(v) => setView(v as "current" | "history")} className="flex min-w-0 flex-col gap-4">
      <TabsList className="w-full sm:w-fit" aria-label="Document processing views">
        <TabsTrigger value="current" className="flex-1 gap-2 sm:flex-none">
          <FileText aria-hidden="true" /> Current Document
        </TabsTrigger>
        <TabsTrigger value="history" className="flex-1 gap-2 sm:flex-none">
          <History aria-hidden="true" /> Document History
        </TabsTrigger>
      </TabsList>
      {/* Current stays mounted so queued uploads and selections survive switching to History. */}
      <TabsContent value="current" keepMounted className="mt-0">
        <CurrentDocument openRequest={openRequest} />
      </TabsContent>
      <TabsContent value="history" className="mt-0">
        <DocumentHistory onOpenDocument={openDocument} onOpenBatch={onOpenBatch} />
      </TabsContent>
    </Tabs>
  )
}

const WORKFLOW_STEPS = ["Upload", "Extract images", "Review", "Generate alt text", "Approve", "Export"] as const

function CurrentDocument({ openRequest }: { openRequest: DocumentOpenRequest | null }) {
  const queue = useDocumentQueue()
  const uploads = useDocumentUploads()
  const [documentType, setDocumentType] = useState<DocumentType>("auto")
  const [settings, setSettings] = useState<GenerationSettings>(DEFAULT_GENERATION_SETTINGS)

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <ol aria-label="Document workflow" className="flex flex-wrap items-center gap-x-2 gap-y-2 text-xs text-muted-foreground">
        {WORKFLOW_STEPS.map((step, i) => (
          <li key={step} className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 font-medium text-foreground">
              <span className="flex size-4 items-center justify-center rounded-full bg-accent text-[10px] font-semibold text-accent-foreground tabular-nums">
                {i + 1}
              </span>
              {step}
            </span>
            {i < WORKFLOW_STEPS.length - 1 && <span aria-hidden="true" className="h-px w-3 bg-border" />}
          </li>
        ))}
      </ol>

      <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="text-base">Document Upload</CardTitle>
            <CardDescription>Add one or more documents to extract their images for alt text.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <DocumentDropZone queue={queue} />

            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium text-muted-foreground">Supported formats</p>
              <ul className="flex flex-wrap gap-1.5">
                {SUPPORTED_FORMATS.map((f) => (
                  <li key={f.ext}>
                    <span
                      title={f.note}
                      className="inline-flex rounded-md border bg-muted px-2 py-0.5 font-mono text-xs font-medium text-foreground"
                    >
                      {f.ext}
                      <span className="sr-only">: {f.note}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                Up to {DOCUMENT_MAX_FILE_MB} MB per file. Legacy .doc and .ppt files are not supported.
              </p>
            </div>
          </CardContent>
        </Card>

        <GenerationSettingsPanel
          settings={settings}
          onChange={setSettings}
          layout="horizontal"
          collapsible
          title="Document Settings"
          description="Context applied to every image extracted from the selected documents."
          footer={
            <div className="flex flex-col gap-3 border-t pt-5">
              <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,14rem),1fr))] gap-4">
                <SelectField id="doc-type" label="Document Type" value={documentType} options={DOCUMENT_TYPES} onChange={setDocumentType} />
              </div>
              <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                <span>AI model selection follows your organization&apos;s Alt Text governance policy.</span>
              </p>
            </div>
          }
        />
      </div>

      <SelectedDocumentsCard queue={queue} uploads={uploads} />

      <UploadedDocumentsCard />

      <DocumentLiveProcessing
        onOpenImages={() => document.getElementById("extracted-images")?.scrollIntoView({ behavior: "smooth", block: "start" })}
      />

      <div id="extracted-images" className="min-w-0 scroll-mt-4">
        <ExtractedImagesPanel openRequest={openRequest} />
      </div>
    </div>
  )
}
