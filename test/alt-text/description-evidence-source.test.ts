import { beforeEach, describe, expect, it, vi } from "vitest"
import { createHash } from "node:crypto"
const s = vi.hoisted(() => ({ asset: null as any, analysis: null as any, ocr: [] as any[], rows: [] as any[], belongs: true, chart: null as any, queryArgs: [] as any[] }))
vi.mock("@/lib/db", () => ({ query: vi.fn(async (sql, args) => { s.queryArgs.push(args); return s.rows }) }))
vi.mock("@/lib/tenant-scope", () => ({ currentTenantId: () => 9 }))
vi.mock("@/lib/alt-text/store", () => ({ getAsset: async () => s.asset, getLatestRegionAnalysis: async () => s.analysis, listOcrResults: async () => s.ocr, getOccurrenceClassification: async () => ({ manual: null }), occurrenceBelongsToAsset: async () => s.belongs }))
vi.mock("@/lib/alt-text/region-service", () => ({ toAnalysisView: (r: any) => r }))
vi.mock("@/lib/alt-text/ocr-service", () => ({ toOcrView: (r: any) => r }))
vi.mock("@/lib/alt-text/image-header", () => ({ readImageHeader: () => ({ width: 100, height: 100, orientation: 1, orientationUnknown: false }) }))
vi.mock("@/lib/alt-text/math-store", () => ({ ensureEvidenceSchema: async () => {} }))
vi.mock("@/lib/alt-text/chart-data-review", () => ({ reviewedChartData: async () => s.chart }))
import { loadDescriptionEvidence } from "@/lib/alt-text/description-evidence-source"
const actor = { userId: 1, viewScope: "all" as const, updateScope: "all" as const }, bytes = new Uint8Array([1,2,3]), sha = createHash("sha256").update(bytes).digest("hex")
const source = () => ({ analysisId: "rga_12345678", analysisVersion: 2, sourceSha256: sha })
const row = (id: number, kind: string, value: any, region = "rgn_12345678") => ({ id, kind, version: 1, status: kind === "math_recognition" ? "candidate" : "completed", region_id: region, input_json: {}, result_json: { assetId: 1, occurrenceId: null, source: source(), ...value } })
beforeEach(() => {
 s.asset = { id: 1, createdBy: 1, reviewerId: null, mimeType: "image/png", classification: "math_equation" }
 s.analysis = { analysisId: "rga_12345678", version: 2, source: { storedWidth: 100, storedHeight: 100, orientation: 1, orientationUnknown: false }, regions: [{ id: "rgn_12345678", primaryType: "equation_region", parentId: null, box: { x: 0,y: 0,width: 1,height: 1 } }], relationships: [] }
 s.ocr = []; s.rows = []; s.belongs = true; s.queryArgs = []
})
describe("read-only description evidence loading", () => {
 it.each(["flowchart", "table", "map", "mixed"])("keeps %s structure and unknown/order flags in its existing strategy", async type => {
   s.asset.classification = type === "mixed" ? "mixed_complex_image" : type
   s.rows = [row(1,"illustration_structure",{ contentType: type,output: { nodes: [],edges: [],table: null,map: null,groups: [],proposedOrderIds: [] },elements: [] })]
   const v = await loadDescriptionEvidence(1,null,bytes,actor)
   expect(v.strategy).toBe(type)
   expect(v.items.find(i => i.kind === "illustration_structure")?.payload).toMatchObject({ contentType: type,structureVerified: false,readingOrderVerified: false })
 })
 it("keeps a simple photo on the standard path without reading advanced evidence", async () => {
   s.asset.classification = "photograph"
   expect(await loadDescriptionEvidence(1,null,bytes,actor)).toMatchObject({ strategy: "standard",items: [],warnings: [] })
   expect(s.queryArgs).toEqual([])
 })
 it("does not use evidence types excluded by tenant preferences", async () => {
   s.rows = [row(1,"math_recognition",{ candidateLatex: "x=1",rawOutput: "x=1" })]
   const v = await loadDescriptionEvidence(1,null,bytes,actor,["ocr","ocr_review","regions"])
   expect(v.strategy).toBe("fallback")
   expect(v.items.some(i => i.kind === "math")).toBe(false)
 })
 it("binds every query to tenant, asset and exact occurrence", async () => {
   await loadDescriptionEvidence(1, 23, bytes, actor)
   expect(s.queryArgs).toEqual([[9,1,23]])
 })
 it.each(["view", "update", "occurrence"])("denies %s scope before evidence reads", async condition => {
   const a = { ...actor }; if (condition === "view") a.viewScope = undefined as any; if (condition === "update") a.updateScope = undefined as any; if (condition === "occurrence") s.belongs = false
   await expect(loadDescriptionEvidence(1, 23, bytes, a)).rejects.toThrow("FORBIDDEN")
   expect(s.queryArgs).toEqual([])
 })
 it("preserves literal math and syntax status separately from scientific validity", async () => {
   s.rows = [row(1,"math_recognition",{ candidateLatex: "x_1² = α", rawOutput: "raw" }), { id: 2, kind: "math_validation", version: 1, status: "valid", region_id: "rgn_12345678", input_json: {}, result_json: { sourceEvidenceId: 1, originalCandidate: "x_1² = α", syntaxStatus: "valid" } }]
   const v = await loadDescriptionEvidence(1,null,bytes,actor)
   expect(v.items.find(i => i.kind === "math")?.payload).toMatchObject({ latex: "x_1² = α", syntaxStatus: "valid", scientificAccuracyVerified: false, validationId: 2 })
 })
 it.each(["checksum", "analysis", "version", "occurrence", "region"])("omits stale or foreign %s evidence", async condition => {
   const r = row(1,"math_recognition",{ candidateLatex: "x=1", rawOutput: "x=1" })
   if (condition === "checksum") r.result_json.source.sourceSha256 = "wrong"
   if (condition === "analysis") r.result_json.source.analysisId = "old"
   if (condition === "version") r.result_json.source.analysisVersion = 1
   if (condition === "occurrence") r.result_json.occurrenceId = 23
   if (condition === "region") r.region_id = "foreign"
   s.rows = [r]
   expect((await loadDescriptionEvidence(1,null,bytes,actor)).items.some(i => i.kind === "math")).toBe(false)
 })
 it("applies only an exact raw-source correction and retains rejected states", async () => {
   const raw = row(1,"math_recognition",{ candidateLatex: "x=1", rawOutput: "raw" })
   const review = { id: 2, kind: "ocr_review", version: 2, status: "verified", region_id: "review_hash", input_json: { sourceRef: "math:1", target: { assetId: 1, occurrenceId: null } }, result_json: { originalText: "raw", correctedText: "x=2", state: "verified", validation: { syntaxStatus: "valid" } } }
   s.rows = [review,raw]
   let v = await loadDescriptionEvidence(1,null,bytes,actor)
   expect(v.items.find(i => i.kind === "ocr_review")).toMatchObject({ state: "transcription_verified", payload: { sourceRef: "math:1", correctedText: "x=2", scientificAccuracyVerified: false } })
   review.result_json.originalText = "another source"
   expect((await loadDescriptionEvidence(1,null,bytes,actor)).items.some(i => i.kind === "ocr_review")).toBe(false)
   review.result_json.originalText = "raw"; review.result_json.state = "rejected"
   v = await loadDescriptionEvidence(1,null,bytes,actor)
   expect(v.items.find(i => i.kind === "ocr_review")?.payload).toMatchObject({ reviewState: "rejected", correctedText: null })
 })
 it("does not leak saved document context or domain inferences into generation", async () => {
   const parent = row(1,"scientific_structure",{ elements: [], relationships: [], labelAssociations: [] })
   const domain = row(2,"scientific_domain",{ parentStructureEvidenceId: 1,parentStructureVersion: 1, detectedSubjects: ["biology"], support: { context: "SECRET_OTHER_DOCUMENT" }, observations: [{ basis: "domain_inference", kind: "invented identity" }, { basis: "direct_visual_candidate", kind: "visible_label_candidate", sourceLabels: [{ text: "OLD_REVIEW" }] }] })
   s.rows = [domain,parent]; s.asset.classification = "scientific_diagram"
   const v = await loadDescriptionEvidence(1,null,bytes,actor), text = JSON.stringify(v)
   expect(text).not.toContain("SECRET_OTHER_DOCUMENT"); expect(text).not.toContain("OLD_REVIEW"); expect(text).not.toContain("invented identity")
   expect(text).toContain("visible_label_candidate")
 })
 it("uses only currently confirmed printed chart values, never numeric candidates", async () => {
   s.asset.classification = "chart"; s.rows = [row(3,"chart_data",{})]
   s.chart = { sourceCurrent: true, result: { points: [{ id: "yes", classification: "label_exact", reviewState: "confirmed_label", value: 12 }, { id: "no", classification: "unknown", reviewState: "needs_review", value: null, candidateValue: 999 }], trends: [], warnings: [] } }
   let v = await loadDescriptionEvidence(1,null,bytes,actor)
   expect(JSON.stringify(v)).toContain('"value":12'); expect(JSON.stringify(v)).not.toContain("999")
   s.chart.sourceCurrent = false
   v = await loadDescriptionEvidence(1,null,bytes,actor)
   expect(v.items.some(i => i.kind === "chart_data")).toBe(false)
 })
})
