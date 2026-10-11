import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/db", () => ({ query: vi.fn() }))
const store = vi.hoisted(() => ({
  getBatch: vi.fn(),
  requestBatchControl: vi.fn(),
  settleBatchControl: vi.fn(),
  resumeBatch: vi.fn(),
}))
vi.mock("@/lib/alt-text/store", () => store)
vi.mock("@/lib/alt-text/batch-job", () => ({ ALT_TEXT_BATCH_JOB_TYPE: "alt_text_batch", altTextBatchIdempotencyKey: (id: string) => `alt-text-batch:${id}` }))
vi.mock("@/lib/alt-text/batch-submission", () => ({ resolveBatchModel: vi.fn(async () => ({})) }))
vi.mock("@/lib/alt-text/generate", () => ({ aiErrorToFailure: () => ({ status: 503, code: "MODEL_UNAVAILABLE", error: "Model unavailable" }) }))

import { controlBatch } from "@/lib/alt-text/batch-control"
import { AiError } from "@/lib/ai/governance-core"

const BID = "11111111-2222-4333-8444-555555555555"
const actor = { userId: 7, tenantId: 42, role: "employee" as const, updateScope: "all" as const }

beforeEach(() => {
  vi.clearAllMocks()
  store.getBatch.mockResolvedValue({ id: BID, status: "processing", createdBy: 7, submittedBy: 7 })
  store.settleBatchControl.mockResolvedValue(null)
})

describe("alt text batch control", () => {
  it("pause persists a request and reports the settled status", async () => {
    store.requestBatchControl.mockResolvedValue({ state: "changed", status: "pause_requested" })
    store.settleBatchControl.mockResolvedValue({ status: "paused" })
    const res = await controlBatch(BID, "pause", actor as any)
    expect(store.requestBatchControl).toHaveBeenCalledWith(BID, "pause")
    expect(res).toMatchObject({ ok: true, body: { status: "paused", changed: true } })
  })

  it("repeated pause is idempotent", async () => {
    store.requestBatchControl.mockResolvedValue({ state: "unchanged", status: "pause_requested" })
    const res = await controlBatch(BID, "pause", actor as any)
    expect(res).toMatchObject({ ok: true, body: { status: "pause_requested", changed: false } })
  })

  it("pause on a cancelling batch is rejected", async () => {
    store.requestBatchControl.mockResolvedValue({ state: "not_eligible", status: "cancel_requested" })
    expect(await controlBatch(BID, "pause", actor as any)).toMatchObject({ ok: false, status: 409, code: "BATCH_CANCELLED" })
  })

  it("cancel on a finished batch is rejected", async () => {
    store.requestBatchControl.mockResolvedValue({ state: "not_eligible", status: "completed" })
    expect(await controlBatch(BID, "cancel", actor as any)).toMatchObject({ ok: false, status: 409, code: "BATCH_NOT_ACTIVE" })
  })

  it("resume wakes the existing job by idempotency key", async () => {
    store.getBatch.mockResolvedValue({ id: BID, status: "paused", createdBy: 7, submittedBy: 7 })
    store.resumeBatch.mockResolvedValue({ state: "changed", status: "queued" })
    const res = await controlBatch(BID, "resume", actor as any)
    expect(store.resumeBatch).toHaveBeenCalledWith(BID, { type: "alt_text_batch", idempotencyKey: `alt-text-batch:${BID}` })
    expect(res).toMatchObject({ ok: true, body: { status: "queued" } })
  })

  it("a cancelled batch cannot resume", async () => {
    store.getBatch.mockResolvedValue({ id: BID, status: "cancelled", createdBy: 7, submittedBy: 7 })
    expect(await controlBatch(BID, "resume", actor as any)).toMatchObject({ ok: false, code: "BATCH_CANCELLED" })
    expect(store.resumeBatch).not.toHaveBeenCalled()
  })

  it("resume is blocked when the AI model is unavailable", async () => {
    store.getBatch.mockResolvedValue({ id: BID, status: "paused", createdBy: 7, submittedBy: 7 })
    const resolveModel = vi.fn(async () => {
      throw new AiError("MODEL_UNAVAILABLE" as any, "down" as any)
    })
    const res = await controlBatch(BID, "resume", actor as any, { resolveModel })
    expect(res).toMatchObject({ ok: false, status: 503 })
    expect(store.resumeBatch).not.toHaveBeenCalled()
  })

  it("own-scope users cannot control other users' batches", async () => {
    store.getBatch.mockResolvedValue({ id: BID, status: "processing", createdBy: 99, submittedBy: 99 })
    expect(await controlBatch(BID, "cancel", { ...actor, updateScope: "own" } as any)).toMatchObject({ ok: false, status: 404 })
    expect(store.requestBatchControl).not.toHaveBeenCalled()
  })
})
