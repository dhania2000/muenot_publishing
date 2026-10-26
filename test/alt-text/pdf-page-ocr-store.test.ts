import {beforeEach,describe,it,expect,vi} from "vitest"
const d=vi.hoisted(()=>({query:vi.fn(),conn:vi.fn(),enqueue:vi.fn()}))
vi.mock("@/lib/db",()=>({query:d.query,withTransaction:async(fn:any)=>fn({query:d.conn})}))
vi.mock("@/lib/tenant-scope",()=>({currentTenantId:()=>5}))
vi.mock("@/lib/alt-text/store",()=>({ensureAltTextSchema:async()=>{}}))
vi.mock("@/lib/background-jobs",()=>({ensureBackgroundJobSchema:async()=>{},enqueueBackgroundJobInTransaction:d.enqueue}))
const store=await import("@/lib/alt-text/pdf-page-ocr-store")
const context=await import("@/lib/alt-text/pdf-page-ocr-context")
beforeEach(()=>{vi.clearAllMocks();d.query.mockResolvedValue([]);d.conn.mockResolvedValue([[{id:2}],[]]);d.enqueue.mockResolvedValue({jobId:10,created:true})})
describe("tenant page evidence persistence",()=>{
 it("fences stale worker writes and never deletes the previous result on a failed attempt",async()=>{
  d.query.mockResolvedValue({affectedRows:0})
  await expect(store.writePageState({id:10,tenant_id:5,worker_id:"stale"} as any,0,"failed",{errorCode:"timeout"})).rejects.toThrow("OCR_LEASE_LOST")
  const [sql,params]=d.query.mock.calls.at(-1)!
  expect(sql).toContain("j.worker_id=?");expect(sql).toContain("lease_expires_at>UTC_TIMESTAMP()")
  expect(params).toContain("stale");expect(params).toContain(null)
 })
 it("coalesces a second submission while a job is active",async()=>{
  d.conn.mockImplementation(async(sql:string)=>[sql.includes("SELECT id,status,payload")?[{id:10,status:"running",payload:{request:{action:"inspect"}}}]:[{id:2}],[]])
  expect(await store.enqueuePageOcr(2,7,{action:"inspect"})).toEqual({jobId:10,created:false})
  expect(d.enqueue).not.toHaveBeenCalled()
 })
 it("rejects a different request while another scope is active",async()=>{
  d.conn.mockImplementation(async(sql:string)=>[sql.includes("SELECT id,status,payload")?[{id:10,status:"running",payload:{request:{action:"recognize"}}}]:[{id:2}],[]])
  await expect(store.enqueuePageOcr(2,7,{action:"inspect"})).rejects.toThrow("PAGE_OCR_JOB_ACTIVE")
  expect(d.enqueue).not.toHaveBeenCalled()
 })
 it("preserves Unicode and the original native layer when mapping rows",()=>{
  const page=store.mapPageRow({page_index:0,source_sha256:"source",status:"completed",attempts:1,job_id:10,error_code:null,updated_at:"2026-10-26T00:00:00Z",evidence_json:JSON.stringify({nativeText:"मूल पाठ"}),result_json:JSON.stringify({rawText:"प्रकाश ऊर्जा है।",normalizedText:"प्रकाश ऊर्जा है।"})})
  expect(page.nativeText).toBe("मूल पाठ");expect(page.result?.rawText).toBe("प्रकाश ऊर्जा है।")
 })
 it("does not count unselected unsupported pages as finished OCR scope",async()=>{
  d.query.mockResolvedValue([{status:"unsupported",page_class:"unsupported",in_scope:0,n:5},{status:"queued",page_class:"scanned",in_scope:1,n:10}])
  const p=await store.pageOcrSummary(2);expect(p.total).toBe(15);expect(p.progress.inScope).toBe(10);expect(p.progress.scopePercent).toBe(0)
 })
 it("adds bounded OCR context only from the same tenant and source page",async()=>{
  d.query.mockResolvedValue([{evidence_json:{evidence:{textChars:0}},text:"प्रकाश ऊर्जा है।",language:"hin",warnings:[],identity:"hash"}])
  const ev=await context.addPageOcrEvidence(2,3,{location:{page:3}})
  expect(ev.nearby?.[0].source.kind).toBe("ocr_page_text");expect(ev.nearby?.[0].source.ref).toContain("pdf:p3")
  expect(d.query.mock.calls.at(-1)?.[1]).toEqual([5,2,2])
 })
 it("keeps native text instead of duplicating it with OCR context",async()=>{
  d.query.mockResolvedValue([{evidence_json:{evidence:{textChars:100}},text:"uncertain OCR",language:"eng",warnings:[],identity:"hash"}])
  const original={nearby:[]};expect(await context.addPageOcrEvidence(2,1,original)).toBe(original)
 })
})
