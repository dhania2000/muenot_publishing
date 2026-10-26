import {beforeEach,it,expect,vi} from "vitest"
const d=vi.hoisted(()=>({query:vi.fn()}))
vi.mock("@/lib/db",()=>({query:d.query}))
vi.mock("@/lib/tenant-scope",()=>({currentTenantId:()=>5}))
vi.mock("@/lib/alt-text/ocr-review-store",()=>({ensureOcrReviewSchema:async()=>{}}))
const {listOcrReviewQueue}=await import("@/lib/alt-text/ocr-review-queue")
beforeEach(()=>{vi.clearAllMocks();d.query.mockImplementation(async(sql:string,params:any[])=>{expect((sql.match(/\?/g)??[]).length).toBe(params.length);return sql.startsWith("SELECT COUNT")?[{n:0}]:[]})})
it("binds all tenant and owner scopes independently across image, math and page sources",async()=>{
 await listOcrReviewQueue({userId:7,viewScope:"both"},2,25)
 const [sql,params]=d.query.mock.calls[1];expect(sql).toContain("a.created_by=? OR a.reviewer_id=?");expect(sql).toContain("d.uploaded_by=?");expect(sql).toContain("d.security_scan_status='clean'");expect(sql).toContain("review_state NOT IN ('verified','rejected')")
 expect(params).toEqual([5,5,7,7,5,7,7,5,7,25,25])
})
it("allows explicitly selected manual review without manufacturing scores",async()=>{
 d.query.mockImplementation(async(sql:string)=>sql.startsWith("SELECT COUNT")?[{n:1}]:[{source_kind:"math_ocr",source_id:"8",asset_id:1,occurrence_id:null,document_id:null,page_index:null,label:"Equation",status:"candidate",confidence:null,at_time:"2026-10-26T00:00:00Z"}])
 const result=await listOcrReviewQueue({userId:7,viewScope:"all"},1,25,true)
 expect(result.items[0].confidence).toBeNull();expect(result.items[0].reason).toBe("Equation verification required")
 expect(d.query.mock.calls[1][1]).toEqual([5,5,5,5,25,0])
})
