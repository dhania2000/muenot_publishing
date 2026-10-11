import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
const store = vi.hoisted(() => ({
  BATCH_HOLD_STATUSES: ["pause_requested", "paused", "cancel_requested"],
  BATCH_MAX_ASSETS_PER_CALL: 500,
  BatchError: class BatchError extends Error {},
  createBatch: vi.fn(),
  findBatchIdByIdempotencyKey: vi.fn(),
  getAssetRefs: vi.fn(),
  getBatch: vi.fn(),
  getSettings: vi.fn(),
  listBatchAssets: vi.fn(),
  normalizeOverride: vi.fn((_s: unknown, o: any) => (o && Object.keys(o).length ? o : null)),
  submitBatch: vi.fn(),
}))
vi.mock("@/lib/alt-text/store", () => store)
const queue = vi.hoisted(() => ({
  ensureBackgroundJobSchema: vi.fn(async () => undefined),
  enqueueBackgroundJobInTransaction: vi.fn(async () => ({ jobId: 501, created: true })),
}))
vi.mock("@/lib/background-jobs", () => queue)
vi.mock("@/lib/ai/assistant-store", () => ({ getTenantAiSettings: vi.fn() }))
vi.mock("@/lib/ai/model-catalog", () => ({ resolveTenantModels: vi.fn() }))
vi.mock("@/lib/alt-text/vision-service", () => ({ selectVisionModel: vi.fn() }))
vi.mock("@/lib/storage", () => ({ keyBelongsToTenant: (k: string, t: number) => k.startsWith(`t${t}/`) }))
vi.mock("@/lib/storage/file-metadata", () => ({ getByObjectKey: vi.fn() }))
vi.mock("@/lib/storage/file-scanning", () => ({ getScanForFile: vi.fn(), canDownload: vi.fn() }))

import { DEFAULT_GENERATION_SETTINGS } from "@/lib/alt-text/core"
import { createBatchFromRequest, parseCreateBatchRequest, submitBatchForProcessing } from "@/lib/alt-text/batch-submission"

const actor = { userId: 7, tenantId: 42, role: "employee" as const, updateScope: "all" as const }
const BID = "11111111-2222-4333-8444-555555555555"
const settings = { ...DEFAULT_GENERATION_SETTINGS, subject: "biology", imageContext: "Cell diagram" }
const ref = (id: number, over: Record<string, unknown> = {}) => ({ id, status: "uploaded", batchId: null, storageKey: `t42/${id}`, createdBy: 7, reviewerId: null, ...over })
const batch = (over: Record<string, unknown> = {}) => ({ id: BID, name: "Ch 3", status: "draft", settings, createdBy: 7, createdAt: new Date(0), stats: { total: 2 }, ...over })
const okDeps = { scan: vi.fn(async () => "clean" as const), resolveModel: vi.fn(async () => ({})) }
const parse = (body: Record<string, unknown>, key: string | null = null) => parseCreateBatchRequest({ name: "Ch 3", assetIds: [1, 2], settings, ...body }, key)

beforeEach(() => {
  vi.clearAllMocks()
  store.getAssetRefs.mockResolvedValue([ref(1), ref(2)])
  store.getBatch.mockResolvedValue(batch())
  store.createBatch.mockResolvedValue(BID)
  store.findBatchIdByIdempotencyKey.mockResolvedValue(null)
  store.listBatchAssets.mockResolvedValue({ items: [{ id: 1, effectiveSettings: settings }, { id: 2, effectiveSettings: settings }] })
  store.submitBatch.mockResolvedValue({ state: "submitted", acceptedCount: 2 })
  okDeps.scan.mockResolvedValue("clean")
})

describe("batch creation", () => {
  it("validates input and rejects bad data with the right status", () => {
    expect(parse({ name: "" })).toMatchObject({ ok: false, status: 400 })
    expect(parse({ name: "x".repeat(151) })).toMatchObject({ ok: false, status: 400 })
    expect(parse({ assetIds: [] })).toMatchObject({ ok: false, status: 400 })
    expect(parse({ assetIds: Array.from({ length: 501 }, (_, i) => i + 1) })).toMatchObject({ ok: false, status: 413 })
    expect(parse({ tenantId: 99 })).toMatchObject({ ok: false, status: 400 })
    expect(parse({ overrides: { 9: { subject: "x" } } })).toMatchObject({ ok: false, status: 422, code: "INVALID_OVERRIDE" })
    expect(parse({}, "bad key")).toMatchObject({ ok: false, code: "INVALID_IDEMPOTENCY_KEY" })
    const ok = parse({ assetIds: [1, 1, 2] }, "key-12345678")
    expect(ok.ok && ok.value.assetIds).toEqual([1, 2])
  })

  it("creates a draft with defaults and per-image overrides, returning only safe fields", async () => {
    const p = parse({ overrides: { 1: { gradeLevel: "undergraduate" } } }, "key-12345678")
    if (!p.ok) throw new Error("parse failed")
    const res = await createBatchFromRequest(p.value, actor)
    expect(res).toMatchObject({ ok: true, status: 201, body: { batch: { id: BID, status: "draft", totalImages: 2 } } })
    const [input, creator] = store.createBatch.mock.calls[0]
    expect(creator).toBe(7)
    expect(input.settings.subject).toBe("biology")
    expect(input.assets).toEqual([{ assetId: 1, override: { gradeLevel: "undergraduate" } }, { assetId: 2, override: undefined }])
    expect(input.idempotencyKey).toBe("key-12345678")
    expect(JSON.stringify(res)).not.toContain("t42/")
  })

  it("rejects missing / cross-tenant assets, out-of-scope and conflicting assets", async () => {
    const p = parse({})
    if (!p.ok) throw new Error()
    store.getAssetRefs.mockResolvedValueOnce([ref(1)])
    expect(await createBatchFromRequest(p.value, actor)).toMatchObject({ status: 404, code: "ASSET_NOT_FOUND" })
    store.getAssetRefs.mockResolvedValueOnce([ref(1), ref(2, { createdBy: 99 })])
    expect(await createBatchFromRequest(p.value, { ...actor, updateScope: "added" })).toMatchObject({ status: 403 })
    store.getAssetRefs.mockResolvedValueOnce([ref(1), ref(2, { batchId: "other" })])
    expect(await createBatchFromRequest(p.value, actor)).toMatchObject({ status: 409 })
    expect(store.createBatch).not.toHaveBeenCalled()
  })

  it("maps transactional failures (cross-tenant project, rollback) to safe errors", async () => {
    const p = parse({ projectId: 99 })
    if (!p.ok) throw new Error()
    store.createBatch.mockRejectedValueOnce(new store.BatchError("Alt Text project not found for this tenant"))
    expect(await createBatchFromRequest(p.value, actor)).toMatchObject({ status: 404, code: "PROJECT_NOT_FOUND" })
    store.createBatch.mockRejectedValueOnce(new store.BatchError("Asset already belongs to another batch"))
    expect(await createBatchFromRequest(p.value, actor)).toMatchObject({ status: 409 })
  })

  it("replays a duplicate create with the same idempotency key without creating a second batch", async () => {
    store.findBatchIdByIdempotencyKey.mockResolvedValue(BID)
    const p = parse({}, "key-12345678")
    if (!p.ok) throw new Error()
    expect(await createBatchFromRequest(p.value, actor)).toMatchObject({ ok: true, status: 200, body: { replayed: true, batch: { id: BID } } })
    expect(store.createBatch).not.toHaveBeenCalled()
  })
})

describe("batch submission", () => {
  it("queues a valid draft without starting processing", async () => {
    const res = await submitBatchForProcessing(BID, actor, okDeps)
    expect(res).toMatchObject({ ok: true, body: { submissionStatus: "queued", acceptedImageCount: 2 } })
    expect(store.submitBatch).toHaveBeenCalledWith(BID, 7, [1, 2], expect.any(Function))
  })

  it("enqueues exactly one reference-only job on the submit transaction", async () => {
    const conn = { query: vi.fn() }
    store.submitBatch.mockImplementationOnce(async (_id: string, _u: number, ids: number[], onQueued: any) => {
      await onQueued(conn, { tenantId: 42, batchId: BID })
      return { state: "submitted", acceptedCount: ids.length }
    })
    const res = await submitBatchForProcessing(BID, actor, okDeps)
    expect(queue.ensureBackgroundJobSchema).toHaveBeenCalled()
    expect(queue.enqueueBackgroundJobInTransaction).toHaveBeenCalledTimes(1)
    expect(queue.enqueueBackgroundJobInTransaction).toHaveBeenCalledWith(conn, expect.objectContaining({
      jobType: "alt_text.batch_processing",
      tenantId: 42,
      payload: { batchId: BID },
      idempotencyKey: `alt-text-batch:${BID}`,
      concurrencyKey: "alt_text.batch_processing:t42",
    }))
    expect(res).toMatchObject({ ok: true, body: { jobId: 501, submissionStatus: "queued" } })
  })

  it("does not report success when the enqueue fails (submit transaction rolls back)", async () => {
    queue.enqueueBackgroundJobInTransaction.mockRejectedValueOnce(new Error("queue full"))
    store.submitBatch.mockImplementationOnce(async (_id: string, _u: number, _ids: number[], onQueued: any) => {
      await onQueued({ query: vi.fn() }, { tenantId: 42, batchId: BID })
      return { state: "submitted", acceptedCount: 2 }
    })
    await expect(submitBatchForProcessing(BID, actor, okDeps)).rejects.toThrow("queue full")
  })

  it("prevents duplicate and concurrent submissions", async () => {
    store.getBatch.mockResolvedValueOnce(batch({ status: "queued" }))
    expect(await submitBatchForProcessing(BID, actor, okDeps)).toMatchObject({ status: 409, code: "BATCH_ALREADY_SUBMITTED" })
    store.submitBatch.mockResolvedValueOnce({ state: "already_submitted", status: "queued", acceptedCount: 2 })
    expect(await submitBatchForProcessing(BID, actor, okDeps)).toMatchObject({ status: 409 })
    store.submitBatch.mockResolvedValueOnce({ state: "assets_changed" })
    expect(await submitBatchForProcessing(BID, actor, okDeps)).toMatchObject({ status: 409, code: "BATCH_CHANGED" })
  })

  it("blocks pending, quarantined or unsafe images and never queues them", async () => {
    okDeps.scan.mockImplementation(async (r: any) => (r.id === 1 ? "pending" : "unsafe"))
    const res = await submitBatchForProcessing(BID, actor, okDeps)
    expect(res).toMatchObject({ status: 422, code: "ASSETS_NOT_CLEARED", details: { blocked: [{ assetId: 1, reason: "pending" }, { assetId: 2, reason: "unsafe" }] } })
    expect(store.submitBatch).not.toHaveBeenCalled()
  })

  it("returns 404 for another tenant's batch and 422 for an empty batch", async () => {
    store.getBatch.mockResolvedValueOnce(null)
    expect(await submitBatchForProcessing(BID, actor, okDeps)).toMatchObject({ status: 404 })
    store.getAssetRefs.mockResolvedValueOnce([])
    expect(await submitBatchForProcessing(BID, actor, okDeps)).toMatchObject({ status: 422, code: "NO_ELIGIBLE_ASSETS" })
  })
})
