import { afterEach, describe, expect, it, vi } from "vitest"
import { EMPTY_BATCH_INFO } from "@/lib/alt-text/batch-settings"
import { planBatchSubmission, type UploadEntry, type UploadStatus } from "@/lib/alt-text/bulk-upload"
import { createAltTextBatch, describeBatchError, newIdempotencyKey, submitAltTextBatch } from "@/lib/alt-text/client"
import { DEFAULT_GENERATION_SETTINGS } from "@/lib/alt-text/core"
import { IDEMPOTENCY_KEY } from "@/lib/alt-text/batch-submission"

vi.mock("server-only", () => ({}))

const entry = (localId: string, uploadStatus: UploadStatus, assetId: number | null): UploadEntry => ({
  localId, file: new File(["x"], `${localId}.png`), hash: null, filename: `${localId}.png`, size: 1,
  validationStatus: "valid", uploadStatus, assetId, attempts: 1,
})
const info = { ...EMPTY_BATCH_INFO, name: "  Chapter 6  ", description: "" }

describe("planBatchSubmission", () => {
  it("builds the backend contract with server asset IDs and re-keyed overrides", () => {
    const plan = planBatchSubmission(["a", "b"], [entry("a", "uploaded", 11), entry("b", "uploaded", 12)], info, DEFAULT_GENERATION_SETTINGS, {
      b: { imageType: "chart" },
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.payload).toEqual({ name: "Chapter 6", description: null, assetIds: [11, 12], settings: DEFAULT_GENERATION_SETTINGS, overrides: { "12": { imageType: "chart" } } })
    expect(Object.keys(plan.payload).sort()).toEqual(["assetIds", "description", "name", "overrides", "settings"])
  })

  it("blocks when any image lacks a server asset ID", () => {
    const plan = planBatchSubmission(["a", "b"], [entry("a", "uploaded", 11), entry("b", "failed", null)], info, DEFAULT_GENERATION_SETTINGS, {})
    expect(plan).toEqual({ ok: false, reason: expect.stringMatching(/1 image is not uploaded/) })
  })

  it("blocks while security scan is pending", () => {
    const plan = planBatchSubmission(["a"], [entry("a", "scan_pending", 11)], info, DEFAULT_GENERATION_SETTINGS, {})
    expect(plan).toEqual({ ok: false, reason: expect.stringMatching(/security scan/) })
  })

  it("requires a batch name and at least one image", () => {
    expect(planBatchSubmission(["a"], [entry("a", "uploaded", 1)], EMPTY_BATCH_INFO, DEFAULT_GENERATION_SETTINGS, {}).ok).toBe(false)
    expect(planBatchSubmission([], [], info, DEFAULT_GENERATION_SETTINGS, {}).ok).toBe(false)
  })

  it("rejects duplicate asset IDs and keeps a stable fingerprint", () => {
    expect(planBatchSubmission(["a", "b"], [entry("a", "uploaded", 5), entry("b", "uploaded", 5)], info, DEFAULT_GENERATION_SETTINGS, {}).ok).toBe(false)
    const args = [["a"], [entry("a", "uploaded", 5)], info, DEFAULT_GENERATION_SETTINGS, {}] as const
    const p1 = planBatchSubmission(...args)
    const p2 = planBatchSubmission(...args)
    expect(p1.ok && p2.ok && p1.fingerprint === p2.fingerprint).toBe(true)
  })
})

describe("batch client", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("generates idempotency keys the backend accepts", () => {
    expect(IDEMPOTENCY_KEY.test(newIdempotencyKey())).toBe(true)
  })

  it("sends Idempotency-Key on create and posts to submit", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      new Response(JSON.stringify(url.endsWith("/submit") ? { success: true, batchId: "x", jobId: 1, submissionStatus: "queued", acceptedImageCount: 1, message: "ok" } : { success: true, replayed: false, batch: { id: "x" } }), { status: 201 }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const payload = { name: "n", description: null, assetIds: [1], settings: DEFAULT_GENERATION_SETTINGS, overrides: {} }
    const created = await createAltTextBatch(payload, "batch-abcdefgh")
    expect(created.ok).toBe(true)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("/api/alt-text/batches")
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("batch-abcdefgh")
    expect(JSON.parse(init.body as string)).toEqual(payload)
    const queued = await submitAltTextBatch("x")
    expect(queued.ok && queued.data.submissionStatus).toBe("queued")
    expect(fetchMock.mock.calls[1][0]).toBe("/api/alt-text/batches/x/submit")
  })

  it("surfaces real server errors instead of success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: false, code: "ASSETS_NOT_CLEARED", error: "blocked" }), { status: 422 })))
    const res = await submitAltTextBatch("x")
    expect(res.ok).toBe(false)
    if (!res.ok) expect(describeBatchError(res.error)).toMatch(/security scan/)
  })

  it("maps credit and permission failures", () => {
    expect(describeBatchError({ status: 402, code: "INSUFFICIENT_CREDITS", message: "x" })).toMatch(/credits/)
    expect(describeBatchError({ status: 403, code: "FORBIDDEN", message: "You do not have permission to generate alt text." })).toMatch(/permission/)
    expect(describeBatchError({ status: 401, code: "UNAUTHENTICATED", message: "x" })).toMatch(/session/)
  })
})
