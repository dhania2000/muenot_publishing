"use client"

/**
 * @file components/publishing/alt-text/document-selection-panel.tsx
 * @module Publishing
 * @kind React client components
 * @summary Phase 3 Task 2 — PDF/PPTX/DOCX drop zone and local selection list.
 *   Files stay in browser memory as File references; nothing is uploaded here.
 */
import { useRef, useState, type DragEvent } from "react"
import { AlertCircle, FilePlus2, FileText, FileType, FileX, Info, Loader2, Presentation, Trash2, Upload, X, type LucideIcon } from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatBytes } from "@/lib/alt-text/bulk-queue"
import { DOCUMENT_ACCEPT, DOCUMENT_FORMATS, DOCUMENT_MAX_FILE_MB, type DocumentEntry, type DocumentKind } from "@/lib/alt-text/document-queue"
import { selectionLimitError } from "@/lib/alt-text/document-upload-queue"
import { cn } from "@/lib/utils"
import { DocumentUploadStatus } from "./document-upload-status"
import type { DocumentQueue } from "./use-document-queue"
import type { DocumentUploads } from "./use-document-uploads"

const KIND_ICON: Record<DocumentKind, { icon: LucideIcon; className: string }> = {
  pdf: { icon: FileText, className: "text-red-600" },
  pptx: { icon: Presentation, className: "text-orange-600" },
  docx: { icon: FileType, className: "text-blue-600" },
}

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes("Files")

function useFilePicker(onFiles: (files: FileList) => void) {
  const inputRef = useRef<HTMLInputElement>(null)
  const input = (
    <input
      ref={inputRef}
      type="file"
      multiple
      accept={DOCUMENT_ACCEPT}
      className="sr-only"
      tabIndex={-1}
      aria-hidden="true"
      onChange={(e) => {
        if (e.target.files) onFiles(e.target.files)
        // Reset so the same file can be chosen again after removal.
        e.target.value = ""
      }}
    />
  )
  return { input, open: () => inputRef.current?.click() }
}

export function DocumentDropZone({ queue }: { queue: DocumentQueue }) {
  const [dragDepth, setDragDepth] = useState(0)
  const picker = useFilePicker(queue.addFiles)
  const dragging = dragDepth > 0
  const { notice } = queue

  const onDrag = (delta: 1 | -1) => (e: DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    setDragDepth((d) => Math.max(0, d + delta))
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        onDragEnter={onDrag(1)}
        onDragLeave={onDrag(-1)}
        onDragOver={(e) => {
          if (!hasFiles(e)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = "copy"
        }}
        onDrop={(e) => {
          if (!hasFiles(e)) return
          e.preventDefault()
          setDragDepth(0)
          queue.addFiles(e.dataTransfer.files)
        }}
        className={cn(
          "flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-8 text-center transition-colors",
          dragging ? "border-primary bg-primary/5" : "bg-muted/30",
        )}
      >
        <div className="flex size-10 items-center justify-center rounded-full bg-background shadow-xs ring-1 ring-border">
          <Upload className={cn("size-5", dragging ? "text-primary" : "text-muted-foreground")} aria-hidden="true" />
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-foreground">{dragging ? "Drop documents to add them" : "Drag and drop documents here"}</p>
          <p className="text-xs text-muted-foreground">PDF, PPTX and DOCX · up to {DOCUMENT_MAX_FILE_MB} MB each</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={picker.open}>
          <FileText aria-hidden="true" /> Browse Documents
        </Button>
        {picker.input}
      </div>
      <div aria-live="polite">
        {notice && (
          <div
            className={cn(
              "flex items-start gap-2 rounded-md border px-3 py-2 text-xs leading-relaxed",
              notice.tone === "error" ? "border-destructive/30 bg-destructive/5 text-destructive" : "bg-muted/40 text-foreground",
            )}
          >
            {notice.tone === "error" ? (
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            ) : (
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            )}
            <span className="flex-1">{notice.message}</span>
            <button type="button" onClick={queue.dismissNotice} className="rounded-sm opacity-70 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <X className="size-3.5" aria-hidden="true" />
              <span className="sr-only">Dismiss message</span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function StatusBadge({ entry }: { entry: DocumentEntry }) {
  if (entry.status === "validating")
    return (
      <Badge variant="outline" className="gap-1">
        <Loader2 className="size-3 animate-spin" aria-hidden="true" /> Validating
      </Badge>
    )
  if (entry.status === "ready")
    return (
      <Badge variant="outline" className="border-emerald-600/30 bg-emerald-50 text-emerald-700">
        Ready
      </Badge>
    )
  return (
    <div className="flex flex-col gap-1">
      <Badge variant="outline" className="w-fit border-destructive/30 bg-destructive/5 text-destructive">
        Invalid
      </Badge>
      <span className="text-xs text-destructive">{entry.error}</span>
    </div>
  )
}

export function SelectedDocumentsCard({ queue, uploads }: { queue: DocumentQueue; uploads: DocumentUploads }) {
  const picker = useFilePicker(queue.addFiles)
  const { entries, summary } = queue
  const pending = summary.validating > 0
  const readyEntries = entries.filter((e) => e.status === "ready")
  const notStarted = readyEntries.filter((e) => !uploads.states.has(e.id))
  const limitError = selectionLimitError(readyEntries)
  const inFlight = [...uploads.states.values()].some((s) => s.phase === "queued" || s.phase === "uploading")
  const uploadDisabled = notStarted.length === 0 || pending || limitError !== null

  const removeEntry = (id: string) => {
    uploads.forget(id)
    queue.remove(id)
  }
  const removeAll = () => {
    uploads.forgetAll()
    queue.clear()
  }

  const counters = [
    { label: "Total Documents", value: summary.total },
    { label: "PDF Files", value: summary.pdf },
    { label: "PPTX Files", value: summary.pptx },
    { label: "DOCX Files", value: summary.docx },
    { label: "Total File Size", value: formatBytes(summary.totalBytes) },
    { label: "Invalid Files", value: summary.invalid },
  ]

  return (
    <Card className="min-w-0">
      <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-col gap-1.5">
          <CardTitle className="text-base">Selected Documents</CardTitle>
          <CardDescription>
            Documents stay on this device until you upload them. Uploads are stored privately and security-scanned before processing.
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={picker.open}>
            <FilePlus2 aria-hidden="true" /> Add More Documents
          </Button>
          {picker.input}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="outline" size="sm" disabled={!entries.length}>
                <Trash2 aria-hidden="true" /> Remove All
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove all documents?</AlertDialogTitle>
                <AlertDialogDescription>
                  This clears {summary.total} selected {summary.total === 1 ? "document" : "documents"} from this list and cancels any
                  upload in progress. Documents that already finished uploading stay in secure storage.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={removeAll}>Remove All</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button
            type="button"
            size="sm"
            disabled={uploadDisabled}
            aria-describedby="doc-upload-status"
            onClick={() => uploads.start(notStarted.map((e) => ({ id: e.id, file: e.file })))}
          >
            {inFlight ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Upload aria-hidden="true" />} Upload Documents
            {notStarted.length ? ` (${notStarted.length})` : ""}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {counters.map((c) => (
            <div key={c.label} className="flex flex-col gap-1 rounded-md border px-3 py-2">
              <dt className="text-xs font-medium text-muted-foreground">{c.label}</dt>
              <dd className="text-lg font-semibold tabular-nums text-foreground">{c.value}</dd>
            </div>
          ))}
        </dl>
        <p id="doc-upload-status" aria-live="polite" className={cn("text-xs", limitError ? "text-destructive" : "text-muted-foreground")}>
          {pending
            ? "Checking selected documents…"
            : limitError
              ? limitError
              : inFlight
                ? "Uploading documents… You can keep working while they upload."
                : notStarted.length
                  ? `${notStarted.length} valid ${notStarted.length === 1 ? "document is" : "documents are"} ready to upload.`
                  : readyEntries.length
                    ? "All valid documents have been uploaded."
                    : "Select at least one valid document to upload."}
        </p>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <span className="sr-only">Icon</span>
                </TableHead>
                <TableHead>Filename</TableHead>
                <TableHead className="whitespace-nowrap">File Type</TableHead>
                <TableHead className="whitespace-nowrap">File Size</TableHead>
                <TableHead className="whitespace-nowrap">Validation Status</TableHead>
                <TableHead className="whitespace-nowrap">Upload Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={7} className="py-8 text-center text-xs text-muted-foreground">
                    No documents selected.
                  </TableCell>
                </TableRow>
              ) : (
                entries.map((entry) => {
                  const kind = entry.kind ? KIND_ICON[entry.kind] : { icon: FileX, className: "text-muted-foreground" }
                  const Icon = kind.icon
                  return (
                    <TableRow key={entry.id}>
                      <TableCell>
                        <Icon className={cn("size-5", kind.className)} aria-hidden="true" />
                      </TableCell>
                      <TableCell className="max-w-64">
                        <span className="block truncate font-medium text-foreground" title={entry.name}>
                          {entry.name}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {entry.kind ? DOCUMENT_FORMATS[entry.kind].label : entry.extension ? `.${entry.extension}` : "Unknown"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">{formatBytes(entry.size)}</TableCell>
                      <TableCell>
                        <StatusBadge entry={entry} />
                      </TableCell>
                      <TableCell className="max-w-72">
                        {entry.status === "ready" ? (
                          <DocumentUploadStatus
                            state={uploads.states.get(entry.id)}
                            name={entry.name}
                            onRetry={() => uploads.start([{ id: entry.id, file: entry.file }])}
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground">{"—"}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button type="button" variant="ghost" size="sm" onClick={() => removeEntry(entry.id)}>
                          <X aria-hidden="true" /> Remove<span className="sr-only"> {entry.name}</span>
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
