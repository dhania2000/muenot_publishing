"use client"

/**
 * @file components/publishing/alt-text/document-processing-workspace.tsx
 * @module Publishing
 * @kind React client component
 * @summary Document Processing workbench. One workflow stage is active at a time
 *   (Upload → Extraction → Images & Review → History); document settings live in a
 *   drawer. All stages stay mounted so queued uploads, selections and the open
 *   document survive stage switches. No data is fabricated.
 */
import { useState } from "react"
import { FileText, FileUp, History, Images, Info, ScanSearch, SlidersHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
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
import { StepNav, ToolbarDivider, Workbench, WorkbenchDrawer, WorkbenchScroll, WorkbenchToolbar, type StepItem } from "./workbench"

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

type Stage = "upload" | "extraction" | "images" | "history"
const STAGES: StepItem<Stage>[] = [
  { id: "upload", label: "Upload", icon: FileUp, hint: "Select documents" },
  { id: "extraction", label: "Extraction", icon: ScanSearch, hint: "Documents & progress" },
  { id: "images", label: "Images & Review", icon: Images, hint: "Generate, approve, export" },
  { id: "history", label: "History", icon: History, hint: "Past documents" },
]

export function DocumentProcessingWorkspace({ onOpenBatch }: { onOpenBatch?: (batchId: string) => void } = {}) {
  const [stage, setStage] = useState<Stage>("upload")
  const [openRequest, setOpenRequest] = useState<DocumentOpenRequest | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const queue = useDocumentQueue()
  const uploads = useDocumentUploads()
  const [documentType, setDocumentType] = useState<DocumentType>("auto")
  const [settings, setSettings] = useState<GenerationSettings>(DEFAULT_GENERATION_SETTINGS)

  const openDocument = (id: number) => {
    setOpenRequest((prev) => ({ id, nonce: (prev?.nonce ?? 0) + 1 }))
    setStage("images")
  }

  return (
    <Workbench>
      <WorkbenchToolbar
        label="Document toolbar"
        title={
          <span className="flex items-center gap-2">
            <FileText className="size-4 text-muted-foreground" aria-hidden="true" /> Document Processing
          </span>
        }
      >
        <span className="hidden text-xs text-muted-foreground md:inline">
          {DOCUMENT_TYPES[documentType]} · {settings.outputLanguage.toUpperCase()}
        </span>
        <ToolbarDivider />
        <Button size="sm" variant="outline" onClick={() => setSettingsOpen(true)}>
          <SlidersHorizontal aria-hidden="true" /> Document Settings
        </Button>
      </WorkbenchToolbar>

      <StepNav label="Document workflow stages" steps={STAGES} value={stage} onChange={setStage} />

      {/* Every stage stays mounted (hidden) so uploads, selections and the open document persist. */}
      <div hidden={stage !== "upload"} className="min-w-0 lg:min-h-0 lg:flex-1">
        <WorkbenchScroll label="Upload documents" className="lg:h-full">
          <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <section aria-label="Add documents" className="flex min-w-0 flex-col gap-4 rounded-lg border bg-card p-4">
              <DocumentDropZone queue={queue} />
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium text-muted-foreground">Supported formats</p>
                <ul className="flex flex-wrap gap-1.5">
                  {SUPPORTED_FORMATS.map((f) => (
                    <li key={f.ext}>
                      <span title={f.note} className="inline-flex rounded-md border bg-muted px-2 py-0.5 font-mono text-xs font-medium text-foreground">
                        {f.ext}
                        <span className="sr-only">: {f.note}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">Up to {DOCUMENT_MAX_FILE_MB} MB per file. Legacy .doc and .ppt files are not supported.</p>
              </div>
            </section>
            <div className="min-w-0">
              <SelectedDocumentsCard queue={queue} uploads={uploads} />
            </div>
          </div>
        </WorkbenchScroll>
      </div>

      <div hidden={stage !== "extraction"} className="min-w-0 lg:min-h-0 lg:flex-1">
        <WorkbenchScroll label="Extraction" className="lg:h-full">
          <div className="flex min-w-0 flex-col gap-4">
            <DocumentLiveProcessing onOpenImages={() => setStage("images")} />
            <UploadedDocumentsCard />
          </div>
        </WorkbenchScroll>
      </div>

      <div hidden={stage !== "images"} className="min-w-0 lg:min-h-0 lg:flex-1">
        <WorkbenchScroll label="Extracted images" className="lg:h-full">
          <ExtractedImagesPanel openRequest={openRequest} />
        </WorkbenchScroll>
      </div>

      <div hidden={stage !== "history"} className="min-w-0 lg:min-h-0 lg:flex-1">
        <WorkbenchScroll label="Document history" className="lg:h-full">
          <DocumentHistory onOpenDocument={openDocument} onOpenBatch={onOpenBatch} />
        </WorkbenchScroll>
      </div>

      <WorkbenchDrawer
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        title="Document Settings"
        description="Context applied to every image extracted from the selected documents. Changes are kept when you close this panel."
        footer={
          <Button size="sm" onClick={() => setSettingsOpen(false)}>
            Done
          </Button>
        }
      >
        <div className="flex flex-col gap-5">
          <SelectField id="doc-type" label="Document Type" value={documentType} options={DOCUMENT_TYPES} onChange={setDocumentType} />
          <GenerationSettingsPanel bare settings={settings} onChange={setSettings} />
          <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>AI model selection follows your organization&apos;s Alt Text governance policy.</span>
          </p>
        </div>
      </WorkbenchDrawer>
    </Workbench>
  )
}
