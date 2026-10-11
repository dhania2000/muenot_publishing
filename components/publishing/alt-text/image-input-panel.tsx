"use client"

/**
 * @file components/publishing/alt-text/image-input-panel.tsx
 * @module Publishing
 * @kind React client component
 * @summary Local image selection, validation and preview for the Alt Text
 *   Generate tab. Nothing is uploaded here; the selected File is handed to the
 *   parent for later backend integration. Client validation is a UX aid only —
 *   the server re-verifies every upload.
 */
import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react"
import { AlertCircle, CheckCircle2, ImageIcon, ImageUp, RefreshCw, ShieldAlert, Trash2 } from "lucide-react"
import { Progress } from "@/components/ui/progress"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { DEFAULT_SETTINGS, validateImage, type SupportedImageType } from "@/lib/alt-text/core"
import { cn } from "@/lib/utils"

export type SelectedImage = {
  file: File
  previewUrl: string
  name: string
  type: SupportedImageType
  format: string
  size: number
  width: number
  height: number
}

const FORMATS = ["JPG", "PNG", "WEBP"]
const ACCEPT = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
const MAX_FILE_MB = Math.min(10, DEFAULT_SETTINGS.maxFileMb)
const EXTENSION_TYPES: Record<string, SupportedImageType> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
}
const FORMAT_LABELS: Record<SupportedImageType, string> = {
  "image/jpeg": "JPEG",
  "image/png": "PNG",
  "image/webp": "WEBP",
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function decodeImage(url: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const done = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
      if (typeof img.decode === "function") img.decode().then(done, reject)
      else done()
    }
    img.onerror = reject
    img.src = url
  })
}

async function prepareImage(file: File): Promise<SelectedImage> {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? ""
  const extensionType = EXTENSION_TYPES[extension]
  if (!extensionType) throw new Error("Only JPG, PNG and WEBP images are supported.")
  if (file.type && file.type !== extensionType)
    throw new Error("The file extension does not match its image type.")
  if (file.size === 0) throw new Error("The file is empty.")
  if (file.size > MAX_FILE_MB * 1024 * 1024) throw new Error(`Images must be ${MAX_FILE_MB} MB or smaller.`)

  const bytes = new Uint8Array(await file.arrayBuffer())
  // Some OSes report an empty MIME type; fall back to the extension so magic-byte checks still run.
  const result = validateImage(
    { name: file.name, size: file.size, type: file.type || extensionType },
    bytes,
    MAX_FILE_MB,
  )
  if (!result.ok) throw new Error(result.error)

  const previewUrl = URL.createObjectURL(file)
  try {
    const { width, height } = await decodeImage(previewUrl)
    if (!width || !height) throw new Error("decode")
    return {
      file,
      previewUrl,
      name: file.name,
      type: result.type,
      format: FORMAT_LABELS[result.type],
      size: file.size,
      width,
      height,
    }
  } catch {
    URL.revokeObjectURL(previewUrl)
    throw new Error("This image appears to be corrupt and could not be opened.")
  }
}

export type UploadState =
  | { phase: "idle" }
  | { phase: "uploading"; progress: number | null }
  | { phase: "uploaded"; assetId: number; scanPending: boolean }
  | { phase: "failed"; message: string }

type ImageInputPanelProps = {
  image: SelectedImage | null
  onImageChange: (image: SelectedImage | null) => void
  upload?: UploadState
  onRetryUpload?: () => void
  /** Locks replace/remove while generation or saving is in flight. */
  locked?: boolean
}

function UploadStatus({ upload, onRetry }: { upload: UploadState; onRetry?: () => void }) {
  if (upload.phase === "idle") return null
  if (upload.phase === "uploading")
    return (
      <div className="flex flex-col gap-1.5" role="status" aria-live="polite">
        <div className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-1.5 font-medium text-foreground">
            <Spinner className="size-3.5" />
            Uploading securely…
          </span>
          {upload.progress !== null && <span className="tabular-nums text-muted-foreground">{upload.progress}%</span>}
        </div>
        <Progress value={upload.progress ?? null} aria-label="Upload progress" />
      </div>
    )
  if (upload.phase === "failed")
    return (
      <Alert variant="destructive">
        <AlertCircle aria-hidden="true" />
        <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
          <span>Upload failed: {upload.message}</span>
          {onRetry && (
            <Button type="button" variant="outline" size="xs" onClick={onRetry}>
              Retry upload
            </Button>
          )}
        </AlertDescription>
      </Alert>
    )
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs" role="status" aria-live="polite">
      <Badge variant="outline" className="gap-1 border-emerald-600/40 text-emerald-700">
        <CheckCircle2 aria-hidden="true" />
        Uploaded
      </Badge>
      <span className="text-muted-foreground">
        Asset <span className="font-mono tabular-nums text-foreground">#{upload.assetId}</span>
      </span>
      {upload.scanPending && (
        <Badge variant="outline" className="gap-1 border-amber-500/50 text-amber-700">
          <ShieldAlert aria-hidden="true" />
          Security scan pending
        </Badge>
      )}
    </div>
  )
}

export function ImageInputPanel({ image, onImageChange, upload = { phase: "idle" }, onRetryUpload, locked = false }: ImageInputPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const requestRef = useRef(0)
  const [dragging, setDragging] = useState(false)
  const [validating, setValidating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    return () => {
      requestRef.current += 1
    }
  }, [])

  const openPicker = () => inputRef.current?.click()

  const resetInput = () => {
    if (inputRef.current) inputRef.current.value = ""
  }

  const handleFiles = async (files: FileList | null) => {
    resetInput()
    if (!files || files.length === 0) return
    if (files.length > 1) {
      setError("Select one image at a time.")
      return
    }
    const request = ++requestRef.current
    setError(null)
    setValidating(true)
    try {
      const selected = await prepareImage(files[0])
      if (request !== requestRef.current) {
        URL.revokeObjectURL(selected.previewUrl)
        return
      }
      onImageChange(selected)
    } catch (err) {
      if (request === requestRef.current)
        setError(err instanceof Error ? err.message : "The image could not be read.")
    } finally {
      if (request === requestRef.current) setValidating(false)
    }
  }

  const removeImage = () => {
    requestRef.current += 1
    setValidating(false)
    setError(null)
    resetInput()
    onImageChange(null)
  }

  const isFileDrag = (event: DragEvent) => event.dataTransfer.types.includes("Files")

  const dropHandlers = {
    onDragEnter: (event: DragEvent<HTMLDivElement>) => {
      if (!isFileDrag(event)) return
      event.preventDefault()
      setDragging(true)
    },
    onDragOver: (event: DragEvent<HTMLDivElement>) => {
      if (!isFileDrag(event)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = "copy"
    },
    onDragLeave: (event: DragEvent<HTMLDivElement>) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
      setDragging(false)
    },
    onDrop: (event: DragEvent<HTMLDivElement>) => {
      if (!isFileDrag(event)) return
      event.preventDefault()
      setDragging(false)
      void handleFiles(event.dataTransfer.files)
    },
  }

  const onDropzoneKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      openPicker()
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Image</CardTitle>
        <CardDescription>Add the image you want to describe.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => void handleFiles(event.target.files)}
        />

        {image ? (
          <div
            {...dropHandlers}
            className={cn(
              "relative flex flex-col gap-3 rounded-lg border bg-card p-3 transition-colors",
              dragging && "border-primary ring-2 ring-primary/20",
            )}
          >
            <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-md border bg-muted/30">
              {/* eslint-disable-next-line @next/next/no-img-element -- local blob: preview, not optimizable */}
              <img
                src={image.previewUrl}
                alt={`Preview of ${image.name}`}
                className="size-full object-contain"
              />
              {(dragging || validating) && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/85 text-sm font-medium text-foreground">
                  {validating ? <Spinner className="size-5" /> : <ImageUp className="size-5 text-primary" aria-hidden="true" />}
                  {validating ? "Checking image…" : "Drop to replace image"}
                </div>
              )}
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div className="col-span-2 flex min-w-0 flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">File name</dt>
                <dd className="truncate font-medium text-foreground" title={image.name}>
                  {image.name}
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">Format</dt>
                <dd className="font-medium text-foreground">{image.format}</dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">Size</dt>
                <dd className="font-medium text-foreground">{formatFileSize(image.size)}</dd>
              </div>
              <div className="col-span-2 flex flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">Dimensions</dt>
                <dd className="font-medium tabular-nums text-foreground">
                  {image.width} {"×"} {image.height} px
                </dd>
              </div>
            </dl>

            <UploadStatus upload={upload} onRetry={onRetryUpload} />

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={openPicker} disabled={validating || locked}>
                <RefreshCw aria-hidden="true" />
                Replace Image
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={removeImage} disabled={locked} className="text-destructive hover:text-destructive">
                <Trash2 aria-hidden="true" />
                Remove Image
              </Button>
            </div>
          </div>
        ) : (
          <div
            {...dropHandlers}
            role="button"
            tabIndex={0}
            aria-label="Upload an image. Drag and drop or press Enter to browse files."
            aria-busy={validating}
            aria-describedby={error ? "alt-text-image-error" : undefined}
            onClick={openPicker}
            onKeyDown={onDropzoneKeyDown}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              dragging
                ? "border-primary bg-primary/5"
                : error
                  ? "border-destructive/50 bg-destructive/5 hover:border-destructive/70"
                  : "border-border bg-muted/30 hover:border-primary/50 hover:bg-muted/50",
            )}
          >
            <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              {validating ? <Spinner className="size-6" /> : <ImageUp className="size-6" aria-hidden="true" />}
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-foreground">
                {validating ? "Checking image…" : dragging ? "Drop image to select it" : "Drag and drop an image here"}
              </p>
              <p className="text-xs text-muted-foreground">
                or <span className="font-medium text-primary underline-offset-4 hover:underline">browse files</span> · up to {MAX_FILE_MB} MB
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              {FORMATS.map((format) => (
                <Badge key={format} variant="secondary" className="font-mono text-[11px]">
                  {format}
                </Badge>
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              tabIndex={-1}
              disabled={validating}
              onClick={(event) => {
                event.stopPropagation()
                openPicker()
              }}
            >
              <ImageIcon aria-hidden="true" />
              Browse Files
            </Button>
          </div>
        )}

        {error && (
          <Alert variant="destructive" id="alt-text-image-error">
            <AlertCircle aria-hidden="true" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
