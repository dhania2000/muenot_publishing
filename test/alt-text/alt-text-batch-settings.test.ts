import { describe, expect, it } from "vitest"
import {
  buildBatchConfiguration,
  buildOverride,
  pruneOverrides,
  resolveEffectiveSettings,
  validateBatchInfo,
  type BatchInfo,
} from "@/lib/alt-text/batch-settings"
import { DEFAULT_GENERATION_SETTINGS, type GenerationSettings } from "@/lib/alt-text/core"

const info: BatchInfo = { name: "Biology Class 10 — Chapter 6", projectId: null, description: "" }
const defaults: GenerationSettings = { ...DEFAULT_GENERATION_SETTINGS, subject: "biology" }

describe("batch info validation", () => {
  it("requires a name and enforces limits", () => {
    expect(validateBatchInfo({ ...info, name: "   " }).name).toBeDefined()
    expect(validateBatchInfo({ ...info, name: "x".repeat(151) }).name).toBeDefined()
    expect(validateBatchInfo({ ...info, description: "x".repeat(501) }).description).toBeDefined()
    expect(validateBatchInfo(info)).toEqual({})
  })
})

describe("overrides and effective settings", () => {
  it("pins a client's ID and version together when another client uses the same version", () => {
    const a = {...defaults, clientGuidelineId:"client_A", clientGuidelineVersion:1}
    const d = {...a, clientGuidelineId:"client_D"}
    const override = buildOverride(a,d)!
    expect(override).toEqual({clientGuidelineId:"client_D",clientGuidelineVersion:1})
    expect(resolveEffectiveSettings({...a,clientGuidelineVersion:7},override)).toMatchObject({clientGuidelineId:"client_D",clientGuidelineVersion:1})
    const clear = buildOverride(a,{...a,clientGuidelineId:null,clientGuidelineVersion:null})!
    expect(resolveEffectiveSettings(a,clear)).toMatchObject({clientGuidelineId:null,clientGuidelineVersion:null})
    const config=buildBatchConfiguration(info,a,["expertA","expertB"],{expertB:override})
    expect(config.isValid).toBe(true)
    expect(config.images.map(i=>i.effectiveSettings.clientGuidelineId)).toEqual(["client_A","client_D"])
  })
  it("loads Phase 1 defaults", () => {
    expect(DEFAULT_GENERATION_SETTINGS).toMatchObject({ imageType: "auto", imagePurpose: "informative", outputLanguage: "en", descriptionMode: "both" })
  })

  it("stores only differing overridable fields and inherits the rest", () => {
    const override = buildOverride(defaults, { ...defaults, outputLanguage: "hi", targetAudience: "professionals" })
    expect(override).toEqual({ outputLanguage: "hi" })
    const changedDefaults = { ...defaults, subject: "chemistry" as const, descriptionMode: "short" as const }
    const effective = resolveEffectiveSettings(changedDefaults, override!)
    expect(effective.outputLanguage).toBe("hi")
    expect(effective.subject).toBe("chemistry")
    expect(effective.descriptionMode).toBe("short")
  })

  it("returns null when edits match defaults (reset)", () => {
    expect(buildOverride(defaults, { ...defaults })).toBeNull()
  })

  it("preserves mathematical and chemical Unicode in context", () => {
    const ctx = "∫₀^∞ e^{-x²} dx = √π/2; SO₄²⁻ + 2H⁺ ⇌ H₂SO₄"
    expect(resolveEffectiveSettings(defaults, { imageContext: ctx }).imageContext).toBe(ctx)
  })

  it("prunes overrides for removed images only", () => {
    const overrides = { a: { subject: "physics" as const }, b: { outputLanguage: "hi" as const } }
    expect(pruneOverrides(overrides, ["a", "b"])).toBe(overrides)
    expect(pruneOverrides(overrides, ["b"])).toEqual({ b: { outputLanguage: "hi" } })
  })
})

describe("batch configuration payload", () => {
  it("resolves per-image settings without leaking between images", () => {
    const config = buildBatchConfiguration(info, defaults, ["a", "b"], { a: { outputLanguage: "hi" }, gone: { subject: "physics" } })
    expect(config.isValid).toBe(true)
    expect(config.imageIds).toEqual(["a", "b"])
    expect(Object.keys(config.overrides)).toEqual(["a"])
    expect(config.images[0].effectiveSettings.outputLanguage).toBe("hi")
    expect(config.images[1].effectiveSettings.outputLanguage).toBe("en")
    expect(config.images.map((i) => i.hasOverride)).toEqual([true, false])
    expect(() => JSON.stringify(config)).not.toThrow()
  })

  it("is invalid without a batch name or images", () => {
    expect(buildBatchConfiguration({ ...info, name: "" }, defaults, ["a"], {}).isValid).toBe(false)
    expect(buildBatchConfiguration(info, defaults, [], {}).isValid).toBe(false)
  })
})
