import { afterEach, describe, expect, it, vi } from "vitest"
import {
  BatchApiError,
  MAX_BACKOFF_MS,
  assetsUrl,
  errorRetryDelay,
  fetchBatchJson,
  pollInterval,
  progressSegments,
  progressUrl,
  syncNotice,
  totalPages,
  type BatchProgressView,
} from "@/lib/alt-text/batch-dashboard"

const ID = "3f2b8c1e-1111-4222-8333-444455556666"
const view = (over: Partial<BatchProgressView> = {}): BatchProgressView => ({
  success: true,
  batchId: ID,
  name: "Biology",
  status: "processing",
  syncState: "active",
  isActive: true,
  total: 10,
  pending: 3,
  blockedPending: 0,
  processing: 2,
  staleProcessing: 0,
  completed: 4,
  failed: 1,
  other: 0,
  progressPercent: 50,
  successPercent: 40,
  jobStatus: "running",
  createdAt: "2026-10-01T00:00:00Z",
  submittedAt: "2026-10-01T00:00:00Z",
  startedAt: "2026-10-01T00:01:00Z",
  completedAt: null,
  lastUpdatedAt: "2026-10-01T00:02:00Z",
  pollIntervalMs: 4000,
  ...over,
})

const mockFetch = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(body), { status, headers }))

afterEach(() => vi.restoreAllMocks())

describe("batch dashboard", () => {
  it("builds the existing progress/assets URLs with only supported params", () => {
    expect(progressUrl(ID)).toBe(`/api/alt-text/batches/${ID}/progress`)
    expect(assetsUrl(ID, 2, 25, "all")).toBe(`/api/alt-text/batches/${ID}/assets?page=2&pageSize=25`)
    expect(assetsUrl(ID, 1, 25, "failed")).toContain("status=failed")
  })

  it("fetches progress and returns backend values unchanged", async () => {
    mockFetch(200, view())
    const v = await fetchBatchJson<BatchProgressView>(progressUrl(ID))
    expect(v.progressPercent).toBe(50)
    expect(v.successPercent).toBe(40)
  })

  it("maps 429 with Retry-After and 404 errors", async () => {
    mockFetch(429, { success: false, code: "RATE_LIMITED", error: "slow" }, { "Retry-After": "12" })
    await expect(fetchBatchJson(progressUrl(ID))).rejects.toMatchObject({ status: 429, retryAfterMs: 12_000 })
    mockFetch(404, { success: false, code: "NOT_FOUND", error: "Batch not found." })
    await expect(fetchBatchJson(progressUrl(ID))).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" })
  })

  it("maps network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"))
    await expect(fetchBatchJson(progressUrl(ID))).rejects.toMatchObject({ code: "NETWORK_ERROR" })
  })

  it("polls active batches and stops for terminal/draft batches", () => {
    expect(pollInterval(view())).toBe(4000)
    for (const status of ["completed", "partially_completed", "failed", "cancelled"] as const)
      expect(pollInterval(view({ status, isActive: false, pollIntervalMs: null }))).toBe(0)
    expect(pollInterval(view({ status: "draft", isActive: false, pollIntervalMs: null }))).toBe(0)
    expect(pollInterval(undefined)).toBe(0)
  })

  it("applies bounded backoff and stops on permanent errors", () => {
    const temp = new BatchApiError(503, "HTTP_503", "x")
    expect(errorRetryDelay(temp, 1)).toBe(5000)
    expect(errorRetryDelay(temp, 3)).toBe(20_000)
    expect(errorRetryDelay(temp, 6)).toBe(MAX_BACKOFF_MS)
    expect(errorRetryDelay(temp, 7)).toBeNull()
    expect(errorRetryDelay(new BatchApiError(429, "RATE_LIMITED", "x", 30_000), 1)).toBe(30_000)
    for (const s of [400, 401, 403, 404]) expect(errorRetryDelay(new BatchApiError(s, "X", "x"), 1)).toBeNull()
    expect(errorRetryDelay(new BatchApiError(0, "ABORTED", "x"), 1)).toBeNull()
  })

  it("keeps success separate from processing: 100% processed with failures is not 100% successful", () => {
    const done = view({ status: "partially_completed", pending: 0, processing: 0, completed: 7, failed: 3, progressPercent: 100, successPercent: 70 })
    expect(progressSegments(done)).toEqual({ completedPct: 70, failedPct: 30, remaining: 0 })
    expect(syncNotice(done)?.title).toBe("Partially completed")
  })

  it("surfaces stale, deferred, empty and all-failed states", () => {
    expect(syncNotice(view({ syncState: "stalled" }))?.title).toMatch(/stale/i)
    expect(syncNotice(view({ syncState: "deferred" }))?.message).toMatch(/credits/)
    expect(syncNotice(view({ total: 0 }))?.title).toBe("Empty batch")
    expect(syncNotice(view({ status: "failed", syncState: "settled", completed: 0, failed: 10 }))?.tone).toBe("error")
    expect(syncNotice(view())).toBeNull()
  })

  it("computes pagination from the server total", () => {
    expect(totalPages({ total: 2501, pageSize: 25 })).toBe(101)
    expect(totalPages({ total: 0, pageSize: 25 })).toBe(1)
  })
})
