import "server-only"
import {currentTenantId} from "@/lib/tenant-scope"
import {getAsset,occurrenceBelongsToAsset,listOcrResults} from "./store"
import {withinScope,type HistoryActor} from "./history"
import {getDocument} from "./document-store"
import {ownerScopeFor} from "./document-service"
import {readOcrPages} from "./pdf-page-ocr-store"
import {listMathEvidence} from "./math-store"
import {toOcrView} from "./ocr-service"
import type {OcrReviewSource,OcrReviewTarget} from "./ocr-review-contract"
export class OcrReviewError extends Error{constructor(readonly status:number,readonly code:string,message:string){super(message)}}
const missing=()=>new OcrReviewError(404,"NOT_FOUND","Recognition evidence not found.")
export async function resolveOcrReviewSource(target:OcrReviewTarget,actor:HistoryActor,canVerify=false):Promise<OcrReviewSource>{
 const common={target,canVerify,confidenceScale:"not_reported" as const,confidence:null,warnings:[] as string[]}
 if(target.kind==="page_ocr"){
  const doc=await getDocument(target.documentId!,ownerScopeFor(actor))
  if(!doc||doc.securityStatus!=="clean")throw missing()
  const [page]=await readOcrPages(doc.id,0,1,target.pageIndex!)
  if(!page)throw missing()
  if(!page.result){
   if(!["failed","cancelled"].includes(page.status)||target.sourceId!==`failure_${page.jobId??0}`)throw missing()
   return {...common,sourceRef:`page:${doc.id}:${target.pageIndex}:failure:${page.jobId??0}:${page.updatedAt}`,rawText:"",analysisId:`page_failure:${page.jobId??0}`,sourceVersion:page.jobId??0,regionId:null,warnings:["No recognized text is available. Review the source or request reprocessing."],sourceSnapshot:page,previewUrl:`/api/alt-text/documents/${doc.id}/page-ocr/preview?pageIndex=${target.pageIndex}`,canEdit:!!actor.updateScope&&actor.updateScope!=="none"&&(actor.updateScope==="all"||doc.uploadedBy===actor.userId)}
  }
  if(page.result.identity!==target.sourceId)throw missing()
  const result=page.result
  return {...common,sourceRef:`page:${doc.id}:${target.pageIndex}:${result.identity}:${result.runId}`,rawText:result.rawText,analysisId:`page:${result.runId}`,sourceVersion:result.runId,regionId:null,warnings:result.warnings,confidence:result.meanConfidence,confidenceScale:"tesseract_0_100",sourceSnapshot:result,previewUrl:`/api/alt-text/documents/${doc.id}/page-ocr/preview?pageIndex=${target.pageIndex}`,canEdit:!!actor.updateScope&&actor.updateScope!=="none"&&(actor.updateScope==="all"||doc.uploadedBy===actor.userId)}
 }
 const asset=await getAsset(target.assetId!)
 if(!asset||!withinScope(actor.viewScope,actor.userId,asset)||target.occurrenceId!=null&&!(await occurrenceBelongsToAsset(asset.id,target.occurrenceId)))throw missing()
 const canEdit=withinScope(actor.updateScope,actor.userId,asset),previewUrl=`/api/alt-text/assets/${asset.id}/image`
 if(target.kind==="math_ocr"){
  const row=(await listMathEvidence(asset.id,target.occurrenceId)).find((r)=>String(r.id)===target.sourceId)
  if(!row)throw missing()
  if(!row.result){
   if(!["failed","cancelled"].includes(row.status))throw missing()
   return {...common,canEdit,sourceRef:`math:${row.id}`,rawText:"",analysisId:`math_failure:${row.id}`,sourceVersion:row.version,regionId:row.regionId,warnings:["No recognized equation is available. Review the source or request reprocessing."],sourceSnapshot:{failedEvidenceId:row.id,status:row.status,errorCode:row.errorCode},previewUrl}
  }
  return {...common,canEdit,sourceRef:`math:${row.id}`,rawText:row.result.rawOutput,analysisId:row.result.analysisId,sourceVersion:row.version,regionId:row.regionId,warnings:row.result.warnings,sourceSnapshot:row.result,previewUrl}
 }
 const row=(await listOcrResults(asset.id,target.occurrenceId)).find((r)=>r.resultId===target.sourceId),result=row?toOcrView(row):null
 if(!result)throw missing()
 return {...common,canEdit,sourceRef:`image:${result.resultId}`,rawText:result.rawText,analysisId:result.resultId,sourceVersion:result.version,regionId:result.region?.regionId??null,warnings:result.warnings,confidence:result.meanConfidence,confidenceScale:"tesseract_0_100",sourceSnapshot:result,previewUrl}
}
/** Called inside the source parent's transaction lock, before appending a review version. */
export async function assertReviewSourceUnchanged(conn:{query:Function},source:OcrReviewSource){
 const t=source.target,tenant=currentTenantId()
 const [rows]=t.kind==="page_ocr"?await conn.query("SELECT result_json,status,job_id,updated_at FROM alt_text_document_page_ocr WHERE tenant_id=? AND document_id=? AND page_index=? FOR UPDATE",[tenant,t.documentId,t.pageIndex]):t.kind==="math_ocr"?await conn.query("SELECT result_json,status FROM alt_text_accessibility_evidence WHERE tenant_id=? AND asset_id=? AND occurrence_key=? AND id=? AND kind='math_recognition' FOR UPDATE",[tenant,t.assetId,t.occurrenceId??0,Number(t.sourceId)]):await conn.query("SELECT result_json FROM alt_text_ocr_results WHERE tenant_id=? AND asset_id=? AND occurrence_key=? AND result_id=? FOR UPDATE",[tenant,t.assetId,t.occurrenceId??0,t.sourceId])
 const r=rows[0]?.result_json,raw=typeof r==="string"?JSON.parse(r):r
 if(!raw&&rows[0]&&["failed","cancelled"].includes(rows[0].status)){
  const old=source.sourceSnapshot as {status?:string;jobId?:number;updatedAt?:string}
  if(old.status===rows[0].status&&(t.kind!=="page_ocr"||old.jobId===(rows[0].job_id==null?null:Number(rows[0].job_id))&&old.updatedAt===new Date(rows[0].updated_at).toISOString()))return
 }
 if(!raw||((t.kind==="page_ocr"&&(raw.identity!==t.sourceId||raw.runId!==source.sourceVersion))||(t.kind==="math_ocr"?raw.rawOutput:raw.rawText)!==source.rawText))throw new OcrReviewError(409,"SOURCE_CHANGED","Recognition changed. Refresh before saving a correction.")
}

