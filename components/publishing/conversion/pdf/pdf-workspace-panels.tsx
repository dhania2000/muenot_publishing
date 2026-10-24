"use client"

/**
 * @file components/publishing/conversion/pdf/pdf-workspace-panels.tsx
 * @module Publishing › Conversion › PDF
 * @kind React client component
 * @summary The four workspace regions (Source Files, Document Preview, Conversion Settings, Processing & Validation),
 *   composed from the shared PDF components (Task 8): file, preview, settings, guidelines, processing and dialogs.
 * @exports PdfSourcePanel, PdfPreviewPanel, PdfSettingsPanel, PdfProcessingPanel, PdfPreviewMode
 *
 * Every control either works locally or is disabled with a visible reason; nothing simulates processing.
 */
import { useId, useRef, useState } from "react"
import Link from "next/link"
import {
  AlertTriangle,
  ChevronDown,
  Columns2,
  Eye,
  FileText,
  Info,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Replace,
  SlidersHorizontal,
  Trash2,
  type LucideIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PdfPanelHeader } from "@/components/publishing/conversion/pdf/pdf-content"
import { PdfConfirmDialog, PdfFileInfoDialog } from "@/components/publishing/conversion/pdf/pdf-dialogs"
import { PdfFeedbackState } from "@/components/publishing/conversion/pdf/pdf-feedback-state"
import {
  PdfFileActionMenu,
  PdfFileList,
  PdfFileMetadata,
  PdfUploadDropzone,
  type PdfFileCardData,
  type PdfFileMetadataFields,
} from "@/components/publishing/conversion/pdf/pdf-file-components"
import { PdfGuidelinesStatus } from "@/components/publishing/conversion/pdf/pdf-guidelines-components"
import {
  PdfPreviewContainer,
  PdfPreviewModeSelector,
  PdfPreviewToolbar,
  type PdfPreviewMode,
} from "@/components/publishing/conversion/pdf/pdf-preview-components"
import { PdfProcessingLog, PdfValidationSummary } from "@/components/publishing/conversion/pdf/pdf-processing-components"
import type { PdfGuidelineContext } from "@/components/publishing/conversion/pdf/pdf-status-model"
import {
  PdfFormatSelector,
  PdfPlannedSettingRow,
  PdfProfileSelector,
  PdfSettingsGroup,
} from "@/components/publishing/conversion/pdf/pdf-settings-components"
import {
  getTargetFormatOptions,
  PDF_FILE_ISSUE_MESSAGES,
  PDF_SETTINGS_GROUPS,
  PDF_SOURCE_EXTENSIONS,
  resolveSettingsProfile,
  type PdfGuidelineState,
  type PdfLocalFile,
  type PdfSettingsGroupId,
} from "@/components/publishing/conversion/pdf/pdf-workspace-config"
import { cn } from "@/lib/utils"

export type { PdfPreviewMode }

const UNPARSED_METADATA_NOTE = "Page count, dimensions and language need server-side parsing (planned)."
const PANEL_SURFACE =
  "flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border bg-card outline-none focus-visible:ring-3 focus-visible:ring-ring/50"

/** Browser-reported values only; nothing is inferred. */
function toCardData(file: PdfLocalFile): PdfFileCardData {
  return {
    id: file.id,
    name: file.name,
    format: file.extension,
    sizeBytes: file.sizeBytes,
    statusLabel: "Added locally · not uploaded",
    issueMessage: file.issue ? PDF_FILE_ISSUE_MESSAGES[file.issue] : null,
  }
}

function toMetadataFields(file: PdfLocalFile): PdfFileMetadataFields {
  return {
    filename: file.name,
    format: file.extension ? `.${file.extension}` : "None",
    mimeType: file.mimeType || "Not reported by browser",
    sizeBytes: file.sizeBytes,
    lastModified: file.lastModified,
    status: file.issue ? "Validation issue" : "Added locally · not uploaded",
  }
}

// ─── Collapse controls (panel container ≥ 56rem) ────────────────────────────

/**
 * The control that was activated disappears when a panel collapses or expands, so focus moves to its counterpart
 * (rail expand button ↔ header collapse button) instead of falling back to the document body.
 */
function toggleKeepingFocus(regionId: string, onToggle: () => void, focusTarget: "rail" | "collapse") {
  onToggle()
  requestAnimationFrame(() =>
    document.getElementById(regionId)?.querySelector<HTMLElement>(`[data-panel-toggle="${focusTarget}"]`)?.focus(),
  )
}

/** Moves focus to an element inside a region, or to the region itself when the element is gone. */
function focusWithin(regionId: string, selector: string) {
  const region = document.getElementById(regionId)
  const target = region?.querySelector<HTMLElement>(selector)
  ;(target ?? region)?.focus()
}

function CollapseButton({
  side,
  expanded,
  controls,
  panelName,
  onToggle,
}: {
  side: "left" | "right"
  expanded: boolean
  controls: string
  panelName: string
  onToggle: () => void
}) {
  const Icon = side === "left" ? (expanded ? PanelLeftClose : PanelLeftOpen) : expanded ? PanelRightClose : PanelRightOpen
  const label = `${expanded ? "Collapse" : "Expand"} ${panelName} panel`
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-expanded={expanded}
      aria-controls={controls}
      aria-label={label}
      title={label}
      data-panel-toggle="collapse"
      onClick={onToggle}
      className="hidden @4xl/pdf-panels:inline-flex"
    >
      <Icon aria-hidden="true" />
    </Button>
  )
}

/** 48px rail shown in place of a collapsed side panel (three-column mode only). */
function CollapsedRail({
  side,
  label,
  icon: Icon,
  controls,
  count,
  onExpand,
}: {
  side: "left" | "right"
  label: string
  icon: LucideIcon
  controls: string
  count?: number
  onExpand: () => void
}) {
  const ExpandIcon = side === "left" ? PanelLeftOpen : PanelRightOpen
  return (
    <div className="hidden h-full flex-col items-center gap-3 py-2 @4xl/pdf-panels:flex">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-expanded={false}
        aria-controls={controls}
        aria-label={`Expand ${label} panel`}
        title={`Expand ${label} panel`}
        data-panel-toggle="rail"
        onClick={onExpand}
      >
        <ExpandIcon aria-hidden="true" />
      </Button>
      <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
      <span className="text-xs font-medium text-muted-foreground [writing-mode:vertical-rl]">{label}</span>
      {count !== undefined && count > 0 && <Badge variant="secondary">{count}</Badge>}
    </div>
  )
}

// ─── Source Files ───────────────────────────────────────────────────────────

type PdfSourcePanelProps = {
  regionId: string
  files: readonly PdfLocalFile[]
  selectedId: string | null
  expanded: boolean
  onToggle: () => void
  onAddFiles: (files: File[]) => void
  onSelect: (id: string) => void
  onPreview: (id: string) => void
  onReplace: (id: string, file: File) => void
  onRemove: (id: string) => void
  onRemoveAll: () => void
}

type PendingConfirm = { kind: "remove"; file: PdfLocalFile } | { kind: "remove-all" } | null

export function PdfSourcePanel({
  regionId,
  files,
  selectedId,
  expanded,
  onToggle,
  onAddFiles,
  onSelect,
  onPreview,
  onReplace,
  onRemove,
  onRemoveAll,
}: PdfSourcePanelProps) {
  const headingId = useId()
  const bodyId = useId()
  const addInputRef = useRef<HTMLInputElement>(null)
  const replaceInputRef = useRef<HTMLInputElement>(null)
  const replaceTargetRef = useRef<string | null>(null)
  const [detailsFile, setDetailsFile] = useState<PdfLocalFile | null>(null)
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm>(null)
  const selected = files.find((f) => f.id === selectedId) ?? null
  const issueCount = files.filter((f) => f.issue).length
  const fileById = (id: string) => files.find((f) => f.id === id)!
  // Where focus goes once the confirm dialog closes after a removal (its trigger no longer exists).
  const focusAfterRemovalRef = useRef<string | null>(null)

  const confirmRemoval = () => {
    if (pendingConfirm?.kind === "remove") {
      const index = files.findIndex((f) => f.id === pendingConfirm.file.id)
      const neighbour = files[index + 1] ?? files[index - 1]
      focusAfterRemovalRef.current = neighbour ? `[data-file-id="${neighbour.id}"] button[aria-pressed]` : "[data-add-files]"
      onRemove(pendingConfirm.file.id)
    } else if (pendingConfirm?.kind === "remove-all") {
      focusAfterRemovalRef.current = "[data-add-files]"
      onRemoveAll()
    }
    setPendingConfirm(null)
  }

  const startReplace = (id: string) => {
    replaceTargetRef.current = id
    replaceInputRef.current?.click()
  }

  return (
    <section id={regionId} tabIndex={-1} aria-labelledby={headingId} className={PANEL_SURFACE}>
      {!expanded && (
        <CollapsedRail
          side="left"
          label="Source Files"
          icon={FileText}
          controls={bodyId}
          count={files.length}
          onExpand={() => toggleKeepingFocus(regionId, onToggle, "collapse")}
        />
      )}
      <div id={bodyId} className={cn("flex min-h-0 flex-1 flex-col", !expanded && "@4xl/pdf-panels:hidden")}>
        <PdfPanelHeader headingId={headingId} title="Source Files" meta={files.length > 0 && <Badge variant="secondary">{files.length}</Badge>}>
          <Button variant="outline" size="sm" data-add-files onClick={() => addInputRef.current?.click()}>
            <Plus aria-hidden="true" />
            Add Files
          </Button>
          <CollapseButton
            side="left"
            expanded={expanded}
            controls={bodyId}
            panelName="source files"
            onToggle={() => toggleKeepingFocus(regionId, onToggle, "rail")}
          />
        </PdfPanelHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
          <PdfUploadDropzone
            purpose="source"
            accept={PDF_SOURCE_EXTENSIONS}
            inputRef={addInputRef}
            onFiles={onAddFiles}
            hint="PDF, Word, Excel, PowerPoint, HTML, XML or images. Empty files are rejected; no size limit is applied locally. Files stay in this browser; server upload is planned."
          />
          <input
            ref={replaceInputRef}
            type="file"
            accept={PDF_SOURCE_EXTENSIONS.map((ext) => `.${ext}`).join(",")}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file && replaceTargetRef.current) onReplace(replaceTargetRef.current, file)
              replaceTargetRef.current = null
              e.target.value = ""
            }}
          />

          {issueCount > 0 && (
            <p role="alert" className="flex items-start gap-1.5 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              {issueCount === 1 ? "1 file has a validation issue." : `${issueCount} files have validation issues.`}
            </p>
          )}

          <PdfFileList
            label="Source files"
            files={files.map(toCardData)}
            selectedId={selectedId}
            onSelect={onSelect}
            emptyTitle="No files uploaded. Add a document to begin."
            renderActions={(card) => (
              <PdfFileActionMenu
                fileName={card.name}
                actions={[
                  { id: "preview", label: "Preview", icon: Eye, onAction: () => onPreview(card.id) },
                  { id: "details", label: "View Details", icon: Info, onAction: () => setDetailsFile(fileById(card.id)) },
                  { id: "replace", label: "Replace File", icon: Replace, onAction: () => startReplace(card.id) },
                  {
                    id: "remove",
                    label: "Remove File",
                    icon: Trash2,
                    destructive: true,
                    onAction: () => setPendingConfirm({ kind: "remove", file: fileById(card.id) }),
                  },
                ]}
              />
            )}
          />

          {files.length > 1 && (
            <Button variant="ghost" size="xs" className="self-end text-destructive hover:text-destructive" onClick={() => setPendingConfirm({ kind: "remove-all" })}>
              <Trash2 aria-hidden="true" />
              Remove All Files
            </Button>
          )}

          {selected && (
            <section aria-label="File information" className="rounded-md border bg-muted/20 p-3">
              <PdfFileMetadata fields={toMetadataFields(selected)} unavailableNote={UNPARSED_METADATA_NOTE} />
            </section>
          )}
        </div>
      </div>

      <PdfFileInfoDialog
        open={detailsFile !== null}
        onOpenChange={(open) => !open && setDetailsFile(null)}
        fields={detailsFile ? toMetadataFields(detailsFile) : {}}
        unavailableNote={UNPARSED_METADATA_NOTE}
      />
      <PdfConfirmDialog
        open={pendingConfirm !== null}
        onOpenChange={(open) => !open && setPendingConfirm(null)}
        destructive
        title={pendingConfirm?.kind === "remove-all" ? "Remove all files?" : "Remove this file?"}
        description={
          pendingConfirm?.kind === "remove"
            ? `${pendingConfirm.file.name} will be removed from this session. The original file on your device is not affected.`
            : `All ${files.length} files will be removed from this session. The original files on your device are not affected.`
        }
        confirmLabel={pendingConfirm?.kind === "remove-all" ? "Remove All" : "Remove File"}
        onConfirm={confirmRemoval}
        onCloseAutoFocus={(event) => {
          const selector = focusAfterRemovalRef.current
          if (!selector) return
          event.preventDefault()
          focusAfterRemovalRef.current = null
          focusWithin(regionId, selector)
        }}
      />
    </section>
  )
}

// ─── Document Preview ───────────────────────────────────────────────────────

type PdfPreviewPanelProps = {
  regionId: string
  file: PdfLocalFile | null
  hasFiles: boolean
  mode: PdfPreviewMode
  onModeChange: (mode: PdfPreviewMode) => void
}

export function PdfPreviewPanel({ regionId, file, hasFiles, mode, onModeChange }: PdfPreviewPanelProps) {
  const headingId = useId()
  return (
    <section id={regionId} tabIndex={-1} aria-labelledby={headingId} className={cn(PANEL_SURFACE, "min-h-[420px]")}>
      <Tabs value={mode} onValueChange={(value) => onModeChange(value as PdfPreviewMode)} className="flex min-h-0 flex-1 flex-col gap-0">
        <PdfPanelHeader
          headingId={headingId}
          title="Document Preview"
          meta={
            file && (
              <span className="min-w-0 truncate text-xs text-muted-foreground" title={file.name}>
                <span className="sr-only">Selected document: </span>
                {file.name}
              </span>
            )
          }
        >
          <PdfPreviewModeSelector />
        </PdfPanelHeader>
        <PdfPreviewToolbar />
        <div className="min-h-0 flex-1 overflow-y-auto bg-muted/20 p-4">
          <TabsContent value="original" className="h-full">
            <OriginalPreview file={file} hasFiles={hasFiles} />
          </TabsContent>
          <TabsContent value="output" className="h-full">
            <PdfPreviewContainer
              state="no-output"
              title="No converted output available."
              description="Converted output appears here after processing, which is planned for a later phase."
            />
          </TabsContent>
          <TabsContent value="compare" className="h-full">
            <PdfPreviewContainer
              state="no-output"
              icon={Columns2}
              title="No converted output available."
              description="Side-by-side comparison needs both a source document and a converted output."
            />
          </TabsContent>
        </div>
      </Tabs>
    </section>
  )
}

function OriginalPreview({ file, hasFiles }: { file: PdfLocalFile | null; hasFiles: boolean }) {
  if (!file) {
    return (
      <PdfPreviewContainer
        state="no-document"
        title="Select or upload a document to preview."
        description={hasFiles ? "Choose a file in Source Files." : "Add a document in Source Files to begin."}
      />
    )
  }
  if (file.issue) {
    return <PdfPreviewContainer state="error" title="Preview unavailable" description={PDF_FILE_ISSUE_MESSAGES[file.issue]} />
  }
  return (
    <PdfPreviewContainer
      state="unavailable"
      title="Document rendering is planned"
      description={`${file.name} is selected. Page rendering arrives with the PDF viewer; its metadata is shown in Source Files. A visual preview will not make the document's text available to screen readers.`}
    />
  )
}

// ─── Conversion Settings ────────────────────────────────────────────────────

type PdfSettingsPanelProps = {
  regionId: string
  guidelinesRegionId: string
  expanded: boolean
  onToggle: () => void
  sourceFile: PdfLocalFile | null
  targetFormat: string
  onTargetFormatChange: (format: string) => void
  expandedGroups: readonly PdfSettingsGroupId[]
  onToggleGroup: (id: PdfSettingsGroupId) => void
  guidelineState: PdfGuidelineState
  /** Real guideline context for the job, when a source exists (Phase 6). Null means Standard Profile. */
  guidelineContext?: PdfGuidelineContext | null
  guidelinesHref: string | null
  onReset: () => void
}

export function PdfSettingsPanel(props: PdfSettingsPanelProps) {
  const { regionId, expanded, onToggle, expandedGroups, onToggleGroup, onReset } = props
  const headingId = useId()
  const bodyId = useId()
  const saveHintId = useId()
  return (
    <section id={regionId} tabIndex={-1} aria-labelledby={headingId} className={PANEL_SURFACE}>
      {!expanded && (
        <CollapsedRail
          side="right"
          label="Settings"
          icon={SlidersHorizontal}
          controls={bodyId}
          onExpand={() => toggleKeepingFocus(regionId, onToggle, "collapse")}
        />
      )}
      <div id={bodyId} className={cn("flex min-h-0 flex-1 flex-col", !expanded && "@4xl/pdf-panels:hidden")}>
        <PdfPanelHeader headingId={headingId} title="Conversion Settings">
          <CollapseButton
            side="right"
            expanded={expanded}
            controls={bodyId}
            panelName="settings"
            onToggle={() => toggleKeepingFocus(regionId, onToggle, "rail")}
          />
        </PdfPanelHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {PDF_SETTINGS_GROUPS.map((group) => (
            <PdfSettingsGroup
              key={group.id}
              id={group.id === "guidelines" ? props.guidelinesRegionId : undefined}
              label={group.label}
              optional={group.id === "guidelines"}
              open={expandedGroups.includes(group.id)}
              onToggle={() => onToggleGroup(group.id)}
            >
              {group.id === "input" && <SourceFormatField file={props.sourceFile} />}
              {group.id === "output" && (
                <>
                  <PdfFormatSelector
                    options={getTargetFormatOptions()}
                    value={props.targetFormat}
                    onChange={props.onTargetFormatChange}
                    help="Formats come from the PDF capability registry. Each option shows whether it can be produced today."
                  />
                  <PdfProfileSelector value={resolveSettingsProfile(props.guidelineState).id} />
                </>
              )}
              {group.id === "guidelines" ? (
                <GuidelinesBlock state={props.guidelineState} context={props.guidelineContext ?? null} href={props.guidelinesHref} />
              ) : (
                group.plannedItems.length > 0 && (
                  <ul className="divide-y" aria-label={`${group.label} (planned)`}>
                    {group.plannedItems.map((item) => (
                      <PdfPlannedSettingRow key={item} label={item} />
                    ))}
                  </ul>
                )
              )}
            </PdfSettingsGroup>
          ))}
        </div>
        <footer className="flex shrink-0 flex-col gap-1.5 border-t px-3 py-2">
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onReset}>
              Reset Settings
            </Button>
            <Button size="sm" disabled aria-describedby={saveHintId}>
              Save Settings
            </Button>
          </div>
          <p id={saveHintId} className="text-right text-xs text-muted-foreground">
            Settings apply to this session only; saving is planned.
          </p>
        </footer>
      </div>
    </section>
  )
}

function SourceFormatField({ file }: { file: PdfLocalFile | null }) {
  return (
    <dl className="flex flex-col gap-1">
      <dt className="text-xs font-medium text-muted-foreground">Source Format</dt>
      <dd className="text-sm text-foreground">{file && !file.issue ? file.extension.toUpperCase() : "Detected from the selected file"}</dd>
    </dl>
  )
}

function GuidelinesBlock({ state, context, href }: { state: PdfGuidelineState; context: PdfGuidelineContext | null; href: string | null }) {
  const actionsHintId = useId()
  return (
    <div className="flex flex-col gap-3">
      <PdfGuidelinesStatus state={state} context={context} />
      {href ? (
        <Button asChild variant="outline" size="sm" className="self-start">
          <Link href={href}>Manage Guidelines</Link>
        </Button>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Guideline actions" aria-describedby={actionsHintId}>
            {["View Guidelines", "Add Guidelines", "Review Requirements"].map((label) => (
              <Button key={label} variant="outline" size="xs" disabled>
                {label}
              </Button>
            ))}
          </div>
          <p id={actionsHintId} className="text-xs text-muted-foreground">
            Guideline management is planned. Processing never requires guidelines.
          </p>
        </>
      )}
    </div>
  )
}

// ─── Processing & Validation ────────────────────────────────────────────────

type PdfProcessingPanelProps = {
  regionId: string
  expanded: boolean
  onToggle: () => void
  files: readonly PdfLocalFile[]
}

export function PdfProcessingPanel({ regionId, expanded, onToggle, files }: PdfProcessingPanelProps) {
  const headingId = useId()
  const bodyId = useId()
  const fileIssues = files.filter((f) => f.issue)
  return (
    <section
      id={regionId}
      tabIndex={-1}
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <h2 id={headingId} className="m-0">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={onToggle}
          className="flex min-h-11 w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 text-left outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50"
        >
          <span className="text-sm font-semibold text-foreground">Processing &amp; Validation</span>
          <span className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
            No active processing job.
            <ChevronDown className={cn("size-4 transition-transform", expanded && "rotate-180")} aria-hidden="true" />
          </span>
        </button>
      </h2>
      <div id={bodyId} hidden={!expanded} className="border-t">
        <Tabs defaultValue="processing" className="gap-0">
          <TabsList variant="line" aria-label="Processing details" className="px-2 pt-1">
            <TabsTrigger value="processing">Processing</TabsTrigger>
            <TabsTrigger value="validation">
              Validation
              {fileIssues.length > 0 && (
                <Badge variant="destructive">
                  {fileIssues.length}
                  <span className="sr-only"> file issues</span>
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="logs">Logs</TabsTrigger>
          </TabsList>
          <div className="max-h-[40vh] overflow-y-auto p-3">
            <TabsContent value="processing">
              <PdfFeedbackState
                kind="no-job"
                size="compact"
                title="No active processing job."
                description="Stage, progress, messages, warnings and errors will appear here once processing is available."
              />
            </TabsContent>
            <TabsContent value="validation" className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Local file checks</h3>
                {files.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No files to check.</p>
                ) : fileIssues.length === 0 ? (
                  <p className="text-sm text-foreground">
                    {files.length === 1 ? "1 file passes" : `${files.length} files pass`} the local type and size checks. Full validation is planned.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {fileIssues.map((f) => (
                      <li key={f.id} className="flex items-start gap-1.5 text-sm">
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden="true" />
                        <span className="min-w-0">
                          <span className="font-medium text-foreground">{f.name}</span>
                          <span className="text-muted-foreground"> — {PDF_FILE_ISSUE_MESSAGES[f.issue!]}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <PdfValidationSummary status="not-run" />
              <p className="text-xs text-muted-foreground">
                Standard conversion checks, client guideline checks and format compliance checks appear here after validation, which is planned.
              </p>
            </TabsContent>
            <TabsContent value="logs">
              <PdfProcessingLog entries={[]} />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </section>
  )
}
