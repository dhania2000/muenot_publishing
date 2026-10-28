import {beforeEach,describe,it,expect,vi} from "vitest"
import {createHash} from "node:crypto"
const s=vi.hoisted(()=>({rows:[] as any[],doc:null as any,file:null as any,occ:null as any,settings:{} as any,queries:[] as any[],scopes:[] as any[],pageRow:null as any}))
vi.mock("@/lib/db",()=>({query:async(sql:string,args:any[])=>{s.queries.push(args);if(sql.includes("FROM alt_text_document_page_ocr"))return s.pageRow?[s.pageRow]:[];return sql.includes("FROM alt_text_document_images i")?s.rows.filter(r=>args[2]==null||r.id===args[2]):[]}}))
vi.mock("@/lib/tenant-scope",()=>({currentTenantId:()=>5}))
vi.mock("@/lib/alt-text/store",()=>({ensureAltTextSchema:async()=>{},getSettingsRecord:async()=>({accessibility:s.settings})}))
vi.mock("@/lib/alt-text/document-store",()=>({getDocumentImage:async()=>s.occ}))
vi.mock("@/lib/alt-text/document-service",()=>({getDocumentForExtraction:async(id:number,scope:any)=>{s.scopes.push([id,scope]);return s.doc},ownerScopeFor:(a:any)=>a.viewScope==="all"?null:{uploadedBy:a.userId}}))
vi.mock("@/lib/alt-text/batch-submission",()=>({}))
vi.mock("@/lib/alt-text/document-image-review-store",()=>({getSelectionSnapshot:vi.fn()}))
vi.mock("@/lib/storage/file-metadata",()=>({getFileById:async()=>s.file}))
import {buildDocumentImageContext} from "@/lib/alt-text/document-context"
import {resolveDocumentPromptContext} from "@/lib/alt-text/document-generation"
const sha="a".repeat(64),revision=createHash("sha256").update(JSON.stringify([11,1,sha])).digest("hex"),actor={userId:7,viewScope:"added" as const}
beforeEach(()=>{
 s.queries=[];s.scopes=[];s.settings={};s.pageRow=null
 s.doc={id:30,securityStatus:"clean",fileObjectId:11,storageReferenceId:"file11",size:100}
 s.file={id:11,fileRef:"file11",uploadStatus:"completed",isCurrent:true,size:100,checksum:sha,version:1,objectKey:"t/5/source.pdf"}
 s.occ={id:2,altTextAssetId:1,sourceLocator:"pdf:p1:o1",mediaSha256:"c".repeat(64)}
 const ctx=buildDocumentImageContext({documentId:30,imageOccurrenceId:2,documentType:"pdf",sourceBinding:{sourceSha256:sha,sourceRevision:revision,sourceLocator:s.occ.sourceLocator,imageSha256:s.occ.mediaSha256},evidence:{captions:[{text:"Figure 1: lens",method:"pdf_struct_caption_child",source:{kind:"pdf_struct",ref:"figure:1"},provenance:"explicit",captionSource:"accessible_structure",sharedWith:1}]}})
 s.rows=[{id:2,document_id:30,alt_text_asset_id:1,page_number:1,slide_number:null,occurrence_index:0,is_decorative:0,extraction_status:"extracted",context_json:ctx,context_version:1,context_status:"analyzed",document_type:"pdf",security_scan_status:"clean"}]
})
describe("authorized context resolution before generation",()=>{
 it("invalidates saved page OCR context when its recognized run changes",async()=>{
   s.rows[0].context_json.pageOcr={identity:"ocr1",runId:3,pageNumber:1,sourceSha256:sha,languageMode:"hin",lines:[{text:"प्रकाश",ref:"line:1"}]}
   s.pageRow={source_sha256:sha,result_json:{identity:"ocr1",runId:3}}
   let r=await resolveDocumentPromptContext(1,actor,2)
   expect(r).toMatchObject({kind:"document",document:{stale:false}})
   s.pageRow.result_json.runId=4
   r=await resolveDocumentPromptContext(1,actor,2)
   expect(r).toMatchObject({kind:"document",document:{stale:true,context:null,packet:null}})
 })
 it("rechecks ownership and binds tenant, asset, occurrence, source revision and image hash",async()=>{
  const r=await resolveDocumentPromptContext(1,actor,2)
  expect(r.kind).toBe("document")
  if(r.kind!=="document")return
  expect(r.document.packet?.snippets[0].text).toBe("Figure 1: lens")
  expect(r.document.packet?.source.sourceSha256).toBe(sha)
  expect(s.scopes).toEqual([[30,{uploadedBy:7}]])
  expect(s.queries[0]).toEqual([5,1,2,2])
 })
 it("rejects inaccessible documents without returning their context",async()=>{s.doc=null;expect(await resolveDocumentPromptContext(1,actor,2)).toMatchObject({kind:"ineligible",code:"NOT_FOUND"})})
 it("uses the refreshed scan verdict rather than the stale joined status",async()=>{s.doc.securityStatus="quarantined";expect(await resolveDocumentPromptContext(1,actor,2)).toMatchObject({kind:"ineligible",code:"DOCUMENT_NOT_CLEAN"})})
 it("refuses ambiguous occurrence lookup and never selects the first match",async()=>{s.rows.push({...s.rows[0],id:3});expect(await resolveDocumentPromptContext(1,actor)).toMatchObject({kind:"ineligible",code:"AMBIGUOUS_OCCURRENCE"});expect(s.scopes).toEqual([])})
 it("does not treat an unknown explicit occurrence as a standalone image",async()=>{expect(await resolveDocumentPromptContext(1,actor,999)).toMatchObject({kind:"ineligible",code:"NOT_FOUND"})})
 it.each(["hash","revision","locator","image","legacy","status","version","document","occurrence"])("omits stale %s snapshots without starting analysis",async fault=>{
  const row=s.rows[0]
  if(fault==="hash")s.file.checksum="b".repeat(64)
  if(fault==="revision")s.file.version=2
  if(fault==="locator")s.occ.sourceLocator="pdf:p2:o2"
  if(fault==="image")s.occ.mediaSha256="d".repeat(64)
  if(fault==="legacy")delete row.context_json.sourceBinding
  if(fault==="status")row.context_status="failed"
  if(fault==="version")row.context_version=0
  if(fault==="document")row.context_json.documentId=31
  if(fault==="occurrence")row.context_json.imageOccurrenceId=3
  const r=await resolveDocumentPromptContext(1,actor,2)
  expect(r).toMatchObject({kind:"document",document:{context:null,packet:null,stale:true}})
 })
 it("rejects a file from another tenant even when its document mirror appears clean",async()=>{s.file.objectKey="t/6/source.pdf";expect(await resolveDocumentPromptContext(1,actor,2)).toMatchObject({kind:"ineligible",code:"DOCUMENT_SOURCE_CHANGED"})})
 it("honors context opt-out without sending the underlying source text",async()=>{s.settings={descriptions:{useDocumentContext:false}};const r=await resolveDocumentPromptContext(1,actor,2);expect(r).toMatchObject({kind:"document",document:{context:null,packet:null}})})
})
