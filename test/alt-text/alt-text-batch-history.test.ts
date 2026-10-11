import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
const store = vi.hoisted(() => ({ listBatches: vi.fn() }))
vi.mock("@/lib/alt-text/store", () => ({
  BATCH_STATUSES: ["draft", "queued", "processing", "pause_requested", "paused", "cancel_requested", "completed", "partially_completed", "failed", "cancelled"],
  listBatches: store.listBatches,
}))
vi.mock("@/lib/alt-text/batch-progress", () => ({ BATCH_ID_PATTERN: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i }))

import { listBatchHistory, parseBatchHistoryQuery } from "@/lib/alt-text/batch-history"
import { batchHistoryUrl } from "@/lib/alt-text/batch-history-types"

const BATCH_ID = "11111111-2222-4333-8444-555555555555"
const parse = (q: string, now?: number) => parseBatchHistoryQuery(new URLSearchParams(q), now)
const batch = (over: Record<string, unknown> = {}) => ({
  id: BATCH_ID, name: "Chapter 3", description: null, projectName: null, status: "completed", createdBy: 7,
  createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-02T00:00:00.000Z",
  stats: { total: 4, pending: 0, processing: 0, completed: 3, failed: 1 },
  settings: { outputLanguage: "en", subject: "biology", descriptionMode: "both", imageContext: "secret context" }, ...over,
})

beforeEach(() => {
  store.listBatches.mockReset()
  store.listBatches.mockResolvedValue({ items: [batch()], total: 1 })
})

describe("batch history query parsing", () => {
  it("applies defaults", () => {
    expect(parse("")).toEqual({ ok: true, value: { page: 1, pageSize: 20, search: undefined, status: undefined, createdFrom: undefined, createdTo: undefined, sort: "newest" } })
  })

  it("rejects invalid values", () => {
    for (const q of ["page=0", "pageSize=51", "status=bogus", "sort=name", "range=year", "range=custom&from=10/01/2026", `search=${"x".repeat(121)}`, "range=custom&from=2026-10-05&to=2026-10-01"]) {
      expect(parse(q).ok, q).toBe(false)
    }
  })

  it("computes relative and inclusive custom date ranges", () => {
    const now = Date.parse("2026-10-11T00:00:00.000Z")
    const r7 = parse("range=7d", now)
    expect(r7.ok && r7.value.createdFrom?.toISOString()).toBe("2026-10-04T00:00:00.000Z")
    const custom = parse("range=custom&from=2026-10-01&to=2026-10-01")
    expect(custom.ok && [custom.value.createdFrom?.toISOString(), custom.value.createdTo?.toISOString()]).toEqual(["2026-10-01T00:00:00.000Z", "2026-10-02T00:00:00.000Z"])
  })
})

describe("listBatchHistory", () => {
  const q = (over = {}) => ({ page: 2, pageSize: 10, sort: "newest" as const, ...over })

  it("scopes non-admin actors to their own batches and paginates", async () => {
    await listBatchHistory(q(), { userId: 7, viewScope: "owned" } as any)
    expect(store.listBatches).toHaveBeenCalledWith(expect.objectContaining({ ownerId: 7, limit: 10, offset: 10 }))
  })

  it("does not restrict 'all' scope and exposes creator id only then", async () => {
    const res = await listBatchHistory(q(), { userId: 1, viewScope: "all" } as any)
    expect(store.listBatches.mock.calls[0][0].ownerId).toBeUndefined()
    expect(res.body.items[0]).toMatchObject({ createdById: 7, createdByMe: false, completed: 3, failed: 1 })
    const own = await listBatchHistory(q(), { userId: 7, viewScope: "owned" } as any)
    expect(own.body.items[0]).toMatchObject({ createdById: null, createdByMe: true })
  })

  it("treats a UUID search as an exact batch id lookup", async () => {
    await listBatchHistory(q({ search: BATCH_ID.toUpperCase() }), { userId: 7, viewScope: "all" } as any)
    expect(store.listBatches).toHaveBeenCalledWith(expect.objectContaining({ batchId: BATCH_ID, search: undefined }))
  })

  it("only exposes summary settings", async () => {
    const res = await listBatchHistory(q(), { userId: 7, viewScope: "all" } as any)
    expect(res.body.items[0].settings).toEqual({ outputLanguage: "en", subject: "biology", descriptionMode: "both" })
  })
})

describe("batchHistoryUrl", () => {
  it("omits defaults and only sends custom dates for custom ranges", () => {
    const base = { page: 1, pageSize: 20, search: " ", status: "all" as const, range: "7d" as const, from: "2026-10-01", to: "", sort: "newest" as const }
    expect(batchHistoryUrl(base)).toBe("/api/alt-text/batches?page=1&pageSize=20&sort=newest&range=7d")
  })
})
