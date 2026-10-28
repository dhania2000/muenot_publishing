import "server-only"
import {createHash} from "node:crypto"
import {query,withTransaction} from "@/lib/db"
import {currentTenantId} from "@/lib/tenant-scope"
import {ensureEvidenceSchema} from "./math-store"
import {AdvancedEvidenceError} from "./advanced-evidence-source"
import {loadStructuredReviewSource,reviewFingerprint} from "./structured-review-source"
import {validateStructuredCorrections,type StructuredReviewInput,type StructuredReviewKind,type StructuredReviewVersion} from "./structured-review-contract"
import {withinScope,type HistoryActor} from "./history"
import type {PermissionScope} from "@/lib/permission-model"
const parse=(v:any)=>typeof v==="string"?JSON.parse(v):v
const key=(kind:StructuredReviewKind,id:number)=>`srev_${createHash("sha256").update(`${kind}:${id}`).digest("hex").slice(0,40)}`
function view(row:any):StructuredReviewVersion{return {...parse(row.result_json),id:Number(row.id),version:Number(row.version)}}
export async function readStructuredReview(assetId:number,occurrenceId:number|null,kind:StructuredReviewKind,evidenceId:number,actor:HistoryActor,approveScope:PermissionScope="none"){
 const source=await loadStructuredReviewSource(assetId,occurrenceId,kind,evidenceId,actor)
 await ensureEvidenceSchema()
 const rows=await query<any[]>("SELECT id,version,result_json FROM alt_text_accessibility_evidence WHERE tenant_id=? AND asset_id=? AND occurrence_key=? AND kind='structured_review' AND region_id=? ORDER BY version DESC LIMIT 50",[currentTenantId(),assetId,occurrenceId??0,key(kind,evidenceId)])
 const {asset,...safe}=source
 return {success:true as const,...safe,canVerify:source.canEdit&&withinScope(approveScope,actor.userId,asset),history:rows.map(view)}
}
export async function saveStructuredReview(assetId:number,input:StructuredReviewInput,actor:HistoryActor,approveScope:PermissionScope="none"){
 const source=await loadStructuredReviewSource(assetId,input.occurrenceId,input.kind,input.evidenceId,actor)
 if(!withinScope(actor.updateScope,actor.userId,source.asset))throw new AdvancedEvidenceError(403,"FORBIDDEN","You cannot correct this evidence.")
 if(input.state==="verified"&&!withinScope(approveScope,actor.userId,source.asset))throw new AdvancedEvidenceError(403,"FORBIDDEN","Verification requires review permission for this image.")
 if(!source.sourceCurrent||source.sourceFingerprint!==input.sourceFingerprint)throw new AdvancedEvidenceError(409,"SOURCE_CHANGED","Source evidence changed. Reload before saving a correction.")
 const invalid=validateStructuredCorrections(input,source.targets)
 if(invalid)throw new AdvancedEvidenceError(422,"INVALID_CORRECTION",invalid)
 await ensureEvidenceSchema()
 const tenant=currentTenantId(),region=key(input.kind,input.evidenceId),request=reviewFingerprint([assetId,input.kind,input.evidenceId,input.requestId]),config=reviewFingerprint([actor.userId,input])
 return withTransaction(async conn=>{
  const [assets]=await conn.query<any[]>("SELECT id FROM alt_text_assets WHERE tenant_id=? AND id=? FOR UPDATE",[tenant,assetId])
  if(!assets.length)throw new AdvancedEvidenceError(404,"NOT_FOUND","The source image no longer exists.")
  const [replay]=await conn.query<any[]>("SELECT id,version,config_key,result_json FROM alt_text_accessibility_evidence WHERE tenant_id=? AND kind='structured_review' AND request_key=?",[tenant,request])
  if(replay[0]){if(replay[0].config_key!==config)throw new AdvancedEvidenceError(409,"REQUEST_CONFLICT","This save request was used for another edit.");return {record:view(replay[0]),replayed:true}}
  const current=await loadStructuredReviewSource(assetId,input.occurrenceId,input.kind,input.evidenceId,actor)
  if(!withinScope(actor.updateScope,actor.userId,current.asset)||input.state==="verified"&&!withinScope(approveScope,actor.userId,current.asset))throw new AdvancedEvidenceError(403,"FORBIDDEN","Your permission for this source changed before saving.")
  if(!current.sourceCurrent||current.sourceFingerprint!==input.sourceFingerprint)throw new AdvancedEvidenceError(409,"SOURCE_CHANGED","Source evidence changed before the correction could be saved.")
  const [prior]=await conn.query<any[]>("SELECT version FROM alt_text_accessibility_evidence WHERE tenant_id=? AND asset_id=? AND occurrence_key=? AND kind='structured_review' AND region_id=? ORDER BY version DESC LIMIT 1",[tenant,assetId,input.occurrenceId??0,region])
  if(Number(prior[0]?.version??0)!==input.expectedVersion)throw new AdvancedEvidenceError(409,"VERSION_CONFLICT","Another reviewer saved a newer version. Reload and compare before saving.")
  const version=input.expectedVersion+1,result:Omit<StructuredReviewVersion,"id"|"version">={state:input.state,comment:input.comment,corrections:input.corrections,reviewerId:actor.userId,createdAt:new Date().toISOString(),sourceFingerprint:input.sourceFingerprint,sourceEvidenceId:input.evidenceId,sourceVersion:source.sourceVersion,sourceKind:input.kind,sourceRegionId:source.sourceRegionId,scientificAccuracyVerified:false,descriptionApproved:false,numericValuesAreOriginalSourceExact:false}
  const [insert]=await conn.query<any>(`INSERT INTO alt_text_accessibility_evidence (tenant_id,asset_id,occurrence_key,region_id,kind,version,analysis_id,request_key,config_key,status,input_json,result_json,created_by) VALUES (?,?,?,?,'structured_review',?,?,?,?,?,?,?,?)`,[tenant,assetId,input.occurrenceId??0,region,version,`srev_${request.slice(0,30)}`,request,config,input.state,JSON.stringify({kind:input.kind,evidenceId:input.evidenceId,sourceVersion:source.sourceVersion,sourceFingerprint:input.sourceFingerprint}),JSON.stringify(result),actor.userId])
  await conn.query(`INSERT INTO alt_text_versions (tenant_id,asset_id,version,action,classification,short_alt,long_description,extracted_text,note,model_id,actor_id) SELECT tenant_id,id,current_version,'evidence_review',classification,short_alt,long_description,extracted_text,?,NULL,? FROM alt_text_assets WHERE tenant_id=? AND id=?`,[`Evidence ${input.kind} #${input.evidenceId}; review #${insert.insertId}, v${version}, ${input.state}. Description approval unchanged.`,actor.userId,tenant,assetId])
  return {record:{...result,id:Number(insert.insertId),version},replayed:false}
 })
}
export async function structuredEvidenceAvailability(assetId:number,occurrenceId:number|null,actor:HistoryActor){
 const {authorizeAdvancedAsset}=await import("./advanced-evidence-source")
 await authorizeAdvancedAsset(assetId,occurrenceId,actor)
 const document=await (await import("./document-generation")).resolveDocumentPromptContext(assetId,actor,occurrenceId)
 if(document.kind==="ineligible")throw new AdvancedEvidenceError(404,"NOT_FOUND","The source document is not available.")
 await ensureEvidenceSchema()
 const rows=await query<any[]>(`SELECT id,kind,version,region_id,created_at FROM alt_text_accessibility_evidence WHERE tenant_id=? AND asset_id=? AND occurrence_key=? AND kind IN ('scientific_structure','illustration_structure','chart_axes','chart_data') AND status='completed' ORDER BY id DESC LIMIT 100`,[currentTenantId(),assetId,occurrenceId??0])
 const [ocr,math]=await Promise.all([query<any[]>(`SELECT result_id FROM alt_text_ocr_results WHERE tenant_id=? AND asset_id=? AND occurrence_key=? ORDER BY id DESC LIMIT 25`,[currentTenantId(),assetId,occurrenceId??0]),query<any[]>(`SELECT id FROM alt_text_accessibility_evidence WHERE tenant_id=? AND asset_id=? AND occurrence_key=? AND kind='math_recognition' AND status NOT IN ('queued','recognizing') ORDER BY id DESC LIMIT 25`,[currentTenantId(),assetId,occurrenceId??0])])
 return {items:rows.map(r=>({id:Number(r.id),kind:r.kind as StructuredReviewKind,version:Number(r.version),regionId:String(r.region_id),createdAt:new Date(r.created_at).toISOString()})),recognition:[...ocr.map(r=>({kind:"image_ocr" as const,sourceId:String(r.result_id)})),...math.map(r=>({kind:"math_ocr" as const,sourceId:String(r.id)}))].map(r=>({...r,assetId,occurrenceId,documentId:null,pageIndex:null}))}
}
