import { beforeEach, describe, expect, it, vi } from "vitest"

const s = vi.hoisted(() => ({
  assets: [] as any[],
  session: { userId: 5, role: "employee" } as any,
  scopes: { view: "all", export: "all" } as Record<string, string>,
  tenant: 9 as number | null,
  exports: [] as any[],
  throwOnGet: null as any,
}))

vi.mock("@/lib/alt-text/store", () => ({
  getAsset: vi.fn(async (id: number) => {
    if (s.throwOnGet) throw s.throwOnGet
    const a = s.assets.find((x) => x.id === id && x.tenantId === s.tenant)
    return a ? { ...a, storageKey: `tenants/${a.tenantId}/secret-key.png` } : null
  }),
  recordExport: vi.fn(async (...args: any[]) => void s.exports.push(args)),
}))
vi.mock("@/lib/api-auth", () => ({
  requireFeatureInModule: vi.fn(async () => (s.session ? { ok: true, session: s.session } : { ok: false, status: 401, error: "Unauthorized" })),
}))
vi.mock("@/lib/permission-store", () => ({
  getScope: vi.fn(async (_u: number, _r: string, _m: string, action: string) => s.scopes[action] ?? "none"),
  getActionScope: vi.fn(async (_u: number, _r: string, _m: string, action: string) => s.scopes[action] ?? "none"),
}))
vi.mock("@/lib/tenant-scope", () => ({ currentTenantIdOrNull: () => s.tenant }))

import { GET } from "@/app/api/alt-text/export/route"

function asset(over: Partial<any> = {}) {
  return {
    id: 1, tenantId: 9, projectId: null, projectName: null, batchId: null, fileName: "रसायन-diagram.png", mimeType: "image/png", sizeBytes: 100,
    imageUrl: "/api/alt-text/assets/1/image", context: null, language: "hi", audience: "general", status: "in_review",
    classification: "chemical_structure", shortAlt: "Manually edited: H₂SO₄ अणु", longDescription: "E = mc²\n\nपैराग्राफ दो: 6.022×10²³ mol⁻¹, ∫x dx",
    extractedText: "H₂O", warnings: ["Verify charge", "=SUM(A1)"], treatment: "Informative", modelId: "openai/gpt-4o", creditsUsed: 7,
    attempts: 1, errorMessage: null, reviewerId: null, reviewerName: null, approvedAt: null, currentVersion: 3, createdBy: 5,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-03T00:00:00.000Z", ...over,
  }
}

const get = (qs: string) => {
  const r = new Request(`http://x/api/alt-text/export?${qs}`) as any
  r.nextUrl = new URL(r.url)
  return GET(r)
}

beforeEach(() => {
  s.assets = [
    asset(),
    asset({ id: 2, classification: "decorative", shortAlt: "", longDescription: null, extractedText: null, warnings: [] }),
    asset({ id: 3, tenantId: 10 }),
    asset({ id: 4, status: "processing", classification: null, shortAlt: null, longDescription: null }),
    asset({ id: 5, createdBy: 6, shortAlt: "=HYPERLINK(\"x\")" }),
  ]
  s.session = { userId: 5, role: "employee" }
  s.scopes = { view: "all", export: "all" }
  s.tenant = 9
  s.exports = []
  s.throwOnGet = null
})

const expectHeaders = (res: Response, ext: string, type: string) => {
  expect(res.status).toBe(200)
  expect(res.headers.get("content-type")).toBe(`${type}; charset=utf-8`)
  expect(res.headers.get("content-disposition")).toBe(`attachment; filename="alt-text-1.${ext}"`)
  expect(res.headers.get("x-content-type-options")).toBe("nosniff")
  expect(res.headers.get("cache-control")).toBe("private, no-store")
}

describe("GET /api/alt-text/export", () => {
  it("TXT: saved edited version with Hindi, math, chemistry and paragraphs", async () => {
    const res = await get("assetId=1&format=txt")
    expectHeaders(res, "txt", "text/plain")
    const text = await res.text()
    expect(text).toContain("Image Filename\n--------------\nरसायन-diagram.png")
    expect(text).toContain("Output Language\n---------------\nHindi")
    expect(text).toContain("Manually edited: H₂SO₄ अणु")
    expect(text).toContain("E = mc²\n\nपैराग्राफ दो: 6.022×10²³ mol⁻¹, ∫x dx")
    expect(text).toContain("Review Warnings")
    expect(text).not.toContain("secret-key")
    expect(text).not.toContain("Image Purpose")
    expect(s.exports[0]).toEqual(["txt", "single", null, 1, 5, 1])
  })

  it("CSV: reuses toCsv with BOM, RFC 4180 quoting and formula protection", async () => {
    const res = await get("assetId=1&format=csv")
    expectHeaders(res, "csv", "text/csv")
    const bytes = new Uint8Array(await res.clone().arrayBuffer())
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const csv = (await res.text()).replace(/^\uFEFF/, "")
    expect(csv.split("\r\n")[0]).toBe("assetId,fileName,classification,language,shortAlt,longDescription,extractedText,warnings,updatedAt")
    expect(csv).toContain('"E = mc²\n\nपैराग्राफ दो: 6.022×10²³ mol⁻¹, ∫x dx"')
    expect(csv).toContain('"Verify charge\n=SUM(A1)"')
    const inj = (await (await get("assetId=5&format=csv")).text()).replace(/^\uFEFF/, "")
    expect(inj).toContain(`"'=HYPERLINK(""x"")"`)
  })

  it("JSON: valid UTF-8 JSON of the current saved version without internals", async () => {
    const res = await get("assetId=1&format=JSON")
    expectHeaders(res, "json", "application/json")
    const body = JSON.parse(await res.text())
    expect(body.asset).toMatchObject({ id: 1, currentVersion: 3, shortAlt: "Manually edited: H₂SO₄ अणु", extractedText: "H₂O", approvedAt: null })
    const raw = JSON.stringify(body)
    for (const k of ["storageKey", "secret-key", "creditsUsed", "tenantId", "imageUrl"]) expect(raw).not.toContain(k)
  })

  it("preserves empty decorative alt text", async () => {
    const json = JSON.parse(await (await get("assetId=2&format=json")).text())
    expect(json.asset.shortAlt).toBe("")
    expect(json.asset.longDescription).toBeNull()
    expect(await (await get("assetId=2&format=txt")).text()).toContain('decorative image, use alt=""')
  })

  it("400 for missing/invalid parameters", async () => {
    for (const qs of ["format=txt", "assetId=1", "assetId=abc&format=txt", "assetId=1&format=xlsx"]) expect((await get(qs)).status).toBe(400)
    expect((await (await get("assetId=1&format=pdf")).json()).code).toBe("INVALID_FORMAT")
  })

  it("401 unauthenticated, 403 without export permission", async () => {
    s.session = null
    expect((await get("assetId=1&format=txt")).status).toBe(401)
    s.session = { userId: 5, role: "employee" }
    s.scopes.export = "none"
    const res = await get("assetId=1&format=txt")
    expect(res.status).toBe(403)
    expect(s.exports).toHaveLength(0)
  })

  it("404 cross-tenant and out-of-scope; 409 when nothing saved", async () => {
    expect((await get("assetId=3&format=txt")).status).toBe(404)
    s.scopes.view = "added"
    expect((await get("assetId=5&format=txt")).status).toBe(404)
    expect((await (await get("assetId=4&format=txt")).json()).code).toBe("NOT_EXPORTABLE")
    expect(s.exports).toHaveLength(0)
  })

  it("503 / 500 without leaking internals", async () => {
    s.throwOnGet = Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:3306 password=x"), { code: "ECONNREFUSED" })
    const res = await get("assetId=1&format=txt")
    expect(res.status).toBe(503)
    expect(await res.text()).not.toContain("10.0.0.1")
    s.throwOnGet = new Error("SELECT * FROM alt_text_assets")
    const res2 = await get("assetId=1&format=txt")
    expect(res2.status).toBe(500)
    expect(await res2.text()).not.toContain("SELECT")
  })
})
