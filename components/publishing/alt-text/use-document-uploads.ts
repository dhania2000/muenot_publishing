"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { mutate } from "swr"
import { DOCUMENT_LIST_PREFIX, uploadAltTextDocument } from "@/lib/alt-text/client"
import { createDocumentUploadQueue, type DocumentUploadQueue, type DocumentUploadState } from "@/lib/alt-text/document-upload-queue"

const UPLOAD_TIMEOUT_MS = 5 * 60_000

export function useDocumentUploads() {
  const [states, setStates] = useState<ReadonlyMap<string, DocumentUploadState>>(() => new Map())
  const engineRef = useRef<DocumentUploadQueue | null>(null)
  if (!engineRef.current) {
    engineRef.current = createDocumentUploadQueue({
      upload: async (file, onProgress, signal) => {
        const res = await uploadAltTextDocument(file, onProgress, signal, { timeoutMs: UPLOAD_TIMEOUT_MS })
        if (res.ok) void mutate((key) => typeof key === "string" && key.startsWith(DOCUMENT_LIST_PREFIX))
        return res
      },
      onChange: setStates,
    })
  }

  useEffect(() => {
    const engine = engineRef.current
    return () => engine?.forgetAll()
  }, [])

  const start = useCallback((items: { id: string; file: File }[]) => engineRef.current!.enqueue(items), [])
  const forget = useCallback((id: string) => engineRef.current!.forget(id), [])
  const forgetAll = useCallback(() => engineRef.current!.forgetAll(), [])

  return { states, start, forget, forgetAll }
}

export type DocumentUploads = ReturnType<typeof useDocumentUploads>
