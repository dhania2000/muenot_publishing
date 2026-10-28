import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

type Resv = { tenant: number; user: number; requestId: string; model: string; credits: number; status: string; settled: number | null; interactionId: number }
const db = vi.hoisted(() => ({
  balance: new Map<number, number>(),
  resv: new Map<string, any>(),
  ledger: new Map<string, any>(),
  meters: [] as any[],
  settleFailures: 0,
}))
const k = (t: number, r: string) => `${t}|${r}`

vi.mock("@/lib/ai/provider", () => ({ gatewayAuthAvailable: () => false, resolveLanguageModel: async (id: string) => id }))
vi.mock("@/lib/demo/outbound-guard", () => ({ assertOutboundAllowed: vi.fn(async () => {}) }))
vi.mock("@/lib/billing/usage-guard", () => ({ meterUsage: (e: any) => db.meters.push(e) }))
vi.mock("@/lib/db", () => ({
  query: vi.fn(async (_sql: string, [tenant, user, requestId]: [number, number, string]) => {
    const r: Resv | undefined = db.resv.get(k(tenant, requestId))
    if (!r || r.user !== user) return []
    const l = db.ledger.get(k(tenant, requestId))
    return [{ status: r.status, credits: r.credits, settled_credits: r.settled, model_id: r.model, amount: l?.amount ?? null, provider: l?.provider ?? null, metadata_json: l ? JSON.stringify(l.metadata) : null }]
  }),
}))
vi.mock("@/lib/ai/credits/credits-platform", async () => {
  const { DEFAULT_PLATFORM_CONFIG } = await import("@/lib/ai/credits/credits-core")
  const rate = (modelId: string, inputPer1K: number, outputPer1K: number) => ({ id: 1, modelId, tier: "standard", inputPer1K, cachedInputPer1K: inputPer1K / 2, outputPer1K, reasoningPer1K: outputPer1K, toolCall: 0, multiplier: 1, minimumCharge: 0.01, maxOutputTokens: null, enabled: true, premium: false, effectiveFrom: "2026-01-01", version: 3 })
  return {
    currentRates: async () => new Map([["openai/vision-a", rate("openai/vision-a", 1, 2)], ["openai/vision-b", rate("openai/vision-b", 4, 8)]]),
    getPlatformConfig: async () => DEFAULT_PLATFORM_CONFIG,
    getPack: vi.fn(),
    listPacks: vi.fn(),
  }
})
vi.mock("@/lib/ai/credits/credits-store", async () => {
  const { CreditError } = await import("@/lib/ai/credits/credits-core")
  const reservedFor = (t: number) => [...db.resv.values()].filter((r) => r.tenant === t && r.status === "reserved").reduce((s, r) => s + r.credits, 0)
  return {
    loadWalletContext: async (tenantId: number) => ({ tenantId }),
    reserveCredits: async (ctx: { tenantId: number }, input: any) => {
      const t = ctx.tenantId
      const existing = db.resv.get(k(t, input.requestId))
      if (existing?.status === "reserved") throw new CreditError("duplicate_request", "This request is already being processed.")
      if (existing?.status === "settled") throw Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY" })
      if ((db.balance.get(t) ?? 0) - reservedFor(t) < input.credits) throw new CreditError("insufficient_credits", "Your organisation has insufficient AI credits.")
      db.resv.set(k(t, input.requestId), { tenant: t, user: input.userId, requestId: input.requestId, model: input.modelId, credits: input.credits, status: "reserved", settled: null, interactionId: 0 })
      return { requestId: input.requestId, credits: input.credits, replay: null }
    },
    releaseCredits: async (t: number, requestId: string) => {
      const r = db.resv.get(k(t, requestId))
      if (r?.status === "reserved") r.status = "released"
    },
    settleCredits: async (ctx: { tenantId: number }, input: any) => {
      if (db.settleFailures > 0) {
        db.settleFailures--
        throw new Error("deadlock")
      }
      const r = db.resv.get(k(ctx.tenantId, input.requestId))
      if (!r || r.status !== "reserved") return null
      r.status = "settled"
      r.settled = input.credits
      const after = (db.balance.get(ctx.tenantId) ?? 0) - input.credits
      db.balance.set(ctx.tenantId, after)
      db.ledger.set(k(ctx.tenantId, input.requestId), { amount: -input.credits, provider: input.modelId.split("/")[0], metadata: input.metadata })
      return { charged: input.credits, balanceAfter: after, uncovered: 0, alerts: [], autoTopup: false }
    },
    addAllocationBonus: vi.fn(), debitCredits: vi.fn(), ensureCreditSchema: vi.fn(), grantCredits: vi.fn(), creditAudit: vi.fn(),
  }
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
const B = model("openai/vision-b")

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
const rateA = { inputPer1K: 1, cachedInputPer1K: 0.5, outputPer1K: 2, reasoningPer1K: 2, toolCall: 0, multiplier: 1, minimumCharge: 0.01, tier: "standard", version: 3 } as any

beforeEach(() => {
  process.env.OPENAI_API_KEY = "sk-test"
  db.balance.clear(); db.resv.clear(); db.ledger.clear(); db.meters.length = 0; db.settleFailures = 0
  db.balance.set(1, 1000); db.balance.set(2, 1000)
  vi.spyOn(console, "error").mockImplementation(() => {})
})
afterEach(() => {
  delete process.env.OPENAI_API_KEY
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
    expect(db.balance.get(1)).toBeCloseTo(1000 - expected)
    expect(db.ledger.get("1|alttext:op-success-1").metadata).toMatchObject({ feature: "alt_text", usageSource: "provider", provider: "openai" })
    expect(db.meters.every((m) => m.attribution.sourceModule === "alt_text")).toBe(true)
    expect(db.meters.some((m) => m.meterKey === "ai_usage" && m.quantity === 1350)).toBe(true)
  })

  it("uses each model's own rate rather than a shared image price", async () => {
    const a = await run({ operationId: "op-rate-a" })
    const b = await run({ operationId: "op-rate-b", m: B })
    expect(a.credits.creditsCharged! * 4).toBeCloseTo(b.credits.creditsCharged!)
  })

  it("rejects with the existing insufficient-credit error and never calls the provider", async () => {
    db.balance.set(1, 0.001)
    const generate = vi.fn()
    const err = await run({ generate }).catch((e) => e)
    expect(err).toBeInstanceOf(AiError)
    expect(err.code).toBe("tenant_budget_exceeded")
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
    expect(db.balance.get(1)).toBe(1000)
    expect(db.meters).toContainEqual(expect.objectContaining({ meterKey: "ai_requests", attribution: expect.objectContaining({ status: "failed", billable: false, sourceModule: "alt_text" }) }))
    // A released attempt may be retried under the same id.
    const retry = await run({ operationId: "op-fail-1" })
    expect(retry.status).toBe("generated")
  })

  it("settles the reservation estimate and flags reconciliation when the provider omits usage", async () => {
    const out = await run({ operationId: "op-nousage", generate: vi.fn(async () => visionResult({ inputTokens: null, outputTokens: null, totalTokens: null })) })
    expect(out.credits).toMatchObject({ status: "estimated", needsReconciliation: true, inputTokens: null, outputTokens: null })
    expect(out.credits.creditsCharged).toBe(out.credits.creditsReserved)
    expect(out.credits.creditsCharged).toBeGreaterThan(0)
    expect(db.meters.some((m) => m.meterKey === "ai_usage")).toBe(false)
    expect((await getAltTextCreditUsage(1, 7, "alttext:op-nousage"))?.status).toBe("estimated")
  })

  it("replays a settled operation without a second provider call or deduction", async () => {
    const first = await run({ operationId: "op-dup-1" })
    const balance = db.balance.get(1)
    const generate = vi.fn()
    const second = await run({ operationId: "op-dup-1", generate })
    expect(second.status).toBe("replayed")
    expect(second.credits.creditsCharged).toBe(first.credits.creditsCharged)
    expect(second.credits.inputTokens).toBe(1200)
    expect(generate).not.toHaveBeenCalled()
    expect(db.balance.get(1)).toBe(balance)
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
    expect(db.balance.get(1)).toBeCloseTo(1000 - r1.credits.creditsCharged!)
  })

  it("retries a failed settlement exactly once without double charging", async () => {
    db.settleFailures = 1
    const out = await run({ operationId: "op-settle-retry" })
    expect(out.credits.status).toBe("settled")
    expect(db.balance.get(1)).toBeCloseTo(1000 - out.credits.creditsCharged!)

    db.settleFailures = 2
    const pending = await run({ operationId: "op-settle-down" })
    expect(pending.credits).toMatchObject({ status: "pending_settlement", creditsCharged: null, needsReconciliation: true })
    expect(db.resv.get("1|alttext:op-settle-down").status).toBe("reserved")
  })

  it("isolates tenants and users", async () => {
    await run({ tenantId: 1, operationId: "op-shared" })
    expect(await getAltTextCreditUsage(2, 7, "alttext:op-shared")).toBeNull()
    expect(await getAltTextCreditUsage(1, 8, "alttext:op-shared")).toBeNull()
    const other = await run({ tenantId: 2, operationId: "op-shared" })
    expect(other.status).toBe("generated")
    expect(db.balance.get(2)).toBeCloseTo(1000 - other.credits.creditsCharged!)
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
    expect(db.meters.filter((x) => x.attribution.correlationId === "assistant-req").map((x) => [x.meterKey, x.attribution.sourceModule])).toEqual([
      ["ai_usage", "ai_assistant"],
      ["ai_requests", "ai_assistant"],
    ])
    expect(db.ledger.get("1|assistant-req").metadata).toMatchObject({ inputTokens: 100, provider: "openai" })
  })
})
