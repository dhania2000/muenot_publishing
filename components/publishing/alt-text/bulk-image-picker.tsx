"use client"

/**
 * @file components/publishing/alt-text/bulk-image-picker.tsx
 * @module Publishing
 * @kind React client component
 * @summary Phase 2 Tasks 2–3 — multi-image selection, drag-and-drop, preview grid and validation results for Bulk Processing.
 *   Nothing is uploaded; images live in the local queue owned by the workspace.
 */
import { memo, useRef, useState, type DragEvent } from "react"
import { AlertCircle, AlertTriangle, ChevronDown, Copy, FileX, ImageOff, ImagePlus, ImageUp, Images, Loader2, RotateCcw, Trash2, X } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"
import { BULK_ACCEPT, BULK_MAX_FILE_MB, formatBytes, formatLabel, type BulkImageItem, type BulkImageStatus } from "@/lib/alt-text/bulk-queue"
import type { BulkImageQueue } from "./use-bulk-image-queue"

const PAGE_SIZE = 48

const STATUS_META: Record<BulkImageStatus, { label: string; className: string }> = {
  pending: { label: "Pending", className: "text-muted-foreground" },
  validating: { label: "Validating", className: "text-muted-foreground" },
  valid: { label: "Valid", className: "border-emerald-600/40 text-emerald-700 dark:text-emerald-400" },
  invalid: { label: "Invalid", className: "border-destructive/50 text-destructive" },
  duplicate: { label: "Duplicate", className: "border-amber-500/50 text-amber-700 dark:text-amber-400" },
}

export function BulkImagePicker({ queue }: { queue: BulkImageQueue }) {
  const { items, summary, validating, hashUnavailable, addFiles, removeImage, removeInvalid, removeDuplicates, retryValidation, clearAll } = queue
  const inputRef = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)
  const [dragOver, setDragOver] = useState(false)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [showErrors, setShowErrors] = useState(false)

  const totalBytes = items.reduce((sum, item) => sum + item.size, 0)
  const visible = items.slice(0, visibleCount)
  const rejected = items.filter((item) => item.status === "invalid" || item.status === "duplicate")
  const progress = summary.total ? Math.round(((summary.total - summary.pending) / summary.total) * 100) : 0
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes("Files")

  const onDragEnter = (e: DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    dragDepth.current += 1
    setDragOver(true)
  }
  const onDragLeave = (e: DragEvent) => {
    if (!hasFiles(e)) return
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragOver(false)
  }
  const onDragOver = (e: DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = "copy"
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    dragDepth.current = 0
    setDragOver(false)
    void addFiles(Array.from(e.dataTransfer.files))
  }

  const openPicker = () => inputRef.current?.click()

  return (
    <div className="flex flex-col gap-4">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={BULK_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          void addFiles(Array.from(e.target.files ?? []))
          e.target.value = ""
        }}
      />

      <div
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
        className={cn(
          "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 text-center transition-colors",
          items.length ? "py-5" : "py-10",
          dragOver ? "border-primary bg-primary/5" : "bg-muted/30",
        )}
      >
        <div className={cn("flex size-12 items-center justify-center rounded-full", dragOver ? "bg-primary/10" : "bg-muted")}>
          <Images className={cn("size-6", dragOver ? "text-primary" : "text-muted-foreground")} aria-hidden="true" />
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">{dragOver ? "Drop images to add them" : "Drag and drop multiple images here"}</p>
          <p className="text-xs text-muted-foreground">JPG, PNG or WEBP · up to {BULK_MAX_FILE_MB} MB each</p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="outline" size="sm" onClick={openPicker}>
            {items.length ? <ImagePlus aria-hidden="true" /> : <ImageUp aria-hidden="true" />}
            {items.length ? "Add More Images" : "Browse Images"}
          </Button>
          {items.length > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                  <Trash2 aria-hidden="true" /> Remove All
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove all {items.length} images?</AlertDialogTitle>
                  <AlertDialogDescription>This clears the current selection. Nothing has been uploaded, so the original files on your device are not affected.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={clearAll}>Remove All</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5 lg:grid-cols-3 xl:grid-cols-5">
        <SummaryStat label="Total selected" value={summary.total} hint={formatBytes(totalBytes)} />
        <SummaryStat label="Valid" value={summary.valid} />
        <SummaryStat label="Invalid" value={summary.invalid} />
        <SummaryStat label="Duplicates" value={summary.duplicate} />
        <SummaryStat label="Pending" value={summary.pending} />
      </dl>

      <div aria-live="polite" className="flex flex-col gap-3">
        {summary.total > 0 && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                {validating && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
                {validating ? `Validating ${summary.pending} image${summary.pending === 1 ? "" : "s"}…` : "Validation complete"}
              </span>
              <span className="tabular-nums">{progress}%</span>
            </div>
            <Progress value={progress} aria-label="Validation progress" />
          </div>
        )}

        {hashUnavailable && (
          <Alert>
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>Content verification unavailable</AlertTitle>
            <AlertDescription>
              This browser does not expose Web Crypto here (an HTTPS page is required), so duplicates are only matched by name, size and date.
            </AlertDescription>
          </Alert>
        )}

        {rejected.length > 0 && (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertTitle>
              {summary.invalid} invalid · {summary.duplicate} duplicate{summary.duplicate === 1 ? "" : "s"} excluded from processing
            </AlertTitle>
            <AlertDescription className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowErrors((v) => !v)} aria-expanded={showErrors}>
                  <ChevronDown className={cn("transition-transform", showErrors && "rotate-180")} aria-hidden="true" />
                  {showErrors ? "Hide" : "View"} validation errors
                </Button>
                {summary.invalid > 0 && (
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={removeInvalid}>
                    <FileX aria-hidden="true" /> Remove invalid
                  </Button>
                )}
                {summary.duplicate > 0 && (
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={removeDuplicates}>
                    <Copy aria-hidden="true" /> Remove duplicates
                  </Button>
                )}
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={retryValidation} disabled={validating}>
                  <RotateCcw aria-hidden="true" /> Retry validation
                </Button>
              </div>
              {showErrors && (
                <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto text-xs">
                  {rejected.map((item) => (
                    <li key={item.id} className="flex min-w-0 gap-1">
                      <span className="truncate font-medium" title={item.name}>
                        {item.name}
                      </span>
                      <span className="shrink-0">({formatBytes(item.size)})</span>
                      <span className="min-w-0 truncate" title={item.error}>
                        — {item.error}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </AlertDescription>
          </Alert>
        )}
      </div>

      {items.length === 0 ? (
        <div className="rounded-md border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">Selected image previews will appear here.</div>
      ) : (
        <section aria-label={`Selected images (${items.length})`} className="flex flex-col gap-3">
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {visible.map((item) => (
              <ImageCard key={item.id} item={item} onRemove={removeImage} />
            ))}
          </ul>
          {items.length > visibleCount && (
            <Button variant="outline" size="sm" className="self-center" onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}>
              Show more ({items.length - visibleCount} remaining)
            </Button>
          )}
        </section>
      )}
    </div>
  )
}

function SummaryStat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">
        {value}
        {hint && <span className="ml-1 text-xs font-normal text-muted-foreground">{hint}</span>}
      </dd>
    </div>
  )
}

const ImageCard = memo(function ImageCard({ item, onRemove }: { item: BulkImageItem; onRemove: (id: string) => void }) {
  const [failed, setFailed] = useState(false)
  const status = STATUS_META[item.status]
  const showPreview = item.status !== "invalid" && !failed
  return (
    <li className={cn("flex min-w-0 flex-col overflow-hidden rounded-md border bg-card", item.status === "invalid" && "border-destructive/40")}>
      <div className="relative aspect-square bg-muted">
        {showPreview ? (
          // eslint-disable-next-line @next/next/no-img-element -- local blob: preview, not optimisable by next/image
          <img
            src={item.previewUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className={cn("size-full object-cover", item.status === "duplicate" && "opacity-50")}
            onError={() => setFailed(true)}
          />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-1 text-muted-foreground">
            <ImageOff className="size-5" aria-hidden="true" />
            <span className="text-[11px]">Preview unavailable</span>
          </div>
        )}
        <Button
          variant="secondary"
          size="icon"
          className="absolute top-1.5 right-1.5 size-7 shadow-sm"
          onClick={() => onRemove(item.id)}
          aria-label={`Remove ${item.name}`}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      <div className="flex min-w-0 flex-col gap-1 p-2">
        <p className="truncate text-xs font-medium" title={item.name}>
          {item.name}
        </p>
        <div className="flex items-center justify-between gap-1 text-[11px] text-muted-foreground">
          <Badge variant="outline" className={cn("gap-1 px-1.5 py-0 text-[10px]", status.className)}>
            {item.status === "validating" && <Loader2 className="size-2.5 animate-spin" aria-hidden="true" />}
            {status.label}
          </Badge>
          <span className="tabular-nums">
            {item.type ? `${formatLabel(item.type)} · ` : ""}
            {formatBytes(item.size)}
          </span>
        </div>
        {item.error ? (
          <p className="line-clamp-2 text-[11px] text-destructive" title={item.error}>
            {item.error}
          </p>
        ) : (
          <p className="text-[11px] tabular-nums text-muted-foreground">
            {item.width ? `${item.width} × ${item.height} px` : "Dimensions pending"}
            {item.hash && <span className="ml-1 font-mono" title={`SHA-256 ${item.hash}`}>#{item.hash.slice(0, 8)}</span>}
          </p>
        )}
      </div>
    </li>
  )
})
