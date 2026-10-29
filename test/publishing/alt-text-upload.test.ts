import { beforeEach, describe, expect, it, vi } from "vitest"

const m = vi.hoisted(() => ({
  uploadFile: vi.fn(),
  deleteFile: vi.fn(),
  checkStorageQuota: vi.fn(),
  getUploadLimits: vi.fn(),
  validateUploadContent: vi.fn(),
  createAsset: vi.fn(),
  getSettings: vi.fn(),
  requireFeatureInModule: vi.fn(),
  hasActionGrant: vi.fn(),
  checkRateLimit: vi.fn(),
}))
vi.mock("@/lib/storage", () => ({ uploadFile: m.uploadFile, deleteFile: m.deleteFile }))
vi.mock("@/lib/storage/storage-quota", () => ({ checkStorageQuota: m.checkStorageQuota }))
vi.mock("@/lib/settings/uploads", () => ({ getUploadLimits: m.getUploadLimits, validateUploadContent: m.validateUploadContent }))
vi.mock("@/lib/alt-text/store", () => ({ createAsset: m.createAsset, getSettings: m.getSettings }))
vi.mock("@/lib/api-auth", () => ({ requireFeatureInModule: m.requireFeatureInModule }))
vi.mock("@/lib/permission-store", () => ({ hasActionGrant: m.hasActionGrant }))
vi.mock("@/lib/tenant-scope", () => ({ currentTenantIdOrNull: () => 42 }))
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: m.checkRateLimit }))

import { NextRequest } from "next/server"
import { processAltTextUpload } from "@/lib/alt-text/upload"
import { POST } from "@/app/api/alt-text/upload/route"

const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const le24 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255]
const le32 = (n: number) => [...le24(n), (n >>> 24) & 255]
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0))

const png = (w = 1200, h = 800, complete = true) =>
  new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...be32(13), ...ascii("IHDR"), ...be32(w), ...be32(h), 8, 6, 0, 0, 0, 0, 0, 0, 0,
    ...(complete ? [...be32(0), ...ascii("IEND"), 0xae, 0x42, 0x60, 0x82] : []),
  ])
const jpeg = (w = 640, h = 480) =>
  new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0, 16, ...ascii("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0,
    0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1,
    0xff, 0xd9,
  ])
const webp = (w = 320, h = 200) => {
  const body = [...ascii("WEBP"), ...ascii("VP8X"), ...le32(10), 0, 0, 0, 0, ...le24(w - 1), ...le24(h - 1)]
  return new Uint8Array([...ascii("RIFF"), ...le32(body.length), ...body])
}
const file = (bytes: Uint8Array, name: string, type: string) => new File([bytes], name, { type })

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset()
  m.getSettings.mockResolvedValue({ maxFileMb: 20, defaultLanguage: "en", defaultAudience: "business_document" })
  m.getUploadLimits.mockResolvedValue({ maxBytes: 25 * 1024 * 1024, maxMb: 25, extensions: [], mimeTypes: new Set() })
  m.validateUploadContent.mockResolvedValue(null)
  m.checkStorageQuota.mockResolvedValue({ allowed: true, reason: "" })
  m.uploadFile.mockImplementation(async (path: string) => ({
    ok: true,
    result: { key: `tenants/42/${path}`, url: `/api/storage/file/tenants/42/${path}`, provider: "s3", size: 1, contentType: "image/png", file: { id: 9 } },
  }))
  m.deleteFile.mockResolvedValue(undefined)
  m.createAsset.mockResolvedValue(101)
  m.requireFeatureInModule.mockResolvedValue({ ok: true, session: { userId: 5, role: "employee" } })
  m.hasActionGrant.mockResolvedValue(true)
  m.checkRateLimit.mockResolvedValue({ allowed: true, retryAfter: 0, remaining: 29 })
})

describe("processAltTextUpload", () => {
  it.each([
    ["photo.jpg", "image/jpeg", jpeg(), 640, 480],
    ["diagram.png", "image/png", png(), 1200, 800],
    ["chart.webp", "image/webp", webp(), 320, 200],
  ])("stores %s privately under a tenant-scoped, collision-resistant key", async (name, type, bytes, width, height) => {
    const res = await processAltTextUpload(file(bytes, name, type), { userId: 5 })
    expect(res).toEqual({ ok: true, asset: { id: 101, filename: name, mimeType: type, size: bytes.length, width, height, status: "uploaded", scanStatus: "pending" } })
    const [path, stored, opts] = m.uploadFile.mock.calls[0]
    expect(path).toMatch(new RegExp(`^alt-text/5/[0-9a-f-]{36}\\.${name.split(".")[1]}$`))
    expect(path).not.toContain(name.split(".")[0])
    expect(stored.type).toBe(type)
    expect(opts.public).toBeUndefined()
    expect(opts.metadata).toMatchObject({ module: "publishing", ownerId: 5, classification: "confidential" })
    expect(m.createAsset).toHaveBeenCalledWith(expect.objectContaining({ fileName: name, mimeType: type, storageKey: `tenants/42/${path}`, createdBy: 5 }))
    expect(JSON.stringify(res)).not.toMatch(/tenants\/42|api\/storage|alt-text\//)
  })

  it("rejects unsupported MIME types, SVG and fake extensions with 415", async () => {
    expect(await processAltTextUpload(file(png(), "a.gif", "image/gif"), { userId: 5 })).toMatchObject({ status: 415 })
    expect(await processAltTextUpload(file(new TextEncoder().encode("<svg/>"), "a.svg", "image/svg+xml"), { userId: 5 })).toMatchObject({ status: 415 })
    expect(await processAltTextUpload(file(png(), "a.jpg", "image/jpeg"), { userId: 5 })).toMatchObject({ status: 415, code: "CONTENT_MISMATCH" })
    expect(await processAltTextUpload(file(new Uint8Array([0x4d, 0x5a, 0, 0]), "a.png", "image/png"), { userId: 5 })).toMatchObject({ status: 415 })
    expect(m.uploadFile).not.toHaveBeenCalled()
  })

  it("rejects oversized, empty, corrupt and bomb-sized images before storage", async () => {
    expect(await processAltTextUpload(file(new Uint8Array(10 * 1024 * 1024 + 1), "big.png", "image/png"), { userId: 5 })).toMatchObject({ status: 413 })
    expect(await processAltTextUpload(file(new Uint8Array(0), "e.png", "image/png"), { userId: 5 })).toMatchObject({ status: 400 })
    expect(await processAltTextUpload(file(png(1200, 800, false), "t.png", "image/png"), { userId: 5 })).toMatchObject({ status: 400 })
    expect(await processAltTextUpload(file(png(1200, 800).slice(0, 20), "h.png", "image/png"), { userId: 5 })).toMatchObject({ status: 400 })
    expect(await processAltTextUpload(file(png(50_000, 50_000), "bomb.png", "image/png"), { userId: 5 })).toMatchObject({ status: 400 })
    expect(m.uploadFile).not.toHaveBeenCalled()
  })

  it("applies a stricter tenant size limit and the storage quota", async () => {
    m.getSettings.mockResolvedValue({ maxFileMb: 1, defaultLanguage: "en", defaultAudience: "business_document" })
    const big = new Uint8Array(2 * 1024 * 1024)
    big.set(png())
    expect(await processAltTextUpload(file(big, "x.png", "image/png"), { userId: 5 })).toMatchObject({ status: 413, code: "FILE_TOO_LARGE" })
    m.checkStorageQuota.mockResolvedValue({ allowed: false, reason: "Storage quota exceeded" })
    expect(await processAltTextUpload(file(png(), "x.png", "image/png"), { userId: 5 })).toMatchObject({ status: 413, code: "STORAGE_QUOTA_EXCEEDED" })
  })

  it("maps storage outage to 503 and daily limits to 429 without creating an asset", async () => {
    m.uploadFile.mockResolvedValueOnce({ ok: false, error: "Upload failed. Check the connected storage configuration." })
    expect(await processAltTextUpload(file(png(), "x.png", "image/png"), { userId: 5 })).toMatchObject({ status: 503, code: "STORAGE_UNAVAILABLE" })
    m.uploadFile.mockResolvedValueOnce({ ok: false, error: "Daily upload limit reached" })
    expect(await processAltTextUpload(file(png(), "x.png", "image/png"), { userId: 5 })).toMatchObject({ status: 429 })
    expect(m.createAsset).not.toHaveBeenCalled()
  })

  it("fails closed when the scan cannot be tracked and cleans up the object", async () => {
    m.uploadFile.mockResolvedValueOnce({ ok: true, result: { key: "tenants/42/alt-text/5/k.png", file: undefined } })
    expect(await processAltTextUpload(file(png(), "x.png", "image/png"), { userId: 5 })).toMatchObject({ status: 503, code: "SCAN_UNAVAILABLE" })
    expect(m.deleteFile).toHaveBeenCalledWith("tenants/42/alt-text/5/k.png")
    expect(m.createAsset).not.toHaveBeenCalled()
  })

  it("deletes the stored object when the asset insert fails", async () => {
    m.createAsset.mockRejectedValueOnce(new Error("ER_DUP_ENTRY secret details"))
    const res = await processAltTextUpload(file(png(), "x.png", "image/png"), { userId: 5 })
    expect(res).toMatchObject({ status: 500, code: "UPLOAD_FAILED" })
    expect(JSON.stringify(res)).not.toContain("ER_DUP")
    expect(m.deleteFile).toHaveBeenCalledWith(expect.stringMatching(/^tenants\/42\/alt-text\/5\//))
  })
})

describe("POST /api/alt-text/upload", () => {
  const request = (form: FormData) => new NextRequest("http://localhost/api/alt-text/upload", { method: "POST", body: form })
  const formWith = (...files: File[]) => {
    const f = new FormData()
    for (const x of files) f.append("file", x)
    f.append("tenantId", "999")
    return f
  }

  it("returns 201 with safe metadata for an authorized upload", async () => {
    const res = await POST(request(formWith(file(png(), "diagram.png", "image/png"))))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).toEqual({ success: true,reused:false, asset: expect.objectContaining({ id: 101, status: "uploaded", scanStatus: "pending" }) })
    expect(JSON.stringify(body)).not.toContain("tenants/42/")
    expect(body.asset).not.toHaveProperty("storageKey")
    expect(m.hasActionGrant).toHaveBeenCalledWith(5, "employee", "publishing.alt_text", "upload")
    expect(m.checkRateLimit.mock.calls[0][0]).toBe("alt-text-upload:42:5")
  })

  it.each([
    [{ ok: false, status: 401, error: "Unauthorized" }, 401],
    [{ ok: false, status: 404, error: "Not found" }, 404],
    [{ ok: false, status: 403, error: "Plan", code: "PLAN_REQUIRED" }, 403],
  ])("enforces session, module toggle and plan (%#)", async (gate, status) => {
    m.requireFeatureInModule.mockResolvedValue(gate)
    expect((await POST(request(formWith(file(png(), "a.png", "image/png"))))).status).toBe(status)
    expect(m.uploadFile).not.toHaveBeenCalled()
  })

  it("requires the publishing.alt_text upload action", async () => {
    m.hasActionGrant.mockResolvedValue(false)
    expect((await POST(request(formWith(file(png(), "a.png", "image/png"))))).status).toBe(403)
    expect(m.uploadFile).not.toHaveBeenCalled()
  })

  it("rejects missing and multiple files, and rate-limited callers", async () => {
    expect((await POST(request(formWith()))).status).toBe(400)
    expect((await POST(request(formWith(file(png(), "a.png", "image/png"), file(png(), "b.png", "image/png"))))).status).toBe(400)
    m.checkRateLimit.mockResolvedValue({ allowed: false, retryAfter: 12, remaining: 0 })
    const limited = await POST(request(formWith(file(png(), "a.png", "image/png"))))
    expect(limited.status).toBe(429)
    expect(limited.headers.get("Retry-After")).toBe("12")
  })
})
