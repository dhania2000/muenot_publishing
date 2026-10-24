import { beforeEach, describe, expect, it, vi } from "vitest"

const deps = vi.hoisted(() => ({
  requireFeatureInModule: vi.fn(),
  getScope: vi.fn(async () => "own" as string),
  getActionScope: vi.fn(async () => "own" as string),
  currentTenantIdOrNull: vi.fn(() => 1 as number | null),
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
  analyzeDocumentContexts: vi.fn(),
  readDocumentImageContext: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/api-auth", () => ({ requireFeatureInModule: deps.requireFeatureInModule }))
vi.mock("@/lib/permission-store", () => ({ getScope: deps.getScope, getActionScope: deps.getActionScope }))
vi.mock("@/lib/tenant-scope", () => ({ currentTenantIdOrNull: deps.currentTenantIdOrNull, currentTenantId: () => 1 }))
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: deps.checkRateLimit }))
vi.mock("@/lib/alt-text/history", () => ({ storeErrorToFailure: () => ({ status: 500, code: "INTERNAL", error: "Something went wrong." }) }))
vi.mock("@/lib/alt-text/document-service", () => ({
  ownerScopeFor: (a: { userId: number; viewScope: string }) => (a.viewScope === "all" ? null : { uploadedBy: a.userId }),
}))
vi.mock("@/lib/alt-text/document-context-service", () => ({
  analyzeDocumentContexts: deps.analyzeDocumentContexts,
  readDocumentImageContext: deps.readDocumentImageContext,
}))

const { GET, POST } = await import("@/app/api/alt-text/documents/[uploadId]/context/route")

const params = (id: string) => ({ params: Promise.resolve({ uploadId: id }) })
const get = (id: string, qs = "?imageId=3") => GET(new Request(`http://localhost/x${qs}`), params(id))
const post = (id: string, body?: string) => POST(new Request("http://localhost/x", { method: "POST", body }), params(id))

const summary = { analyzed: 2, unavailable: 1, failed: 0, total: 3 }

beforeEach(() => {
  vi.clearAllMocks()
  deps.requireFeatureInModule.mockResolvedValue({ ok: true, session: { userId: 7, role: "member" } })
  deps.getScope.mockResolvedValue("own")
  deps.getActionScope.mockResolvedValue("own")
  deps.currentTenantIdOrNull.mockReturnValue(1)
  deps.checkRateLimit.mockResolvedValue({ allowed: true })
  deps.analyzeDocumentContexts.mockResolvedValue({ ok: true, summary })
  deps.readDocumentImageContext.mockResolvedValue({ ok: true, imageId: 3, status: "not_analyzed", analyzedAt: null, stale: false, context: null })
})

describe("GET /api/alt-text/documents/[id]/context", () => {
  it("rejects unauthenticated users", async () => {
    deps.requireFeatureInModule.mockResolvedValueOnce({ ok: false, status: 401, error: "Unauthorized" })
    expect((await get("5")).status).toBe(401)
    expect(deps.readDocumentImageContext).not.toHaveBeenCalled()
  })

  it("rejects users without view permission", async () => {
    deps.getScope.mockResolvedValueOnce("none")
    expect((await get("5")).status).toBe(403)
  })

  it("returns 404 for malformed document ids and 400 without a valid imageId", async () => {
    expect((await get("abc")).status).toBe(404)
    expect((await get("5", "")).status).toBe(400)
    expect((await get("5", "?imageId=0")).status).toBe(400)
    expect(deps.readDocumentImageContext).not.toHaveBeenCalled()
  })

  it("reads stored context scoped to the owner and never runs analysis", async () => {
    const res = await get("5")
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, imageId: 3, status: "not_analyzed", context: null })
    expect(deps.readDocumentImageContext).toHaveBeenCalledWith(5, 3, { uploadedBy: 7 })
    expect(deps.analyzeDocumentContexts).not.toHaveBeenCalled()
  })

  it("does not scope `all` viewers to an owner", async () => {
    deps.getScope.mockResolvedValueOnce("all")
    await get("5")
    expect(deps.readDocumentImageContext).toHaveBeenCalledWith(5, 3, null)
  })

  it("maps service failures (e.g. another owner's document) to their status", async () => {
    deps.readDocumentImageContext.mockResolvedValueOnce({ ok: false, status: 404, code: "NOT_FOUND", error: "The document could not be found." })
    const res = await get("5")
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ code: "NOT_FOUND" })
  })
})

describe("POST /api/alt-text/documents/[id]/context", () => {
  it("requires the upload action", async () => {
    deps.getActionScope.mockResolvedValueOnce("none")
    expect((await post("5")).status).toBe(403)
    expect(deps.analyzeDocumentContexts).not.toHaveBeenCalled()
  })

  it("analyzes the whole document when no body is sent", async () => {
    const res = await post("5")
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, summary })
    expect(deps.analyzeDocumentContexts).toHaveBeenCalledWith(5, { uploadedBy: 7 }, { imageId: undefined })
  })

  it("analyzes a single image and returns its context", async () => {
    deps.analyzeDocumentContexts.mockResolvedValueOnce({ ok: true, summary: { ...summary, total: 1 }, context: null })
    const res = await post("5", JSON.stringify({ imageId: 9 }))
    expect(await res.json()).toMatchObject({ success: true, context: null })
    expect(deps.analyzeDocumentContexts).toHaveBeenCalledWith(5, { uploadedBy: 7 }, { imageId: 9 })
  })

  it("rejects invalid JSON and invalid imageIds", async () => {
    expect((await post("5", "{oops")).status).toBe(400)
    expect((await post("5", JSON.stringify({ imageId: "9" }))).status).toBe(400)
    expect((await post("5", JSON.stringify({ imageId: -1 }))).status).toBe(400)
    expect((await post("5", JSON.stringify({ imageId: 1.5 }))).status).toBe(400)
    expect(deps.analyzeDocumentContexts).not.toHaveBeenCalled()
  })

  it("enforces the per-user rate limit", async () => {
    deps.checkRateLimit.mockResolvedValueOnce({ allowed: false })
    const res = await post("5")
    expect(res.status).toBe(429)
    expect(deps.analyzeDocumentContexts).not.toHaveBeenCalled()
  })

  it("surfaces service failures such as unsupported DOCX", async () => {
    deps.analyzeDocumentContexts.mockResolvedValueOnce({ ok: false, status: 415, code: "CONTEXT_NOT_SUPPORTED", error: "DOCX image extraction is not available yet." })
    const res = await post("5")
    expect(res.status).toBe(415)
    expect(await res.json()).toMatchObject({ code: "CONTEXT_NOT_SUPPORTED" })
  })
})
