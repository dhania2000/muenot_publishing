import "server-only"
import {createHash,randomBytes} from "node:crypto"
import {query,withTransaction} from "@/lib/db"
import {currentTenantId} from "@/lib/tenant-scope"
import {ensureEvidenceSchema} from "./math-store"
import {ensurePageOcrSchema} from "./pdf-page-ocr-store"
import {assertReviewSourceUnchanged,OcrReviewError} from "./ocr-review-source"
import {validateEquation} from "./math-validation"
import type {OcrReviewInput,OcrReviewSource,OcrReviewVersion} from "./ocr-review-contract"
const hash=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex")
export const reviewRegionKey=(sourceRef:string)=>`rev_${createHash("sha256").update(sourceRef).digest("hex").slice(0,40)}`
const parsed=(v:any)=>typeof v==="string"?JSON.parse(v):v
let schema:Promise<void>|null=null
export function ensureOcrReviewSchema(){
 schema??=(async()=>{await ensureEvidenceSchema();await ensurePageOcrSchema();
  // A page review references its existing document in input_json, with no fabricated image asset.
  const columns=await query<any[]>("SELECT IS_NULLABLE AS nullable FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='alt_text_accessibility_evidence' AND COLUMN_NAME='asset_id'")
  if(columns[0]?.nullable==="NO")await query("ALTER TABLE alt_text_accessibility_evidence MODIFY asset_id BIGINT UNSIGNED NULL")
 })().catch((e)=>{schema=null;throw e});return schema
}
function view(row:any):OcrReviewVersion{return {id:Number(row.id),version:Number(row.version),...parsed(row.result_json)}}
export async function readOcrReviews(source:OcrReviewSource){
 await ensureOcrReviewSchema()
 const rows=await query<any[]>(`SELECT id,version,result_json FROM alt_text_accessibility_evidence WHERE tenant_id=? AND kind='ocr_review' AND region_id=? ORDER BY version DESC LIMIT 50`,[currentTenantId(),reviewRegionKey(source.sourceRef)])
 return rows.map(view)
}
/** Retain earlier model/run corrections in the same source location after reprocessing. Their
 * sourceRef remains explicit; they never become corrections for a new recognition automatically. */
export async function readEarlierOcrReviews(source:OcrReviewSource){
 await ensureOcrReviewSchema()
 const t=source.target
 const rows=await query<any[]>(`SELECT id,version,result_json FROM alt_text_accessibility_evidence WHERE tenant_id=? AND kind='ocr_review'
   AND asset_id <=> ? AND occurrence_key=? AND JSON_UNQUOTE(JSON_EXTRACT(input_json,'$.target.kind'))=?
   AND JSON_EXTRACT(input_json,'$.target.documentId') <=> CAST(? AS JSON)
   AND JSON_EXTRACT(input_json,'$.target.pageIndex') <=> CAST(? AS JSON)
   AND JSON_EXTRACT(input_json,'$.regionId') <=> CAST(? AS JSON)
   AND region_id<>? ORDER BY id DESC LIMIT 25`,[currentTenantId(),t.assetId,t.occurrenceId??0,t.kind,JSON.stringify(t.documentId),JSON.stringify(t.pageIndex),JSON.stringify(source.regionId),reviewRegionKey(source.sourceRef)])
 return rows.map(view)
}
export async function saveOcrReview(source:OcrReviewSource,input:OcrReviewInput,actorId:number){
 await ensureOcrReviewSchema()
 if(!source.canEdit||input.state==="verified"&&!source.canVerify)throw new OcrReviewError(403,"FORBIDDEN","You do not have permission for this review action.")
 const validation=source.target.kind==="math_ocr"?validateEquation(input.text,Number(source.target.sourceId)):null
 if(input.state==="verified"&&validation?.syntaxStatus!=="valid"&&source.target.kind==="math_ocr")throw new OcrReviewError(422,"EQUATION_INVALID","Resolve equation syntax errors before marking it verified.")
 const tenantId=currentTenantId(),regionKey=reviewRegionKey(source.sourceRef),requestKey=hash(["ocr_review",source.sourceRef,input.requestId]),configKey=hash([input,actorId])
 return withTransaction(async(conn)=>{
  const [parent]=source.target.assetId!=null?await conn.query<any[]>("SELECT id,current_version FROM alt_text_assets WHERE tenant_id=? AND id=? FOR UPDATE",[tenantId,source.target.assetId]):await conn.query<any[]>("SELECT id FROM alt_text_documents WHERE tenant_id=? AND id=? FOR UPDATE",[tenantId,source.target.documentId])
  if(!parent[0])throw new OcrReviewError(404,"NOT_FOUND","The source no longer exists.")
  const [replay]=await conn.query<any[]>("SELECT * FROM alt_text_accessibility_evidence WHERE tenant_id=? AND kind='ocr_review' AND request_key=?",[tenantId,requestKey])
  if(replay[0]){if(replay[0].config_key!==configKey)throw new OcrReviewError(409,"REQUEST_CONFLICT","This save request was already used with different edits.");return {record:view(replay[0]),replayed:true}}
  await assertReviewSourceUnchanged(conn,source)
  const [prior]=await conn.query<any[]>("SELECT version FROM alt_text_accessibility_evidence WHERE tenant_id=? AND kind='ocr_review' AND region_id=? ORDER BY version DESC LIMIT 1",[tenantId,regionKey])
  if(Number(prior[0]?.version??0)!==input.expectedVersion)throw new OcrReviewError(409,"VERSION_CONFLICT","Another reviewer saved changes. Reload the latest version before saving yours.")
  const version=input.expectedVersion+1,createdAt=new Date().toISOString()
  if(validation&&input.state==="verified"){
   validation.humanVerified=true;validation.sourceMatchVerified=true
   validation.reviewReference={reviewerId:actorId,reviewVersion:version,sourceRef:source.sourceRef,verifiedAt:createdAt}
  }
  const result:Omit<OcrReviewVersion,"id"|"version">={state:input.state,originalText:source.rawText,correctedText:input.text,comment:input.comment,editorId:actorId,createdAt,sourceRef:source.sourceRef,validation,sourceDesignation:"human_corrected_ocr",altTextApproved:false}
  const [inserted]=await conn.query<any>(`INSERT INTO alt_text_accessibility_evidence (tenant_id,asset_id,occurrence_key,region_id,kind,version,analysis_id,request_key,config_key,status,input_json,result_json,created_by) VALUES (?,?,?,?,'ocr_review',?,?,?,?,?,?,?,?)`,[tenantId,source.target.assetId,source.target.occurrenceId??0,regionKey,version,`review_${randomBytes(10).toString("hex")}`,requestKey,configKey,input.state,JSON.stringify(source),JSON.stringify(result),actorId])
  const id=Number(inserted.insertId)
  // Reuse existing asset version audit, without changing the content version or approval columns.
  if(source.target.assetId!=null)await conn.query(`INSERT INTO alt_text_versions (tenant_id,asset_id,version,action,classification,short_alt,long_description,extracted_text,note,model_id,actor_id)
    SELECT tenant_id,id,current_version,?,classification,short_alt,long_description,extracted_text,?,NULL,? FROM alt_text_assets WHERE tenant_id=? AND id=?`,["ocr_evidence_review",`OCR review evidence #${id}, version ${version}, state ${input.state}`,actorId,tenantId,source.target.assetId])
  else{
   const snapshot=source.sourceSnapshot as {runId?:number}
   if(snapshot.runId)await conn.query(`INSERT INTO platform_background_job_events (job_id,event_type,detail) SELECT id,'ocr_evidence_review',? FROM platform_background_jobs WHERE tenant_id=? AND id=?`,[JSON.stringify({evidenceId:id,version,state:input.state,editorId:actorId,documentId:source.target.documentId,pageIndex:source.target.pageIndex}),tenantId,snapshot.runId])
  }
  return {record:{id,version,...result},replayed:false}
 })
}
