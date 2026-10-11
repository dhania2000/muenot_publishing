"use client"

import { useCallback, useMemo, useRef, useState } from "react"
import {
  checkSignature,
  createDocumentEntry,
  partitionNewFiles,
  selectReadyFiles,
  summarizeDocuments,
  type DocumentEntry,
} from "@/lib/alt-text/document-queue"
import { DOCUMENT_UPLOAD_LIMITS } from "@/lib/alt-text/document-upload-contract"

export type QueueNotice = { tone: "info" | "error"; message: string } | null

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

export function useDocumentQueue() {
  const [entries, setEntries] = useState<DocumentEntry[]>([])
  const [notice, setNotice] = useState<QueueNotice>(null)
  const seq = useRef(0)

  const addFiles = useCallback(
    (incoming: FileList | File[]) => {
      const files = Array.from(incoming)
      if (!files.length) return
      const { accepted, duplicates } = partitionNewFiles(entries, files)
      const room = Math.max(0, DOCUMENT_UPLOAD_LIMITS.maxFiles - entries.length)
      const overflow = Math.max(0, accepted.length - room)
      const created = accepted.slice(0, room).map((f) => createDocumentEntry(f, `doc-${Date.now().toString(36)}-${++seq.current}`))
      const rejected = created.filter((e) => e.status === "invalid").length
      const parts: string[] = []
      if (duplicates.length) parts.push(`${plural(duplicates.length, "likely duplicate")} skipped (${duplicates.join(", ")})`)
      if (overflow) parts.push(`${plural(overflow, "file")} not added — up to ${DOCUMENT_UPLOAD_LIMITS.maxFiles} documents per selection`)
      if (rejected) parts.push(`${plural(rejected, "file")} rejected — see the list for details`)
      setNotice(parts.length ? { tone: rejected || overflow ? "error" : "info", message: `${parts.join(". ")}.` } : null)
      if (!created.length) return
      setEntries((prev) => [...prev, ...created])

      for (const entry of created) {
        if (entry.status !== "validating" || !entry.kind) continue
        void checkSignature(entry.file, entry.kind).then((error) =>
          setEntries((cur) =>
            cur.map((e) => (e.id === entry.id ? { ...e, status: error ? "invalid" : "ready", error: error ?? undefined } : e)),
          ),
        )
      }
    },
    [entries],
  )

  const remove = useCallback((id: string) => setEntries((prev) => prev.filter((e) => e.id !== id)), [])
  const clear = useCallback(() => {
    setEntries([])
    setNotice(null)
  }, [])

  const summary = useMemo(() => summarizeDocuments(entries), [entries])
  const readyFiles = useMemo(() => selectReadyFiles(entries), [entries])

  return { entries, notice, summary, readyFiles, addFiles, remove, clear, dismissNotice: () => setNotice(null) }
}

export type DocumentQueue = ReturnType<typeof useDocumentQueue>
