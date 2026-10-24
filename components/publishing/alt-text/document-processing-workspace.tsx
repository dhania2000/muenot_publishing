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
import { Info } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { DEFAULT_GENERATION_SETTINGS, type GenerationSettings } from "@/lib/alt-text/core"
import { DOCUMENT_MAX_FILE_MB } from "@/lib/alt-text/document-queue"
import { DocumentDropZone, SelectedDocumentsCard } from "./document-selection-panel"
import { GenerationSettingsPanel, SelectField } from "./generation-settings-panel"
import { useDocumentQueue } from "./use-document-queue"
import { useDocumentUploads } from "./use-document-uploads"
import { UploadedDocumentsCard } from "./uploaded-documents-card"
import { ExtractedImagesPanel } from "./extracted-images-panel"
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

      <DocumentLiveProcessing
        onOpenImages={() => document.getElementById("extracted-images")?.scrollIntoView({ behavior: "smooth", block: "start" })}
      />

      <div id="extracted-images" className="min-w-0 scroll-mt-4">
        <ExtractedImagesPanel />
      </div>
    </div>
  )
}
