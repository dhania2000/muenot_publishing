import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/db", () => ({ query: vi.fn(async () => []) }))
vi.mock("@/lib/permission-store", () => ({ getScope: vi.fn(), hasActionGrant: vi.fn() }))
const store = vi.hoisted(() => ({
  BATCH_HOLD_STATUSES: ["pause_requested", "paused", "cancel_requested"],
  getBatch: vi.fn(),
  getBatchStatus: vi.fn(async () => "processing"),
  getAsset: vi.fn(),
  claimForGeneration: vi.fn(async () => 1),
  markFailed: vi.fn(async () => true),
  requeueAsset: vi.fn(async () => true),
  finalizeBatchFromAssets: vi.fn(),
  ensureAltTextSchema: vi.fn(async () => {}),
  BATCH_MAX_ASSETS_PER_CALL: 100,
}))
const credits = vi.hoisted(() => ({ getAltTextCreditUsage: vi.fn(async () => null), altTextRequestId: (s: string) => `alt_${s}` }))
vi.mock("@/lib/alt-text/store", async (importOriginal) => ({ deriveBatchStatus: ((await importOriginal()) as any).deriveBatchStatus, ...store }))
vi.mock("@/lib/alt-text/credit-service", () => credits)
vi.mock("@/lib/alt-text/generate", () => ({ generateAltTextForAsset: vi.fn() }))

import { DEFAULT_GENERATION_SETTINGS } from "@/lib/alt-text/core"
import { batchOperationKey, classifyGenerateFailure, processAltTextBatch } from "@/lib/alt-text/batch-processor"
import { deriveBatchStatus } from "@/lib/alt-text/store"
import { JobDeferredError } from "@/lib/job-retry-policy"

const BID = "11111111-2222-4333-8444-555555555555"
const actor = { userId: 7, tenantId: 42, role: "employee" as const, viewScope: "all" as const, updateScope: "all" as const }
const plan = (ids: number[]) => ({ jobId: 9, tenantId: 42, batchId: BID, attempt: 1, settings: DEFAULT_GENERATION_SETTINGS, assetIds: ids, chunks: [ids] }) as any
const signal = new AbortController().signal
const ok = { ok: true, body: { replayed: false } }
const fail = (status: number, code: string) => ({ ok: false, status, code, error: code })
const stats = (o: Partial<Record<string, number>> = {}) => ({ total: 3, pending: 0, processing: 0, completed: 3, failed: 0, ...o })

let generate: ReturnType<typeof vi.fn>
let deferrals = 0
const run = (ids: number[], loadActor: any = async () => actor) =>
  processAltTextBatch(plan(ids), { signal }, { generate: generate as any, loadActor, countHaltDeferrals: async () => deferrals, random: () => 1 })

beforeEach(() => {
  vi.clearAllMocks()
  deferrals = 0
  generate = vi.fn(async () => ok)
  store.getBatch.mockResolvedValue({ id: BID, status: "processing", createdBy: 7, submittedBy: 7 })
  store.getAsset.mockImplementation(async (id: number) => ({ id, batchId: BID, status: "uploaded", attempts: 0, currentVersion: 0, settingsOverride: null }))
  store.finalizeBatchFromAssets.mockResolvedValue({ status: "completed", stats: stats() })
})

describe("alt text batch processor", () => {
  it("schedules 120 opted-in images in bounded deliveries without duplicate ordinary generation",async()=>{
    const selection={version:1,stages:["generation","qa"],billableConfirmed:true,ocrLanguageMode:null,settings:DEFAULT_GENERATION_SETTINGS}
    store.getBatch.mockResolvedValue({id:BID,status:"processing",createdBy:7,submittedBy:7,accessibilityPipeline:selection})
    const saved=new Set<number>(),ids=Array.from({length:120},(_,i)=>i+1)
    store.getAsset.mockImplementation(async(id:number)=>({id,batchId:BID,status:saved.has(id)?"in_review":"uploaded",attempts:0,currentVersion:0,settingsOverride:id===1?{outputLanguage:"hi"}:null}))
    store.finalizeBatchFromAssets.mockImplementation(async()=>({status:saved.size===120?"completed":"processing",stats:stats({total:120,completed:saved.size,pending:120-saved.size})}))
    const schedule=vi.fn(async(_b:string,id:number)=>{expect(saved.has(id)).toBe(false);saved.add(id);return {summary:{status:"queued"}}})
    for(let delivery=0;delivery<12;delivery++){const call=processAltTextBatch(plan(ids),{signal},{generate:generate as any,loadActor:async()=>actor,scheduleProcessing:schedule as any,resolveDocument:async(id:number)=>({kind:"document",document:{imageOccurrenceId:id+1000}}) as any});if(delivery<11)await expect(call).rejects.toBeInstanceOf(JobDeferredError);else await expect(call).resolves.toMatchObject({batchStatus:"completed"})}
    expect(schedule).toHaveBeenCalledTimes(120);expect(generate).not.toHaveBeenCalled();expect(schedule.mock.calls[0]).toMatchObject([BID,1,1001,selection,{outputLanguage:"hi"},actor]);await processAltTextBatch(plan(ids),{signal},{loadActor:async()=>actor,scheduleProcessing:schedule as any});expect(schedule).toHaveBeenCalledTimes(120)
  })
  it("isolates an advanced scheduling failure and preserves the independent image's pending work",async()=>{
    store.getBatch.mockResolvedValue({id:BID,status:"processing",createdBy:7,submittedBy:7,accessibilityPipeline:{stages:["generation"]}})
    store.finalizeBatchFromAssets.mockResolvedValue({status:"processing",stats:stats({pending:1,failed:1})})
    const schedule=vi.fn().mockRejectedValueOnce(Object.assign(new Error("this document occurrence changed"),{code:"SOURCE_CHANGED"})).mockResolvedValue({summary:{status:"queued"}})
    await expect(processAltTextBatch(plan([1,2]),{signal},{loadActor:async()=>actor,generate:generate as any,scheduleProcessing:schedule,resolveDocument:async()=>({kind:"standalone"})})).rejects.toBeInstanceOf(JobDeferredError)
    expect(schedule).toHaveBeenCalledTimes(2);expect(store.markFailed).toHaveBeenCalledTimes(1);expect(generate).not.toHaveBeenCalled()
  })
  it("processes every image sequentially as the submitter and settles from records", async () => {
    const res = await run([1, 2, 3])
    expect(generate).toHaveBeenCalledTimes(3)
    expect(generate.mock.calls.every((c) => c[1] === actor)).toBe(true)
    expect(res).toMatchObject({ completed: 3, failed: 0, batchStatus: "completed" })
  })

  it("uses a deterministic, length-safe credit operation key", () => {
    expect(batchOperationKey(BID, 0, 0)).toBe(batchOperationKey(BID, 0, 0))
    expect(batchOperationKey(BID, 0, 1)).not.toBe(batchOperationKey(BID, 0, 0))
    expect(`a${Number.MAX_SAFE_INTEGER}_${batchOperationKey(BID, 99, 99)}`.length).toBeLessThanOrEqual(64)
  })

  it("isolates permanent image failures and continues", async () => {
    generate.mockResolvedValueOnce(fail(502, "INVALID_AI_RESPONSE"))
    store.finalizeBatchFromAssets.mockResolvedValue({ status: "partially_completed", stats: stats({ completed: 2, failed: 1 }) })
    const res = await run([1, 2, 3])
    expect(generate).toHaveBeenCalledTimes(3)
    expect(res).toMatchObject({ completed: 2, failed: 1, batchStatus: "partially_completed" })
  })

  it("records pre-claim failures so the image does not loop forever", async () => {
    generate.mockResolvedValueOnce(fail(415, "UNSUPPORTED_TYPE"))
    await run([1])
    expect(store.claimForGeneration).toHaveBeenCalledWith(1)
    expect(store.markFailed).toHaveBeenCalledWith(1, "UNSUPPORTED_TYPE", 1, "UNSUPPORTED_TYPE")
  })

  it.each([
    [402, "INSUFFICIENT_CREDITS"],
    [429, "RATE_LIMITED"],
    [403, "AI_DISABLED"],
  ])("halts the batch on global failure %s %s, requeues the image and defers", async (status, code) => {
    generate.mockResolvedValueOnce(ok).mockResolvedValueOnce(fail(status, code))
    store.finalizeBatchFromAssets.mockResolvedValue({ status: "processing", stats: stats({ completed: 1, pending: 2 }) })
    const err = await run([1, 2, 3]).catch((e) => e)
    expect(err).toBeInstanceOf(JobDeferredError)
    expect(generate).toHaveBeenCalledTimes(2)
    expect(store.requeueAsset).toHaveBeenCalledWith(2, BID, code)
  })

  it("keeps images pending while awaiting credits", async () => {
    generate.mockResolvedValueOnce(fail(402, "INSUFFICIENT_CREDITS"))
    store.finalizeBatchFromAssets.mockResolvedValue({ status: "processing", stats: stats({ completed: 0, pending: 3 }) })
    const err = await run([1, 2, 3]).catch((e) => e)
    expect(err).toBeInstanceOf(JobDeferredError)
    expect(err.code).toBe("ALT_TEXT_AWAITING_CREDITS")
    expect(store.markFailed).not.toHaveBeenCalled()
  })

  it("backs off rate limits exponentially and honours Retry-After", async () => {
    deferrals = 2
    generate.mockResolvedValueOnce({ ...fail(429, "RATE_LIMITED"), details: { retryAfterSeconds: 1000 } })
    store.finalizeBatchFromAssets.mockResolvedValue({ status: "processing", stats: stats({ completed: 0, pending: 1 }) })
    const err = await run([1]).catch((e) => e)
    expect(err.delaySeconds).toBe(1000)
    deferrals = 3
    generate.mockResolvedValueOnce(fail(429, "RATE_LIMITED"))
    expect(((await run([1]).catch((e) => e)) as JobDeferredError).delaySeconds).toBe(480)
  })

  it("stops deferring non-clearing config halts after the retry limit, leaving images pending", async () => {
    deferrals = 3
    generate.mockResolvedValueOnce(fail(403, "MODEL_NOT_ALLOWED"))
    store.finalizeBatchFromAssets.mockResolvedValue({ status: "processing", stats: stats({ completed: 0, pending: 1 }) })
    const err = await run([1]).catch((e) => e)
    expect(err).not.toBeInstanceOf(JobDeferredError)
    expect(err.code).toBe("HALTED_MODEL_NOT_ALLOWED")
    expect(store.requeueAsset).toHaveBeenCalledWith(1, BID, "MODEL_NOT_ALLOWED")
    expect(store.markFailed).not.toHaveBeenCalled()
  })

  it("never re-runs a billed-but-unsaved prior attempt", async () => {
    store.getAsset.mockResolvedValue({ id: 1, batchId: BID, status: "processing", attempts: 1, currentVersion: 0, settingsOverride: null })
    credits.getAltTextCreditUsage.mockResolvedValueOnce({ creditsCharged: 3 } as any)
    vi.spyOn(console, "error").mockImplementation(() => {})
    await run([1])
    expect(generate).not.toHaveBeenCalled()
    expect(store.markFailed).toHaveBeenCalled()
  })

  it("skips images that left the batch or are already done (duplicate delivery)", async () => {
    store.getAsset.mockResolvedValueOnce({ id: 1, batchId: "other", status: "uploaded" }).mockResolvedValueOnce({ id: 2, batchId: BID, status: "in_review" })
    const res = await run([1, 2])
    expect(generate).not.toHaveBeenCalled()
    expect(res).toMatchObject({ skipped: 2 })
  })

  it("defers while images are busy elsewhere", async () => {
    generate.mockResolvedValue(fail(409, "GENERATION_IN_PROGRESS"))
    store.finalizeBatchFromAssets.mockResolvedValue({ status: "processing", stats: stats({ processing: 1 }) })
    await expect(run([1])).rejects.toBeInstanceOf(JobDeferredError)
  })

  it("fails permanently when the submitter is no longer permitted", async () => {
    const err = await run([1], async () => null).catch((e) => e)
    expect(err.code).toBe("SUBMITTER_NOT_PERMITTED")
    expect(generate).not.toHaveBeenCalled()
  })

  it("classifies failures", () => {
    expect(classifyGenerateFailure({ status: 409, code: "SCAN_PENDING" })).toBe("busy")
    expect(classifyGenerateFailure({ status: 400, code: "INVALID_REQUEST" })).toBe("permanent")
    expect(classifyGenerateFailure({ status: 502, code: "PROVIDER_ERROR" })).toBe("halt")
    expect(classifyGenerateFailure({ status: 503, code: "EVIDENCE_UNAVAILABLE" })).toBe("halt")
  })
})

describe("deriveBatchStatus", () => {
  it.each([
    [stats(), "completed"],
    [stats({ completed: 2, failed: 1 }), "partially_completed"],
    [stats({ completed: 0, failed: 3 }), "failed"],
    [stats({ completed: 2, pending: 1 }), null],
    [stats({ total: 0, completed: 0 }), null],
  ])("%o → %s", (s, expected) => expect(deriveBatchStatus(s as any)).toBe(expected))
})
