import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_SETTINGS } from "@/lib/alt-text/core"

const deps = vi.hoisted(() => ({
  requireFeatureInModule: vi.fn(),
  getScope: vi.fn(async () => "own" as string),
  getActionScope: vi.fn(async () => "own" as string),
  hasActionGrant: vi.fn(async () => false),
  currentTenantIdOrNull: vi.fn(() => 1 as number | null),
  getSession: vi.fn(),
  getSettingsRecord: vi.fn(),
  saveSettingsRecord: vi.fn(),
  detectAccessibilityBackend: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/api-auth", () => ({ requireFeatureInModule: deps.requireFeatureInModule }))
vi.mock("@/lib/permission-store", () => ({ getScope: deps.getScope, getActionScope: deps.getActionScope, hasActionGrant: deps.hasActionGrant }))
vi.mock("@/lib/tenant-scope", () => ({ currentTenantIdOrNull: deps.currentTenantIdOrNull, currentTenantId: () => 1 }))
vi.mock("@/lib/auth", () => ({ getSession: deps.getSession }))
vi.mock("@/lib/ai/assistant-store", () => ({ getTenantAiSettings: vi.fn(async () => ({})) }))
vi.mock("@/lib/ai/model-catalog", () => ({ resolveTenantModels: vi.fn(async () => ({ usable: [] })) }))
vi.mock("@/lib/alt-text/vision-service", () => ({ isVisionCompatible: () => true }))
vi.mock("@/lib/alt-text/history", () => ({ storeErrorToFailure: () => ({ status: 500, code: "INTERNAL", error: "Something went wrong." }) }))
vi.mock("@/lib/alt-text/store", () => ({ getSettingsRecord: deps.getSettingsRecord, saveSettingsRecord: deps.saveSettingsRecord }))
vi.mock("@/lib/alt-text/accessibility-backend", () => ({ detectAccessibilityBackend: deps.detectAccessibilityBackend }))

const { GET, PATCH } = await import("@/app/api/alt-text/settings/route")

const record = (over: Record<string, unknown> = {}) => ({
  settings: { ...DEFAULT_SETTINGS, preferredModelId: "openai/keep-me" },
  accessibility: { ocr: { reviewPolicy: "always" } },
  revision: 4,
  updatedBy: 1,
  updatedAt: null,
  ...over,
})
const patch = (body: unknown) =>
  PATCH(new Request("http://localhost/api/alt-text/settings", { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json" } }) as never)

const clientPolicy={enabled:true,clientName:"Synthetic client",requiredLiterals:["H₂O"],forbiddenLiterals:[],requireLong:false}
it("rejects the old organization-wide client policy write and directs managers to the client library",async()=>{const response=await patch({expectedRevision:4,clientGuideline:clientPolicy});expect(response.status).toBe(400);expect(await response.json()).toMatchObject({code:"CLIENT_GUIDELINE_LIBRARY_REQUIRED"});expect(deps.saveSettingsRecord).not.toHaveBeenCalled()})
it("requires a revision and rejects forged guideline versions or executable fields",async()=>{expect((await patch({clientGuideline:clientPolicy})).status).toBe(400);expect((await patch({expectedRevision:4,clientGuideline:{...clientPolicy,version:999}})).status).toBe(400);expect((await patch({expectedRevision:4,clientGuideline:{...clientPolicy,script:"override review"}})).status).toBe(400);expect(deps.saveSettingsRecord).not.toHaveBeenCalled()})
it("denies client-policy changes without Manage settings permission",async()=>{deps.getSession.mockResolvedValue({userId:7,role:"employee"});expect((await patch({expectedRevision:4,clientGuideline:clientPolicy})).status).toBe(403);expect(deps.saveSettingsRecord).not.toHaveBeenCalled()})
it("bounds streamed settings bytes even when Content-Length is absent",async()=>{const response=await PATCH(new Request("http://localhost/api/alt-text/settings",{method:"PATCH",body:JSON.stringify({clientGuideline:{...clientPolicy,clientName:"क".repeat(17000)}})}) as never);expect(response.status).toBe(413);expect(deps.saveSettingsRecord).not.toHaveBeenCalled()})

beforeEach(() => {
  vi.clearAllMocks()
  deps.requireFeatureInModule.mockResolvedValue({ ok: true, session: { userId: 7, role: "admin" } })
  deps.getSession.mockResolvedValue({ userId: 7, role: "admin" })
  deps.currentTenantIdOrNull.mockReturnValue(1)
  deps.getScope.mockResolvedValue("own")
  deps.hasActionGrant.mockResolvedValue(false)
  deps.getSettingsRecord.mockResolvedValue(record())
  deps.saveSettingsRecord.mockResolvedValue({ ok: true, revision: 5 })
  deps.detectAccessibilityBackend.mockResolvedValue({ implemented: ["standard_description", "auto_classification"], visionModelAvailable: true, ocrLanguagePacks: [], disabledByPolicy: [] })
})

describe("GET /api/alt-text/settings", () => {
  it("rejects unauthenticated users", async () => {
    deps.requireFeatureInModule.mockResolvedValueOnce({ ok: false, status: 401, error: "Unauthorized" })
    expect((await GET()).status).toBe(401)
    expect(deps.getSettingsRecord).not.toHaveBeenCalled()
  })

  it("rejects requests without a tenant context", async () => {
    deps.currentTenantIdOrNull.mockReturnValue(null)
    expect((await GET()).status).toBe(403)
  })

  it("returns legacy settings plus resolved accessibility settings and permissions", async () => {
    deps.getSession.mockResolvedValue({ userId: 7, role: "member" })
    const body = await (await GET()).json()
    expect(body.settings.preferredModelId).toBe("openai/keep-me")
    expect(body.revision).toBe(4)
    expect(body.accessibility.configured.ocr.reviewPolicy).toBe("always")
    expect(body.accessibility.capabilities.ocr.status).toBe("not_implemented")
    expect(body.permissions.canManage).toBe(false)
  })
})

describe("PATCH /api/alt-text/settings", () => {
  it("rejects users without manage permission", async () => {
    deps.getSession.mockResolvedValue({ userId: 7, role: "member" })
    expect((await patch({ requireReview: false, expectedRevision: 4 })).status).toBe(403)
    expect(deps.saveSettingsRecord).not.toHaveBeenCalled()
  })

  it("allows non-admins holding the manage_settings grant", async () => {
    deps.getSession.mockResolvedValue({ userId: 7, role: "member" })
    deps.hasActionGrant.mockResolvedValue(true)
    expect((await patch({ requireReview: false, expectedRevision: 4 })).status).toBe(200)
  })

  it("rejects unknown top-level fields such as a tenant id", async () => {
    const res = await patch({ tenantId: 2, expectedRevision: 4 })
    expect(res.status).toBe(400)
    expect(deps.saveSettingsRecord).not.toHaveBeenCalled()
  })

  it("rejects invalid accessibility values with field errors", async () => {
    const res = await patch({ accessibility: { ocr: { languages: ["xx"] } }, expectedRevision: 4 })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe("VALIDATION_FAILED")
    expect(body.fieldErrors[0].path).toBe("ocr.languages")
  })

  it("rejects enabling an unavailable capability", async () => {
    const body = await (await patch({ accessibility: { ocr: { enabled: true } }, expectedRevision: 4 })).json()
    expect(body.fieldErrors[0].code).toBe("CAPABILITY_UNAVAILABLE")
    expect(deps.saveSettingsRecord).not.toHaveBeenCalled()
  })

  it("returns 409 on a stale revision", async () => {
    const res = await patch({ requireReview: false, expectedRevision: 3 })
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe("SETTINGS_CONFLICT")
  })

  it("returns 409 when a concurrent write wins inside the transaction", async () => {
    deps.saveSettingsRecord.mockResolvedValueOnce({ ok: false, reason: "conflict", revision: 5 })
    expect((await patch({ requireReview: false, expectedRevision: 4 })).status).toBe(409)
  })

  it("merges the patch and preserves unrelated settings", async () => {
    const res = await patch({ accessibility: { quality: { scientificAccuracyReview: true } }, expectedRevision: 4 })
    expect(res.status).toBe(200)
    const [input, actor] = deps.saveSettingsRecord.mock.calls[0]
    expect(actor).toBe(7)
    expect(input.expectedRevision).toBe(4)
    expect(input.settings.preferredModelId).toBe("openai/keep-me")
    expect(input.accessibility.quality.scientificAccuracyReview).toBe(true)
    expect(input.accessibility.ocr.reviewPolicy).toBe("always")
  })

  it("leaves accessibility untouched for legacy-only updates", async () => {
    await patch({ requireReview: false })
    const [input] = deps.saveSettingsRecord.mock.calls[0]
    expect(input.accessibility).toBeUndefined()
    expect(input.settings.requireReview).toBe(false)
  })
})
