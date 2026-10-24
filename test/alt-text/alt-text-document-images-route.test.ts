import { beforeEach, describe, expect, it, vi } from "vitest"

const deps = vi.hoisted(() => ({
  requireFeatureInModule: vi.fn(),
  getScope: vi.fn(async () => "own" as string),
  getActionScope: vi.fn(async () => "own" as string),
  currentTenantIdOrNull: vi.fn(() => 1 as number | null),
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
  getDocument: vi.fn(),
  countDocumentImages: vi.fn(),
  listReviewImages: vi.fn(),
  getReadinessSummary: vi.fn(),
  setSelection: vi.fn(),
  setReviewStatus: vi.fn(),
  selectAllEligible: vi.fn(),
  clearSelection: vi.fn(),
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
vi.mock("@/lib/alt-text/document-store", () => ({ getDocument: deps.getDocument, countDocumentImages: deps.countDocumentImages }))
vi.mock("@/lib/alt-text/document-image-review-store", () => ({
  listReviewImages: deps.listReviewImages,
  getReadinessSummary: deps.getReadinessSummary,
  setSelection: deps.setSelection,
  setReviewStatus: deps.setReviewStatus,
  selectAllEligible: deps.selectAllEligible,
  clearSelection: deps.clearSelection,
}))

const { GET, PATCH } = await import("@/app/api/alt-text/documents/[uploadId]/images/route")

const params = (id: string) => ({ params: Promise.resolve({ uploadId: id }) })
const get = (id: string, qs = "") => GET(new Request(`http://localhost/x${qs}`), params(id))
const patch = (id: string, body: unknown) =>
  PATCH(new Request("http://localhost/x", { method: "PATCH", body: typeof body === "string" ? body : JSON.stringify(body) }), params(id))

const summary = { totalOccurrences: 3, selectedOccurrences: 1 }
const counts = { total: 3, pending: 0, extracted: 3, failed: 0, unsupported: 0 }

beforeEach(() => {
  vi.clearAllMocks()
  deps.requireFeatureInModule.mockResolvedValue({ ok: true, session: { userId: 7, role: "member" } })
  deps.getScope.mockResolvedValue("own")
  deps.getActionScope.mockResolvedValue("own")
  deps.currentTenantIdOrNull.mockReturnValue(1)
  deps.checkRateLimit.mockResolvedValue({ allowed: true })
  deps.getDocument.mockResolvedValue({ id: 5, processingStatus: "extracted" })
  deps.countDocumentImages.mockResolvedValue(counts)
  deps.listReviewImages.mockResolvedValue({ images: [], total: 0 })
  deps.getReadinessSummary.mockResolvedValue(summary)
  deps.setSelection.mockResolvedValue({ applied: [1], ineligible: [2], notFound: [], changed: 1 })
  deps.setReviewStatus.mockResolvedValue({ applied: [1], ineligible: [], notFound: [], changed: 1 })
  deps.selectAllEligible.mockResolvedValue(4)
  deps.clearSelection.mockResolvedValue(2)
})

describe("GET /api/alt-text/documents/[id]/images", () => {
  it("rejects unauthenticated users and users without view permission", async () => {
    deps.requireFeatureInModule.mockResolvedValueOnce({ ok: false, status: 401, error: "Unauthorized" })
    expect((await get("5")).status).toBe(401)
    deps.getScope.mockResolvedValueOnce("none")
    expect((await get("5")).status).toBe(403)
    expect(deps.listReviewImages).not.toHaveBeenCalled()
  })

  it("returns 404 for malformed ids and documents outside the caller's scope", async () => {
    expect((await get("abc")).status).toBe(404)
    deps.getDocument.mockResolvedValueOnce(null)
    expect((await get("5")).status).toBe(404)
    expect(deps.listReviewImages).not.toHaveBeenCalled()
  })

  it("rejects invalid filters before touching the store", async () => {
    expect((await get("5", "?alt=maybe")).status).toBe(400)
    expect(deps.getDocument).not.toHaveBeenCalled()
  })

  it("scopes owners, parses the query and returns page + summary + counts", async () => {
    const res = await get("5", "?page=2&pageSize=12&selection=selected")
    expect(res.status).toBe(200)
    expect(deps.getDocument).toHaveBeenCalledWith(5, { uploadedBy: 7 })
    expect(deps.listReviewImages).toHaveBeenCalledWith(5, { page: 2, pageSize: 12, sort: "document", selection: "selected" })
    expect(await res.json()).toMatchObject({ success: true, documentId: 5, page: 2, pageSize: 12, total: 0, summary, counts })
  })

  it("does not scope `all` viewers to an owner", async () => {
    deps.getScope.mockResolvedValueOnce("all")
    await get("5")
    expect(deps.getDocument).toHaveBeenCalledWith(5, null)
  })
})

describe("PATCH /api/alt-text/documents/[id]/images", () => {
  it("requires the upload action", async () => {
    deps.getActionScope.mockResolvedValueOnce("none")
    expect((await patch("5", { action: "select", imageIds: [1] })).status).toBe(403)
    expect(deps.setSelection).not.toHaveBeenCalled()
  })

  it("rejects malformed bodies and unknown actions", async () => {
    expect((await patch("5", "{not json")).status).toBe(400)
    expect((await patch("5", { action: "generate", imageIds: [1] })).status).toBe(400)
    expect(deps.getDocument).not.toHaveBeenCalled()
  })

  it("rate limits selection updates", async () => {
    deps.checkRateLimit.mockResolvedValueOnce({ allowed: false })
    expect((await patch("5", { action: "select", imageIds: [1] })).status).toBe(429)
  })

  it("returns 404 for another owner's document", async () => {
    deps.getDocument.mockResolvedValueOnce(null)
    expect((await patch("5", { action: "select", imageIds: [1] })).status).toBe(404)
    expect(deps.setSelection).not.toHaveBeenCalled()
  })

  it("selects and reports ineligible ids alongside the fresh summary", async () => {
    const res = await patch("5", { action: "select", imageIds: [1, 2, 1] })
    expect(deps.setSelection).toHaveBeenCalledWith(5, [1, 2], true, 7)
    expect(await res.json()).toMatchObject({ success: true, action: "select", applied: [1], ineligible: [2], changed: 1, summary })
  })

  it("routes deselect, review and document-wide actions", async () => {
    await patch("5", { action: "deselect", imageIds: [1] })
    expect(deps.setSelection).toHaveBeenCalledWith(5, [1], false, 7)
    await patch("5", { action: "set_review", imageIds: [1], reviewStatus: "needs_attention" })
    expect(deps.setReviewStatus).toHaveBeenCalledWith(5, [1], "needs_attention", 7)
    expect(await (await patch("5", { action: "select_all_eligible" })).json()).toMatchObject({ changed: 4 })
    expect(await (await patch("5", { action: "clear_selection" })).json()).toMatchObject({ changed: 2 })
  })
})
