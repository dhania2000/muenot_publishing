import { beforeEach, describe, expect, it, vi } from "vitest"

const s = vi.hoisted(() => ({
  asset: null as any,
  occurrences: new Map<number, any>(),
  policy: { useAutoClassification: true, reviewUncertainClassification: true, allowCategoryCorrection: true, analysisTypes: [] as string[] },
  assetWrites: [] as any[],
  occurrenceWrites: [] as any[],
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/alt-text/store", () => ({
  getAsset: vi.fn(async (id: number) => (s.asset && s.asset.id === id ? { ...s.asset, storageKey: "k" } : null)),
  getSettingsRecord: vi.fn(async () => ({ accessibility: null, revision: 1, settings: {} })),
  getOccurrenceClassification: vi.fn(async (_a: number, occ: number) => (s.occurrences.has(occ) ? { found: true, manual: s.occurrences.get(occ) } : { found: false, manual: null })),
  setManualClassification: vi.fn(async (id: number, manual: any) => {
    if (s.asset.status === "processing") return false
    s.assetWrites.push({ id, manual })
    s.asset.classificationRecord = { schemaVersion: 1, automated: s.asset.classificationRecord?.automated ?? null, manual }
    return true
  }),
  setOccurrenceClassification: vi.fn(async (_a: number, occ: number, manual: any) => {
    if (!s.occurrences.has(occ)) return false
    s.occurrenceWrites.push({ occ, manual })
    s.occurrences.set(occ, manual)
    return true
  }),
}))
vi.mock("@/lib/alt-text/accessibility-backend", () => ({ detectAccessibilityBackend: vi.fn(async () => ({})) }))
vi.mock("@/lib/alt-text/accessibility-settings", () => ({
  ACCESSIBILITY_CAPABILITIES: new Proxy({}, { get: (_t, k) => ({ label: String(k), dependency: "dep" }) }),
  ANALYSIS_CAPABILITY: {},
  resolveEffectiveAccessibilitySettings: vi.fn(() => ({ effective: { general: s.policy }, capabilities: null })),
}))

import { clearClassificationCorrection, correctClassification, parseOccurrenceId, readClassification } from "@/lib/alt-text/classification-service"

const ctx = { tenantId: 9, role: "employee" as const, canEdit: true }
const editor = { userId: 5, viewScope: "all" as const, updateScope: "all" as const }
const viewer = { userId: 5, viewScope: "all" as const, updateScope: "none" as const }
const automated = {
  primaryCategory: "chart", secondaryCategories: [], complexityLevel: "medium", contentHints: ["axes_or_legend"], certainty: "ambiguous",
  evidenceSummary: "Bars with axes.", uncertaintyReasons: [], method: "vision_generation", modelReference: "m", schemaVersion: 1, createdAt: null,
}
const body = { primaryCategory: "graph", secondaryCategories: ["table_image"], complexityLevel: "high", note: "It is a line graph" }

beforeEach(() => {
  s.asset = { id: 1, status: "in_review", classification: "chart", modelId: "m", createdBy: 5, reviewerId: null, classificationRecord: { schemaVersion: 1, automated, manual: null } }
  s.occurrences = new Map([[42, null]])
  s.policy = { useAutoClassification: true, reviewUncertainClassification: true, allowCategoryCorrection: true, analysisTypes: [] }
  s.assetWrites = []
  s.occurrenceWrites = []
})

describe("parseOccurrenceId", () => {
  it("accepts empty and positive integers, rejects the rest", () => {
    expect(parseOccurrenceId(null)).toBeNull()
    expect(parseOccurrenceId("")).toBeNull()
    expect(parseOccurrenceId("7")).toBe(7)
    expect(parseOccurrenceId(7)).toBe(7)
    expect(parseOccurrenceId("0")).toBeUndefined()
    expect(parseOccurrenceId("1.5")).toBeUndefined()
    expect(parseOccurrenceId(-3)).toBeUndefined()
  })
})

describe("readClassification", () => {
  it("returns the automated view and flags uncertain results for review", async () => {
    const r = await readClassification(1, null, editor, ctx)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.body.classification.source).toBe("automated")
    expect(r.body.classification.status).toBe("needs_review")
    expect(r.body.classification.permissions.canCorrect).toBe(true)
  })

  it("hides assets outside the view scope and unknown occurrences", async () => {
    expect(await readClassification(1, null, { userId: 99, viewScope: "added" }, ctx)).toMatchObject({ ok: false, status: 404 })
    expect(await readClassification(1, 999, editor, ctx)).toMatchObject({ ok: false, status: 404 })
  })

  it("denies correction when the policy disables it", async () => {
    s.policy.allowCategoryCorrection = false
    const r = await readClassification(1, null, editor, ctx)
    expect(r.ok && r.body.classification.permissions.canCorrect).toBe(false)
  })
})

describe("correctClassification", () => {
  it("saves an asset-level correction that wins over the automated result", async () => {
    const r = await correctClassification(1, body, editor, ctx, new Date("2026-10-01T00:00:00Z"))
    expect(r.ok).toBe(true)
    expect(s.assetWrites[0].manual).toMatchObject({ primaryCategory: "graph", secondaryCategories: ["table_image"], editedBy: 5, editedAt: "2026-10-01T00:00:00.000Z" })
    if (!r.ok) return
    expect(r.body.classification.source).toBe("asset_override")
    expect(r.body.classification.result?.primaryCategory).toBe("graph")
    expect(r.body.classification.automated?.primaryCategory).toBe("chart")
    expect(r.body.classification.requiresReview).toBe(false)
  })

  it("saves an occurrence-level correction without touching the asset", async () => {
    const r = await correctClassification(1, { ...body, occurrenceId: 42 }, editor, ctx)
    expect(r.ok && r.body.classification.source).toBe("occurrence_override")
    expect(s.assetWrites).toHaveLength(0)
    expect(s.occurrenceWrites[0].occ).toBe(42)
  })

  it("rejects invalid taxonomy, unknown fields and bad occurrence ids", async () => {
    expect(await correctClassification(1, { ...body, primaryCategory: "cat" }, editor, ctx)).toMatchObject({ status: 400, details: { field: "primaryCategory" } })
    expect(await correctClassification(1, { ...body, shortAlt: "x" }, editor, ctx)).toMatchObject({ status: 400, details: { field: "shortAlt" } })
    expect(await correctClassification(1, { ...body, occurrenceId: "abc" }, editor, ctx)).toMatchObject({ status: 400, details: { field: "occurrenceId" } })
    expect(s.assetWrites).toHaveLength(0)
  })

  it("enforces update scope, policy and busy state", async () => {
    expect(await correctClassification(1, body, viewer, ctx)).toMatchObject({ status: 403, code: "FORBIDDEN" })
    s.policy.allowCategoryCorrection = false
    expect(await correctClassification(1, body, editor, ctx)).toMatchObject({ status: 403, code: "CORRECTION_DISABLED" })
    s.policy.allowCategoryCorrection = true
    s.asset.status = "processing"
    expect(await correctClassification(1, body, editor, ctx)).toMatchObject({ status: 409, code: "ASSET_BUSY" })
    expect(s.assetWrites).toHaveLength(0)
  })

  it("returns 404 for an occurrence that does not belong to the asset", async () => {
    expect(await correctClassification(1, { ...body, occurrenceId: 777 }, editor, ctx)).toMatchObject({ status: 404 })
  })
})

describe("clearClassificationCorrection", () => {
  it("reverts to the automated classification", async () => {
    await correctClassification(1, body, editor, ctx)
    const r = await clearClassificationCorrection(1, null, editor, ctx)
    expect(s.assetWrites.at(-1).manual).toBeNull()
    expect(r.ok && r.body.classification.source).toBe("automated")
  })
})
