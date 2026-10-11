"use client"

/**
 * @file components/publishing/alt-text/batch-export-action.tsx
 * @module Publishing
 * @kind React client component
 * @summary Phase 2 Task 15 — Export Results dropdown (CSV / TXT / JSON) for the Bulk Processing dashboard.
 *   Downloads come straight from the server; permission and eligibility are enforced there.
 */
import { useState } from "react"
import { ChevronDown, Download, FileSpreadsheet, Loader2 } from "lucide-react"
import type { BatchProgressView } from "@/lib/alt-text/batch-dashboard"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

// XLSX covers every image in the batch (status + warnings sheets); the text formats are completed-only.
const FORMATS = [
  { value: "xlsx", label: "Download Excel (.xlsx)", allImages: true },
  { value: "csv", label: "Download CSV", allImages: false },
  { value: "txt", label: "Download TXT", allImages: false },
  { value: "json", label: "Download JSON", allImages: false },
] as const
type Format = (typeof FORMATS)[number]["value"]

const exportUrl = (batchId: string, format: Format) => `/api/alt-text/batches/${encodeURIComponent(batchId)}/export?format=${format}&scope=completed`

function filenameFrom(res: Response, fallback: string) {
  const match = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")
  return match?.[1] ?? fallback
}

export function BatchExportAction({ view }: { view: BatchProgressView }) {
  const [pending, setPending] = useState<Format | null>(null)
  const [error, setError] = useState<string | null>(null)
  const eligible = view.completed
  const partial = eligible > 0 && eligible < view.total

  const download = async (format: Format) => {
    if (pending) return
    setPending(format)
    setError(null)
    try {
      const res = await fetch(exportUrl(view.batchId, format), { cache: "no-store" })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? `Export failed (HTTP ${res.status}).`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = filenameFrom(res, `batch-${view.batchId}-alt-text.${format}`)
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.")
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" disabled={view.total === 0 || pending !== null} title={view.total === 0 ? "No images in this batch" : undefined}>
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
            {pending === "xlsx" ? "Generating Excel…" : pending ? "Exporting…" : "Export Results"}
            <ChevronDown aria-hidden="true" />
            {view.total === 0 && <span className="sr-only"> (No images in this batch)</span>}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="flex flex-col gap-0.5 font-normal">
            <span className="text-sm font-medium">
              {eligible} completed image{eligible === 1 ? "" : "s"}
            </span>
            {partial && <span className="text-xs text-muted-foreground">Partial batch: {view.total - eligible} not exportable</span>}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {FORMATS.map((f) => (
            <DropdownMenuItem
              key={f.value}
              onSelect={() => void download(f.value)}
              disabled={pending !== null || (!f.allImages && eligible === 0)}
            >
              {f.allImages ? <FileSpreadsheet aria-hidden="true" /> : <Download aria-hidden="true" />}
              <span className="flex flex-col">
                {f.label}
                {f.allImages && <span className="text-xs text-muted-foreground">All {view.total} images, 5 sheets</span>}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {error && (
        <p role="alert" className="max-w-64 text-right text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
