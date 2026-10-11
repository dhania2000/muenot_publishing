/**
 * @file lib/alt-text/batch-history.ts
 * @module Publishing · Alt Text
 * @kind Server-side library
 * @summary Phase 2 Task 17 — query parsing and scoped listing for Bulk Batch History. Read-only; reuses `listBatches()`.
 * @security Tenant scope comes from the request context inside the store; non-"all" view scopes only see batches they created or submitted.
 */
import "server-only"
import type { HistoryActor, HistoryFailure } from "./history"
import { BATCH_ID_PATTERN } from "./batch-progress"
import { BATCH_STATUSES, listBatches, type BatchListSort, type BatchStatus } from "./store"
import type { BatchHistoryItem, BatchHistoryList } from "./batch-history-types"

export type { BatchHistoryItem, BatchHistoryList } from "./batch-history-types"

const MAX_PAGE_SIZE = 50
const MAX_SEARCH = 120
const DAY_MS = 86_400_000
const SORTS: readonly BatchListSort[] = ["newest", "oldest", "updated"]
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export type BatchHistoryQuery = {
  page: number
  pageSize: number
  search?: string
  status?: BatchStatus
  createdFrom?: Date
  createdTo?: Date
  sort: BatchListSort
}

const fail = (status: number, code: string, error: string): HistoryFailure => ({ ok: false, status, code, error })

function parseDay(v: string | null, endOfDay: boolean): Date | null | undefined {
  if (!v) return undefined
  if (!DATE_RE.test(v)) return null
  const d = new Date(`${v}T00:00:00.000Z`)
  if (Number.isNaN(d.getTime())) return null
  return endOfDay ? new Date(d.getTime() + DAY_MS) : d
}

export function parseBatchHistoryQuery(sp: URLSearchParams, now = Date.now()): { ok: true; value: BatchHistoryQuery } | HistoryFailure {
  const int = (key: string, def: number) => {
    const v = sp.get(key)
    if (v == null || v === "") return def
    return /^\d{1,6}$/.test(v) ? Number(v) : NaN
  }
  const page = int("page", 1)
  const pageSize = int("pageSize", 20)
  if (!(page >= 1)) return fail(400, "INVALID_QUERY", "page must be a positive integer.")
  if (!(pageSize >= 1 && pageSize <= MAX_PAGE_SIZE)) return fail(400, "INVALID_QUERY", `pageSize must be between 1 and ${MAX_PAGE_SIZE}.`)

  const search = sp.get("search")?.trim() || undefined
  if (search && search.length > MAX_SEARCH) return fail(400, "INVALID_QUERY", `search must be at most ${MAX_SEARCH} characters.`)

  const status = sp.get("status") || undefined
  if (status && !(BATCH_STATUSES as readonly string[]).includes(status)) return fail(400, "INVALID_QUERY", "Unknown status filter.")

  const sort = (sp.get("sort") || "newest") as BatchListSort
  if (!SORTS.includes(sort)) return fail(400, "INVALID_QUERY", "sort must be 'newest', 'oldest' or 'updated'.")

  const range = sp.get("range") || "all"
  let createdFrom: Date | undefined
  let createdTo: Date | undefined
  if (range === "7d" || range === "30d") createdFrom = new Date(now - (range === "7d" ? 7 : 30) * DAY_MS)
  else if (range === "custom") {
    const from = parseDay(sp.get("from"), false)
    const to = parseDay(sp.get("to"), true)
    if (from === null || to === null) return fail(400, "INVALID_QUERY", "Dates must use the YYYY-MM-DD format.")
    if (from && to && from >= to) return fail(400, "INVALID_QUERY", "The start date must be on or before the end date.")
    createdFrom = from
    createdTo = to
  } else if (range !== "all") return fail(400, "INVALID_QUERY", "Unknown date range.")

  return { ok: true, value: { page, pageSize, search, status: status as BatchStatus | undefined, createdFrom, createdTo, sort } }
}

export async function listBatchHistory(q: BatchHistoryQuery, actor: HistoryActor): Promise<{ ok: true; body: BatchHistoryList }> {
  const searchIsId = q.search !== undefined && BATCH_ID_PATTERN.test(q.search)
  const { items, total } = await listBatches({
    status: q.status,
    ownerId: actor.viewScope === "all" ? undefined : actor.userId,
    batchId: searchIsId ? q.search!.toLowerCase() : undefined,
    search: searchIsId ? undefined : q.search,
    createdFrom: q.createdFrom,
    createdTo: q.createdTo,
    sort: q.sort,
    limit: q.pageSize,
    offset: (q.page - 1) * q.pageSize,
  })
  return {
    ok: true,
    body: {
      success: true,
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: items.map(
        (b): BatchHistoryItem => ({
          id: b.id,
          name: b.name,
          description: b.description,
          projectName: b.projectName,
          status: b.status,
          total: b.stats.total,
          completed: b.stats.completed,
          failed: b.stats.failed,
          pending: b.stats.pending,
          processing: b.stats.processing,
          createdAt: b.createdAt,
          updatedAt: b.updatedAt,
          createdByMe: Number(b.createdBy) === actor.userId,
          createdById: actor.viewScope === "all" ? Number(b.createdBy) : null,
          settings: { outputLanguage: b.settings.outputLanguage, subject: b.settings.subject, descriptionMode: b.settings.descriptionMode },
        }),
      ),
    },
  }
}
