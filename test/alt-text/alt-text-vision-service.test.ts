import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const generateText = vi.fn()
vi.mock("ai", () => ({ generateText }))
vi.mock("@/lib/ai/provider", () => ({
  gatewayAuthAvailable: () => Boolean(process.env.AI_GATEWAY_API_KEY),
  resolveLanguageModel: async (id: string) => id,
}))
vi.mock("@/lib/demo/outbound-guard", () => ({ assertOutboundAllowed: vi.fn(async () => {}) }))

import type { CatalogModel } from "@/lib/ai/catalog-core"
import { AiError, defaultTenantSettings } from "@/lib/ai/governance-core"
import { DEFAULT_SETTINGS, normalizeGenerationSettings } from "@/lib/alt-text/core"
import { generateAltTextFromImage, isVisionCompatible, selectVisionModel } from "@/lib/alt-text/vision-service"

const model = (id: string, vision: boolean): CatalogModel => ({
  id,
  provider: id.split("/")[0],
  displayName: id,
  description: "",
  family: "gpt",
  contextWindow: 128000,
  maxOutputTokens: 16000,
  inputTypes: vision ? ["text", "image"] : ["text"],
  outputTypes: ["text"],
  supportsVision: vision,
  supportsTools: true,
  supportsReasoning: false,
  supportsFiles: false,
  supportsStructuredOutput: true,
  inputPricePerMTok: 1,
  outputPricePerMTok: 2,
  cachedInputPricePerMTok: null,
  releasedAt: null,
  deprecatedAt: null,
  firstSeenAt: "2026-01-01T00:00:00Z",
})
const VISION = model("openai/vision-a", true)
const TEXT = model("openai/text-only", false)
const tenant = { ...defaultTenantSettings(), enabled: true, allowVision: true }

function png(): Uint8Array {
  const b = new Uint8Array(64)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  b.set([0, 0, 0, 64, 0, 0, 0, 48], 16)
  return b
}

const reply = (o: Record<string, unknown>) =>
  JSON.stringify({ classification: "chart", purpose: "informative", shortAlt: "Bar chart of rainfall", longDescription: "x-axis: month; y-axis: mm", extractedText: "Rainfall (mm)", warnings: [], treatment: "Use alt plus long description.", ...o })

const run = (gen: Record<string, unknown> = {}) =>
  generateAltTextFromImage({ image: { bytes: png(), mediaType: "image/png" }, generation: normalizeGenerationSettings(gen), altTextSettings: DEFAULT_SETTINGS, model: VISION })

beforeEach(() => {
  process.env.OPENAI_API_KEY = "sk-test-secret-123"
  generateText.mockReset()
  vi.spyOn(console, "error").mockImplementation(() => {})
})
afterEach(() => {
  delete process.env.OPENAI_API_KEY
  vi.restoreAllMocks()
})

describe("vision model selection", () => {
  it("selects only vision-capable models and honours the tenant default", () => {
    const b = model("openai/vision-b", true)
    expect(selectVisionModel({ usable: [TEXT, VISION, b], tenantSettings: tenant, defaultModelId: "openai/vision-b" }).id).toBe("openai/vision-b")
    expect(selectVisionModel({ usable: [TEXT, VISION], tenantSettings: tenant, defaultModelId: TEXT.id }).id).toBe(VISION.id)
  })
  it("rejects text-only models instead of silently switching", () => {
    expect(() => selectVisionModel({ usable: [TEXT], tenantSettings: tenant })).toThrow(/vision-capable/)
    expect(() => selectVisionModel({ usable: [TEXT, VISION], tenantSettings: tenant, preferredModelId: TEXT.id })).toThrow(/cannot analyse images/)
  })
  it("enforces governance and provider configuration", () => {
    expect(() => selectVisionModel({ usable: [VISION], tenantSettings: { ...tenant, allowVision: false } })).toThrow(AiError)
    expect(() => selectVisionModel({ usable: [VISION], tenantSettings: { ...tenant, enabled: false } })).toThrow(/not enabled/)
    const gateway = process.env.AI_GATEWAY_API_KEY
    delete process.env.OPENAI_API_KEY
    delete process.env.AI_GATEWAY_API_KEY
    expect(isVisionCompatible(VISION)).toBe(false)
    if (gateway) process.env.AI_GATEWAY_API_KEY = gateway
  })
})

describe("generateAltTextFromImage", () => {
  const evidence = { schemaVersion: 1 as const, assetId: 1, occurrenceId: null, sourceSha256: "a".repeat(64), regionAnalysisId: null, classification: "chart", strategy: "chart" as const, items: [], warnings: ["Printed labels require review"], requiresReview: true as const, guidelineVersion: null }
  it("adds saved evidence to the same single provider call and preserves deterministic warnings", async () => {
    generateText.mockResolvedValue({ text: reply({ shortAlt: "वर्षा १२ mm", extractedText: "१२ mm" }), usage: {} })
    const result = await generateAltTextFromImage({ image: { bytes: png(),mediaType: "image/png" },generation: normalizeGenerationSettings({ outputLanguage: "hi" }),altTextSettings: DEFAULT_SETTINGS,model: VISION,advancedEvidence: evidence })
    expect(generateText).toHaveBeenCalledOnce()
    const call = generateText.mock.calls[0][0]
    expect(call.messages[0].content[0].text).toContain("UNTRUSTED source-bound accessibility evidence")
    expect(call.instructions).toContain("No pixel-derived values")
    expect(result.output.warnings).toContain("Printed labels require review")
    expect(result.output.shortAlt).toBe("वर्षा १२ mm")
  })
  it.each([{ purpose: "decorative", shortAlt: "",longDescription: "" }, { purpose: "informative",longDescription: "" }])("rejects unsupported complex-image response %j", async output => {
    generateText.mockResolvedValue({ text: reply(output),usage: {} })
    await expect(generateAltTextFromImage({ image: { bytes: png(),mediaType: "image/png" },generation: normalizeGenerationSettings({}),altTextSettings: DEFAULT_SETTINGS,model: VISION,advancedEvidence: evidence })).rejects.toMatchObject({ details: { reason: "invalid_output" } })
    expect(generateText).toHaveBeenCalledOnce()
  })
  it("sends the actual image bytes and the existing prompt", async () => {
    generateText.mockResolvedValue({ text: reply({}), usage: { inputTokens: 900, outputTokens: 120, totalTokens: 1020 }, finishReason: "stop" })
    const r = await run({ subject: "chemistry", imageType: "math_equation" })
    const call = generateText.mock.calls[0][0]
    const filePart = call.messages[0].content.find((p: { type: string }) => p.type === "file")
    expect(filePart.mediaType).toBe("image/png")
    expect(filePart.data.data).toBeInstanceOf(Uint8Array)
    expect(filePart.data.data.length).toBe(64)
    expect(call.instructions).toMatch(/Chemistry: copy chemical formulas exactly/)
    expect(call.instructions).toMatch(/math_equation/)
    expect(r.output.shortAlt).toBe("Bar chart of rainfall")
    expect(r.output.longDescription).toContain("y-axis")
    expect(r.usage).toEqual({ inputTokens: 900, outputTokens: 120, totalTokens: 1020, cachedInputTokens: null })
    expect(r.modelId).toBe(VISION.id)
    expect(r.provider).toBe("openai")
  })

  it("supports Hindi output and preserves Unicode", async () => {
    generateText.mockResolvedValue({ text: reply({ shortAlt: "जल का सूत्र H₂O", extractedText: "H₂O → 2H⁺" }), usage: {} })
    const r = await run({ outputLanguage: "hi" })
    expect(generateText.mock.calls[0][0].instructions).toMatch(/Hindi \(Devanagari script\)/)
    expect(r.output.shortAlt).toBe("जल का सूत्र H₂O")
    expect(r.output.extractedText).toBe("H₂O → 2H⁺")
    expect(r.usage.inputTokens).toBeNull()
  })

  it("returns intentionally empty alt text for decorative images", async () => {
    generateText.mockResolvedValue({ text: reply({ classification: "decorative", shortAlt: "", longDescription: "" }), usage: {} })
    const r = await run({ imagePurpose: "decorative" })
    expect(r.output.shortAlt).toBe("")
    expect(r.output.treatment).toContain('alt=""')
  })

  it("rejects malformed AI output without fabricating a result", async () => {
    generateText.mockResolvedValue({ text: "Sorry, I cannot help", usage: {} })
    await expect(run()).rejects.toMatchObject({ code: "provider_error", details: { reason: "invalid_output", outputError: "no_json" } })
  })

  it("maps provider failures and never leaks the key or image data", async () => {
    const err = Object.assign(new Error("Rate limit for key sk-test-secret-123"), { name: "AI_APICallError", statusCode: 429 })
    generateText.mockRejectedValue(err)
    const e = (await run().catch((x) => x)) as AiError
    expect(e.code).toBe("rate_limited")
    const logged = JSON.stringify([e.message, e.details, (console.error as unknown as { mock: { calls: unknown[] } }).mock.calls])
    expect(logged).not.toContain("sk-test-secret-123")
    expect(logged).not.toMatch(/iVBOR|base64/)

    generateText.mockRejectedValue(Object.assign(new Error("t"), { name: "TimeoutError" }))
    await expect(run()).rejects.toMatchObject({ details: { reason: "timeout" } })
  })

  it("rejects invalid image input before calling the provider", async () => {
    const bad = generateAltTextFromImage({ image: { bytes: new Uint8Array([1, 2, 3]), mediaType: "image/png" }, generation: normalizeGenerationSettings({}), altTextSettings: DEFAULT_SETTINGS, model: VISION })
    await expect(bad).rejects.toMatchObject({ code: "invalid_request" })
    await expect(generateAltTextFromImage({ image: { bytes: png(), mediaType: "image/png" }, generation: normalizeGenerationSettings({}), altTextSettings: DEFAULT_SETTINGS, model: TEXT })).rejects.toMatchObject({ code: "model_not_allowed" })
    expect(generateText).not.toHaveBeenCalled()
  })
})
