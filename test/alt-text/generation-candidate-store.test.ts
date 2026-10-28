import { beforeEach, describe, expect, it, vi } from "vitest"
const s = vi.hoisted(() => ({ approved: true, claimed: true, calls: [] as { sql: string; params: any[] }[], version: 3 }))
vi.mock("@/lib/tenant-scope", () => ({ currentTenantId: () => 9 }))
vi.mock("@/lib/db", () => ({ query: vi.fn(async () => []), withTransaction: async (fn: any) => fn({ query: async (sql: string, params: any[]) => {
  s.calls.push({ sql, params })
  if (sql.startsWith("SELECT current_version, approved_at")) return [s.claimed ? [{ current_version: 3, approved_at: s.approved ? new Date() : null }] : []]
  if (sql.startsWith("SELECT COALESCE(MAX(version)")) return [[{ next_version: 7 }]]
  if (sql.startsWith("SELECT current_version")) return [[{ current_version: 7 }]]
  return [{ affectedRows: 1 }]
} }) }))
import { saveGeneration } from "@/lib/alt-text/store"
import type { AltTextResult } from "@/lib/alt-text/core"
const output: AltTextResult = { classification: "chart", shortAlt: "नया विवरण", longDescription: "Reviewed printed labels", extractedText: "१२", warnings: ["Review required"], treatment: "Adjacent description", generationEvidence: { schemaVersion: 1, requestId: "alttext:a1_test", strategy: "chart", sourceSha256: "a".repeat(64), occurrenceId: 2, regionAnalysisId: "rga_12345678", evidence: [{ id: "evidence:20",version: 2,kind: "chart_data",state: "candidate" }], outputLanguage: "hi", provider: "openai", generatedAt: "2026-10-28T00:00:00Z", guidelineVersion: null, reviewStatus: "needs_review", warnings: ["Review required"], treatment: "Adjacent description" } }
beforeEach(() => { s.approved = true; s.claimed = true; s.calls = [] })
describe("approved content preservation in existing version history", () => {
 it("saves a separate candidate without modifying approved content or active version", async () => {
   expect(await saveGeneration(1,output,"model",4,2,true,5)).toBe(true)
   const insert = s.calls.find(c => c.sql.includes("'generated_candidate'"))!
   expect(insert.params.slice(0,4)).toEqual([9,1,7,"chart"])
   expect(JSON.parse(insert.params.at(-1))).toMatchObject({ occurrenceId: 2, outputLanguage: "hi", reviewStatus: "needs_review", evidence: [{ id: "evidence:20",version: 2 }] })
   const updates = s.calls.filter(c => c.sql.startsWith("UPDATE"))
   expect(updates).toHaveLength(1)
   expect(updates[0].sql).not.toMatch(/short_alt|long_description|current_version|approved_at|reviewed_by/)
   expect(updates[0].params).toEqual([4,9,1])
   expect(insert.sql.match(/\?/g)?.length).toBe(insert.params.length)
 })
 it("does not save a superseded or foreign processing attempt", async () => {
   s.claimed = false
   expect(await saveGeneration(1,output,"model",4,2,true,5)).toBe(false)
   expect(s.calls).toHaveLength(1)
   expect(s.calls[0].params).toEqual([9,1,5])
   expect(s.calls[0].sql).toContain("FOR UPDATE")
 })
 it("allocates new active versions after candidate versions and saves provenance atomically", async () => {
   s.approved = false
   expect(await saveGeneration(1,output,"model",4,2,true,5)).toBe(true)
   const update = s.calls.find(c => c.sql.startsWith("UPDATE"))!, insert = s.calls.find(c => c.sql.startsWith("INSERT"))!
   expect(update.sql).toContain("MAX(v.version) + 1")
   expect(update.params[0]).toBe("in_review")
   expect(insert.params[2]).toBe(7)
   expect(insert.sql).toContain("generation_evidence_json")
   expect(insert.sql.match(/\?/g)?.length).toBe(insert.params.length)
 })
})
