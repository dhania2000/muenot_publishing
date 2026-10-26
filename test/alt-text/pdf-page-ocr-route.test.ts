import {beforeEach,describe,it,expect,vi} from "vitest"
const d=vi.hoisted(()=>({auth:vi.fn(),view:vi.fn(),action:vi.fn(),doc:vi.fn(),enqueue:vi.fn(),pages:vi.fn(),summary:vi.fn(),latest:vi.fn(),policy:vi.fn(),cancel:vi.fn(),rate:vi.fn(),after:vi.fn(),run:vi.fn(),render:vi.fn(),original:vi.fn()}))
vi.mock("next/server",async(orig)=>({...await orig<typeof import("next/server")>(),after:d.after}))
vi.mock("@/lib/api-auth",()=>({requireFeatureInModule:d.auth}))
vi.mock("@/lib/permission-store",()=>({getScope:d.view,getActionScope:d.action}))
vi.mock("@/lib/tenant-scope",()=>({currentTenantId:()=>5,currentTenantIdOrNull:()=>5}))
vi.mock("@/lib/background-jobs",()=>({requestBackgroundJobCancel:d.cancel,runDueBackgroundJobs:d.run}))
vi.mock("@/lib/rate-limit",()=>({checkRateLimit:d.rate}))
vi.mock("@/lib/alt-text/document-service",()=>({getDocumentForExtraction:d.doc,ownerScopeFor:(a:any)=>a.viewScope==="all"?null:{uploadedBy:a.userId}}))
vi.mock("@/lib/alt-text/pdf-page-ocr-store",()=>({enqueuePageOcr:d.enqueue,readOcrPages:d.pages,pageOcrSummary:d.summary,latestPageOcrJob:d.latest}))
vi.mock("@/lib/alt-text/pdf-page-ocr-policy",()=>({getPageOcrPolicy:d.policy}))
vi.mock("@/lib/alt-text/pdf-page-renderer",()=>({openPdfForRender:d.render}))
vi.mock("@/lib/alt-text/document-extraction-run",async(orig)=>({...await orig<typeof import("@/lib/alt-text/document-extraction-run")>(),readVerifiedOriginal:d.original}))
const route=await import("@/app/api/alt-text/documents/[uploadId]/page-ocr/route")
const preview=await import("@/app/api/alt-text/documents/[uploadId]/page-ocr/preview/route")
const ctx=(id="2")=>({params:Promise.resolve({uploadId:id})})
const request={action:"recognize",mode:"selected",pages:[0],languageMode:"eng",dpi:300,segmentation:"auto"}
const req=(body:unknown=request)=>new Request("http://localhost/page-ocr",{method:"POST",body:JSON.stringify(body)})
beforeEach(()=>{
 vi.clearAllMocks();d.auth.mockResolvedValue({ok:true,session:{userId:7,role:"employee"}});d.view.mockResolvedValue("own");d.action.mockResolvedValue("own")
 d.doc.mockResolvedValue({id:2,uploadedBy:7,documentType:"pdf",securityStatus:"clean"});d.rate.mockResolvedValue({allowed:true})
 d.pages.mockResolvedValue([]);d.summary.mockResolvedValue({total:0,progress:{}});d.latest.mockResolvedValue(null)
 d.policy.mockResolvedValue({enabled:true,modes:[{id:"eng",available:true}],defaultMode:"eng",reason:null})
 d.enqueue.mockResolvedValue({jobId:10,created:true});d.cancel.mockResolvedValue("cancel_requested")
})
describe("page OCR permission and resource boundaries",()=>{
 it("denies unauthenticated and unauthorized processing",async()=>{
  d.auth.mockResolvedValueOnce({ok:false,status:401,error:"Unauthorized"});expect((await route.POST(req(),ctx())).status).toBe(401)
  d.action.mockResolvedValueOnce("none");expect((await route.POST(req(),ctx())).status).toBe(403);expect(d.enqueue).not.toHaveBeenCalled()
 })
 it("does not disclose a PDF outside the caller's tenant/owner scope",async()=>{
  d.doc.mockResolvedValue(null);expect((await route.GET(new Request("http://localhost/x"),ctx())).status).toBe(404)
  expect(d.doc).toHaveBeenCalledWith(2,{uploadedBy:7});expect(d.pages).not.toHaveBeenCalled()
 })
 it("enforces upload-own even when view scope is all",async()=>{
  d.view.mockResolvedValue("all");d.doc.mockImplementation(async(_id,scope)=>scope?.uploadedBy===7?null:{id:2,uploadedBy:8,documentType:"pdf",securityStatus:"clean"})
  expect((await route.POST(req(),ctx())).status).toBe(404);expect(d.enqueue).not.toHaveBeenCalled()
 })
 it("never inspects, renders or runs OCR on saved History/status reads",async()=>{
  const response=await route.GET(new Request("http://localhost/x?offset=0"),ctx())
  expect(response.status).toBe(200);expect((await response.json()).success).toBe(true)
  expect(d.enqueue).not.toHaveBeenCalled();expect(d.render).not.toHaveBeenCalled();expect(d.run).not.toHaveBeenCalled()
 })
 it("denies quarantined input before enqueue and preview",async()=>{
  d.doc.mockResolvedValue({id:2,documentType:"pdf",securityStatus:"quarantined"})
  expect((await route.POST(req(),ctx())).status).toBe(409)
  expect((await preview.GET(new Request("http://localhost/x?pageIndex=0"),ctx())).status).toBe(404)
  expect(d.render).not.toHaveBeenCalled();expect(d.enqueue).not.toHaveBeenCalled()
 })
 it("rejects invalid pages, unsupported language, oversized bodies and unauthorized reprocessing",async()=>{
  for(const body of [{...request,pages:[500]},{...request,languageMode:"math"},{...request,mode:"reprocess"},{data:"x".repeat(13000)}])expect((await route.POST(req(body),ctx())).status).toBe(400)
  expect(d.enqueue).not.toHaveBeenCalled()
 })
 it("rejects an unavailable selected model without an English fallback",async()=>{
  d.policy.mockResolvedValue({enabled:true,modes:[{id:"eng",available:false}]});expect((await route.POST(req(),ctx())).status).toBe(409);expect(d.enqueue).not.toHaveBeenCalled()
 })
 it("persists work before scheduling the shared worker",async()=>{
  const r=await route.POST(req(),ctx());expect(r.status).toBe(202);expect(d.enqueue).toHaveBeenCalledWith(2,7,request);expect(d.after).toHaveBeenCalledTimes(1)
 })
 it("does not start another worker for a replayed active job",async()=>{
  d.enqueue.mockResolvedValue({jobId:10,created:false});await route.POST(req(),ctx());expect(d.after).not.toHaveBeenCalled()
 })
 it("reports a changed selection rather than silently OCRing a different page",async()=>{
  d.enqueue.mockRejectedValue(new Error("PAGE_SELECTION_CHANGED"));expect((await route.POST(req(),ctx())).status).toBe(409)
 })
 it("uses tenant-owned durable cancellation",async()=>{
  d.latest.mockResolvedValue({id:10,status:"running"});await route.DELETE(req(),ctx());expect(d.cancel).toHaveBeenCalledWith(10,5)
 })
 it("enforces request and preview rate limits",async()=>{
  d.rate.mockResolvedValue({allowed:false});expect((await route.POST(req(),ctx())).status).toBe(429)
  d.pages.mockResolvedValue([{pageIndex:0}]);expect((await preview.GET(new Request("http://localhost/x?pageIndex=0"),ctx())).status).toBe(429);expect(d.render).not.toHaveBeenCalled()
 })
})
