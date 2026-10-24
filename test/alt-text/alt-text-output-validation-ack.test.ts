import { describe, expect, it } from "vitest"
import { parseAcknowledgeRequest } from "@/lib/alt-text/output-validation-contract"

const runId = "0f8fad5b-d9cb-469f-a165-70867728950e"

describe("parseAcknowledgeRequest", () => {
  it("accepts a valid request and trims the note", () => {
    expect(parseAcknowledgeRequest({ runId, checkId: "alt.visual:12", note: "  looks right  " })).toEqual({ ok: true, request: { runId, checkId: "alt.visual:12", note: "looks right" } })
  })

  it("treats an empty note as null", () => {
    expect(parseAcknowledgeRequest({ runId, checkId: "c1", note: "   " })).toEqual({ ok: true, request: { runId, checkId: "c1", note: null } })
  })

  it.each([
    [null],
    [[]],
    [{ runId: "nope", checkId: "c1" }],
    [{ runId, checkId: "a\"].b" }],
    [{ runId, checkId: "" }],
    [{ runId, checkId: "c1", note: 5 }],
    [{ runId, checkId: "c1", extra: true }],
    [{ runId, checkId: "c1", note: "x".repeat(501) }],
  ])("rejects %j", (body) => {
    expect(parseAcknowledgeRequest(body).ok).toBe(false)
  })
})
