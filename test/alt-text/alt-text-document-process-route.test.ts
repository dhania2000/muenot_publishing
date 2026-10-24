import { beforeEach, describe, expect, it, vi } from "vitest"

const deps = vi.hoisted(() => ({
  requireFeatureInModule: vi.fn(),
  getScope: vi.fn(async () => "own" as string),
  getActionScope: vi.fn(async () => "own" as string),
  currentTenantIdOrNull: vi.fn(() => 1 as number | null),
  getDocumentForExtraction: vi.fn(),
  startDocumentPreparation: vi.fn(),
  cancelDocumentPreparation: vi.fn(),
  getDocumentPreparationProgress: vi.fn(async (documentId: number) => ({ documentId, jobId: 11, active: true })),
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
  runDueBackgroundJobs: vi.fn(async () => undefined),
  after: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: deps.after }))
vi.mock("@/lib/api-auth", () => ({ requireFeatureInModule: deps.requireFeatureInModule }))
vi.mock("@/lib/permission-store", () => ({ getScope: deps.getScope, getActionScope: deps.getActionScope }))
vi.mock("@/lib/tenant-scope", () => ({ currentTenantIdOrNull: deps.currentTenantIdOrNull, currentTenantId: () => 1 }))
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: deps.checkRateLimit }))
vi.mock("@/lib/background-jobs", () => ({ runDueBackgroundJobs: deps.runDueBackgroundJobs }))
vi.mock("@/lib/alt-text/history", () => ({ storeErrorToFailure: () => ({ status: 500, code: "INTERNAL", error: "Something went wrong." }) }))
vi.mock("@/lib/alt-text/document-service", () => ({
  getDocumentForExtraction: deps.getDocumentForExtraction,
  ownerScopeFor: (a: { userId: number; viewScope: string }) => (a.viewScope === "all" ? null : { uploadedBy: a.userId }),
}))
vi.mock("@/lib/alt-text/document-preparation-job", () => ({
  startDocumentPreparation: deps.startDocumentPreparation,
  cancelDocumentPreparation: deps.cancelDocumentPreparation,
  getDocumentPreparationProgress: deps.getDocumentPreparationProgress,
}))

const processRoute = await import("@/app/api/alt-text/documents/[uploadId]/process/route")
const extractRoute = await import("@/app/api/alt-text/documents/[uploadId]/extract/route")

const ctx = (id: string) => ({ params: Promise.resolve({ uploadId: id }) })
const req = () => new Request("http://localhost/x", { method: "POST" })
const doc = { id: 5, documentType: "pdf", securityStatus: "clean", uploadedBy: 7 }

beforeEach(() => {
  vi.clearAllMocks()
  deps.requireFeatureInModule.mockResolvedValue({ ok: true, session: { userId: 7, role: "member" } })
  deps.getScope.mockResolvedValue("own")
  deps.getActionScope.mockResolvedValue("own")
  deps.currentTenantIdOrNull.mockReturnValue(1)
  deps.checkRateLimit.mockResolvedValue({ allowed: true })
  deps.getDocumentForExtraction.mockResolvedValue(doc)
  deps.startDocumentPreparation.mockResolvedValue({ ok: true, jobId: 11, created: true })
  deps.cancelDocumentPreparation.mockResolvedValue({ result: "cancel_requested", jobId: 11 })
})

describe("POST /api/alt-text/documents/:id/process", () => {
  it("rejects unauthenticated users", async () => {
    deps.requireFeatureInModule.mockResolvedValueOnce({ ok: false, status: 401, error: "Unauthorized" })
    expect((await processRoute.POST(req(), ctx("5"))).status).toBe(401)
    expect(deps.startDocumentPreparation).not.toHaveBeenCalled()
  })

  it("rejects users without upload permission", async () => {
    deps.getActionScope.mockResolvedValue("none")
    expect((await processRoute.POST(req(), ctx("5"))).status).toBe(403)
    expect(deps.startDocumentPreparation).not.toHaveBeenCalled()
  })

  it("returns 404 for malformed ids without touching the store", async () => {
    expect((await processRoute.POST(req(), ctx("abc"))).status).toBe(404)
    expect(deps.getDocumentForExtraction).not.toHaveBeenCalled()
  })

  it("returns 404 for documents outside the owner scope", async () => {
    deps.getDocumentForExtraction.mockResolvedValueOnce(null)
    expect((await processRoute.POST(req(), ctx("5"))).status).toBe(404)
    expect(deps.getDocumentForExtraction).toHaveBeenCalledWith(5, { uploadedBy: 7 })
    expect(deps.startDocumentPreparation).not.toHaveBeenCalled()
  })

  it("enqueues and returns 202 with progress, kicking the worker once", async () => {
    const res = await processRoute.POST(req(), ctx("5"))
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body).toMatchObject({ success: true, jobId: 11, created: true, preparation: { documentId: 5 } })
    expect(deps.startDocumentPreparation).toHaveBeenCalledWith(doc, 7)
    expect(deps.after).toHaveBeenCalledTimes(1)
  })

  it("reuses an active job without kicking the worker again", async () => {
    deps.startDocumentPreparation.mockResolvedValueOnce({ ok: true, jobId: 11, created: false })
    const res = await processRoute.POST(req(), ctx("5"))
    expect(res.status).toBe(202)
    expect((await res.json()).created).toBe(false)
    expect(deps.after).not.toHaveBeenCalled()
  })

  it("surfaces enqueue refusals such as an unclean document", async () => {
    deps.startDocumentPreparation.mockResolvedValueOnce({ ok: false, status: 409, code: "DOCUMENT_NOT_CLEAN", error: "nope" })
    const res = await processRoute.POST(req(), ctx("5"))
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe("DOCUMENT_NOT_CLEAN")
  })

  it("rate-limits per user", async () => {
    deps.checkRateLimit.mockResolvedValueOnce({ allowed: false })
    expect((await processRoute.POST(req(), ctx("5"))).status).toBe(429)
    expect(deps.startDocumentPreparation).not.toHaveBeenCalled()
  })
})

describe("legacy POST /extract", () => {
  it("enqueues the same durable job instead of extracting synchronously", async () => {
    const res = await extractRoute.POST(req(), ctx("5"))
    expect(res.status).toBe(202)
    expect(deps.startDocumentPreparation).toHaveBeenCalledWith(doc, 7)
  })
})

describe("DELETE /api/alt-text/documents/:id/process", () => {
  it("requests cancellation for an owned document", async () => {
    const res = await processRoute.DELETE(req(), ctx("5"))
    expect(res.status).toBe(200)
    expect((await res.json()).result).toBe("cancel_requested")
    expect(deps.cancelDocumentPreparation).toHaveBeenCalledWith(5)
  })

  it("returns 409 when nothing is active", async () => {
    deps.cancelDocumentPreparation.mockResolvedValueOnce({ result: "not_active", jobId: null })
    expect((await processRoute.DELETE(req(), ctx("5"))).status).toBe(409)
  })

  it("does not cancel documents outside the owner scope", async () => {
    deps.getDocumentForExtraction.mockResolvedValueOnce(null)
    expect((await processRoute.DELETE(req(), ctx("5"))).status).toBe(404)
    expect(deps.cancelDocumentPreparation).not.toHaveBeenCalled()
  })
})
