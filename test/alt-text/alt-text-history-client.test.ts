import { afterEach, describe, expect, it, vi } from "vitest"
import { AltTextApiError, altTextFetcher, historyListUrl, isAltTextAssetKey, isVersionConflict } from "@/lib/alt-text/client"

describe("historyListUrl", () => {
  it("includes paging and sort, omitting empty filters", () => {
    const url = new URL(historyListUrl({ page: 2, pageSize: 25, sort: "oldest", search: "   " }), "http://x")
    expect(url.pathname).toBe("/api/alt-text/assets")
    expect(Object.fromEntries(url.searchParams)).toEqual({ page: "2", pageSize: "25", sort: "oldest" })
  })

  it("trims and encodes search plus status/classification filters", () => {
    const url = new URL(historyListUrl({ page: 1, pageSize: 10, sort: "newest", search: "  fig 1&2.png ", status: "approved", classification: "chart" }), "http://x")
    expect(url.searchParams.get("search")).toBe("fig 1&2.png")
    expect(url.searchParams.get("status")).toBe("approved")
    expect(url.searchParams.get("classification")).toBe("chart")
  })

  it("caps search length at the backend limit", () => {
    const url = new URL(historyListUrl({ page: 1, pageSize: 10, sort: "newest", search: "a".repeat(500) }), "http://x")
    expect(url.searchParams.get("search")).toHaveLength(200)
  })
})

describe("cache keys and conflicts", () => {
  it("matches only Alt Text asset keys", () => {
    expect(isAltTextAssetKey("/api/alt-text/assets?page=1")).toBe(true)
    expect(isAltTextAssetKey("/api/alt-text/assets/4/versions")).toBe(true)
    expect(isAltTextAssetKey("/api/alt-text/export?id=4")).toBe(false)
    expect(isAltTextAssetKey(["/api/alt-text/assets"])).toBe(false)
  })

  it("detects version conflicts only for 409 VERSION_CONFLICT", () => {
    expect(isVersionConflict({ status: 409, code: "VERSION_CONFLICT", message: "" })).toBe(true)
    expect(isVersionConflict({ status: 409, code: "OTHER", message: "" })).toBe(false)
    expect(isVersionConflict({ status: 400, code: "VERSION_CONFLICT", message: "" })).toBe(false)
  })
})

describe("altTextFetcher", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("returns JSON data on success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true, items: [], total: 0 }), { status: 200, headers: { "Content-Type": "application/json" } })))
    await expect(altTextFetcher("/api/alt-text/assets")).resolves.toMatchObject({ total: 0 })
  })

  it("throws AltTextApiError with the mapped status on failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: false, code: "FORBIDDEN", error: "No access" }), { status: 403, headers: { "Content-Type": "application/json" } })))
    const err = await altTextFetcher("/api/alt-text/assets").catch((e) => e)
    expect(err).toBeInstanceOf(AltTextApiError)
    expect(err.apiError.status).toBe(403)
  })
})
