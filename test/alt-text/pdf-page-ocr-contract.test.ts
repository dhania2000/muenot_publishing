import {describe,it,expect} from "vitest"
import {canSelectPage,parsePageOcrRequest} from "@/lib/alt-text/pdf-page-ocr-types"
import {derivePageOcrProgress,planRender,rasterBoxToNorm,rasterBoxToPdf} from "@/lib/alt-text/pdf-page-ocr-contract"
import {pageOcrIdentity} from "@/lib/alt-text/pdf-page-ocr-identity"
const request={action:"recognize",mode:"selected",pages:[0],languageMode:"eng",dpi:300,segmentation:"auto"} as const
describe("page OCR submission policy",()=>{
 it("requires explicit authorization for re-OCR, rejects paths and invalid resource settings",()=>{
  expect(parsePageOcrRequest({...request,mode:"reprocess"})).toBeNull()
  expect(parsePageOcrRequest({...request,mode:"reprocess",confirmReprocess:true})).not.toBeNull()
  for(const patch of [{dpi:Infinity},{dpi:800},{pages:[-1]},{pages:[500]},{languageMode:"auto"},{segmentation:"custom"},{path:"/private/pdf"},{tenantId:99}])expect(parsePageOcrRequest({...request,...patch})).toBeNull()
 })
 it("does not overwrite a native text layer or a successful OCR result in normal selection",()=>{
  const p={status:"needs_review" as const,nativeText:"native",result:null,classification:{pageClass:"mixed" as const,ocrRecommended:false,needsReview:true,reasons:[]}}
  expect(canSelectPage(p,{...request,pages:[0]})).toBe(false)
  expect(canSelectPage(p,{...request,mode:"reprocess",pages:[0]})).toBe(true)
  expect(canSelectPage({...p,nativeText:""},{...request,pages:[0]})).toBe(true)
 })
 it("keeps retries separate from completed pages",()=>{
  const p={status:"completed" as const,nativeText:"",result:{} as any,classification:{pageClass:"scanned" as const,ocrRecommended:true,needsReview:false,reasons:[]}}
  expect(canSelectPage(p,{...request,mode:"retry",pages:[]})).toBe(false)
  expect(canSelectPage({...p,status:"failed"},{...request,mode:"retry",pages:[]})).toBe(true)
 })
 it("keys reuse on source, page, language, model, render and segmentation",()=>{
  const input={documentId:2,sourceSha256:"a".repeat(64),pageIndex:0,languageMode:"eng" as const,engineVersion:"v1",modelSha256s:["x"],dpi:300,segmentation:"auto"}
  const identity=pageOcrIdentity(input)
  for(const p of [{pageIndex:1},{languageMode:"hin" as const},{dpi:200},{modelSha256s:["y"]},{sourceSha256:"b".repeat(64)},{segmentation:"single_block"}])expect(pageOcrIdentity({...input,...p})).not.toBe(identity)
 })
})
describe("limits, partial progress and coordinates",()=>{
 it("counts failed and unsupported pages without claiming full success",()=>{
  const p=derivePageOcrProgress(200,[...Array(185).fill("completed"),...Array(10).fill("failed"),...Array(5).fill("unsupported")])
  expect(p.outcome).toBe("partial");expect(p.completed).toBe(185);expect(p.failed).toBe(10);expect(p.unsupported).toBe(5)
  expect(derivePageOcrProgress(100,[...Array(10).fill("completed"),...Array(90).fill("queued")]).scopePercent).toBe(10)
 })
 it("enforces pixel limits and rejects invalid coordinate values",()=>{
  expect(planRender(14000,14000).ok).toBe(false);expect(planRender(612,792,{targetDpi:NaN}).ok).toBe(true)
  expect(rasterBoxToNorm({left:NaN,top:0,width:1,height:1},100,100)).toBeNull()
  expect(rasterBoxToNorm({left:99,top:0,width:5,height:1},100,100)).toBeNull()
  expect(rasterBoxToPdf({left:0,top:0,width:1,height:1},[0,0,0,0,0,0])).toBeNull()
 })
})
