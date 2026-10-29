import { beforeEach, describe, expect, it, vi } from "vitest"
const s = vi.hoisted(() => ({ approved: true, claimed: true, calls: [] as { sql: string; params: any[] }[], version: 3, publicRow:null as any }))
vi.mock("@/lib/tenant-scope", () => ({ currentTenantId: () => 9 }))
vi.mock("@/lib/db", () => ({ query: vi.fn(async (sql:string) => (sql.startsWith("SELECT version,action")||sql.startsWith("SELECT v.*"))&&s.publicRow?[s.publicRow]:[]), withTransaction: async (fn: any) => fn({ query: async (sql: string, params: any[]) => {
  s.calls.push({ sql, params })
  if (sql.startsWith("SELECT current_version, approved_at")) return [s.claimed ? [{ current_version: 3, approved_at: s.approved ? new Date() : null }] : []]
  if (sql.startsWith("SELECT COALESCE(MAX(version)")) return [[{ next_version: 7 }]]
  if (sql.startsWith("SELECT current_version")) return [[{ current_version: 7 }]]
  return [{ affectedRows: 1 }]
} }) }))
import { saveGeneration,getSavedGeneration,listVersions } from "@/lib/alt-text/store"
import type { AltTextResult } from "@/lib/alt-text/core"
const output: AltTextResult = { classification: "chart", shortAlt: "नया विवरण", longDescription: "Reviewed printed labels", extractedText: "१२", warnings: ["Review required"], treatment: "Adjacent description", generationEvidence: { schemaVersion: 1, requestId: "alttext:a1_test", strategy: "chart", sourceSha256: "a".repeat(64), occurrenceId: 2, regionAnalysisId: "rga_12345678", evidence: [{ id: "evidence:20",version: 2,kind: "chart_data",state: "candidate" }], outputLanguage: "hi", provider: "openai", generatedAt: "2026-10-28T00:00:00Z", guidelineVersion: null, reviewStatus: "needs_review", warnings: ["Review required"], treatment: "Adjacent description" } }
beforeEach(() => { s.approved = true; s.claimed = true; s.calls = [];s.publicRow=null;delete output.documentContextSnapshot;delete output.generationEvidence!.clientGuideline })
describe("approved content preservation in existing version history", () => {
 it("pins the selected client in active work while keeping approved work's binding unchanged for candidates",async()=>{
   output.generationEvidence!.clientGuideline={id:"client_D",clientName:"Client D",version:"3",rules:[{type:"require_long"}]}
   await saveGeneration(1,output,"model",4,2,true,5)
   expect(s.calls.filter(c=>c.sql.startsWith("UPDATE")).every(c=>!c.sql.includes("settings_override"))).toBe(true)
   expect(JSON.parse(s.calls.find(c=>c.sql.startsWith("INSERT"))!.params.at(-1)).clientGuideline).toMatchObject({id:"client_D",version:"3"})
   s.calls=[];s.approved=false
   await saveGeneration(1,output,"model",4,2,true,5)
   const update=s.calls.find(c=>c.sql.startsWith("UPDATE"))!
   expect(update.sql).toContain("'$.clientGuidelineId',?,'$.clientGuidelineVersion',?")
   expect(update.params).toContain("client_D")
   expect(update.sql.match(/\?/g)?.length).toBe(update.params.length)
 })
 it("stores private context evidence but redacts it from asset-only replay and history",async()=>{
   output.documentContextSnapshot={snippets:[{text:"DO_NOT_EXPOSE_DOCUMENT_TEXT"}]} as any
   await saveGeneration(1,output,"model",4,2,true,5)
   const insert=s.calls.find(c=>c.sql.startsWith("INSERT"))!,audit=insert.params.at(-1)
   expect(audit).toContain("DO_NOT_EXPOSE_DOCUMENT_TEXT")
   s.publicRow={version:7,action:"generated_candidate",generation_evidence_json:audit,created_at:new Date(),classification:"chart",short_alt:"Candidate"}
   expect(JSON.stringify(await getSavedGeneration(1,"alttext:a1_test"))).not.toContain("DO_NOT_EXPOSE_DOCUMENT_TEXT")
   expect(JSON.stringify(await listVersions(1))).not.toContain("DO_NOT_EXPOSE_DOCUMENT_TEXT")
   expect((await getSavedGeneration(1,"alttext:a1_test"))?.result.generationEvidence?.evidence[0].id).toBe("evidence:20")
 })
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
