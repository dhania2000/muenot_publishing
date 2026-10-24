"use client"

/**
 * @file components/publishing/alt-text/use-document-preparation.ts
 * @module Publishing
 * @kind React hook
 * @summary Phase 3 Task 11 — reads durable preparation progress from the document details endpoint.
 *   Polls only while the job is active; on a failed poll the last confirmed state is kept and flagged stale.
 */
import { useEffect, useRef } from "react"
import useSWR from "swr"
import { altTextFetcher, documentDetailUrl, type DocumentDetailResponse } from "@/lib/alt-text/client"

const POLL_MS = 4000

export function useDocumentPreparation(documentId: number | null, onSettled?: () => void) {
  const swr = useSWR<DocumentDetailResponse>(documentId ? documentDetailUrl(documentId) : null, altTextFetcher, {
    revalidateOnFocus: true,
    keepPreviousData: false,
    refreshInterval: (latest) => (latest?.preparation?.active ? POLL_MS : 0),
  })
  const preparation = swr.data?.preparation ?? null
  const active = !!preparation?.active

  // Refresh dependent views once when a run transitions from active to settled.
  const wasActive = useRef(false)
  useEffect(() => {
    if (wasActive.current && !active) onSettled?.()
    wasActive.current = active
  }, [active, onSettled])

  return {
    preparation,
    active,
    isLoading: swr.isLoading,
    stale: !!swr.error && !!swr.data,
    error: swr.error as Error | undefined,
    mutate: swr.mutate,
  }
}
