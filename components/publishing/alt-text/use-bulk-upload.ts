"use client"

import { useEffect, useState } from "react"
import type { BulkImageItem } from "@/lib/alt-text/bulk-queue"
import { createBulkUploadEngine, summarizeUploads, type UploadEntry } from "@/lib/alt-text/bulk-upload"
import { uploadAltTextImage } from "@/lib/alt-text/client"

const UPLOAD_TIMEOUT_MS = 120_000

export function useBulkUpload(items: BulkImageItem[]) {
  const [entries, setEntries] = useState<UploadEntry[]>([])
  const [engine] = useState(() =>
    createBulkUploadEngine({
      upload: (file, signal) => uploadAltTextImage(file, undefined, signal, { reuseExisting: true, timeoutMs: UPLOAD_TIMEOUT_MS }),
      onChange: setEntries,
    }),
  )

  useEffect(() => engine.sync(items), [engine, items])
  useEffect(() => () => engine.cancel(), [engine])

  const summary = summarizeUploads(entries)
  const running = summary.uploading > 0 || (engine.running && summary.pending > 0)
  useEffect(() => {
    if (!running) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [running])

  return {
    entries,
    byId: new Map(entries.map((e) => [e.localId, e])),
    summary,
    running,
    start: () => engine.start(),
    retry: (ids?: string[]) => engine.retry(ids),
    cancel: () => engine.cancel(),
  }
}
