import { beforeEach, describe, expect, it, vi } from "vitest"

const deps = vi.hoisted(() => ({
  requireFeatureInModule: vi.fn(),
  getScope: vi.fn(async () => "own" as string),
  getActionScope: vi.fn(async () => "own" as string),
  currentTenantIdOrNull: vi.fn(() => 1 as number | null),
  listDocumentRecords: vi.fn(),
  getDocumentRecord: vi.fn(),
  getDocumentUpload: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/api-auth", () => ({ requireFeatureInModule: deps.requireFeatureInModule }))
vi.mock("@/lib/permission-store", () => ({ getScope: deps.getScope, getActionScope: deps.getActionScope }))
vi.mock("@/lib/tenant-scope", () => ({ currentTenantIdOrNull: deps.currentTenantIdOrNull }))
vi.mock("@/lib/alt-text/history", () => ({ storeErrorToFailure: () => ({ status: 500, code: "INTERNAL", error: "Something went wrong." }) }))
vi.mock("@/lib/alt-text/document-upload", () => ({ getDocumentUpload: deps.getDocumentUpload }))
vi.mock("@/lib/alt-text/document-service", () => ({
  listDocumentRecords: deps.listDocumentRecords,
  getDocumentRecord: deps.getDocumentRecord,
  ownerScopeFor: (a: { userId: number; viewScope: string }) => (a.viewScope === "all" ? null : { uploadedBy: a.userId }),
}))

vi.mock("@/lib/alt-text/document-preparation-job", () => ({ getDocumentPreparationProgress: vi.fn(async (documentId: number) => ({ documentId, jobId: null })) }))

const { GET: LIST } = await import("@/app/api/alt-text/documents/route")
const { GET: DETAIL } = await import("@/app/api/alt-text/documents/[uploadId]/route")

const listReq = (qs = "") => new Request(`http://localhost/api/alt-text/documents${qs}`)
const detail = (id: string) => DETAIL(new Request("http://localhost/x"), { params: Promise.resolve({ uploadId: id }) })

const record = { id: 5, uploadId: "u1", filename: "deck.pptx", securityStatus: "clean", processingStatus: "pending", uploadedBy: 7 }

beforeEach(() => {
  vi.clearAllMocks()
  deps.requireFeatureInModule.mockResolvedValue({ ok: true, session: { userId: 7, role: "member" } })
  deps.getScope.mockResolvedValue("own")
  deps.currentTenantIdOrNull.mockReturnValue(1)
  deps.listDocumentRecords.mockResolvedValue({ documents: [record], total: 1 })
  deps.getDocumentRecord.mockResolvedValue(record)
  deps.getDocumentUpload.mockResolvedValue({ uploadId: "u1" })
})

describe("GET /api/alt-text/documents", () => {
  it("rejects unauthenticated users", async () => {
    deps.requireFeatureInModule.mockResolvedValueOnce({ ok: false, status: 401, error: "Unauthorized" })
    expect((await LIST(listReq())).status).toBe(401)
    expect(deps.listDocumentRecords).not.toHaveBeenCalled()
  })

  it("rejects users without view permission", async () => {
    deps.getScope.mockResolvedValueOnce("none")
    expect((await LIST(listReq())).status).toBe(403)
  })

  it("rejects requests with no tenant in context", async () => {
    deps.currentTenantIdOrNull.mockReturnValueOnce(null)
    expect((await LIST(listReq())).status).toBe(403)
  })

  it("scopes non-`all` viewers to their own uploads and returns paginated metadata", async () => {
    const res = await LIST(listReq("?page=2&pageSize=10"))
    expect(res.status).toBe(200)
    expect(deps.listDocumentRecords).toHaveBeenCalledWith({ page: 2, pageSize: 10, projectId: null }, { uploadedBy: 7 })
    const body = await res.json()
    expect(body).toMatchObject({ success: true, page: 2, pageSize: 10, total: 1, documents: [record] })
    expect(res.headers.get("cache-control")).toMatch(/no-store/)
  })

  it("lets `all` viewers list the whole tenant", async () => {
    deps.getScope.mockResolvedValueOnce("all")
    await LIST(listReq())
    expect(deps.listDocumentRecords).toHaveBeenCalledWith(expect.anything(), null)
  })

  it("clamps the page size and falls back on malformed paging", async () => {
    await LIST(listReq("?page=-3&pageSize=5000"))
    expect(deps.listDocumentRecords).toHaveBeenCalledWith({ page: 1, pageSize: 100, projectId: null }, { uploadedBy: 7 })
  })

  it("rejects a malformed projectId", async () => {
    const res = await LIST(listReq("?projectId=1%20OR%201=1"))
    expect(res.status).toBe(400)
    expect(deps.listDocumentRecords).not.toHaveBeenCalled()
  })

  it("does not leak internal errors", async () => {
    deps.listDocumentRecords.mockRejectedValueOnce(new Error("ER_ACCESS_DENIED secret-host"))
    const res = await LIST(listReq())
    expect(res.status).toBe(500)
    expect(await res.text()).not.toMatch(/secret-host/)
  })
})

describe("GET /api/alt-text/documents/:id", () => {
  it("returns a persisted record for a numeric id, owner-scoped", async () => {
    const res = await detail("5")
    expect(res.status).toBe(200)
    expect(deps.getDocumentRecord).toHaveBeenCalledWith(5, { uploadedBy: 7 })
    expect(deps.getDocumentUpload).not.toHaveBeenCalled()
    expect((await res.json()).document).toEqual(record)
  })

  it("returns 404 for a record outside the tenant or owner scope", async () => {
    deps.getDocumentRecord.mockResolvedValueOnce(null)
    expect((await detail("99")).status).toBe(404)
  })

  it("keeps serving Task 3 upload status for upload ids", async () => {
    const id = "3f6c1a8e-2b4d-4c5e-9f00-112233445566"
    const res = await detail(id)
    expect(res.status).toBe(200)
    expect(deps.getDocumentUpload).toHaveBeenCalledWith(id, { userId: 7, canViewAll: false })
    expect(deps.getDocumentRecord).not.toHaveBeenCalled()
  })

  it("rejects unauthenticated users", async () => {
    deps.requireFeatureInModule.mockResolvedValueOnce({ ok: false, status: 401, error: "Unauthorized" })
    expect((await detail("5")).status).toBe(401)
    expect(deps.getDocumentRecord).not.toHaveBeenCalled()
  })
})
