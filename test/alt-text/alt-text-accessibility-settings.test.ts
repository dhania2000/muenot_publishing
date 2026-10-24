import { describe, expect, it } from "vitest"
import {
  accessibilitySnapshot,
  defaultAccessibilityPreferences,
  deriveCapabilityStates,
  mergeAccessibilityPreferences,
  normalizeAccessibilityPreferences,
  resolveEffectiveAccessibilitySettings,
  validateAccessibilityPatch,
  type AccessibilityBackend,
} from "@/lib/alt-text/accessibility-settings"

const today: AccessibilityBackend = { implemented: ["standard_description", "auto_classification"], visionModelAvailable: true, ocrLanguagePacks: [], disabledByPolicy: [] }
const withOcr: AccessibilityBackend = { ...today, implemented: [...today.implemented, "ocr"], ocrLanguagePacks: ["en"] }
const tenant = { requireReview: true, defaultLanguage: "en" as const }
const resolve = (stored: unknown, backend = today, revision = 3) => resolveEffectiveAccessibilitySettings({ storedAccessibility: stored, revision, tenant, backend })

describe("capability states", () => {
  it("reports only registered engines as available", () => {
    const caps = deriveCapabilityStates(today)
    expect(caps.standard_description.status).toBe("available")
    expect(caps.auto_classification.status).toBe("available")
    for (const id of ["ocr", "math_analysis", "chart_analysis", "latex_output", "client_guidelines", "advanced_qa"] as const) {
      expect(caps[id].status).toBe("not_implemented")
      expect(caps[id].reason).toBeTruthy()
    }
  })

  it("distinguishes not configured and disabled by policy", () => {
    expect(deriveCapabilityStates({ ...today, visionModelAvailable: false }).standard_description.status).toBe("not_configured")
    expect(deriveCapabilityStates({ ...today, implemented: [...today.implemented, "ocr"] }).ocr.status).toBe("not_configured")
    expect(deriveCapabilityStates({ ...today, disabledByPolicy: ["standard_description"] }).standard_description.status).toBe("disabled_by_policy")
  })
})

describe("normalization", () => {
  it("loads historical records without accessibility settings as platform defaults", () => {
    const { preferences, explicit } = normalizeAccessibilityPreferences(null)
    expect(preferences).toEqual(defaultAccessibilityPreferences())
    expect(explicit.size).toBe(0)
    expect(preferences.ocr.enabled).toBe(false)
    expect(preferences.ocr.languages).toEqual(["en"])
  })

  it("drops invalid stored values without failing", () => {
    const { preferences, explicit } = normalizeAccessibilityPreferences({ ocr: { languages: ["xx"], reviewPolicy: "always" }, bogus: 1 })
    expect(preferences.ocr.languages).toEqual(["en"])
    expect(preferences.ocr.reviewPolicy).toBe("always")
    expect([...explicit]).toEqual(["ocr.reviewPolicy"])
  })
})

describe("patch validation", () => {
  const caps = deriveCapabilityStates(today)

  it("rejects unknown sections and fields", () => {
    const r = validateAccessibilityPatch({ nope: {}, ocr: { secret: true } }, caps)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.map((e) => e.code)).toEqual(["UNKNOWN_FIELD", "UNKNOWN_FIELD"])
  })

  it("rejects wrong types, invalid options and range violations", () => {
    const r = validateAccessibilityPatch({ ocr: { keepWarnings: "yes", reviewPolicy: "never", languages: [] }, math: { outputFormat: 3 } }, caps)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.map((e) => e.code).sort()).toEqual(["INVALID_OPTION", "INVALID_TYPE", "INVALID_TYPE", "OUT_OF_RANGE"])
  })

  it("rejects enabling unavailable capabilities", () => {
    const cases = [{ ocr: { enabled: true } }, { math: { outputFormat: "latex" } }, { general: { analysisTypes: ["chart"] } }, { graphs: { dataExtraction: true } }]
    for (const patch of cases) {
      const r = validateAccessibilityPatch(patch, caps)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.errors[0].code).toBe("CAPABILITY_UNAVAILABLE")
    }
  })

  it("accepts policy preferences and turning gated values off", () => {
    const r = validateAccessibilityPatch({ ocr: { enabled: false, languages: ["hi", "en"], reviewPolicy: "always" }, graphs: { preferQualitative: false } }, caps)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.patch.ocr?.languages).toEqual(["en", "hi"])
  })

  it("accepts a capability once the backend reports it available", () => {
    expect(validateAccessibilityPatch({ ocr: { enabled: true } }, deriveCapabilityStates(withOcr)).ok).toBe(true)
  })

  it("merges without touching unrelated fields", () => {
    const base = defaultAccessibilityPreferences()
    const merged = mergeAccessibilityPreferences(base, { quality: { scientificAccuracyReview: true } })
    expect(merged.quality.scientificAccuracyReview).toBe(true)
    expect(merged.ocr).toEqual(base.ocr)
    expect(base.quality.scientificAccuracyReview).toBe(false)
  })
})

describe("effective settings resolver", () => {
  it("reports sources and forces unavailable capabilities off", () => {
    const r = resolve({ ocr: { enabled: true, reviewPolicy: "always" } })
    expect(r.configured.ocr.enabled).toBe(true)
    expect(r.effective.ocr.enabled).toBe(false)
    expect(r.sources["ocr.enabled"]).toEqual({ source: "capability_unavailable", blockedBy: ["ocr"] })
    expect(r.sources["ocr.reviewPolicy"].source).toBe("tenant")
    expect(r.sources["math.outputFormat"].source).toBe("platform_default")
  })

  it("keeps OCR language separate from output language and filters uninstalled packs", () => {
    const r = resolve({ ocr: { enabled: true, languages: ["en", "hi"] } }, withOcr)
    expect(r.outputLanguage).toBe("en")
    expect(r.effective.ocr.languages).toEqual(["en"])
    expect(r.ocrLanguages.find((l) => l.code === "hi")).toMatchObject({ configured: true, packInstalled: false })
  })

  it("works without a client guideline and exposes mandatory safeguards", () => {
    const r = resolve(null)
    expect(r.guideline).toMatchObject({ status: "none", reference: null })
    expect(r.scopes.supported).toEqual(["platform_default", "tenant"])
    expect(r.mandatory.find((m) => m.id === "no_auto_approve")?.active).toBe(true)
    expect(r.mandatory.find((m) => m.id === "tenant_require_review")?.active).toBe(true)
  })
})

describe("job snapshot", () => {
  it("captures an immutable copy of effective settings", () => {
    const resolved = resolve({ ocr: { reviewPolicy: "always" } }, today, 7)
    const snap = accessibilitySnapshot(resolved, { modelId: "openai/gpt-x", requireReview: true })
    expect(snap).toMatchObject({ settingsRevision: 7, modelId: "openai/gpt-x", guidelineVersion: null, ocr: { enabled: false, languages: [] } })
    expect(snap.reviewPolicy.ocrReview).toBe("always")
    ;(resolved.effective.general.analysisTypes as string[]).push("chart")
    expect(snap.analysisTypes).toEqual([])
  })
})
