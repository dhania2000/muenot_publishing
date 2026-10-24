"use client"

/**
 * @file components/publishing/conversion/pdf/pdf-workspace-panels.tsx
 * @module Publishing › Conversion › PDF
 * @kind React client component
 * @summary The four workspace regions (Source Files, Document Preview, Conversion Settings, Processing & Validation)
 *   plus their shared panel header, compact empty state and planned-setting row.
 * @exports PdfPanelHeader, PdfWorkspaceEmptyState, PdfSourcePanel, PdfPreviewPanel, PdfSettingsPanel, PdfProcessingPanel,
 *   PdfPreviewMode
 *
 * Every control either works locally or is disabled with a visible reason; nothing simulates processing.
 */
import { useId, useRef, useState } from "react"
import Link from "next/link"
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns2,
  FileText,
  FileWarning,
  Maximize,
  Minus,
  MoveHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RotateCw,
  Scan,
  Search,
  SlidersHorizontal,
  Trash2,
  Upload,
  type LucideIcon,
} from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PdfCapabilityStatusIndicator } from "@/components/publishing/conversion/pdf/pdf-capability-status"
import { PDF_CAPABILITY_STATUS_META } from "@/components/publishing/conversion/pdf/pdf-capabilities"
import { PdfFeedbackState } from "@/components/publishing/conversion/pdf/pdf-feedback-state"
import {
  formatBytes,
  getTargetFormatOptions,
  PDF_FILE_ISSUE_MESSAGES,
  PDF_GUIDELINE_PRIORITY,
  PDF_GUIDELINE_STATES,
  PDF_SETTINGS_GROUPS,
  PDF_SOURCE_EXTENSIONS,
  resolveSettingsProfile,
  STANDARD_PROFILE,
  type PdfGuidelineState,
  type PdfLocalFile,
  type PdfSettingsGroupId,
} from "@/components/publishing/conversion/pdf/pdf-workspace-config"
import { cn } from "@/lib/utils"

// ─── Shared pieces ──────────────────────────────────────────────────────────

type PdfPanelHeaderProps = {
  id: string
  title: string
  meta?: React.ReactNode
  actions?: React.ReactNode
}

/** Sticky header used by every workspace panel. `id` labels the panel region. */
export function PdfPanelHeader({ id, title, meta, actions }: PdfPanelHeaderProps) {
  return (
    <header className="flex min-h-11 shrink-0 items-center justify-between gap-2 border-b bg-card px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <h2 id={id} className="truncate text-sm font-semibold text-foreground">
          {title}
        </h2>
        {meta}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </header>
  )
}

/** Compact empty state for narrow panels; the preview uses the larger PdfFeedbackState. */
export function PdfWorkspaceEmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-md border border-dashed px-3 py-6 text-center">
      <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>}
      {action}
    </div>
  )
}

function PlannedRow({ label }: { label: string }) {
  return (
    <li className="flex items-center justify-between gap-2 py-1.5 text-sm">
      <span className="text-foreground">{label}</span>
      <PdfCapabilityStatusIndicator status="planned" />
    </li>
  )
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
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-expanded={expanded}
      aria-controls={controls}
      aria-label={`${expanded ? "Collapse" : "Expand"} ${panelName} panel`}
      title={`${expanded ? "Collapse" : "Expand"} ${panelName} panel`}
      onClick={onToggle}
      className="hidden xl:inline-flex"
    >
      <Icon aria-hidden="true" />
    </Button>
  )
}

/** 48px rail shown in place of a collapsed side panel (≥ xl only). */
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
    <div className="hidden h-full flex-col items-center gap-3 py-2 xl:flex">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-expanded={false}
        aria-controls={controls}
        aria-label={`Expand ${label} panel`}
        title={`Expand ${label} panel`}
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

const ACCEPT_ATTR = PDF_SOURCE_EXTENSIONS.map((ext) => `.${ext}`).join(",")

type PdfSourcePanelProps = {
  regionId: string
  files: readonly PdfLocalFile[]
  selectedId: string | null
  expanded: boolean
  onToggle: () => void
  onAddFiles: (files: File[]) => void
  onSelect: (id: string) => void
  onRemove: (id: string) => void
}

export function PdfSourcePanel({ regionId, files, selectedId, expanded, onToggle, onAddFiles, onSelect, onRemove }: PdfSourcePanelProps) {
  const headingId = useId()
  const bodyId = useId()
  const hintId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const selected = files.find((f) => f.id === selectedId) ?? null
  const issueCount = files.filter((f) => f.issue).length

  const browse = () => inputRef.current?.click()

  return (
    <section
      id={regionId}
      tabIndex={-1}
      aria-labelledby={headingId}
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border bg-card outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {!expanded && <CollapsedRail side="left" label="Source Files" icon={FileText} controls={bodyId} count={files.length} onExpand={onToggle} />}
      <div id={bodyId} className={cn("flex min-h-0 flex-1 flex-col", !expanded && "xl:hidden")}>
        <PdfPanelHeader
          id={headingId}
          title="Source Files"
          meta={files.length > 0 && <Badge variant="secondary">{files.length}</Badge>}
          actions={
            <>
              <Button variant="outline" size="sm" onClick={browse}>
                <Plus aria-hidden="true" />
                Add Files
              </Button>
              <CollapseButton side="left" expanded={expanded} controls={bodyId} panelName="source files" onToggle={onToggle} />
            </>
          }
        />
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPT_ATTR}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              onAddFiles(Array.from(e.target.files ?? []))
              e.target.value = ""
            }}
          />
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              onAddFiles(Array.from(e.dataTransfer.files))
            }}
            className={cn(
              "flex flex-col items-center gap-2 rounded-md border border-dashed px-3 py-4 text-center transition-colors",
              dragging ? "border-primary bg-primary/5" : "bg-muted/30",
            )}
          >
            <Upload className="size-5 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-foreground">
              Drag &amp; drop files or{" "}
              <button type="button" onClick={browse} aria-describedby={hintId} className="font-medium text-primary underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none">
                browse
              </button>
            </p>
            <p id={hintId} className="text-xs leading-relaxed text-muted-foreground">
              PDF, Word, Excel, PowerPoint, HTML, XML or images. Files stay in this browser; server upload is planned.
            </p>
          </div>

          {issueCount > 0 && (
            <p role="alert" className="flex items-start gap-1.5 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              {issueCount === 1 ? "1 file has a validation issue." : `${issueCount} files have validation issues.`}
            </p>
          )}

          {files.length === 0 ? (
            <PdfWorkspaceEmptyState icon={FileText} title="No files uploaded. Add a document to begin." />
          ) : (
            <ul aria-label="Source files" className="flex flex-col gap-1.5">
              {files.map((file) => (
                <SourceFileRow
                  key={file.id}
                  file={file}
                  selected={file.id === selectedId}
                  onSelect={() => onSelect(file.id)}
                  onRemove={() => onRemove(file.id)}
                />
              ))}
            </ul>
          )}

          {selected && <SourceFileDetails file={selected} />}
        </div>
      </div>
    </section>
  )
}

function SourceFileRow({ file, selected, onSelect, onRemove }: { file: PdfLocalFile; selected: boolean; onSelect: () => void; onRemove: () => void }) {
  const Icon = file.issue ? FileWarning : FileText
  return (
    <li
      className={cn(
        "flex min-w-0 items-center gap-1 rounded-md border transition-colors",
        selected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50",
        file.issue && "border-destructive/40",
      )}
    >
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-start gap-2 rounded-md px-2 py-2 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <Icon className={cn("mt-0.5 size-4 shrink-0", file.issue ? "text-destructive" : "text-muted-foreground")} aria-hidden="true" />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium text-foreground">{file.name}</span>
          <span className="text-xs text-muted-foreground">
            {(file.extension || "Unknown").toUpperCase()} · {formatBytes(file.sizeBytes)}
          </span>
          {file.issue && <span className="text-xs text-destructive">{PDF_FILE_ISSUE_MESSAGES[file.issue]}</span>}
        </span>
      </button>
      <Button variant="ghost" size="icon-sm" aria-label={`Remove ${file.name}`} title="Remove from list" onClick={onRemove} className="mr-1">
        <Trash2 aria-hidden="true" />
      </Button>
    </li>
  )
}

function SourceFileDetails({ file }: { file: PdfLocalFile }) {
  const hintId = useId()
  const rows: [string, string][] = [
    ["Filename", file.name],
    ["Extension", file.extension ? `.${file.extension}` : "None"],
    ["MIME type", file.mimeType || "Not reported by browser"],
    ["File size", formatBytes(file.sizeBytes)],
    ["Last modified", new Date(file.lastModified).toLocaleString()],
    ["Status", file.issue ? "Validation issue" : "Added locally · not uploaded"],
  ]
  return (
    <section aria-label="File information" className="flex flex-col gap-2 rounded-md border bg-muted/20 p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">File information</h3>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
        {rows.map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="text-muted-foreground">{term}</dt>
            <dd className="truncate text-foreground" title={value}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">Page count, dimensions and orientation need server-side parsing (planned).</p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="File actions" aria-describedby={hintId}>
        {["View", "Replace", "Rename", "Select Pages"].map((action) => (
          <Button key={action} variant="outline" size="xs" disabled>
            {action}
          </Button>
        ))}
      </div>
      <p id={hintId} className="text-xs text-muted-foreground">
        These file actions are planned.
      </p>
    </section>
  )
}

// ─── Document Preview ───────────────────────────────────────────────────────

export type PdfPreviewMode = "original" | "output" | "compare"

const VIEWER_TOOLS: { label: string; icon: LucideIcon }[] = [
  { label: "Previous page", icon: ChevronLeft },
  { label: "Next page", icon: ChevronRight },
  { label: "Zoom out", icon: Minus },
  { label: "Zoom in", icon: Plus },
  { label: "Fit width", icon: MoveHorizontal },
  { label: "Fit page", icon: Scan },
  { label: "Rotate view", icon: RotateCw },
  { label: "Search document", icon: Search },
  { label: "Fullscreen", icon: Maximize },
]

type PdfPreviewPanelProps = {
  regionId: string
  file: PdfLocalFile | null
  hasFiles: boolean
  mode: PdfPreviewMode
  onModeChange: (mode: PdfPreviewMode) => void
}

export function PdfPreviewPanel({ regionId, file, hasFiles, mode, onModeChange }: PdfPreviewPanelProps) {
  const headingId = useId()
  const toolbarHintId = useId()
  return (
    <section
      id={regionId}
      tabIndex={-1}
      aria-labelledby={headingId}
      className="flex h-full min-h-[420px] min-w-0 flex-col overflow-hidden rounded-lg border bg-card outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <Tabs value={mode} onValueChange={(value) => onModeChange(value as PdfPreviewMode)} className="flex min-h-0 flex-1 flex-col gap-0">
        <PdfPanelHeader
          id={headingId}
          title={file ? file.name : "Document Preview"}
          actions={
            <TabsList aria-label="Preview mode">
              <TabsTrigger value="original">Original</TabsTrigger>
              <TabsTrigger value="output">Output</TabsTrigger>
              <TabsTrigger value="compare">
                <Columns2 aria-hidden="true" className="hidden sm:block" />
                Compare
              </TabsTrigger>
            </TabsList>
          }
        />
        <div
          role="toolbar"
          aria-label="Viewer controls"
          aria-describedby={toolbarHintId}
          className="flex min-w-0 flex-wrap items-center gap-1 border-b bg-muted/30 px-2 py-1.5"
        >
          {VIEWER_TOOLS.slice(0, 2).map(({ label, icon: Icon }) => (
            <Button key={label} variant="ghost" size="icon-sm" disabled aria-label={label} title={label}>
              <Icon aria-hidden="true" />
            </Button>
          ))}
          <span className="px-1 text-xs tabular-nums text-muted-foreground" aria-label="Page number unavailable">
            {"– / –"}
          </span>
          <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
          {VIEWER_TOOLS.slice(2).map(({ label, icon: Icon }) => (
            <Button key={label} variant="ghost" size="icon-sm" disabled aria-label={label} title={label}>
              <Icon aria-hidden="true" />
            </Button>
          ))}
          <span id={toolbarHintId} className="ml-auto text-xs text-muted-foreground">
            Viewer controls arrive with document rendering.
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto bg-muted/20 p-4">
          <TabsContent value="original" className="h-full">
            <OriginalPreview file={file} hasFiles={hasFiles} />
          </TabsContent>
          <TabsContent value="output" className="h-full">
            <PdfFeedbackState kind="no-data" title="No converted output available." description="Converted output appears here after processing, which is planned for a later phase." />
          </TabsContent>
          <TabsContent value="compare" className="h-full">
            <PdfFeedbackState
              kind="no-data"
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
      <PdfFeedbackState
        kind="no-document"
        title="Select or upload a document to preview."
        description={hasFiles ? "Choose a file in Source Files." : "Add a document in Source Files to begin."}
      />
    )
  }
  if (file.issue) {
    return <PdfFeedbackState kind="error" title="Preview unavailable" description={PDF_FILE_ISSUE_MESSAGES[file.issue]} />
  }
  return (
    <PdfFeedbackState
      kind="unavailable"
      title="Document rendering is planned"
      description={`${file.name} is selected. Page rendering arrives with the PDF viewer; its metadata is shown in Source Files.`}
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
  guidelinesHref: string | null
  onReset: () => void
}

export function PdfSettingsPanel(props: PdfSettingsPanelProps) {
  const { regionId, expanded, onToggle, expandedGroups, onToggleGroup, onReset } = props
  const headingId = useId()
  const bodyId = useId()
  const saveHintId = useId()
  return (
    <section
      id={regionId}
      tabIndex={-1}
      aria-labelledby={headingId}
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border bg-card outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {!expanded && <CollapsedRail side="right" label="Settings" icon={SlidersHorizontal} controls={bodyId} onExpand={onToggle} />}
      <div id={bodyId} className={cn("flex min-h-0 flex-1 flex-col", !expanded && "xl:hidden")}>
        <PdfPanelHeader
          id={headingId}
          title="Conversion Settings"
          actions={<CollapseButton side="right" expanded={expanded} controls={bodyId} panelName="settings" onToggle={onToggle} />}
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          {PDF_SETTINGS_GROUPS.map((group) => (
            <SettingsGroup
              key={group.id}
              id={group.id === "guidelines" ? props.guidelinesRegionId : undefined}
              label={group.label}
              optional={group.id === "guidelines"}
              open={expandedGroups.includes(group.id)}
              onToggle={() => onToggleGroup(group.id)}
            >
              {group.id === "input" && <SourceFormatField file={props.sourceFile} />}
              {group.id === "output" && <OutputFields targetFormat={props.targetFormat} onTargetFormatChange={props.onTargetFormatChange} guidelineState={props.guidelineState} />}
              {group.id === "guidelines" ? (
                <GuidelinesSummary state={props.guidelineState} href={props.guidelinesHref} />
              ) : (
                group.plannedItems.length > 0 && (
                  <ul className="divide-y" aria-label={`${group.label} (planned)`}>
                    {group.plannedItems.map((item) => (
                      <PlannedRow key={item} label={item} />
                    ))}
                  </ul>
                )
              )}
            </SettingsGroup>
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

function SettingsGroup({
  id,
  label,
  optional,
  open,
  onToggle,
  children,
}: {
  id?: string
  label: string
  optional?: boolean
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  const contentId = useId()
  return (
    <div id={id} tabIndex={id ? -1 : undefined} className="border-b outline-none last:border-b-0 focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={onToggle}
          className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm font-medium text-foreground outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50"
        >
          <span className="flex items-center gap-2">
            {label}
            {optional && <Badge variant="outline">Optional</Badge>}
          </span>
          <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden="true" />
        </button>
      </h3>
      <div id={contentId} hidden={!open} className="flex flex-col gap-3 px-3 pb-3">
        {children}
      </div>
    </div>
  )
}

function SourceFormatField({ file }: { file: PdfLocalFile | null }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">Source Format</span>
      <p className="text-sm text-foreground">
        {file && !file.issue ? file.extension.toUpperCase() : "Detected from the selected file"}
      </p>
    </div>
  )
}

function OutputFields({
  targetFormat,
  onTargetFormatChange,
  guidelineState,
}: {
  targetFormat: string
  onTargetFormatChange: (format: string) => void
  guidelineState: PdfGuidelineState
}) {
  const targetId = useId()
  const profileId = useId()
  const options = getTargetFormatOptions()
  const selected = options.find((o) => o.format === targetFormat)
  const profile = resolveSettingsProfile(guidelineState)
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={targetId} className="text-xs text-muted-foreground">
          Target Format
        </Label>
        <Select value={targetFormat} onValueChange={onTargetFormatChange}>
          <SelectTrigger id={targetId} className="w-full">
            <SelectValue placeholder="Select a format" />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.format} value={option.format}>
                {option.format}
                <span className="text-xs text-muted-foreground">{PDF_CAPABILITY_STATUS_META[option.status].label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selected && selected.status !== "available" && (
          <Alert>
            <AlertDescription className="text-xs">
              {selected.format} output is {PDF_CAPABILITY_STATUS_META[selected.status].label.toLowerCase()} and cannot be produced yet.
            </AlertDescription>
          </Alert>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={profileId} className="text-xs text-muted-foreground">
          Conversion Profile
        </Label>
        <Select value={profile.id} onValueChange={() => {}}>
          <SelectTrigger id={profileId} className="w-full">
            <SelectValue>{profile.label}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={STANDARD_PROFILE.id}>{STANDARD_PROFILE.label}</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">Saved presets and company profiles are planned.</p>
      </div>
    </>
  )
}

function GuidelinesSummary({ state, href }: { state: PdfGuidelineState; href: string | null }) {
  const actionsHintId = useId()
  const meta = PDF_GUIDELINE_STATES[state]
  const profile = resolveSettingsProfile(state)
  return (
    <div className="flex flex-col gap-3" data-guideline-state={state}>
      <p className="rounded-md bg-muted/50 px-2.5 py-2 text-xs leading-relaxed text-foreground">{meta.description}</p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Guideline status</dt>
        <dd className="text-foreground">{meta.label}</dd>
        <dt className="text-muted-foreground">Profile in effect</dt>
        <dd className="text-foreground">{profile.label}</dd>
        <dt className="text-muted-foreground">Company profile</dt>
        <dd className="text-foreground">None selected</dd>
        <dt className="text-muted-foreground">Applicable rules</dt>
        <dd className="text-foreground">None (standard settings)</dd>
      </dl>
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Rule priority</span>
        <ol className="flex list-decimal flex-col gap-0.5 pl-4 text-xs text-foreground">
          {PDF_GUIDELINE_PRIORITY.map((rule) => (
            <li key={rule.id}>{rule.label}</li>
          ))}
        </ol>
        <p className="text-xs text-muted-foreground">Safety and mandatory technical requirements always apply. Conflicts are flagged for review.</p>
      </div>
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
              {fileIssues.length > 0 && <Badge variant="destructive">{fileIssues.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="logs">Logs</TabsTrigger>
          </TabsList>
          <div className="max-h-[40vh] overflow-y-auto p-3">
            <TabsContent value="processing">
              <PdfWorkspaceEmptyState
                icon={FileText}
                title="No active processing job."
                description="Stage, progress, messages, warnings and errors will appear here once processing is available."
              />
            </TabsContent>
            <TabsContent value="validation" className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">File compatibility</h3>
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
              <PdfWorkspaceEmptyState
                icon={FileText}
                title="No validation results."
                description="Quality findings, guideline findings and output issues appear after validation, which is planned."
              />
            </TabsContent>
            <TabsContent value="logs">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] text-left text-xs">
                  <caption className="sr-only">Processing event log</caption>
                  <thead className="text-muted-foreground">
                    <tr className="border-b">
                      <th scope="col" className="py-1.5 pr-3 font-medium">Event Type</th>
                      <th scope="col" className="py-1.5 pr-3 font-medium">Message</th>
                      <th scope="col" className="py-1.5 pr-3 font-medium">Timestamp</th>
                      <th scope="col" className="py-1.5 font-medium">Severity</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td colSpan={4} className="py-4 text-center text-muted-foreground">
                        No processing events recorded.
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </section>
  )
}
