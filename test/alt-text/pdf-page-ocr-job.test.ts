import {beforeEach,describe,it,expect,vi} from "vitest"
import type {BackgroundJob} from "@/lib/background-jobs"
const d=vi.hoisted(()=>({cancel:vi.fn(),query:vi.fn(),doc:vi.fn(),original:vi.fn(),inspect:vi.fn(),recognize:vi.fn(),next:vi.fn(),pending:vi.fn(),save:vi.fn(),write:vi.fn(),policy:vi.fn()}))
vi.mock("@/lib/background-jobs",()=>({isBackgroundJobCancelRequested:d.cancel}))
vi.mock("@/lib/db",()=>({query:d.query}))
vi.mock("@/lib/alt-text/document-service",()=>({getDocumentForExtraction:d.doc}))
vi.mock("@/lib/alt-text/document-extraction-run",()=>({readVerifiedOriginal:d.original}))
vi.mock("@/lib/alt-text/pdf-page-ocr-pipeline",()=>({inspectPdfPages:d.inspect,recognizePdfPage:d.recognize,executionIdentity:()=>"identical"}))
vi.mock("@/lib/alt-text/pdf-page-ocr-store",()=>({confirmedTextImages:async()=>new Set(),pageOcrJobOutcome:async()=>({completedScope:true,outcome:"completed"}),ensurePageOcrSchema:async()=>{},nextOcrPage:d.next,hasPendingOcr:d.pending,saveInspectedPages:d.save,writePageState:d.write}))
vi.mock("@/lib/alt-text/pdf-page-ocr-policy",()=>({getPageOcrPolicy:d.policy}))
const {runPdfPageOcrJob}=await import("@/lib/alt-text/pdf-page-ocr-job")
const {PageRenderError}=await import("@/lib/alt-text/pdf-page-renderer")
const {currentTenantId}=await import("@/lib/tenant-scope")
const job={id:11,tenant_id:5,worker_id:"worker-a"} as BackgroundJob
const payload={documentId:2,request:{action:"recognize",mode:"selected",pages:[0],languageMode:"eng",dpi:300,segmentation:"auto"}} as const
const run=()=>runPdfPageOcrJob({...payload,request:{...payload.request,pages:[0]}},{job,signal:new AbortController().signal})
beforeEach(()=>{
 vi.clearAllMocks();d.cancel.mockResolvedValue(false);d.query.mockResolvedValue([{id:11}]);d.doc.mockResolvedValue({id:2,documentType:"pdf",securityStatus:"clean"});d.original.mockResolvedValue({ok:true,bytes:new Uint8Array([1])})
 d.policy.mockResolvedValue({enabled:true,modes:[{id:"eng",available:true}]});d.next.mockResolvedValue(null);d.pending.mockResolvedValue(false);d.write.mockResolvedValue(undefined)
 d.recognize.mockImplementation(async()=>{expect(currentTenantId()).toBe(5);return {status:"completed",rawText:"text"}})
})
describe("durable page OCR checkpoints",()=>{
 it("does no OCR when an inspected job only classifies pages",async()=>{
  d.inspect.mockResolvedValue([{pageIndex:0}]);await runPdfPageOcrJob({documentId:2,request:{action:"inspect"}},{job,signal:new AbortController().signal})
  expect(d.save).toHaveBeenCalledWith(2,[{pageIndex:0}],job);expect(d.recognize).not.toHaveBeenCalled()
 })
 it("resumes an interrupted recognizing page and saves it before moving on",async()=>{
  d.next.mockResolvedValueOnce({page:{pageIndex:0,status:"recognizing"},runAttempts:1})
  await run();expect(d.write).toHaveBeenNthCalledWith(1,job,0,"rendering",{attempt:true});expect(d.write).toHaveBeenLastCalledWith(job,0,"completed",{result:{status:"completed",rawText:"text"}})
 })
 it("does not rerun a compatible successful result on duplicate delivery",async()=>{
  d.next.mockResolvedValueOnce({page:{pageIndex:0,result:{identity:"identical",status:"completed",runId:11}},runAttempts:0});await run();expect(d.recognize).not.toHaveBeenCalled()
 })
 it("cancels before reading or recognizing and preserves saved results",async()=>{
  d.cancel.mockResolvedValue(true);await expect(run()).rejects.toMatchObject({code:"PAGE_OCR_CANCELLED"});expect(d.original).not.toHaveBeenCalled();expect(d.write).not.toHaveBeenCalled()
 })
 it("rejects stale worker ownership before opening the private PDF",async()=>{
  d.query.mockResolvedValue([]);await expect(run()).rejects.toThrow("OCR_LEASE_LOST");expect(d.original).not.toHaveBeenCalled()
 })
 it("backs off a render failure without replacing an earlier result",async()=>{
  d.next.mockResolvedValueOnce({page:{pageIndex:3,result:{identity:"old",status:"completed"}},runAttempts:0});d.recognize.mockRejectedValue(new PageRenderError("RENDER_TIMEOUT","timeout"));d.pending.mockResolvedValue(true)
  await expect(run()).rejects.toMatchObject({code:"PAGE_OCR_BACKOFF"});expect(d.write).toHaveBeenLastCalledWith(job,3,"queued",{errorCode:"RENDER_TIMEOUT",retrySeconds:30})
 })
 it("exhausts page attempts separately and continues to the next page",async()=>{
  d.next.mockResolvedValueOnce({page:{pageIndex:0},runAttempts:3}).mockResolvedValueOnce({page:{pageIndex:1},runAttempts:0});await run();expect(d.write).toHaveBeenCalledWith(job,0,"failed",{errorCode:"PAGE_ATTEMPTS_EXHAUSTED"});expect(d.write).toHaveBeenCalledWith(job,1,"completed",expect.anything())
 })
 it("does not claim success when persistence fails after real work",async()=>{
  d.next.mockResolvedValueOnce({page:{pageIndex:0},runAttempts:0});d.write.mockResolvedValueOnce(undefined).mockRejectedValueOnce(Object.assign(new Error("database unavailable"),{code:"ECONNRESET"}))
  await expect(run()).rejects.toMatchObject({status:503});expect(d.write).toHaveBeenCalledTimes(2)
 })
 it("rejects quarantined documents and newly disabled OCR policy",async()=>{
  d.doc.mockResolvedValueOnce({id:2,documentType:"pdf",securityStatus:"quarantined"});await expect(run()).rejects.toThrow("DOCUMENT_NOT_CLEAN");expect(d.original).not.toHaveBeenCalled()
  d.policy.mockResolvedValue({enabled:false,modes:[]});await expect(run()).rejects.toThrow("OCR_POLICY_UNAVAILABLE");expect(d.recognize).not.toHaveBeenCalled()
 })
 it("bounds each delivery to ten pages and defers the remaining scope",async()=>{
  d.next.mockResolvedValue({page:{pageIndex:0},runAttempts:0});d.pending.mockResolvedValue(true);await expect(run()).rejects.toMatchObject({code:"PAGE_OCR_CONTINUE"});expect(d.recognize).toHaveBeenCalledTimes(10)
 })
})
