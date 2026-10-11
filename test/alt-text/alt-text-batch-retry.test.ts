import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/db", () => ({ query: vi.fn() }))
const store = vi.hoisted(() => ({
  getBatch: vi.fn(),
  getAssetRefs: vi.fn(),
  retryFailedBatchAssets: vi.fn(),
}))
vi.mock("@/lib/alt-text/store", () => store)
vi.mock("@/lib/alt-text/batch-job", () => ({ ALT_TEXT_BATCH_JOB_TYPE: "alt_text_batch", altTextBatchIdempotencyKey: (id: string) => `alt-text-batch:${id}` }))
vi.mock("@/lib/alt-text/batch-submission", () => ({ resolveBatchModel: vi.fn(async () => ({})), assetScanVerdict: vi.fn(async () => "clean") }))
vi.mock("@/lib/alt-text/generate", () => ({ aiErrorToFailure: () => ({ status: 503, code: "MODEL_UNAVAILABLE", error: "Model unavailable" }) }))

import { retryBatchFailures } from "@/lib/alt-text/batch-retry"
import { classifyFailureCode, maxImageAttemptsFromEnv, retryBlocker } from "@/lib/alt-text/retry-policy"
import { AiError } from "@/lib/ai/governance-core"

const BID = "11111111-2222-4333-8444-555555555555"
const actor = { userId: 7, tenantId: 42, role: "employee" as const, updateScope: "all" as const }
const ref = (id: number, extra: Record<string, unknown> = {}) => ({ id, batchId: BID, status: "failed", createdBy: 7, reviewerId: null, ...extra })
const clean = vi.fn(async () => "clean" as const)

/** Simulates the store: applies the blocker callback to candidates and reports accepted/skipped. */
function storeApplies(candidates: { id: number; status: string; currentVersion: number; errorCode: string | null; attempts: number }[]) {
  store.retryFailedBatchAssets.mockImplementation(async (_b: string, _job: unknown, opts: { assetIds?: number[]; blocker: (c: any) => string | null }) => {
    const pool = opts.assetIds ? candidates.filter((c) => opts.assetIds!.includes(c.id)) : candidates
    const accepted: number[] = []
    const skipped: { id: number; reason: string }[] = []
    for (const c of pool) {
      const reason = opts.blocker(c)
      if (reason) skipped.push({ id: c.id, reason })
      else accepted.push(c.id)
    }
    return { state: "changed", status: accepted.length ? "queued" : "partially_completed", accepted, skipped }
  })
}

const cand = (id: number, errorCode: string | null, attempts = 1, currentVersion = 0) => ({ id, status: "failed", currentVersion, errorCode, attempts })

beforeEach(() => {
  vi.clearAllMocks()
  store.getBatch.mockResolvedValue({ id: BID, status: "partially_completed", createdBy: 7, submittedBy: 7 })
  store.getAssetRefs.mockResolvedValue([ref(1), ref(2), ref(3)])
})

describe("retry policy", () => {
  it("classifies persisted error codes and treats unknown codes as needing review", () => {
    expect(classifyFailureCode("PROVIDER_TIMEOUT")).toBe("transient")
    expect(classifyFailureCode("INSUFFICIENT_CREDITS")).toBe("credits")
    expect(classifyFailureCode("AI_DISABLED")).toBe("configuration")
    expect(classifyFailureCode("UNSUPPORTED_TYPE")).toBe("permanent")
    expect(classifyFailureCode(null)).toBe("needs_review")
    expect(classifyFailureCode("SOMETHING_NEW")).toBe("needs_review")
  })

  it("blocks permanent, unclassified, generated and exhausted images", () => {
    expect(retryBlocker(cand(1, "PROVIDER_ERROR"), 5)).toBeNull()
    expect(retryBlocker(cand(1, "INSUFFICIENT_CREDITS"), 5)).toBeNull()
    expect(retryBlocker(cand(1, "FILE_TOO_LARGE"), 5)).toBe("PERMANENT_FAILURE")
    expect(retryBlocker(cand(1, null), 5)).toBe("NEEDS_REVIEW")
    expect(retryBlocker(cand(1, "PROVIDER_ERROR", 5), 5)).toBe("ATTEMPTS_EXHAUSTED")
    expect(retryBlocker(cand(1, "PROVIDER_ERROR", 1, 2), 5)).toBe("HAS_RESULT")
    expect(retryBlocker({ ...cand(1, "PROVIDER_ERROR"), status: "completed" }, 5)).toBe("NOT_FAILED")
  })

  it("reads a bounded attempt limit from env", () => {
    expect(maxImageAttemptsFromEnv({})).toBe(5)
    expect(maxImageAttemptsFromEnv({ ALT_TEXT_MAX_IMAGE_ATTEMPTS: "3" })).toBe(3)
    expect(maxImageAttemptsFromEnv({ ALT_TEXT_MAX_IMAGE_ATTEMPTS: "999" })).toBe(20)
    expect(maxImageAttemptsFromEnv({ ALT_TEXT_MAX_IMAGE_ATTEMPTS: "nope" })).toBe(5)
  })
})

describe("retry failed batch images", () => {
  it("re-queues only eligible images on the existing job and reports skips", async () => {
    storeApplies([cand(1, "PROVIDER_ERROR"), cand(2, "UNSUPPORTED_TYPE"), cand(3, null)])
    const res = await retryBatchFailures(BID, actor as any, {}, { scan: clean, maxAttempts: 5 })
    expect(store.retryFailedBatchAssets).toHaveBeenCalledWith(BID, { type: "alt_text_batch", idempotencyKey: `alt-text-batch:${BID}` }, expect.any(Object))
    expect(res).toMatchObject({
      ok: true,
      body: { acceptedCount: 1, acceptedIds: [1], skippedCount: 2, skippedByReason: { PERMANENT_FAILURE: 1, NEEDS_REVIEW: 1 } },
    })
  })

  it("skips images whose file is unsafe or missing", async () => {
    storeApplies([cand(1, "PROVIDER_ERROR"), cand(2, "PROVIDER_ERROR"), cand(3, "PROVIDER_ERROR")])
    const scan = vi.fn(async (r: { id: number }) => (r.id === 2 ? "quarantined" : r.id === 3 ? "missing" : "clean")) as any
    const res = await retryBatchFailures(BID, actor as any, {}, { scan, maxAttempts: 5 })
    expect(res).toMatchObject({ ok: true, body: { acceptedIds: [1], skippedByReason: { UNSAFE_FILE: 2 } } })
  })

  it("a pending scan does not block retry", async () => {
    storeApplies([cand(1, "PROVIDER_ERROR")])
    store.getAssetRefs.mockResolvedValue([ref(1)])
    const res = await retryBatchFailures(BID, actor as any, {}, { scan: vi.fn(async () => "pending") as any, maxAttempts: 5 })
    expect(res).toMatchObject({ ok: true, body: { acceptedIds: [1] } })
  })

  it("retries a single image and surfaces its blocker as an error", async () => {
    storeApplies([cand(1, "PROVIDER_ERROR"), cand(2, "FILE_TOO_LARGE")])
    store.getAssetRefs.mockResolvedValue([ref(2)])
    const res = await retryBatchFailures(BID, actor as any, { assetId: 2 }, { scan: clean, maxAttempts: 5 })
    expect(res).toMatchObject({ ok: false, status: 409, code: "PERMANENT_FAILURE" })

    store.getAssetRefs.mockResolvedValue([ref(1)])
    expect(await retryBatchFailures(BID, actor as any, { assetId: 1 }, { scan: clean, maxAttempts: 5 })).toMatchObject({ ok: true, body: { acceptedIds: [1] } })
  })

  it("an image from another batch is not found", async () => {
    store.getAssetRefs.mockResolvedValue([ref(9, { batchId: "other" })])
    expect(await retryBatchFailures(BID, actor as any, { assetId: 9 }, { scan: clean })).toMatchObject({ ok: false, status: 404 })
    expect(store.retryFailedBatchAssets).not.toHaveBeenCalled()
  })

  it("cancelled and draft batches cannot be retried", async () => {
    store.getBatch.mockResolvedValue({ id: BID, status: "cancelled", createdBy: 7, submittedBy: 7 })
    expect(await retryBatchFailures(BID, actor as any)).toMatchObject({ ok: false, code: "BATCH_CANCELLED" })
    store.getBatch.mockResolvedValue({ id: BID, status: "draft", createdBy: 7, submittedBy: 7 })
    expect(await retryBatchFailures(BID, actor as any)).toMatchObject({ ok: false, code: "BATCH_NOT_RETRYABLE" })
    expect(store.retryFailedBatchAssets).not.toHaveBeenCalled()
  })

  it("reports when there are no failed images", async () => {
    store.getAssetRefs.mockResolvedValue([ref(1, { status: "completed" })])
    expect(await retryBatchFailures(BID, actor as any, {}, { scan: clean })).toMatchObject({ ok: false, code: "NO_FAILED_IMAGES" })
  })

  it("is blocked before any change when the AI model is unavailable", async () => {
    const resolveModel = vi.fn(async () => {
      throw new AiError("MODEL_UNAVAILABLE" as any, "down" as any)
    })
    expect(await retryBatchFailures(BID, actor as any, {}, { resolveModel, scan: clean })).toMatchObject({ ok: false, status: 503 })
    expect(store.retryFailedBatchAssets).not.toHaveBeenCalled()
  })

  it("own-scope users cannot see other users' batches", async () => {
    store.getBatch.mockResolvedValue({ id: BID, status: "failed", createdBy: 99, submittedBy: 99 })
    expect(await retryBatchFailures(BID, { ...actor, updateScope: "added" } as any)).toMatchObject({ ok: false, status: 404 })
  })

  it("out-of-scope images are skipped without leaking their ids", async () => {
    storeApplies([cand(1, "PROVIDER_ERROR"), cand(2, "PROVIDER_ERROR")])
    store.getAssetRefs.mockResolvedValue([ref(1), ref(2, { createdBy: 99 })])
    const res = await retryBatchFailures(BID, { ...actor, updateScope: "added" } as any, {}, { scan: clean, maxAttempts: 5 })
    expect(res).toMatchObject({ ok: true, body: { acceptedIds: [1], skippedCount: 0, skipped: [], skippedByReason: {} } })
  })

  it("a batch without a durable job reports JOB_UNAVAILABLE", async () => {
    store.retryFailedBatchAssets.mockResolvedValue({ state: "job_unavailable" })
    expect(await retryBatchFailures(BID, actor as any, {}, { scan: clean })).toMatchObject({ ok: false, code: "JOB_UNAVAILABLE" })
  })
})
