import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
const store = vi.hoisted(() => ({
  BATCH_COMPLETED_ASSET_STATUSES: ["in_review", "approved", "rejected"],
  getBatchProgressRecord: vi.fn(),
  listBatchAssetStatuses: vi.fn(),
}))
vi.mock("@/lib/alt-text/store", () => store)
vi.mock("@/lib/alt-text/batch-job", () => ({
  ALT_TEXT_BATCH_JOB_TYPE: "alt_text.batch_processing",
  altTextBatchIdempotencyKey: (id: string) => `alt-text-batch:${id}`,
}))
const ai = vi.hoisted(() => ({ generate: vi.fn(), enqueue: vi.fn() }))
vi.mock("@/lib/alt-text/generate", () => ({ generateAltTextForAsset: ai.generate }))
vi.mock("@/lib/background-jobs", () => ({ enqueueBackgroundJob: ai.enqueue, enqueueBackgroundJobInTransaction: ai.enqueue }))
const gate = vi.hoisted(() => ({ result: null as any }))
vi.mock("@/lib/alt-text/route-gate", async () => {
  const { NextResponse } = await import("next/server")
  const H = { "Cache-Control": "private, no-store" }
  return {
    gateAltTextHistory: vi.fn(async () => gate.result),
    jsonError: (f: any) => NextResponse.json({ success: false, error: f.error, code: f.code }, { status: f.status, headers: H }),
    jsonOk: (b: unknown) => NextResponse.json(b, { headers: H }),
    unexpected: () => NextResponse.json({ success: false, code: "INTERNAL_ERROR" }, { status: 500, headers: H }),
  }
})
const rate = vi.hoisted(() => ({ checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfter: 0 })) }))
vi.mock("@/lib/rate-limit", () => rate)
vi.mock("@/lib/tenant-scope", () => ({ currentTenantIdOrNull: () => 42 }))

import { NextRequest, NextResponse } from "next/server"
import { computeProgress, readBatchAssets, readBatchProgress, toProgressView, parseBatchAssetsQuery } from "@/lib/alt-text/batch-progress"
import { GET as progressGET } from "@/app/api/alt-text/batches/[id]/progress/route"
import { GET as assetsGET } from "@/app/api/alt-text/batches/[id]/assets/route"

const BID = "11111111-2222-4333-8444-555555555555"
const admin = { userId: 1, viewScope: "all" as const }
const T = "2026-10-01T10:00:00.000Z"
const job = (over: Record<string, unknown> = {}) => ({ status: "running", deferred: false, leaseExpired: false, startedAt: T, completedAt: null, updatedAt: T, ...over })
const record = (counts: Record<string, number>, over: Record<string, unknown> = {}) => ({
  id: BID,
  name: "Chapter 3",
  status: "processing",
  createdBy: 7,
  submittedBy: 7,
  createdAt: "2026-10-01T09:00:00.000Z",
  submittedAt: "2026-10-01T09:30:00.000Z",
  updatedAt: T,
  assetsUpdatedAt: "2026-10-01T10:05:00.000Z",
  counts: { total: 0, pending: 0, blocked: 0, processing: 0, staleProcessing: 0, completed: 0, failed: 0, ...counts },
  job: job(),
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  gate.result = { ok: true, actor: admin }
  rate.checkRateLimit.mockResolvedValue({ allowed: true, retryAfter: 0 })
})

describe("progress calculation", () => {
  it("reports counts, progress and success separately", async () => {
    store.getBatchProgressRecord.mockResolvedValue(record({ total: 100, pending: 30, processing: 2, completed: 60, failed: 8 }))
    const r = await readBatchProgress(BID, admin)
    expect(r).toMatchObject({ ok: true, body: { total: 100, pending: 30, processing: 2, completed: 60, failed: 8, other: 0, progressPercent: 68, successPercent: 60, syncState: "active" } })
    expect(store.getBatchProgressRecord).toHaveBeenCalledWith(BID, { type: "alt_text.batch_processing", idempotencyKey: `alt-text-batch:${BID}` })
    if (r.ok) expect(r.body.lastUpdatedAt).toBe("2026-10-01T10:05:00.000Z")
  })

  it("handles zero images without dividing by zero", () => {
    expect(computeProgress({ total: 0, pending: 0, processing: 0, completed: 0, failed: 0 })).toEqual({ progressPercent: 0, successPercent: 0, other: 0 })
    expect(toProgressView(record({}, { status: "draft", job: null }) as any)).toMatchObject({ syncState: "idle", progressPercent: 0, startedAt: null, completedAt: null, pollIntervalMs: null })
  })

  it("partially completed batch reaches 100% progress without 100% success", () => {
    const v = toProgressView(record({ total: 10, completed: 7, failed: 3 }, { status: "partially_completed", job: job({ status: "completed", completedAt: "2026-10-01T11:00:00.000Z" }) }) as any)
    expect(v).toMatchObject({ progressPercent: 100, successPercent: 70, syncState: "settled", completedAt: "2026-10-01T11:00:00.000Z", isActive: false })
  })

  it("fully failed batch is 100% processed and 0% successful", () => {
    expect(toProgressView(record({ total: 4, failed: 4 }, { status: "failed", job: job({ status: "completed" }) }) as any)).toMatchObject({ progressPercent: 100, successPercent: 0, failed: 4 })
  })

  it("credit-blocked/deferred batches keep progress and are not counted as done", () => {
    const v = toProgressView(record({ total: 10, completed: 4, pending: 6, blocked: 6 }, { job: job({ status: "queued", deferred: true }) }) as any)
    expect(v).toMatchObject({ syncState: "deferred", progressPercent: 40, successPercent: 40, blockedPending: 6, completedAt: null })
  })

  it("retry transitions recalculate from current records", () => {
    const before = toProgressView(record({ total: 5, completed: 3, failed: 2 }, { status: "partially_completed" }) as any)
    const after = toProgressView(record({ total: 5, completed: 3, pending: 2 }, { status: "partially_completed" }) as any)
    expect(before.progressPercent).toBe(100)
    expect(after).toMatchObject({ progressPercent: 60, failed: 0, syncState: "out_of_sync" })
  })

  it("stale or orphaned workers are reported as stalled, not processing", () => {
    expect(toProgressView(record({ total: 3, processing: 1, staleProcessing: 1, pending: 2 }) as any).syncState).toBe("stalled")
    expect(toProgressView(record({ total: 3, pending: 3 }, { job: job({ status: "dead_letter" }) }) as any).syncState).toBe("stalled")
    expect(toProgressView(record({ total: 3, pending: 3 }, { job: job({ leaseExpired: true }) }) as any).syncState).toBe("stalled")
    expect(toProgressView(record({ total: 3, completed: 3 }) as any).syncState).toBe("settling")
  })
})

describe("access control", () => {
  it("rejects malformed ids and hides foreign/out-of-scope batches", async () => {
    expect(await readBatchProgress("1 OR 1=1", admin)).toMatchObject({ ok: false, status: 400 })
    store.getBatchProgressRecord.mockResolvedValue(null)
    expect(await readBatchProgress(BID, admin)).toMatchObject({ ok: false, status: 404 })
    store.getBatchProgressRecord.mockResolvedValue(record({ total: 1 }))
    expect(await readBatchProgress(BID, { userId: 99, viewScope: "added" })).toMatchObject({ ok: false, status: 404 })
    expect(await readBatchProgress(BID, { userId: 7, viewScope: "added" })).toMatchObject({ ok: true })
  })

  it("routes return gate errors and 429 with no-store headers", async () => {
    const ctx = { params: Promise.resolve({ id: BID }) }
    gate.result = { ok: false, response: NextResponse.json({ code: "UNAUTHENTICATED" }, { status: 401 }) }
    expect((await progressGET(new NextRequest("http://x/p"), ctx)).status).toBe(401)
    gate.result = { ok: false, response: NextResponse.json({ code: "FORBIDDEN" }, { status: 403 }) }
    expect((await assetsGET(new NextRequest("http://x/a"), ctx)).status).toBe(403)
    gate.result = { ok: true, actor: admin }
    rate.checkRateLimit.mockResolvedValueOnce({ allowed: false, retryAfter: 9 })
    const limited = await progressGET(new NextRequest("http://x/p"), ctx)
    expect(limited.status).toBe(429)
    expect(limited.headers.get("Retry-After")).toBe("9")
    store.getBatchProgressRecord.mockResolvedValue(record({ total: 2, pending: 2 }))
    const ok = await progressGET(new NextRequest("http://x/p"), ctx)
    expect(ok.status).toBe(200)
    expect(ok.headers.get("Cache-Control")).toContain("no-store")
    store.getBatchProgressRecord.mockRejectedValueOnce(Object.assign(new Error("sql"), { code: "ER_X" }))
    expect((await progressGET(new NextRequest("http://x/p"), ctx)).status).toBe(500)
  })

  it("polling never enqueues jobs or calls AI", async () => {
    store.getBatchProgressRecord.mockResolvedValue(record({ total: 2, pending: 2 }))
    store.listBatchAssetStatuses.mockResolvedValue({ items: [], total: 0 })
    for (let i = 0; i < 3; i++) {
      await readBatchProgress(BID, admin)
      await readBatchAssets(BID, { page: 1, pageSize: 25 }, admin)
    }
    expect(ai.generate).not.toHaveBeenCalled()
    expect(ai.enqueue).not.toHaveBeenCalled()
  })
})

describe("per-image status", () => {
  it("validates pagination and status filters", () => {
    expect(parseBatchAssetsQuery(new URLSearchParams("pageSize=500"))).toMatchObject({ ok: false, status: 400 })
    expect(parseBatchAssetsQuery(new URLSearchParams("status=hacked"))).toMatchObject({ ok: false, status: 400 })
    expect(parseBatchAssetsQuery(new URLSearchParams("page=3&pageSize=50&status=failed"))).toMatchObject({ ok: true, value: { page: 3, pageSize: 50, status: "failed" } })
  })

  it("returns bounded, safe rows with scope applied per asset", async () => {
    store.getBatchProgressRecord.mockResolvedValue(record({ total: 60 }))
    store.listBatchAssetStatuses.mockResolvedValue({
      total: 60,
      items: [
        { id: 5, fileName: "a.png", classification: "diagram", status: "approved", shortAltPreview: "A cell", errorMessage: null, createdBy: 7, reviewerId: null, updatedAt: T },
        { id: 6, fileName: "b.png", classification: null, status: "failed", shortAltPreview: null, errorMessage: "Image unreadable", createdBy: 7, reviewerId: null, updatedAt: T },
      ],
    })
    const r = await readBatchAssets(BID, { page: 2, pageSize: 25, status: "completed" }, { userId: 7, viewScope: "added" })
    expect(store.listBatchAssetStatuses).toHaveBeenCalledWith(BID, { statuses: ["in_review", "approved", "rejected"], limit: 25, offset: 25, owner: { userId: 7, match: "added" } })
    if (!r.ok) throw new Error("expected ok")
    expect(r.body).toMatchObject({ total: 60, page: 2, pageSize: 25 })
    expect(r.body.items[0]).toMatchObject({ progressStatus: "completed", previewUrl: "/api/alt-text/assets/5/image", failureReason: null, startedAt: null })
    expect(r.body.items[1]).toMatchObject({ progressStatus: "failed", failureReason: "Image unreadable" })
    expect(JSON.stringify(r.body)).not.toMatch(/storage|createdBy/)
  })

  it("denies cross-tenant batch asset listing", async () => {
    store.getBatchProgressRecord.mockResolvedValue(null)
    expect(await readBatchAssets(BID, { page: 1, pageSize: 25 }, admin)).toMatchObject({ ok: false, status: 404 })
    expect(store.listBatchAssetStatuses).not.toHaveBeenCalled()
  })
})
