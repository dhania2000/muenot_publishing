import { beforeEach, describe, expect, it, vi } from "vitest"

const s = vi.hoisted(() => ({
  assets: [] as any[],
  versions: [] as any[],
  session: { userId: 5, role: "employee" } as any,
  gate: null as any,
  scopes: { view: "all", update: "all" } as Record<string, string>,
  tenant: 9 as number | null,
  listCalls: [] as any[],
  editCalls: [] as any[],
  throwOnGet: null as any,
}))

vi.mock("@/lib/alt-text/store", () => ({
  getSettings: vi.fn(async () => ({ shortMaxChars: 125 })),
  getAsset: vi.fn(async (id: number) => {
    if (s.throwOnGet) throw s.throwOnGet
    const a = s.assets.find((x) => x.id === id && x.tenantId === s.tenant)
    return a ? { ...a, storageKey: `tenants/${a.tenantId}/secret.png` } : null
  }),
  listAssets: vi.fn(async (filter: any) => {
    s.listCalls.push(filter)
    let rows = s.assets.filter((a) => a.tenantId === s.tenant)
    if (filter.createdById) rows = rows.filter((a) => a.createdBy === filter.createdById)
    if (filter.search) rows = rows.filter((a) => a.fileName.includes(filter.search))
    const total = rows.length
    return { items: rows.slice(filter.offset, filter.offset + filter.limit), total }
  }),
  listVersions: vi.fn(async (id: number) => s.versions.filter((v) => v.assetId === id)),
  editAsset: vi.fn(async (id: number, edit: any, actorId: number, expected?: number, audit?: any) => {
    s.editCalls.push({ id, edit, actorId, expected, audit })
    const a = s.assets.find((x) => x.id === id && x.tenantId === s.tenant)
    if (!a) return null
    if (a.status === "processing") return "busy"
    if (expected !== undefined && a.currentVersion !== expected) return "conflict"
    Object.assign(a, edit, { currentVersion: a.currentVersion + 1 }, audit ? {language:audit.language,warnings:audit.warnings} : {})
    s.versions.unshift({ assetId: id, version: a.currentVersion, action: "edited", ...edit, note: null, modelId: null, actorId, actorName: "Editor", createdAt: "2026-01-02T00:00:00.000Z" })
    return { ...a }
  }),
}))
vi.mock("@/lib/api-auth", () => ({
  requireFeatureInModule: vi.fn(async () => s.gate ?? (s.session ? { ok: true, session: s.session } : { ok: false, status: 401, error: "Unauthorized" })),
}))
vi.mock("@/lib/permission-store", () => ({ getScope: vi.fn(async (_u: number, _r: string, _m: string, action: string) => s.scopes[action] ?? "none") }))
vi.mock("@/lib/tenant-scope", () => ({ currentTenantIdOrNull: () => s.tenant }))

import { cleanText, parseEditRequest, parseListQuery, storeErrorToFailure } from "@/lib/alt-text/history"
import { GET as listRoute } from "@/app/api/alt-text/assets/route"
import { GET as getRoute, PATCH as patchRoute } from "@/app/api/alt-text/assets/[id]/route"
import { GET as versionsRoute } from "@/app/api/alt-text/assets/[id]/versions/route"

function asset(over: Partial<any> = {}) {
  return {
    id: 1, tenantId: 9, projectId: null, projectName: null, batchId: null, fileName: "diagram.png", mimeType: "image/png", sizeBytes: 100,
    imageUrl: "/api/alt-text/assets/1/image", context: null, language: "en", audience: "general", status: "in_review",
    classification: "photograph", shortAlt: "AI alt", longDescription: "AI long", extractedText: "", warnings: ["w"], treatment: "Informative",
    modelId: "openai/gpt-4o", creditsUsed: 7, attempts: 1, errorMessage: null, reviewerId: null, reviewerName: null, approvedAt: null,
    currentVersion: 1, createdBy: 5, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", ...over,
  }
}
const req = (url: string, init?: RequestInit) => {
  const r = new Request(`http://x${url}`, init) as any
  r.nextUrl = new URL(`http://x${url}`)
  return r
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const patch = (id: string, body: unknown) => patchRoute(req(`/api/alt-text/assets/${id}`, { method: "PATCH", body: JSON.stringify(body) }), ctx(id))

beforeEach(() => {
  s.assets = [
    asset(),
    asset({ id: 2, fileName: "chart.png", classification: "chart", createdBy: 6 }),
    asset({ id: 3, tenantId: 10, fileName: "other-tenant.png" }),
  ]
  s.versions = [{ assetId: 1, version: 1, action: "generated", classification: "photograph", shortAlt: "AI alt", longDescription: "AI long", note: null, modelId: "openai/gpt-4o", actorId: 5, actorName: "Gen", createdAt: "2026-01-01T00:00:00.000Z" }]
  s.session = { userId: 5, role: "employee" }
  s.gate = null
  s.scopes = { view: "all", update: "all" }
  s.tenant = 9
  s.listCalls = []
  s.editCalls = []
  s.throwOnGet = null
})

describe("GET /api/alt-text/assets", () => {
  it("lists only the current tenant's assets without internal fields", async () => {
    const res = await listRoute(req("/api/alt-text/assets"))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.items.map((a: any) => a.id)).toEqual([1, 2])
    expect(body.total).toBe(2)
    expect(body.items[0]).not.toHaveProperty("storageKey")
    expect(body.items[0]).not.toHaveProperty("creditsUsed")
    expect(body.items[0].imageUrl).toBe("/api/alt-text/assets/1/image")
  })

  it("paginates, searches (escaping LIKE wildcards) and applies record scope", async () => {
    s.scopes.view = "added"
    const res = await listRoute(req("/api/alt-text/assets?page=1&pageSize=1&search=diagram&sort=oldest&status=in_review&classification=photograph"))
    const body = await res.json()
    expect(body).toMatchObject({ page: 1, pageSize: 1, total: 1 })
    expect(s.listCalls[0]).toMatchObject({ createdById: 5, limit: 1, offset: 0, sort: "oldest", status: "in_review", classification: "photograph" })
    await listRoute(req("/api/alt-text/assets?search=50%25_off"))
    expect(s.listCalls[1].search).toBe("50\\%\\_off")
  })

  it("rejects bad query parameters and caps page size", () => {
    expect(parseListQuery(new URLSearchParams("pageSize=500")).ok).toBe(false)
    expect(parseListQuery(new URLSearchParams("status=bogus")).ok).toBe(false)
    expect(parseListQuery(new URLSearchParams("page=0")).ok).toBe(false)
  })

  it("401 when unauthenticated", async () => {
    s.session = null
    const res = await listRoute(req("/api/alt-text/assets"))
    expect(res.status).toBe(401)
    expect((await res.json()).code).toBe("UNAUTHENTICATED")
  })
})

describe("GET /api/alt-text/assets/[id]", () => {
  it("returns the saved AI descriptions and version number", async () => {
    const res = await getRoute(req("/api/alt-text/assets/1"), ctx("1"))
    const { asset: a } = await res.json()
    expect(a).toMatchObject({ id: 1, shortAlt: "AI alt", longDescription: "AI long", warnings: ["w"], language: "en", modelId: "openai/gpt-4o", currentVersion: 1 })
    expect(a).not.toHaveProperty("storageKey")
  })

  it("400 on invalid id, 404 for other tenant or out-of-scope records", async () => {
    expect((await getRoute(req("/api/alt-text/assets/abc"), ctx("abc"))).status).toBe(400)
    expect((await getRoute(req("/api/alt-text/assets/0"), ctx("0"))).status).toBe(400)
    expect((await getRoute(req("/api/alt-text/assets/3"), ctx("3"))).status).toBe(404)
    s.scopes.view = "added"
    expect((await getRoute(req("/api/alt-text/assets/2"), ctx("2"))).status).toBe(404)
  })

  it("maps database outages to 503 and other errors to 500 without leaking details", async () => {
    s.throwOnGet = Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:3306 user=root"), { code: "ECONNREFUSED" })
    const res = await getRoute(req("/api/alt-text/assets/1"), ctx("1"))
    expect(res.status).toBe(503)
    expect(JSON.stringify(await res.json())).not.toContain("10.0.0.1")
    s.throwOnGet = new Error("SELECT * FROM alt_text_assets syntax")
    const res2 = await getRoute(req("/api/alt-text/assets/1"), ctx("1"))
    expect(res2.status).toBe(500)
    expect(JSON.stringify(await res2.json())).not.toContain("SELECT")
    expect(storeErrorToFailure({ code: "PROTOCOL_CONNECTION_LOST" }).status).toBe(503)
  })
})

describe("PATCH /api/alt-text/assets/[id]", () => {
  it("keeps an essential over-target equation whole and saves explicit Hindi language for review",async()=>{
    const value="समीकरण α² + β² = γ²; ".repeat(12),res=await patch("1",{expectedVersion:1,shortAlt:value,outputLanguage:"hi"})
    const body=await res.json();expect(res.status).toBe(200)
    expect(body.asset.shortAlt).toBe(value.trim());expect(body.asset.language).toBe("hi")
    expect(body.asset.warnings.join(" ")).toContain("not a WCAG limit")
    expect(s.editCalls[0].audit.note).toContain("literal-source.v1")
  })
  it("rejects malformed Unicode and unsupported explicit language without saving",async()=>{
    expect(parseEditRequest({expectedVersion:1,shortAlt:"bad \ud800"})).toMatchObject({ok:false,code:"INVALID_UNICODE"})
    expect(parseEditRequest({expectedVersion:1,shortAlt:"value",outputLanguage:"fr"})).toMatchObject({ok:false,code:"UNSUPPORTED_LANGUAGE"})
    expect(s.editCalls).toHaveLength(0)
  })
  it("saves Short Alt Text and Detailed Description edits as a new version", async () => {
    const res = await patch("1", { expectedVersion: 1, shortAlt: "Edited alt", longDescription: "Edited long" })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.asset).toMatchObject({ shortAlt: "Edited alt", longDescription: "Edited long", currentVersion: 2 })
    expect(s.editCalls[0]).toMatchObject({ id: 1, actorId: 5, expected: 1, edit: { classification: "photograph", extractedText: "" } })
    const versions = await (await versionsRoute(req("/api/alt-text/assets/1/versions"), ctx("1"))).json()
    expect(versions.versions.map((v: any) => [v.version, v.changeType])).toEqual([[2, "edited"], [1, "generated"]])
    expect(versions.versions[1]).toMatchObject({ shortAlt: "AI alt", longDescription: "AI long" })
  })

  it("preserves Unicode and mathematical notation", async () => {
    const text = "∫₀¹ x² dx = ⅓ — हिन्दी αβγ √2 ≤ π"
    const res = await patch("1", { expectedVersion: 1, shortAlt: text })
    expect((await res.json()).asset.shortAlt).toBe(text)
    expect(cleanText("a\u0000b\r\nc ")).toBe("ab\nc")
  })

  it("allows empty alt for decorative images but not for informative or complex ones", async () => {
    expect((await patch("1", { expectedVersion: 1, shortAlt: "", classification: "decorative" })).status).toBe(200)
    expect(s.assets[0].shortAlt).toBe("")
    const blank = await patch("2", { expectedVersion: 1, shortAlt: "" })
    expect(blank.status).toBe(422)
    expect((await blank.json()).code).toBe("ALT_TEXT_REQUIRED")
    const noLong = await patch("2", { expectedVersion: 1, longDescription: "" })
    expect((await noLong.json()).code).toBe("DESCRIPTION_REQUIRED")
    expect((await patch("1", { expectedVersion: 1, shortAlt: "x".repeat(1001) })).status).toBe(422)
  })

  it("returns 409 on a stale expectedVersion or while generating", async () => {
    await patch("1", { expectedVersion: 1, shortAlt: "First" })
    const stale = await patch("1", { expectedVersion: 1, shortAlt: "Second" })
    expect(stale.status).toBe(409)
    expect((await stale.json()).code).toBe("VERSION_CONFLICT")
    expect(s.assets[0].shortAlt).toBe("First")
    s.assets[1].status = "processing"
    expect((await (await patch("2", { expectedVersion: 1, shortAlt: "x" })).json()).code).toBe("ASSET_BUSY")
  })

  it("rejects protected or unknown fields and requires expectedVersion", async () => {
    const res = await patch("1", { expectedVersion: 1, shortAlt: "x", tenantId: 10, storageKey: "k", creditsUsed: 0 })
    expect(res.status).toBe(400)
    expect(parseEditRequest({ shortAlt: "x" })).toMatchObject({ ok: false, code: "EXPECTED_VERSION_REQUIRED" })
    expect(parseEditRequest({ expectedVersion: 1 })).toMatchObject({ ok: false, code: "NO_CHANGES" })
    expect(s.editCalls).toHaveLength(0)
  })

  it("403 without update permission or out of update scope; 401 unauthenticated", async () => {
    s.scopes.update = "none"
    expect((await patch("1", { expectedVersion: 1, shortAlt: "x" })).status).toBe(403)
    s.scopes = { view: "all", update: "added" }
    expect((await patch("2", { expectedVersion: 1, shortAlt: "x" })).status).toBe(403)
    s.session = null
    expect((await patch("1", { expectedVersion: 1, shortAlt: "x" })).status).toBe(401)
    expect(s.editCalls).toHaveLength(0)
  })

  it("never modifies another tenant's asset", async () => {
    const res = await patch("3", { expectedVersion: 1, shortAlt: "hijack" })
    expect(res.status).toBe(404)
    expect(s.assets[2].shortAlt).toBe("AI alt")
    s.tenant = null
    expect((await patch("1", { expectedVersion: 1, shortAlt: "x" })).status).toBe(403)
  })
})

describe("GET /api/alt-text/assets/[id]/versions", () => {
  it("is tenant-isolated", async () => {
    s.versions.push({ assetId: 3, version: 1, action: "generated", actorId: 1, actorName: "x", createdAt: "2026-01-01T00:00:00.000Z" })
    expect((await versionsRoute(req("/api/alt-text/assets/3/versions"), ctx("3"))).status).toBe(404)
  })
})
