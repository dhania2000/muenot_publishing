"use client"

/**
 * @file components/publishing/conversion/pdf/pdf-workspace.tsx
 * @module Publishing › Conversion › PDF
 * @kind React client component
 * @summary PDF Workspace foundation: workflow stepper, workspace toolbar, three-panel layout and bottom processing panel.
 * @exports PdfWorkspace, PdfWorkflowStepper, PdfWorkspaceToolbar
 * @see PDF_PHASE1_TASK2_UI_ARCHITECTURE.md §7
 *
 * Layout: ≥ xl three panels with collapsible side rails; md–xl one panel at a time via a panel switcher;
 * < md a single stacked column. State is local UI state only — files never leave the browser.
 */
import { useCallback, useId, useState } from "react"
import { Download, FileCheck2, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PdfStatusIndicator } from "@/components/publishing/conversion/pdf/pdf-capability-status"
import {
  DEFAULT_EXPANDED_SETTINGS,
  describeLocalFile,
  formatBytes,
  PDF_WORKFLOW_STEPS,
  getWorkflowStepState,
  type PdfGuidelineState,
  type PdfLocalFile,
  type PdfSettingsGroupId,
  type PdfWorkflowStepId,
  type PdfWorkspaceRegion,
} from "@/components/publishing/conversion/pdf/pdf-workspace-config"
import {
  PdfPreviewPanel,
  PdfProcessingPanel,
  PdfSettingsPanel,
  PdfSourcePanel,
  type PdfPreviewMode,
} from "@/components/publishing/conversion/pdf/pdf-workspace-panels"
import { PdfThreePanelContent } from "@/components/publishing/conversion/pdf/pdf-content"
import { cn } from "@/lib/utils"

type PanelTab = "source" | "preview" | "settings"

const PANEL_TABS: { id: PanelTab; label: string }[] = [
  { id: "source", label: "Source Files" },
  { id: "preview", label: "Preview" },
  { id: "settings", label: "Settings" },
]

let fileSeq = 0

export function PdfWorkspace({ guidelinesHref = null }: { guidelinesHref?: string | null }) {
  const baseId = useId()
  const regionIds: Record<PdfWorkspaceRegion, string> = {
    source: `${baseId}-source`,
    preview: `${baseId}-preview`,
    settings: `${baseId}-settings`,
    guidelines: `${baseId}-guidelines`,
    processing: `${baseId}-processing`,
  }

  const [files, setFiles] = useState<PdfLocalFile[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [previewMode, setPreviewMode] = useState<PdfPreviewMode>("original")
  const [targetFormat, setTargetFormat] = useState("")
  const [expandedGroups, setExpandedGroups] = useState<PdfSettingsGroupId[]>([...DEFAULT_EXPANDED_SETTINGS])
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
  const [bottomOpen, setBottomOpen] = useState(false)
  const [panelTab, setPanelTab] = useState<PanelTab>("source")
  const [currentStep, setCurrentStep] = useState<PdfWorkflowStepId>("upload")
  const [announcement, setAnnouncement] = useState("")
  // Guidelines are optional; until Phase 6 the workspace always runs on the Standard Profile.
  const guidelineState: PdfGuidelineState = "not-provided"

  const selectedFile = files.find((f) => f.id === selectedId) ?? null

  const addFiles = useCallback(
    (incoming: File[]) => {
      if (!incoming.length) return
      const next = [...files]
      for (const file of incoming) next.push(describeLocalFile(file, next, `local-${++fileSeq}`))
      const added = next.slice(files.length)
      const issues = added.filter((f) => f.issue).length
      setFiles(next)
      if (!selectedId) setSelectedId(added.find((f) => !f.issue)?.id ?? added[0].id)
      setAnnouncement(
        `${added.length} ${added.length === 1 ? "file" : "files"} added.${issues ? ` ${issues} with validation issues.` : ""}`,
      )
    },
    [files, selectedId],
  )

  const removeFile = (id: string) => {
    const file = files.find((f) => f.id === id)
    const remaining = files.filter((f) => f.id !== id)
    setFiles(remaining)
    if (selectedId === id) setSelectedId(remaining[0]?.id ?? null)
    if (file) setAnnouncement(`${file.name} removed.`)
  }

  const replaceFile = (id: string, incoming: File) => {
    const others = files.filter((f) => f.id !== id)
    const replacement = describeLocalFile(incoming, others, id)
    setFiles(files.map((f) => (f.id === id ? replacement : f)))
    setAnnouncement(`Replaced with ${replacement.name}.${replacement.issue ? " The new file has a validation issue." : ""}`)
  }

  const removeAllFiles = () => {
    const count = files.length
    setFiles([])
    setSelectedId(null)
    setAnnouncement(`${count} ${count === 1 ? "file" : "files"} removed.`)
  }

  const previewFile = (id: string) => {
    setSelectedId(id)
    setPreviewMode("original")
    goToStep("preview")
  }

  const toggleGroup = (id: PdfSettingsGroupId) =>
    setExpandedGroups((groups) => (groups.includes(id) ? groups.filter((g) => g !== id) : [...groups, id]))

  const resetSettings = () => {
    setTargetFormat("")
    setExpandedGroups([...DEFAULT_EXPANDED_SETTINGS])
    setAnnouncement("Settings reset to the Standard Profile defaults.")
  }

  const goToStep = (stepId: PdfWorkflowStepId) => {
    const step = PDF_WORKFLOW_STEPS.find((s) => s.id === stepId)!
    setCurrentStep(stepId)
    const region = step.region
    if (region === "source") {
      setLeftOpen(true)
      setPanelTab("source")
    } else if (region === "settings" || region === "guidelines") {
      setRightOpen(true)
      setPanelTab("settings")
      if (region === "guidelines") setExpandedGroups((g) => (g.includes("guidelines") ? g : [...g, "guidelines"]))
    } else if (region === "preview") {
      setPanelTab("preview")
    } else {
      setBottomOpen(true)
    }
    requestAnimationFrame(() => document.getElementById(regionIds[region])?.focus({ preventScroll: false }))
  }

  const panelVisibility = (tab: PanelTab) => cn("min-h-0 min-w-0", panelTab !== tab && "md:max-xl:hidden")

  return (
    <div data-slot="pdf-workspace" className="flex min-w-0 flex-col gap-3">
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <PdfWorkflowStepper currentStep={currentStep} onSelect={goToStep} />

      <PdfWorkspaceToolbar file={selectedFile} fileCount={files.length} targetFormat={targetFormat} />

      <div role="group" aria-label="Workspace panels" className="hidden gap-1 rounded-lg bg-muted p-1 md:flex xl:hidden">
        {PANEL_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-pressed={panelTab === tab.id}
            aria-controls={regionIds[tab.id]}
            onClick={() => setPanelTab(tab.id)}
            className={cn(
              "flex-1 rounded-md px-3 py-1.5 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
              panelTab === tab.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
            {tab.id === "source" && files.length > 0 && <span className="ml-1.5 text-xs text-muted-foreground">({files.length})</span>}
          </button>
        ))}
      </div>

      <PdfThreePanelContent
        data-slot="pdf-workspace-panels"
        sourceCollapsed={!leftOpen}
        settingsCollapsed={!rightOpen}
        className="gap-3 xl:h-[min(80dvh,920px)] xl:min-h-[600px]"
        slotClassNames={{
          source: panelVisibility("source"),
          preview: cn(panelVisibility("preview"), "md:max-xl:h-[70dvh]"),
          settings: panelVisibility("settings"),
        }}
        source={
          <PdfSourcePanel
            regionId={regionIds.source}
            files={files}
            selectedId={selectedId}
            expanded={leftOpen}
            onToggle={() => setLeftOpen((v) => !v)}
            onAddFiles={addFiles}
            onSelect={setSelectedId}
            onPreview={previewFile}
            onReplace={replaceFile}
            onRemove={removeFile}
            onRemoveAll={removeAllFiles}
          />
        }
        preview={
          <PdfPreviewPanel
            regionId={regionIds.preview}
            file={selectedFile}
            hasFiles={files.length > 0}
            mode={previewMode}
            onModeChange={setPreviewMode}
          />
        }
        settings={
          <PdfSettingsPanel
            regionId={regionIds.settings}
            guidelinesRegionId={regionIds.guidelines}
            expanded={rightOpen}
            onToggle={() => setRightOpen((v) => !v)}
            sourceFile={selectedFile}
            targetFormat={targetFormat}
            onTargetFormatChange={setTargetFormat}
            expandedGroups={expandedGroups}
            onToggleGroup={toggleGroup}
            guidelineState={guidelineState}
            guidelinesHref={guidelinesHref}
            onReset={resetSettings}
          />
        }
      />

      <PdfProcessingPanel regionId={regionIds.processing} expanded={bottomOpen} onToggle={() => setBottomOpen((v) => !v)} files={files} />
    </div>
  )
}

// ─── Workflow stepper ───────────────────────────────────────────────────────

export function PdfWorkflowStepper({
  currentStep,
  onSelect,
}: {
  currentStep: PdfWorkflowStepId
  onSelect: (id: PdfWorkflowStepId) => void
}) {
  return (
    <nav aria-label="Workflow steps">
      <ol className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-6">
        {PDF_WORKFLOW_STEPS.map((step, index) => {
          const state = getWorkflowStepState(step, currentStep)
          const isCurrent = state === "current"
          return (
            <li key={step.id} className="min-w-0">
              <button
                type="button"
                aria-current={isCurrent ? "step" : undefined}
                onClick={() => onSelect(step.id)}
                data-state={state}
                className={cn(
                  "flex h-full w-full min-w-0 items-start gap-2 rounded-md border px-2.5 py-2 text-left outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                  isCurrent ? "border-primary bg-primary/5" : "bg-card hover:bg-muted/50",
                )}
              >
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums",
                    isCurrent ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground",
                  )}
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-foreground">
                    {step.label}
                    {step.optional && <span className="text-xs font-normal text-muted-foreground">(Optional)</span>}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">{step.description}</span>
                  {state === "planned" && <span className="text-xs text-muted-foreground">Planned</span>}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

// ─── Workspace toolbar ──────────────────────────────────────────────────────

export function PdfWorkspaceToolbar({
  file,
  fileCount,
  targetFormat,
}: {
  file: PdfLocalFile | null
  fileCount: number
  targetFormat: string
}) {
  const hintId = useId()
  return (
    <div
      role="region"
      aria-label="Workspace summary"
      className="flex min-w-0 flex-col gap-2 rounded-lg border bg-card px-3 py-2 lg:flex-row lg:items-center lg:justify-between"
    >
      <dl className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <div className="flex min-w-0 items-center gap-1.5">
          <dt className="text-muted-foreground">Document</dt>
          <dd className="truncate font-medium text-foreground">
            {file ? `${file.name} · ${(file.extension || "?").toUpperCase()} · ${formatBytes(file.sizeBytes)}` : fileCount ? "None selected" : "No files"}
          </dd>
        </div>
        <div className="flex items-center gap-1.5">
          <dt className="text-muted-foreground">Target</dt>
          <dd className="font-medium text-foreground">{targetFormat || "Not selected"}</dd>
        </div>
        <div className="flex items-center gap-1.5">
          <dt className="text-muted-foreground">Profile</dt>
          <dd className="font-medium text-foreground">Standard</dd>
        </div>
        <div className="flex items-center gap-1.5">
          <dt className="text-muted-foreground">Status</dt>
          <dd>
            <PdfStatusIndicator label="No active job" tone="neutral" bordered />
          </dd>
        </div>
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Job actions" aria-describedby={hintId} className="flex flex-wrap gap-1.5">
          <Button variant="outline" size="sm" disabled>
            <FileCheck2 aria-hidden="true" />
            Validate
          </Button>
          <Button size="sm" disabled>
            <Play aria-hidden="true" />
            Process
          </Button>
          <Button variant="outline" size="sm" disabled>
            <Download aria-hidden="true" />
            Download
          </Button>
        </div>
        <p id={hintId} className="text-xs text-muted-foreground">
          Processing is planned for a later phase.
        </p>
      </div>
    </div>
  )
}
