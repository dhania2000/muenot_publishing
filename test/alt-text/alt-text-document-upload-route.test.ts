import { beforeEach, describe, expect, it, vi } from "vitest"

const deps = vi.hoisted(() => ({
  requireFeatureInModule: vi.fn(),
  hasActionGrant: vi.fn(async () => true),
  currentTenantIdOrNull: vi.fn(() => 1 as number | null),
  checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfter: 0 })),
  processDocumentUpload: vi.fn(),
}))

vi.mock("@/lib/api-auth", () => ({ requireFeatureInModule: deps.requireFeatureInModule }))
vi.mock("@/lib/permission-store", () => ({ hasActionGrant: deps.hasActionGrant }))
vi.mock("@/lib/tenant-scope", () => ({ currentTenantIdOrNull: deps.currentTenantIdOrNull }))
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: deps.checkRateLimit }))
vi.mock("@/lib/alt-text/document-upload", () => ({ processDocumentUpload: deps.processDocumentUpload }))

const { POST } = await import("@/app/api/alt-text/documents/upload/route")

function request(form: FormData | null, headers: Record<string, string | null> = {}) {
  const url = "http://localhost/api/alt-text/documents/upload"
  // Let the runtime compute the multipart content-type/boundary, then layer test overrides on top.
  const base = new Request(url, { method: "POST", body: form ?? undefined })
  const h = new Headers(base.headers)
  if (!("content-length" in headers)) h.set("content-length", "2048")
  for (const [k, v] of Object.entries(headers)) v == null ? h.delete(k) : h.set(k, v)
  // undici forbids setting content-length on a Request, so override the getter on the original
  // (re-building the Request would re-serialize the form with a different multipart boundary).
  Object.defineProperty(base, "headers", { value: h })
  return base as unknown as Parameters<typeof POST>[0]
}

const withFile = (...names: string[]) => {
  const f = new FormData()
  for (const n of names) f.append("document", new File(["%PDF-1.7"], n, { type: "application/pdf" }))
  return f
}

beforeEach(() => {
  vi.clearAllMocks()
  deps.requireFeatureInModule.mockResolvedValue({ ok: true, session: { userId: 7, role: "member" } })
  deps.hasActionGrant.mockResolvedValue(true)
  deps.currentTenantIdOrNull.mockReturnValue(1)
  deps.checkRateLimit.mockResolvedValue({ allowed: true, retryAfter: 0 })
  deps.processDocumentUpload.mockResolvedValue({ ok: true, document: { uploadId: "u1" }, reused: false })
})

describe("POST /api/alt-text/documents/upload", () => {
  it("rejects unauthenticated users", async () => {
    deps.requireFeatureInModule.mockResolvedValueOnce({ ok: false, status: 401, error: "Unauthorized" })
    const res = await POST(request(withFile("a.pdf")))
    expect(res.status).toBe(401)
    expect(deps.processDocumentUpload).not.toHaveBeenCalled()
  })

  it("rejects when the Publishing module is disabled", async () => {
    deps.requireFeatureInModule.mockResolvedValueOnce({ ok: false, status: 404, error: "Not found" })
    expect((await POST(request(withFile("a.pdf")))).status).toBe(404)
  })

  it("rejects users without the alt text upload grant", async () => {
    deps.hasActionGrant.mockResolvedValueOnce(false)
    const res = await POST(request(withFile("a.pdf")))
    expect(res.status).toBe(403)
    expect(deps.hasActionGrant).toHaveBeenCalledWith(7, "member", "publishing.alt_text", "upload")
    expect(deps.processDocumentUpload).not.toHaveBeenCalled()
  })

  it("rejects requests without a server-resolved tenant", async () => {
    deps.currentTenantIdOrNull.mockReturnValueOnce(null)
    expect((await POST(request(withFile("a.pdf")))).status).toBe(403)
  })

  it("applies the per-tenant, per-user rate limit", async () => {
    deps.checkRateLimit.mockResolvedValueOnce({ allowed: false, retryAfter: 30 })
    const res = await POST(request(withFile("a.pdf")))
    expect(res.status).toBe(429)
    expect(res.headers.get("retry-after")).toBe("30")
    expect(deps.checkRateLimit.mock.calls[0][0]).toBe("alt-text-document-upload:1:7")
  })

  it("requires multipart/form-data", async () => {
    expect((await POST(request(null, { "content-type": "application/json" }))).status).toBe(415)
  })

  it("requires a declared content length (no unbounded bodies)", async () => {
    const res = await POST(request(withFile("a.pdf"), { "content-length": null }))
    expect(res.status).toBe(411)
    expect(deps.processDocumentUpload).not.toHaveBeenCalled()
  })

  it("rejects oversized bodies before reading them", async () => {
    const res = await POST(request(withFile("a.pdf"), { "content-length": String(200 * 1024 * 1024) }))
    expect(res.status).toBe(413)
  })

  it("accepts exactly one document per request", async () => {
    expect((await POST(request(new FormData()))).status).toBe(400)
    expect((await POST(request(withFile("a.pdf", "b.pdf")))).status).toBe(400)
  })

  it("ignores client-supplied tenant ids and uses the session user", async () => {
    const form = withFile("a.pdf")
    form.append("tenantId", "2")
    form.append("userId", "99")
    const res = await POST(request(form))
    expect(res.status).toBe(201)
    expect(deps.processDocumentUpload.mock.calls[0][1]).toEqual({ userId: 7 })
    expect(res.headers.get("cache-control")).toContain("no-store")
  })

  it("returns 200 for a reused (idempotent) retry and surfaces service errors", async () => {
    deps.processDocumentUpload.mockResolvedValueOnce({ ok: true, document: { uploadId: "u1" }, reused: true })
    expect((await POST(request(withFile("a.pdf")))).status).toBe(200)
    deps.processDocumentUpload.mockResolvedValueOnce({ ok: false, status: 422, code: "MACROS_NOT_ALLOWED", error: "Documents containing macros are not allowed." })
    const res = await POST(request(withFile("a.pdf")))
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ success: false, code: "MACROS_NOT_ALLOWED", error: "Documents containing macros are not allowed." })
  })

  it("sanitizes unexpected failures", async () => {
    deps.processDocumentUpload.mockRejectedValueOnce(new Error("s3://secret-bucket/key leaked"))
    const res = await POST(request(withFile("a.pdf")))
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain("secret-bucket")
  })
})
