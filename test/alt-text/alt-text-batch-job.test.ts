import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
const store = vi.hoisted(() => ({
  BATCH_HOLD_STATUSES: ["pause_requested", "paused", "cancel_requested"],
  getBatch: vi.fn(),
  getAssetRefs: vi.fn(),
  markBatchProcessing: vi.fn(async () => true),
  settleBatchFromJob: vi.fn(async () => true),
  settleBatchControl: vi.fn(async () => null),
  finalizeBatchFromAssets: vi.fn(async () => null),
}))
const scope = vi.hoisted(() => ({ tenants: [] as number[] }))
vi.mock("@/lib/alt-text/store", () => store)
vi.mock("@/lib/tenant-scope", () => ({
  runForTenant: async (t: { tenantId: number }, fn: () => Promise<unknown>) => {
    scope.tenants.push(t.tenantId)
    return fn()
  },
}))

import { DEFAULT_GENERATION_SETTINGS } from "@/lib/alt-text/core"
import {
  ALT_TEXT_BATCH_CHUNK_SIZE,
  AltTextBatchJobError,
  onAltTextBatchJobSettled,
  runAltTextBatchJob,
} from "@/lib/alt-text/batch-job"
import { classifyJobFailure, JobDeferredError } from "@/lib/job-retry-policy"

const BID = "11111111-2222-4333-8444-555555555555"
const job = { id: 9, tenant_id: 42, attempts: 1 }
const signal = new AbortController().signal
const refs = (n: number, status = "uploaded") => Array.from({ length: n }, (_, i) => ({ id: i + 1, status, batchId: BID, storageKey: `t42/${i}`, createdBy: 7, reviewerId: null }))

beforeEach(() => {
  vi.clearAllMocks()
  scope.tenants = []
  store.getBatch.mockResolvedValue({ id: BID, status: "queued", settings: DEFAULT_GENERATION_SETTINGS })
  store.getAssetRefs.mockResolvedValue(refs(23))
})

describe("alt_text.batch_processing handler", () => {
  it("runs inside the job row's tenant scope, never a payload-supplied one", async () => {
    await expect(runAltTextBatchJob({ batchId: BID, tenantId: 1 } as any, { job, signal }, { processor: null })).rejects.toBeInstanceOf(JobDeferredError)
    expect(scope.tenants).toEqual([42])
  })

  it("rejects jobs without a tenant as a permanent failure", async () => {
    const err = await runAltTextBatchJob({ batchId: BID }, { job: { ...job, tenant_id: 0 }, signal }).catch((e) => e)
    expect(err).toBeInstanceOf(AltTextBatchJobError)
    expect(classifyJobFailure(err)).toBe("permanent")
    expect(store.getBatch).not.toHaveBeenCalled()
  })

  it("defers without completing or calling AI when no processor is registered", async () => {
    const err = await runAltTextBatchJob({ batchId: BID }, { job, signal }, { processor: null }).catch((e) => e)
    expect(err).toBeInstanceOf(JobDeferredError)
    expect(err.code).toBe("ALT_TEXT_PROCESSOR_UNAVAILABLE")
    expect(store.markBatchProcessing).not.toHaveBeenCalled()
  })

  it("builds a chunked plan of eligible asset ids for the processor", async () => {
    store.getAssetRefs.mockResolvedValue([...refs(23), { ...refs(1, "in_review")[0], id: 99 }])
    const processor = vi.fn(async () => ({ processed: 23 }))
    const result = await runAltTextBatchJob({ batchId: BID }, { job, signal }, { processor })
    expect(result).toEqual({ processed: 23 })
    const plan = (processor.mock.calls[0] as any[])[0]
    expect(plan).toMatchObject({ jobId: 9, tenantId: 42, batchId: BID, attempt: 1 })
    expect(plan.assetIds).not.toContain(99)
    expect(plan.chunks.map((c: number[]) => c.length)).toEqual([ALT_TEXT_BATCH_CHUNK_SIZE, ALT_TEXT_BATCH_CHUNK_SIZE, 3])
    expect(JSON.stringify(plan)).not.toContain("t42/")
    expect(store.markBatchProcessing).toHaveBeenCalledWith(BID)
  })

  it.each([
    ["missing batch", () => store.getBatch.mockResolvedValue(null), "BATCH_NOT_FOUND"],
    ["draft batch", () => store.getBatch.mockResolvedValue({ id: BID, status: "draft", settings: DEFAULT_GENERATION_SETTINGS }), "BATCH_NOT_ELIGIBLE"],
    ["no eligible assets", () => store.getAssetRefs.mockResolvedValue(refs(3, "approved")), "NO_ELIGIBLE_ASSETS"],
  ])("fails permanently for %s", async (_label, arrange, code) => {
    arrange()
    const err = await runAltTextBatchJob({ batchId: BID }, { job, signal }, { processor: vi.fn() }).catch((e) => e)
    expect(err.code).toBe(code)
    expect(classifyJobFailure(err)).toBe("permanent")
  })
})

describe("job settle mirroring", () => {
  it.each([
    ["dead_letter", "failed"],
    ["failed", "failed"],
    ["cancelled", "cancelled"],
  ])("maps %s to batch %s in the job's tenant", async (status, target) => {
    await onAltTextBatchJobSettled({ ...job, payload: { batchId: BID } }, status)
    expect(store.settleBatchFromJob).toHaveBeenCalledWith(BID, target)
    expect(scope.tenants).toEqual([42])
  })

  it("leaves the batch alone on completion or retry", async () => {
    await onAltTextBatchJobSettled({ ...job, payload: { batchId: BID } }, "completed")
    await onAltTextBatchJobSettled({ ...job, payload: { batchId: BID } }, "queued")
    expect(store.settleBatchFromJob).not.toHaveBeenCalled()
  })
})

describe("JobDeferredError", () => {
  it("clamps delay to a safe window", () => {
    expect(new JobDeferredError("x", 1).delaySeconds).toBe(30)
    expect(new JobDeferredError("x", 99999).delaySeconds).toBe(3600)
  })
})
