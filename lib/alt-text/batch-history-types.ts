/**
 * @file lib/alt-text/batch-history-types.ts
 * @module Publishing · Alt Text
 * @kind Shared types + client helpers
 * @summary Phase 2 Task 17 — Batch History API contract shared by the route and the Bulk Processing UI.
 */
import type { BatchStatus } from "./store"
import type { GenerationSettings } from "./core"

export type BatchHistoryItem = {
  id: string
  name: string
  description: string | null
  projectName: string | null
  status: BatchStatus
  total: number
  completed: number
  failed: number
  pending: number
  processing: number
  createdAt: string
  updatedAt: string
  createdByMe: boolean
  /** Only exposed to actors with an "all" view scope. */
  createdById: number | null
  settings: Pick<GenerationSettings, "outputLanguage" | "subject" | "descriptionMode">
}

export type BatchHistoryList = { success: true; items: BatchHistoryItem[]; total: number; page: number; pageSize: number }

export type BatchHistoryRange = "all" | "7d" | "30d" | "custom"
export type BatchHistorySort = "newest" | "oldest" | "updated"
export type BatchHistoryFilters = {
  page: number
  pageSize: number
  search: string
  status: BatchStatus | "all"
  range: BatchHistoryRange
  from: string
  to: string
  sort: BatchHistorySort
}

export function batchHistoryUrl(f: BatchHistoryFilters) {
  const sp = new URLSearchParams({ page: String(f.page), pageSize: String(f.pageSize), sort: f.sort })
  if (f.search.trim()) sp.set("search", f.search.trim())
  if (f.status !== "all") sp.set("status", f.status)
  if (f.range !== "all") {
    sp.set("range", f.range)
    if (f.range === "custom") {
      if (f.from) sp.set("from", f.from)
      if (f.to) sp.set("to", f.to)
    }
  }
  return `/api/alt-text/batches?${sp}`
}
