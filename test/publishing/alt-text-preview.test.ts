import { beforeEach, describe, expect, it, vi } from "vitest"

const m = vi.hoisted(() => ({
  requireFeatureInModule: vi.fn(),
  getScope: vi.fn(),
  tenantId: 42 as number | null,
  getAsset: vi.fn(),
  getByObjectKey: vi.fn(),
  getScanForFile: vi.fn(),
  downloadFile: vi.fn(),
}))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/api-auth", () => ({ requireFeatureInModule: m.requireFeatureInModule }))
vi.mock("@/lib/permission-store", () => ({ getScope: m.getScope }))
vi.mock("@/lib/tenant-scope", () => ({ currentTenantIdOrNull: () => m.tenantId }))
vi.mock("@/lib/alt-text/store", () => ({ getAsset: m.getAsset, createAsset: vi.fn(), getSettings: vi.fn() }))
vi.mock("@/lib/storage/file-metadata", () => ({ getByObjectKey: m.getByObjectKey }))
vi.mock("@/lib/storage/file-scanning", async (orig) => ({
  ...(await orig<typeof import("@/lib/storage/file-scanning")>()),
  getScanForFile: m.getScanForFile,
}))
vi.mock("@/lib/storage", () => ({
  downloadFile: m.downloadFile,
  uploadFile: vi.fn(),
  deleteFile: vi.fn(),
  keyBelongsToTenant: (key: string, t: number) => key.startsWith(`t/${t}/`),
}))
vi.mock("@/lib/storage/storage-quota", () => ({ checkStorageQuota: vi.fn() }))
vi.mock("@/lib/settings/uploads", () => ({ getUploadLimits: vi.fn(), validateUploadContent: vi.fn() }))

import { NextRequest } from "next/server"
import { GET } from "@/app/api/alt-text/assets/[id]/image/route"

const KEY = "t/42/alt-text/7/abc.png"
const BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])

const call = (id: string) =>
  GET(new NextRequest(`http://localhost/api/alt-text/assets/${id}/image`), { params: Promise.resolve({ id }) })

const asset = (over: Record<string, unknown> = {}) => ({
  id: 5,
  fileName: 'my "photo"\r\n.png',
  mimeType: "image/png",
  storageKey: KEY,
  createdBy: 7,
  reviewerId: null,
  ...over,
})

beforeEach(() => {
  m.tenantId = 42
  for (const fn of [m.requireFeatureInModule, m.getScope, m.getAsset, m.getByObjectKey, m.getScanForFile, m.downloadFile]) fn.mockReset()
  m.requireFeatureInModule.mockResolvedValue({ ok: true, session: { userId: 7, role: "employee" } })
  m.getScope.mockResolvedValue("all")
  m.getAsset.mockResolvedValue(asset())
  m.getByObjectKey.mockResolvedValue({ id: 11, classification: "confidential", uploadStatus: "completed" })
  m.getScanForFile.mockResolvedValue({ scanStatus: "clean", approved: false, quarantineStatus: "released" })
  m.downloadFile.mockResolvedValue({ body: new Blob([BYTES]).stream(), contentType: "text/html", size: BYTES.length })
})

describe("GET /api/alt-text/assets/[id]/image", () => {
  it.each([
    ["image/jpeg", "a.jpg"],
    ["image/png", "a.png"],
    ["image/webp", "a.webp"],
  ])("streams an authorized %s image with secure headers", async (type, name) => {
    m.getAsset.mockResolvedValue(asset({ mimeType: type, fileName: name }))
    const res = await call("5")
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe(type)
    expect(res.headers.get("x-content-type-options")).toBe("nosniff")
    expect(res.headers.get("content-disposition")).toBe(`inline; filename="${name}"`)
    expect(res.headers.get("cache-control")).toContain("no-store")
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'")
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(BYTES)
    expect(m.downloadFile).toHaveBeenCalledWith(KEY)
  })

  it("sanitizes the filename and never leaks the storage key", async () => {
    const res = await call("5")
    const disposition = res.headers.get("content-disposition")!
    expect(disposition).not.toMatch(/[\r\n]/)
    expect(disposition).toBe('inline; filename="my _photo_.png"')
    const all = JSON.stringify([...res.headers.entries()])
    expect(all).not.toContain(KEY)
  })

  it("rejects invalid identifiers before touching auth or storage", async () => {
    for (const id of ["abc", "0", "-1", "1.5", "../x"]) expect((await call(id)).status).toBe(400)
    expect(m.getAsset).not.toHaveBeenCalled()
  })

  it("returns 401 when unauthenticated", async () => {
    m.requireFeatureInModule.mockResolvedValue({ ok: false, status: 401, error: "Unauthorized" })
    const res = await call("5")
    expect(res.status).toBe(401)
    expect((await res.json()).code).toBe("UNAUTHENTICATED")
  })

  it("returns 403 when the Publishing module is disabled", async () => {
    m.requireFeatureInModule.mockResolvedValue({ ok: false, status: 403, code: "MODULE_DISABLED", error: "Module disabled" })
    const res = await call("5")
    expect(res.status).toBe(403)
    expect(m.getAsset).not.toHaveBeenCalled()
  })

  it("returns 403 without the view permission", async () => {
    m.getScope.mockResolvedValue("none")
    expect((await call("5")).status).toBe(403)
    expect(m.getAsset).not.toHaveBeenCalled()
  })

  it("hides records outside the user's record scope", async () => {
    m.getScope.mockResolvedValue("added")
    m.getAsset.mockResolvedValue(asset({ createdBy: 99 }))
    expect((await call("5")).status).toBe(404)
    expect(m.downloadFile).not.toHaveBeenCalled()
  })

  it("denies cross-tenant access with a non-disclosing 404", async () => {
    m.getAsset.mockResolvedValue(null)
    expect((await call("5")).status).toBe(404)
    m.getAsset.mockResolvedValue(asset({ storageKey: "t/7/alt-text/1/x.png" }))
    const res = await call("5")
    expect(res.status).toBe(404)
    expect(m.downloadFile).not.toHaveBeenCalled()
  })

  it("blocks infected images without disclosing them", async () => {
    m.getScanForFile.mockResolvedValue({ scanStatus: "infected", approved: true, quarantineStatus: "quarantined" })
    expect((await call("5")).status).toBe(404)
    expect(m.downloadFile).not.toHaveBeenCalled()
  })

  it.each(["pending", "scanning", "error"])("returns 409 while the scan is %s", async (scanStatus) => {
    m.getScanForFile.mockResolvedValue({ scanStatus, approved: false, quarantineStatus: "quarantined" })
    const res = await call("5")
    expect(res.status).toBe(409)
    expect(m.downloadFile).not.toHaveBeenCalled()
  })

  it("treats a missing scan record as unsafe", async () => {
    m.getScanForFile.mockResolvedValue(null)
    expect((await call("5")).status).toBe(409)
  })

  it("rejects unsupported stored types such as SVG", async () => {
    m.getAsset.mockResolvedValue(asset({ mimeType: "image/svg+xml" }))
    expect((await call("5")).status).toBe(415)
    expect(m.downloadFile).not.toHaveBeenCalled()
  })

  it("returns 404 when the storage object is missing", async () => {
    m.downloadFile.mockRejectedValue(Object.assign(new Error("gone"), { name: "NoSuchKey" }))
    expect((await call("5")).status).toBe(404)
  })

  it("returns 503 when storage is unavailable without leaking details", async () => {
    m.downloadFile.mockRejectedValue(new Error(`connect ECONNREFUSED for ${KEY}`))
    const res = await call("5")
    expect(res.status).toBe(503)
    expect(await res.text()).not.toContain(KEY)
  })

  it("returns 500 on unexpected failures", async () => {
    m.getAsset.mockRejectedValue(new Error("SELECT * FROM alt_text_assets"))
    const res = await call("5")
    expect(res.status).toBe(500)
    expect(await res.text()).not.toContain("SELECT")
  })
})
