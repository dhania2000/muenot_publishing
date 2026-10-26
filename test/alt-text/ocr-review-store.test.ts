import {beforeEach,describe,it,expect,vi} from "vitest"
const d=vi.hoisted(()=>({query:vi.fn(),conn:vi.fn(),unchanged:vi.fn()}))
vi.mock("@/lib/db",()=>({query:d.query,withTransaction:async(fn:any)=>fn({query:d.conn})}))
vi.mock("@/lib/tenant-scope",()=>({currentTenantId:()=>5}))
vi.mock("@/lib/alt-text/math-store",()=>({ensureEvidenceSchema:async()=>{}}))
vi.mock("@/lib/alt-text/pdf-page-ocr-store",()=>({ensurePageOcrSchema:async()=>{}}))
vi.mock("@/lib/alt-text/ocr-review-source",()=>({assertReviewSourceUnchanged:d.unchanged,OcrReviewError:class extends Error{constructor(public status:number,public code:string,message:string){super(message)}}}))
const store=await import("@/lib/alt-text/ocr-review-store")
const source={target:{kind:"image_ocr",sourceId:"ocr_123",assetId:1,occurrenceId:2,documentId:null,pageIndex:null},sourceRef:"image:ocr_123",rawText:"raw मूल",analysisId:"ocr_123",sourceVersion:1,regionId:null,canEdit:true,canVerify:true} as any
const input={target:source.target,expectedVersion:0,requestId:"request_123",text:"सही क्षेत्र",state:"corrected",comment:"Checked"} as any
beforeEach(()=>{vi.clearAllMocks();d.query.mockResolvedValue([]);d.unchanged.mockResolvedValue(undefined);d.conn.mockImplementation(async(sql:string)=>{
 if(sql.includes("FROM alt_text_assets")&&sql.startsWith("SELECT"))return [[{id:1,current_version:4}]]
 if(sql.startsWith("INSERT INTO alt_text_accessibility_evidence"))return [{insertId:10}]
 return [[]]
})})
describe("immutable correction versions and audit",()=>{
 it("saves original and corrected Unicode separately and audits without changing Alt Text approval",async()=>{
  const result=await store.saveOcrReview(source,input,7)
  expect(result.record).toMatchObject({version:1,originalText:"raw मूल",correctedText:"सही क्षेत्र",editorId:7,altTextApproved:false})
  expect(d.conn.mock.calls[0][0]).toContain("FOR UPDATE");expect(d.conn.mock.calls[0][1]).toEqual([5,1])
  expect(d.conn.mock.calls.some(([sql])=>sql.startsWith("UPDATE")||sql.startsWith("DELETE"))).toBe(false)
  expect(d.conn.mock.calls.some(([sql])=>sql.startsWith("INSERT INTO alt_text_versions"))).toBe(true)
 })
 it("rejects a stale reviewer version before inserting a correction or audit",async()=>{
  d.conn.mockImplementation(async(sql:string)=>[sql.includes("SELECT version")?[{version:2}]:sql.includes("FROM alt_text_assets")?[{id:1}]:[]])
  await expect(store.saveOcrReview(source,input,7)).rejects.toMatchObject({status:409,code:"VERSION_CONFLICT"})
  expect(d.conn.mock.calls.some(([sql])=>sql.startsWith("INSERT"))).toBe(false)
 })
 it("does not save when reprocessing changed the source at the transaction boundary",async()=>{d.unchanged.mockRejectedValue(new Error("SOURCE_CHANGED"));await expect(store.saveOcrReview(source,input,7)).rejects.toThrow("SOURCE_CHANGED");expect(d.conn.mock.calls.some(([sql])=>sql.startsWith("INSERT"))).toBe(false)})
 it("requires reviewer permission separately from edit permission",async()=>{await expect(store.saveOcrReview({...source,canVerify:false},{...input,state:"verified"},7)).rejects.toMatchObject({status:403});expect(d.conn).not.toHaveBeenCalled()})
 it("refuses human verification of malformed equation syntax",async()=>{await expect(store.saveOcrReview({...source,target:{...source.target,kind:"math_ocr",sourceId:"8"}},{...input,state:"verified",text:String.raw`\frac{a}{`},7)).rejects.toMatchObject({code:"EQUATION_INVALID"})})
 it("keeps page review attached to its document without creating an image asset",async()=>{
  d.conn.mockImplementation(async(sql:string)=>sql.includes("SELECT id FROM alt_text_documents")?[[{id:3}]]:sql.startsWith("INSERT INTO alt_text_accessibility_evidence")?[{insertId:11}]:[[]])
  await store.saveOcrReview({...source,target:{kind:"page_ocr",assetId:null,occurrenceId:null,documentId:3,pageIndex:0,sourceId:"hash"},sourceRef:"page:3:0:hash:5",sourceSnapshot:{runId:5}},input,7)
  expect(d.conn.mock.calls[0][1]).toEqual([5,3]);expect(d.conn.mock.calls.some(([sql])=>sql.includes("INSERT INTO platform_background_job_events"))).toBe(true)
 })
})
