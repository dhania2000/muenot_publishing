"use client"

/**
 * @file components/publishing/conversion/pdf/pdf-file-components.tsx
 * @module Publishing › Conversion › PDF
 * @kind React client component
 * @summary Reusable file UI: upload dropzone (source files or client guidelines), file card, file list,
 *   metadata list and per-file action menu (Task 8.3).
 * @exports PdfUploadDropzone, PdfFileCard, PdfFileList, PdfFileMetadata, PdfFileActionMenu, PdfFileCardData,
 *   PdfFileMetadataFields, PdfFileAction
 *
 * Nothing here uploads or parses. Upload progress is indeterminate unless a caller supplies a real state,
 * and metadata rows only render for values the caller actually has.
 */
import { useId, useRef, useState } from "react"
import { AlertTriangle, BookOpenCheck, FileText, FileWarning, LoaderCircle, MoreHorizontal, Upload, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { PdfFeedbackState } from "@/components/publishing/conversion/pdf/pdf-feedback-state"
import { formatBytes } from "@/components/publishing/conversion/pdf/pdf-workspace-config"
import { cn } from "@/lib/utils"

// ─── Upload dropzone ────────────────────────────────────────────────────────

export type PdfUploadPurpose = "source" | "guidelines"

const PURPOSE_COPY: Record<PdfUploadPurpose, { icon: LucideIcon; lead: string }> = {
  source: { icon: Upload, lead: "Drag & drop files or" },
  guidelines: { icon: BookOpenCheck, lead: "Drag & drop guideline documents or" },
}

type PdfUploadDropzoneProps = {
  purpose?: PdfUploadPurpose
  /** Extensions without the dot, e.g. ["pdf", "docx"]. */
  accept: readonly string[]
  multiple?: boolean
  /** Short line describing accepted types, size limit and where files go. */
  hint: string
  onFiles: (files: File[]) => void
  disabled?: boolean
  disabledReason?: string
  /** Only true while a real upload is running; shown as indeterminate. */
  uploading?: boolean
  error?: string | null
  className?: string
}

/**
 * Source documents and client guideline documents use the same dropzone with different copy and a
 * `data-upload-purpose` attribute, so the two flows are never confused.
 */
export function PdfUploadDropzone({
  purpose = "source",
  accept,
  multiple = true,
  hint,
  onFiles,
  disabled,
  disabledReason,
  uploading,
  error,
  className,
}: PdfUploadDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const hintId = useId()
  const [dragging, setDragging] = useState(false)
  const { icon: Icon, lead } = PURPOSE_COPY[purpose]
  const inactive = disabled || uploading
  const browse = () => inputRef.current?.click()

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <input
        ref={inputRef}
        type="file"
        multiple={multiple}
        accept={accept.map((ext) => `.${ext}`).join(",")}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        disabled={inactive}
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []))
          e.target.value = ""
        }}
      />
      <div
        data-upload-purpose={purpose}
        data-dragging={dragging || undefined}
        aria-disabled={inactive || undefined}
        onDragOver={(e) => {
          if (inactive) return
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          if (!inactive) onFiles(Array.from(e.dataTransfer.files))
        }}
        className={cn(
          "flex flex-col items-center gap-2 rounded-md border border-dashed px-3 py-4 text-center transition-colors",
          dragging ? "border-primary bg-primary/5" : "bg-muted/30",
          error && "border-destructive/50",
          inactive && "opacity-60",
        )}
      >
        {uploading ? (
          <LoaderCircle className="size-5 text-primary motion-safe:animate-spin" aria-hidden="true" />
        ) : (
          <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
        )}
        {uploading ? (
          <p role="status" className="text-sm text-foreground">
            Uploading…
          </p>
        ) : (
          <p className="text-sm text-foreground">
            {lead}{" "}
            <button
              type="button"
              onClick={browse}
              disabled={disabled}
              aria-describedby={hintId}
              className="font-medium text-primary underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none disabled:cursor-not-allowed disabled:no-underline"
            >
              browse
            </button>
          </p>
        )}
        <p id={hintId} className="text-xs leading-relaxed text-muted-foreground">
          {disabled && disabledReason ? disabledReason : hint}
        </p>
      </div>
      {error && (
        <p role="alert" className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  )
}

// ─── File card & list ───────────────────────────────────────────────────────

export type PdfFileCardData = {
  id: string
  name: string
  /** Extension or format label, e.g. "pdf". */
  format: string
  sizeBytes: number
  /** Only when a parser reported it. */
  pageCount?: number
  /** Short status text such as "Added locally". */
  statusLabel?: string
  /** A validation problem; switches the card to the warning style. */
  issueMessage?: string | null
}

type PdfFileCardProps = {
  file: PdfFileCardData
  selected?: boolean
  onSelect?: () => void
  /** Trailing controls (remove button, action menu). */
  actions?: React.ReactNode
  density?: "compact" | "comfortable"
  /** Render as a list item (inside PdfFileList) or a standalone element. */
  as?: "li" | "div"
}

export function PdfFileCard({ file, selected = false, onSelect, actions, density = "compact", as: Root = "li" }: PdfFileCardProps) {
  const Icon = file.issueMessage ? FileWarning : FileText
  const details = [
    (file.format || "Unknown").toUpperCase(),
    formatBytes(file.sizeBytes),
    file.pageCount !== undefined ? `${file.pageCount} ${file.pageCount === 1 ? "page" : "pages"}` : null,
  ].filter(Boolean)

  const body = (
    <>
      <Icon className={cn("mt-0.5 size-4 shrink-0", file.issueMessage ? "text-destructive" : "text-muted-foreground")} aria-hidden="true" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium text-foreground" title={file.name}>
          {file.name}
        </span>
        <span className="text-xs text-muted-foreground">{details.join(" · ")}</span>
        {density === "comfortable" && file.statusLabel && !file.issueMessage && (
          <span className="text-xs text-muted-foreground">{file.statusLabel}</span>
        )}
        {file.issueMessage && <span className="text-xs text-destructive">{file.issueMessage}</span>}
      </span>
    </>
  )
  const bodyClass = cn("flex min-w-0 flex-1 items-start gap-2 rounded-md px-2 text-left", density === "compact" ? "py-2" : "py-3")

  return (
    <Root
      data-selected={selected || undefined}
      className={cn(
        "flex min-w-0 items-center gap-1 rounded-md border transition-colors",
        selected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50",
        file.issueMessage && "border-destructive/40",
      )}
    >
      {onSelect ? (
        <button
          type="button"
          aria-pressed={selected}
          onClick={onSelect}
          className={cn(bodyClass, "outline-none focus-visible:ring-3 focus-visible:ring-ring/50")}
        >
          {body}
        </button>
      ) : (
        <div className={bodyClass}>{body}</div>
      )}
      {actions && <div className="mr-1 flex shrink-0 items-center">{actions}</div>}
    </Root>
  )
}

type PdfFileListProps = {
  files: readonly PdfFileCardData[]
  label: string
  selectedId?: string | null
  onSelect?: (id: string) => void
  renderActions?: (file: PdfFileCardData) => React.ReactNode
  density?: "compact" | "comfortable"
  state?: "ready" | "loading" | "error"
  emptyTitle?: string
  emptyDescription?: string
  errorMessage?: string
  onRetry?: () => void
}

export function PdfFileList({
  files,
  label,
  selectedId,
  onSelect,
  renderActions,
  density,
  state = "ready",
  emptyTitle = "No files added",
  emptyDescription,
  errorMessage,
  onRetry,
}: PdfFileListProps) {
  if (state === "loading") return <PdfFeedbackState kind="loading" size="compact" title={`Loading ${label.toLowerCase()}`} />
  if (state === "error") {
    return <PdfFeedbackState kind="error" title={`Could not load ${label.toLowerCase()}`} description={errorMessage} onRetry={onRetry} />
  }
  if (files.length === 0) {
    return <PdfFeedbackState kind="no-files" size="compact" title={emptyTitle} description={emptyDescription} />
  }
  return (
    <ul aria-label={label} className="flex flex-col gap-1.5">
      {files.map((file) => (
        <PdfFileCard
          key={file.id}
          file={file}
          density={density}
          selected={file.id === selectedId}
          onSelect={onSelect ? () => onSelect(file.id) : undefined}
          actions={renderActions?.(file)}
        />
      ))}
    </ul>
  )
}

// ─── Metadata ───────────────────────────────────────────────────────────────

export type PdfFileMetadataFields = {
  filename?: string
  format?: string
  mimeType?: string
  sizeBytes?: number
  pageCount?: number
  language?: string
  dimensions?: string
  /** Epoch milliseconds. */
  lastModified?: number
  status?: string
}

const METADATA_LABELS: Record<keyof PdfFileMetadataFields, string> = {
  filename: "Filename",
  format: "Format",
  mimeType: "MIME type",
  sizeBytes: "File size",
  pageCount: "Pages",
  language: "Language",
  dimensions: "Dimensions",
  lastModified: "Last modified",
  status: "Status",
}

function formatMetadataValue(key: keyof PdfFileMetadataFields, value: string | number): string {
  if (key === "sizeBytes") return formatBytes(value as number)
  if (key === "lastModified") return new Date(value as number).toLocaleString()
  return String(value)
}

/** Renders only the fields that have values. `unavailableNote` explains what is missing and why. */
export function PdfFileMetadata({
  fields,
  title = "File information",
  unavailableNote,
  className,
}: {
  fields: PdfFileMetadataFields
  title?: string
  unavailableNote?: string
  className?: string
}) {
  const rows = (Object.keys(METADATA_LABELS) as (keyof PdfFileMetadataFields)[])
    .filter((key) => fields[key] !== undefined && fields[key] !== "")
    .map((key) => [METADATA_LABELS[key], formatMetadataValue(key, fields[key]!)] as const)
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
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
      {unavailableNote && <p className="text-xs text-muted-foreground">{unavailableNote}</p>}
    </div>
  )
}

// ─── Action menu ────────────────────────────────────────────────────────────

export type PdfFileAction = {
  id: "preview" | "replace" | "remove" | "details" | (string & {})
  label: string
  icon?: LucideIcon
  /** Omit to show the action disabled (not built yet). */
  onAction?: () => void
  destructive?: boolean
}

/** Overflow menu for one file. Actions without a handler are disabled, never faked. */
export function PdfFileActionMenu({ fileName, actions }: { fileName: string; actions: readonly PdfFileAction[] }) {
  const regular = actions.filter((a) => !a.destructive)
  const destructive = actions.filter((a) => a.destructive)
  const renderItem = (action: PdfFileAction) => {
    const Icon = action.icon
    return (
      <DropdownMenuItem
        key={action.id}
        disabled={!action.onAction}
        variant={action.destructive ? "destructive" : "default"}
        onSelect={() => action.onAction?.()}
      >
        {Icon && <Icon aria-hidden="true" />}
        {action.label}
        {!action.onAction && <span className="ml-auto text-xs text-muted-foreground">Planned</span>}
      </DropdownMenuItem>
    )
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${fileName}`}>
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        {regular.map(renderItem)}
        {regular.length > 0 && destructive.length > 0 && <DropdownMenuSeparator />}
        {destructive.map(renderItem)}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
