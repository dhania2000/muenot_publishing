import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/alt-text/store", () => ({}))
vi.mock("@/lib/alt-text/accessibility-backend", () => ({ detectAccessibilityBackend: vi.fn() }))
vi.mock("@/lib/alt-text/credit-service", () => ({ altTextRequestId: vi.fn(), estimateVisionReservation: vi.fn(), getAltTextCreditUsage: vi.fn(), runMeteredVisionCall: vi.fn() }))
vi.mock("@/lib/alt-text/generate", () => ({ aiErrorToFailure: vi.fn(), readImageBytes: vi.fn() }))
vi.mock("@/lib/alt-text/preview", () => ({ openAltTextImage: vi.fn() }))
vi.mock("@/lib/alt-text/vision-service", () => ({ detectRegionsFromImage: vi.fn(), selectVisionModel: vi.fn() }))
vi.mock("@/lib/ai/assistant-store", () => ({ getTenantAiSettings: vi.fn() }))
vi.mock("@/lib/ai/model-catalog", () => ({ resolveTenantModels: vi.fn() }))

import { parseDetectRequest, staleReasonsFor, toAnalysisView } from "@/lib/alt-text/region-service"
import { REGION_SCHEMA_VERSION, type RegionAnalysis } from "@/lib/alt-text/region-analysis"

describe("parseDetectRequest", () => {
  it("accepts a valid request id with no occurrence", () => {
    expect(parseDetectRequest({ requestId: "abcd1234" })).toEqual({ ok: true, value: { occurrenceId: null, requestId: "abcd1234" } })
  })

  it("accepts a positive occurrence id", () => {
    const r = parseDetectRequest({ requestId: "req_12345678", occurrenceId: 7 })
    expect(r.ok && r.value.occurrenceId).toBe(7)
  })

  it.each([null, [], "x", 3])("rejects non-object body %p", (body) => {
    expect(parseDetectRequest(body)).toMatchObject({ ok: false, status: 400, code: "INVALID_REQUEST" })
  })

  it("rejects unexpected fields so callers cannot smuggle model or box hints", () => {
    expect(parseDetectRequest({ requestId: "abcd1234", modelId: "x" })).toMatchObject({ ok: false, code: "INVALID_REQUEST", details: { fields: ["modelId"] } })
  })

  it.each([undefined, "short", "has space!", "a".repeat(37)])("rejects bad requestId %p", (requestId) => {
    expect(parseDetectRequest({ requestId })).toMatchObject({ ok: false, code: "INVALID_REQUEST_ID" })
  })

  it.each([0, -1, 1.5, "abc"])("rejects bad occurrenceId %p", (occurrenceId) => {
    expect(parseDetectRequest({ requestId: "abcd1234", occurrenceId })).toMatchObject({ ok: false, code: "INVALID_REQUEST" })
  })
})

describe("staleReasonsFor", () => {
  const base = { schemaVersion: REGION_SCHEMA_VERSION, complexityAtAnalysis: "high" } as RegionAnalysis

  it("is empty with no analysis or a current analysis", () => {
    expect(staleReasonsFor(null, "high")).toEqual([])
    expect(staleReasonsFor(base, "high")).toEqual([])
  })

  it("flags reclassified complexity and older schemas", () => {
    expect(staleReasonsFor(base, "low")).toHaveLength(1)
    expect(staleReasonsFor({ ...base, schemaVersion: 0 }, "low")).toHaveLength(2)
  })
})

describe("toAnalysisView", () => {
  const row = (analysis: unknown) => ({ analysisId: "rga_1", version: 3, analysis }) as never

  it("returns null for rows without a source frame", () => {
    expect(toAnalysisView(row(null))).toBeNull()
    expect(toAnalysisView(row({ regions: [] }))).toBeNull()
  })

  it("drops corrupt regions instead of repairing them and reports it", () => {
    const view = toAnalysisView(
      row({ schemaVersion: 1, assetId: 4, source: { width: 10, height: 10 }, regions: [{ bogus: true }, { id: "x", box: { x: 2, y: 0, width: 1, height: 1 } }], warnings: ["kept"], complexityAtAnalysis: "medium" }),
    )
    expect(view).not.toBeNull()
    expect(view!.regions).toEqual([])
    expect(view!.warnings).toEqual(["kept", "2 saved regions failed validation and are hidden."])
    expect(view!.version).toBe(3)
    expect(view!.readingOrderVerified).toBe(false)
  })
})
