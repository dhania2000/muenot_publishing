import "server-only"
import {randomUUID} from "node:crypto"
import {query,withTransaction} from "@/lib/db"
import {currentTenantId} from "@/lib/tenant-scope"
import {withinScope,type HistoryActor} from "./history"
import {ensureEvidenceSchema} from "./math-store"
import {AdvancedEvidenceError} from "./advanced-evidence-source"
import {reviewFingerprint} from "./structured-review-source"
import {authorizeQualitySource,loadQualityInput} from "./advanced-quality-source"
import {runAdvancedQuality,QUALITY_VALIDATORS} from "./advanced-quality"
import {ADVANCED_QUALITY_VERSION,type QualityReport} from "./advanced-quality-contract"
const parse=(v:any)=>typeof v==="string"?JSON.parse(v):v
const region="quality_current"
const config=(fingerprint:string)=>reviewFingerprint([ADVANCED_QUALITY_VERSION,QUALITY_VALIDATORS,fingerprint])
export async function readAdvancedQuality(assetId:number,occurrenceId:number|null,actor:HistoryActor){
 const {asset}=await authorizeQualitySource(assetId,occurrenceId,actor)
 await ensureEvidenceSchema()
 const [row]=await query<any[]>(`SELECT config_key,result_json FROM alt_text_accessibility_evidence WHERE tenant_id=? AND asset_id=? AND occurrence_key=? AND kind='quality_validation' AND region_id=? ORDER BY version DESC LIMIT 1`,[currentTenantId(),assetId,occurrenceId??0,region])
 const canRun=withinScope(actor.updateScope,actor.userId,asset)
 if(!row)return {success:true as const,report:null,sourceCurrent:null,canRun}
 const current=await loadQualityInput(assetId,occurrenceId,actor)
 return {success:true as const,report:parse(row.result_json) as QualityReport,sourceCurrent:row.config_key===config(current.fingerprint),canRun}
}
/** Persist one reproducible QA snapshot in the existing evidence table and image audit transaction. */
export async function saveAdvancedQuality(assetId:number,occurrenceId:number|null,requestId:string,actor:HistoryActor){
 if(!/^[A-Za-z0-9_-]{8,48}$/.test(requestId))throw new AdvancedEvidenceError(400,"INVALID_REQUEST","Invalid validation request identity.")
 const source=await loadQualityInput(assetId,occurrenceId,actor)
 if(!withinScope(actor.updateScope,actor.userId,source.asset))throw new AdvancedEvidenceError(403,"FORBIDDEN","You cannot record QA for this image.")
 const tenant=currentTenantId(),request=reviewFingerprint(["quality_validation",assetId,occurrenceId,actor.userId,requestId]),configuration=config(source.fingerprint)
 const validation=runAdvancedQuality(source.input)
 return withTransaction(async conn=>{
  const [parent]=await conn.query<any[]>("SELECT id FROM alt_text_assets WHERE tenant_id=? AND id=? FOR UPDATE",[tenant,assetId])
  if(!parent.length)throw new AdvancedEvidenceError(404,"NOT_FOUND","The image no longer exists.")
  const [replay]=await conn.query<any[]>("SELECT config_key,result_json FROM alt_text_accessibility_evidence WHERE tenant_id=? AND kind='quality_validation' AND request_key=?",[tenant,request])
  if(replay[0]){if(replay[0].config_key!==configuration)throw new AdvancedEvidenceError(409,"REQUEST_CONFLICT","This validation request belongs to an earlier source snapshot. Start a new validation.");return {report:parse(replay[0].result_json) as QualityReport,replayed:true}}
  const current=await loadQualityInput(assetId,occurrenceId,actor)
  if(!withinScope(actor.updateScope,actor.userId,current.asset))throw new AdvancedEvidenceError(403,"FORBIDDEN","Permission for this image changed before validation was saved.")
  if(current.fingerprint!==source.fingerprint)throw new AdvancedEvidenceError(409,"SOURCE_CHANGED","Description or evidence changed while QA was running. Run QA again on the new saved version.")
  const [prior]=await conn.query<any[]>("SELECT version,config_key,result_json FROM alt_text_accessibility_evidence WHERE tenant_id=? AND asset_id=? AND occurrence_key=? AND kind='quality_validation' AND region_id=? ORDER BY version DESC LIMIT 1",[tenant,assetId,occurrenceId??0,region])
  if(prior[0]?.config_key===configuration)return {report:parse(prior[0].result_json) as QualityReport,replayed:true}
  const runId=randomUUID(),{blockingFailures,...summary}=validation.summary
  const report:QualityReport={runId,assetId,occurrenceId,contentVersion:source.input.contentVersion,sourceSha256:source.input.sourceSha256,sourceFingerprint:source.fingerprint,ruleVersion:ADVANCED_QUALITY_VERSION,validatorVersions:{...QUALITY_VALIDATORS},validatedAt:new Date().toISOString(),validatedBy:actor.userId,guideline:source.input.policy.guideline?{id:source.input.policy.guideline.id,version:source.input.policy.guideline.version}:null,reviewState:"requires_human_review",scoreLabel:"Automated Checks Pass Rate",summary,blockingFailures,checks:validation.checks,certification:false,descriptionApprovedByQa:false}
  const version=Number(prior[0]?.version??0)+1
  await conn.query(`INSERT INTO alt_text_accessibility_evidence (tenant_id,asset_id,occurrence_key,region_id,kind,version,analysis_id,request_key,config_key,status,input_json,result_json,created_by) VALUES (?,?,?,?,'quality_validation',?,?,?,?,'completed',?,?,?)`,[tenant,assetId,occurrenceId??0,region,version,runId,request,configuration,JSON.stringify({ruleVersion:ADVANCED_QUALITY_VERSION,validatorVersions:QUALITY_VALIDATORS,fingerprint:source.fingerprint,snapshot:source.input}),JSON.stringify(report),actor.userId])
  await conn.query(`INSERT INTO alt_text_versions (tenant_id,asset_id,version,action,classification,short_alt,long_description,extracted_text,note,model_id,actor_id) SELECT tenant_id,id,current_version,'quality_validation',classification,short_alt,long_description,extracted_text,?,NULL,? FROM alt_text_assets WHERE tenant_id=? AND id=?`,[`Read-only QA ${runId}, ${ADVANCED_QUALITY_VERSION}; ${blockingFailures} blocking findings. Final description and approval unchanged.`,actor.userId,tenant,assetId])
  return {report,replayed:false}
 })
}
