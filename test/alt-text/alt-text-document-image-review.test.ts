import { describe, expect, it } from "vitest"
import { SELECTION_BATCH_MAX, contextState, imageListSearchParams, parseImageListQuery, parseImageMutation } from "@/lib/alt-text/document-image-review"

const q = (s: string) => parseImageListQuery(new URLSearchParams(s))

describe("parseImageListQuery", () => {
  it("applies defaults", () => {
    expect(q("")).toEqual({ ok: true, query: { page: 1, pageSize: 24, sort: "document" } })
  })

  it("treats 'all' as no filter and keeps known filters", () => {
    const r = q("extraction=all&alt=missing&context=ready&selection=selected&sort=location&search=%20logo%20")
    expect(r).toEqual({ ok: true, query: { page: 1, pageSize: 24, sort: "location", alt: "missing", context: "ready", selection: "selected", search: "logo" } })
  })

  it("rejects unknown filters, bad pagination, long search and malformed hashes", () => {
    expect(q("extraction=bogus").ok).toBe(false)
    expect(q("sort=random").ok).toBe(false)
    expect(q("page=0").ok).toBe(false)
    expect(q("pageSize=49").ok).toBe(false)
    expect(q("pageSize=-1").ok).toBe(false)
    expect(q(`search=${"a".repeat(101)}`).ok).toBe(false)
    expect(q("mediaSha256=xyz").ok).toBe(false)
  })

  it("accepts a valid sha256 for duplicate inspection", () => {
    const sha = "a".repeat(64)
    expect(q(`mediaSha256=${sha}`)).toMatchObject({ ok: true, query: { mediaSha256: sha } })
  })

  it("round-trips through imageListSearchParams", () => {
    const sp = imageListSearchParams({ page: 3, pageSize: 12, sort: "newest", search: " chart ", alt: "has" })
    expect(q(sp.toString())).toEqual({ ok: true, query: { page: 3, pageSize: 12, sort: "newest", search: "chart", alt: "has" } })
  })
})

describe("parseImageMutation", () => {
  it("accepts document-wide actions without ids", () => {
    expect(parseImageMutation({ action: "select_all_eligible" })).toEqual({ ok: true, request: { action: "select_all_eligible" } })
    expect(parseImageMutation({ action: "clear_selection" })).toEqual({ ok: true, request: { action: "clear_selection" } })
  })

  it("dedupes ids and validates their shape and count", () => {
    expect(parseImageMutation({ action: "select", imageIds: [3, 3, 4] })).toEqual({ ok: true, request: { action: "select", imageIds: [3, 4] } })
    expect(parseImageMutation({ action: "select", imageIds: [] }).ok).toBe(false)
    expect(parseImageMutation({ action: "select", imageIds: [0] }).ok).toBe(false)
    expect(parseImageMutation({ action: "select", imageIds: ["1"] }).ok).toBe(false)
    expect(parseImageMutation({ action: "deselect", imageIds: Array.from({ length: SELECTION_BATCH_MAX + 1 }, (_, i) => i + 1) }).ok).toBe(false)
  })

  it("requires a valid review status for set_review", () => {
    expect(parseImageMutation({ action: "set_review", imageIds: [1], reviewStatus: "reviewed" }).ok).toBe(true)
    expect(parseImageMutation({ action: "set_review", imageIds: [1], reviewStatus: "approved" }).ok).toBe(false)
  })

  it("rejects unknown actions and non-object bodies, including generation attempts", () => {
    expect(parseImageMutation({ action: "generate", imageIds: [1] }).ok).toBe(false)
    expect(parseImageMutation(null).ok).toBe(false)
    expect(parseImageMutation([]).ok).toBe(false)
  })
})

describe("contextState", () => {
  it("maps persisted context status/confidence to review states", () => {
    expect(contextState(null, null)).toBe("not_analyzed")
    expect(contextState("failed", null)).toBe("needs_review")
    expect(contextState("unavailable", null)).toBe("unavailable")
    expect(contextState("analyzed", "low")).toBe("needs_review")
    expect(contextState("analyzed", "high")).toBe("ready")
    expect(contextState("analyzed", "medium")).toBe("ready")
  })
})
