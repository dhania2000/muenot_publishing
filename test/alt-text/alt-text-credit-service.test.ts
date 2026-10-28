import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

type Resv = { tenant: number; user: number; requestId: string; model: string; credits: number; status: string; settled: number | null }
const db = vi.hoisted(() => ({ resv: new Map<string, Resv>(), ledger: new Map<string, any>(), settleFailures: 0, ledgerFailures: 0 }))
vi.mock("@/lib/ai/provider", () => ({ gatewayAuthAvailable: () => false, resolveLanguageModel: async (id: string) => id }))
vi.mock("@/lib/demo/outbound-guard", () => ({ assertOutboundAllowed: vi.fn(async () => {}) }))
// Exercise the real standalone credit service. Mock only SQL, including unique keys, conditional
// transitions and transaction rollback; do not mock removed wallet/platform/meter modules.
vi.mock("@/lib/db", () => {
  const query = vi.fn(async (sql: string, params: any[]) => {
    if (sql.includes("SELECT r.status")) {
      const [tenant,user,requestId] = params, r = db.resv.get(`${tenant}|${requestId}`), l = db.ledger.get(`${tenant}|${requestId}`)
      return !r || r.user !== user ? [] : [{ status: r.status,credits: r.credits,settled_credits: r.settled,model_id: r.model,amount: l?.amount ?? null,provider: l?.provider ?? null,metadata_json: l ? JSON.stringify(l.metadata) : null }]
    }
    if (sql.includes("AS used") && sql.includes("ai_credit_reservations")) {
      const used = [...db.resv.values()].filter(r => r.tenant === params[0]).reduce((sum,r) => sum + (r.status === "settled" ? r.settled ?? 0 : r.status === "reserved" ? r.credits : 0),0)
      return [{ used }]
    }
    if (sql.startsWith("INSERT INTO ai_credit_reservations")) {
      const [tenant,user,requestId,model,credits] = params, key = `${tenant}|${requestId}`
      if (db.resv.has(key)) throw Object.assign(new Error("Duplicate reservation"),{ code: "ER_DUP_ENTRY" })
      db.resv.set(key,{ tenant,user,requestId,model,credits,status: "reserved",settled: null }); return { affectedRows: 1 }
    }
    if (sql.startsWith("UPDATE ai_credit_reservations SET status='released'")) {
      const r = db.resv.get(`${params[0]}|${params[1]}`)
      if (!r || r.status !== "reserved") return { affectedRows: 0 }
      r.status = "released"; return { affectedRows: 1 }
    }
    if (sql.startsWith("UPDATE ai_credit_reservations SET status='settled'")) {
      if (db.settleFailures > 0) { db.settleFailures--; throw new Error("deadlock") }
      const [credits,tenant,requestId] = params, r = db.resv.get(`${tenant}|${requestId}`)
      if (!r || r.status !== "reserved") return { affectedRows: 0 }
      r.status = "settled"; r.settled = credits; return { affectedRows: 1 }
    }
    if (sql.startsWith("INSERT IGNORE INTO ai_credit_ledger")) {
      if (db.ledgerFailures > 0) { db.ledgerFailures--; throw new Error("ledger unavailable") }
      const [tenant,user,idempotencyKey,amount,provider,model,metadata] = params, key = `${tenant}|${String(idempotencyKey).replace(/^usage:/,"")}`
      if (db.ledger.has(key)) return { affectedRows: 0 }
      db.ledger.set(key,{ tenant,user,idempotencyKey,amount,provider,model,metadata: JSON.parse(metadata) }); return { affectedRows: 1 }
    }
    throw new Error(`Unhandled credit SQL: ${sql}`)
  })
  return { query, withTransaction: async (fn: any) => {
    const reservations = structuredClone(db.resv), ledger = structuredClone(db.ledger)
    try { return await fn({ query: async (sql: string,params: any[]) => [await query(sql,params)] }) }
    catch (error) { db.resv.clear(); for (const [k,v] of reservations) db.resv.set(k,v); db.ledger.clear(); for (const [k,v] of ledger) db.ledger.set(k,v); throw error }
  } }
})

import type { CatalogModel } from "@/lib/ai/catalog-core"
import { rateUsage } from "@/lib/ai/credits/credits-core"
import { beginMeteredRequest, finishMeteredRequest } from "@/lib/ai/credits/credits-service"
import { AiError } from "@/lib/ai/governance-core"
import { DEFAULT_SETTINGS, normalizeGenerationSettings, buildPrompt } from "@/lib/alt-text/core"
import { CLASSIFICATION_PROMPT_RULES } from "@/lib/alt-text/classification"
import { IMAGE_INPUT_TOKEN_RESERVE, altTextRequestId, estimateAltTextReservation, getAltTextCreditUsage, runMeteredAltTextGeneration } from "@/lib/alt-text/credit-service"
import type { VisionGenerationResult } from "@/lib/alt-text/vision-service"

const model = (id: string): CatalogModel => ({
  id, provider: "openai", displayName: id, description: "", family: "gpt", contextWindow: 128000, maxOutputTokens: 2000,
  inputTypes: ["text", "image"], outputTypes: ["text"], supportsVision: true, supportsTools: true, supportsReasoning: false, supportsFiles: false,
  supportsStructuredOutput: true, inputPricePerMTok: 1, outputPricePerMTok: 2, cachedInputPricePerMTok: null, releasedAt: null, deprecatedAt: null, firstSeenAt: "2026-01-01T00:00:00Z",
})
const A = model("openai/vision-a")
const B = { ...model("openai/vision-b"),inputPricePerMTok: 8,outputPricePerMTok: 24 }

function png(): Uint8Array {
  const b = new Uint8Array(64)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  b.set([0, 0, 0, 64, 0, 0, 0, 48], 16)
  return b
}
const generation = normalizeGenerationSettings({})
it("reserves the actual evidence and classification prompt in the same existing metered request", () => {
  const advancedEvidence = { schemaVersion: 1 as const,assetId: 1,occurrenceId: null,sourceSha256: "a".repeat(64),regionAnalysisId: null,classification: "math_equation",strategy: "math" as const,items: [{ id: "math:1",version: 1,kind: "math",regionId: null,state: "candidate" as const,payload: { latex: "x + α = १२ ".repeat(600) } }],warnings: [],requiresReview: true as const,guidelineVersion: null }
  const input = { generation,altTextSettings: DEFAULT_SETTINGS,model: A,advancedEvidence }, estimate = estimateAltTextReservation(input)
  const prompt = buildPrompt({ language: generation.outputLanguage,audience: DEFAULT_SETTINGS.defaultAudience,context: generation.imageContext,shortMaxChars: DEFAULT_SETTINGS.shortMaxChars,generation,advancedEvidence,classificationRules: CLASSIFICATION_PROMPT_RULES })
  expect(estimate.promptChars).toBe(prompt.instructions.length + prompt.prompt.length + Math.ceil(IMAGE_INPUT_TOKEN_RESERVE * 3.5))
  expect(estimate.estimate.inputTokens).toBeGreaterThan(estimateAltTextReservation({ generation,altTextSettings: DEFAULT_SETTINGS,model: A }).estimate.inputTokens)
})
const visionInput = (m = A) => ({ image: { bytes: png(), mediaType: "image/png" as const }, generation, altTextSettings: DEFAULT_SETTINGS, model: m })
const visionResult = (usage: Partial<VisionGenerationResult["usage"]> = {}, m = A): VisionGenerationResult => ({
  output: { shortAlt: "Bar chart of rainfall" } as any,
  modelId: m.id,
  provider: "openai",
  usage: { inputTokens: 1200, outputTokens: 150, totalTokens: 1350, cachedInputTokens: 0, ...usage },
  finishReason: "stop",
  latencyMs: 10,
})
const run = (o: { tenantId?: number; userId?: number; operationId?: string; m?: CatalogModel; generate?: any } = {}) =>
  runMeteredAltTextGeneration(
    { tenantId: o.tenantId ?? 1, userId: o.userId ?? 7, operationId: o.operationId, vision: visionInput(o.m) },
    { generate: o.generate ?? vi.fn(async () => visionResult({}, o.m)) },
  )
const rateA = { inputPer1K: 0.5, cachedInputPer1K: 0.25, outputPer1K: 2, reasoningPer1K: 2, toolCall: 0, multiplier: 1, minimumCharge: 0.01, tier: "standard", version: 3 } as any

beforeEach(() => {
  process.env.OPENAI_API_KEY = "sk-test"
  db.resv.clear(); db.ledger.clear(); db.settleFailures = 0; db.ledgerFailures = 0
  delete process.env.AI_MONTHLY_CREDIT_LIMIT
  vi.spyOn(console, "error").mockImplementation(() => {})
})
afterEach(() => {
  delete process.env.OPENAI_API_KEY
  delete process.env.AI_MONTHLY_CREDIT_LIMIT
  vi.restoreAllMocks()
})

describe("alt text credit metering", () => {
  it("reserves a conservative estimate that includes image input, then settles actual usage and releases the rest", async () => {
    const est = estimateAltTextReservation({ generation, altTextSettings: DEFAULT_SETTINGS, model: A })
    expect(est.estimate.inputTokens).toBeGreaterThanOrEqual(IMAGE_INPUT_TOKEN_RESERVE)
    expect(est.estimate.outputTokens).toBe(2000)

    const out = await run({ operationId: "op-success-1" })
    expect(out.status).toBe("generated")
    if (out.status !== "generated") return
    const expected = rateUsage({ inputTokens: 1200, cachedInputTokens: 0, outputTokens: 150, reasoningTokens: 0, toolCalls: 0 }, rateA).credits
    expect(out.credits).toMatchObject({ status: "settled", creditsCharged: expected, inputTokens: 1200, outputTokens: 150, needsReconciliation: false, modelId: A.id })
    expect(out.credits.creditsReserved).toBeGreaterThan(expected)
    expect(db.ledger.get("1|alttext:op-success-1").amount).toBe(-expected)
    expect(db.ledger.get("1|alttext:op-success-1").metadata).toMatchObject({ feature: "alt_text", usageSource: "provider", provider: "openai" })
    expect(db.ledger.get("1|alttext:op-success-1").metadata).toMatchObject({ sourceModule: "alt_text",inputTokens: 1200,outputTokens: 150,reportedUsage: { totalTokens: 1350 } })
  })

  it("uses the actual standalone model tiers rather than a shared image price", async () => {
    const a = await run({ operationId: "op-rate-a" })
    const b = await run({ operationId: "op-rate-b", m: B })
    expect(a.credits.creditsCharged! * 3).toBeCloseTo(b.credits.creditsCharged!)
  })

  it("rejects the configured monthly cap before calling the provider", async () => {
    process.env.AI_MONTHLY_CREDIT_LIMIT = "0.001"
    const generate = vi.fn()
    const err = await run({ generate }).catch((e) => e)
    expect(err).toBeInstanceOf(AiError)
    expect(err.code).toBe("tenant_budget_exceeded")
    expect(err.status).toBe(402)
    expect(err.details?.creditCode).toBe("insufficient_credits")
    expect(generate).not.toHaveBeenCalled()
  })

  it("rejects invalid images before reserving credits", async () => {
    const err = await runMeteredAltTextGeneration({ tenantId: 1, userId: 7, vision: { ...visionInput(), image: { bytes: new Uint8Array([1, 2, 3]), mediaType: "image/png" } } }).catch((e) => e)
    expect(err.code).toBe("invalid_request")
    expect(db.resv.size).toBe(0)
  })

  it("releases the full hold on provider failure with no charge", async () => {
    const generate = vi.fn(async () => { throw new AiError("rate_limited", "slow down") })
    await expect(run({ operationId: "op-fail-1", generate })).rejects.toMatchObject({ code: "rate_limited" })
    expect(db.resv.get("1|alttext:op-fail-1").status).toBe("released")
    expect(db.ledger.size).toBe(0)
    // The standalone reservation key remains unique after release. A retry is a new operation.
    await expect(run({ operationId: "op-fail-1" })).rejects.toMatchObject({ details: { creditCode: "duplicate_request" } })
    const retry = await run({ operationId: "op-fail-2" })
    expect(retry.status).toBe("generated")
  })

  it("settles the reservation estimate and flags reconciliation when the provider omits usage", async () => {
    const out = await run({ operationId: "op-nousage", generate: vi.fn(async () => visionResult({ inputTokens: null, outputTokens: null, totalTokens: null })) })
    expect(out.credits).toMatchObject({ status: "estimated", needsReconciliation: true, inputTokens: null, outputTokens: null })
    expect(out.credits.creditsCharged).toBe(out.credits.creditsReserved)
    expect(out.credits.creditsCharged).toBeGreaterThan(0)
    expect(db.ledger.get("1|alttext:op-nousage").metadata).toMatchObject({ usageSource: "reservation_estimate",needsReconciliation: true,reportedUsage: { inputTokens: null,outputTokens: null } })
    expect((await getAltTextCreditUsage(1, 7, "alttext:op-nousage"))?.status).toBe("estimated")
  })

  it("replays a settled operation without a second provider call or deduction", async () => {
    const first = await run({ operationId: "op-dup-1" })
    const debit = db.ledger.get("1|alttext:op-dup-1").amount
    const generate = vi.fn()
    const second = await run({ operationId: "op-dup-1", generate })
    expect(second.status).toBe("replayed")
    expect(second.credits.creditsCharged).toBe(first.credits.creditsCharged)
    expect(second.credits.inputTokens).toBe(1200)
    expect(generate).not.toHaveBeenCalled()
    expect(db.ledger.get("1|alttext:op-dup-1").amount).toBe(debit)
    expect(db.ledger.size).toBe(1)
  })

  it("lets only one of two concurrent submissions run and charges once", async () => {
    let unblock!: () => void
    const gate = new Promise<void>((r) => (unblock = r))
    const generate = vi.fn(async () => { await gate; return visionResult() })
    const p1 = run({ operationId: "op-race-1", generate })
    await new Promise((r) => setTimeout(r, 0))
    const p2 = run({ operationId: "op-race-1", generate })
    const e2 = await p2.catch((e) => e)
    unblock()
    const r1 = await p1
    expect(e2.details?.creditCode).toBe("duplicate_request")
    expect(generate).toHaveBeenCalledTimes(1)
    expect(db.ledger.get("1|alttext:op-race-1").amount).toBe(-r1.credits.creditsCharged!)
    expect(db.ledger.size).toBe(1)
  })

  it("retries a failed settlement exactly once without double charging", async () => {
    db.settleFailures = 1
    const out = await run({ operationId: "op-settle-retry" })
    expect(out.credits.status).toBe("settled")
    expect(db.ledger.get("1|alttext:op-settle-retry").amount).toBe(-out.credits.creditsCharged!)

    db.settleFailures = 2
    const pending = await run({ operationId: "op-settle-down" })
    expect(pending.credits).toMatchObject({ status: "pending_settlement", creditsCharged: null, needsReconciliation: true })
    expect(db.resv.get("1|alttext:op-settle-down").status).toBe("reserved")
  })

  it("rolls back a settlement when its ledger write fails, so a retry cannot lose the audit row", async () => {
    db.ledgerFailures = 1
    const out = await run({ operationId: "op-ledger-retry" })
    expect(out.credits.status).toBe("settled")
    expect(db.ledger.get("1|alttext:op-ledger-retry")?.amount).toBe(-out.credits.creditsCharged!)
    expect(db.ledger.size).toBe(1)
  })

  it("keeps a reconciliation hold when both ledger attempts fail", async () => {
    db.ledgerFailures = 2
    const out = await run({ operationId: "op-ledger-down" })
    expect(out.credits).toMatchObject({ status: "pending_settlement",creditsCharged: null,needsReconciliation: true })
    expect(db.resv.get("1|alttext:op-ledger-down")).toMatchObject({ status: "reserved",settled: null })
    expect(db.ledger.size).toBe(0)
  })

  it("isolates tenants and users", async () => {
    await run({ tenantId: 1, operationId: "op-shared" })
    expect(await getAltTextCreditUsage(2, 7, "alttext:op-shared")).toBeNull()
    expect(await getAltTextCreditUsage(1, 8, "alttext:op-shared")).toBeNull()
    const other = await run({ tenantId: 2, operationId: "op-shared" })
    expect(other.status).toBe("generated")
    expect(db.ledger.get("2|alttext:op-shared").amount).toBe(-other.credits.creditsCharged!)
  })

  it("bills regeneration as a new operation and validates operation ids", async () => {
    await run({ operationId: "op-regen-1" })
    const again = await run({ operationId: "op-regen-2" })
    expect(again.status).toBe("generated")
    expect(db.ledger.size).toBe(2)
    expect(altTextRequestId()).toMatch(/^alttext:[0-9a-f-]{36}$/)
    expect(() => altTextRequestId("bad id!")).toThrow(AiError)
  })

  it("keeps the assistant's existing metering defaults", async () => {
    const m = await beginMeteredRequest(1, 7, { id: A.id, tier: "standard", supportsReasoning: false, maxOutputTokens: 100 }, 350, 100, "assistant-req")
    await finishMeteredRequest(m, 7, A.id, { inputTokens: 100, cachedInputTokens: 0, outputTokens: 50, reasoningTokens: 0, toolCalls: 0 }, 42)
    expect(db.ledger.get("1|assistant-req").metadata).toMatchObject({ sourceModule: null,interactionId: 42,outputTokens: 50 })
    expect(db.ledger.get("1|assistant-req").metadata).toMatchObject({ inputTokens: 100, provider: "openai" })
  })
})
