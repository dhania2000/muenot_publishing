import "server-only"
import {createHash,randomBytes} from "node:crypto"
import {query,withTransaction} from "@/lib/db"
import {currentTenantId} from "@/lib/tenant-scope"
import {ensureEvidenceSchema} from "./math-store"
import {ensureBackgroundJobSchema,enqueueBackgroundJobInTransaction,type BackgroundJob} from "@/lib/background-jobs"
import type {AdvancedRegionRequest} from "./advanced-evidence-source"
import type {ChartStructureResult} from "./chart-contract"
import type {MathCrop} from "./math-contract"
import type {ImageRegion} from "./region-analysis"
import type {ComplexityLevel} from "./classification"
export type AdvancedEvidenceKind="chart_structure"
export type AdvancedEvidenceInput={kind:AdvancedEvidenceKind;assetId:number;occurrenceId:number|null;request:AdvancedRegionRequest;source:MathCrop;actorId:number;modelId:string;regions:ImageRegion[];regionParentId:string|null;complexity:ComplexityLevel;support:Pick<ChartStructureResult,"ocrEvidence"|"reviewEvidence">}
export type AdvancedEvidenceRecord={id:number;version:number;regionId:string;status:string;jobId:number|null;errorCode:string|null;result:ChartStructureResult|null;createdAt:string}
const hash=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex")
const parse=(v:any)=>typeof v==="string"?JSON.parse(v):v
function view(r:any):AdvancedEvidenceRecord{return {id:Number(r.id),version:Number(r.version),regionId:r.region_id,status:r.status,jobId:r.job_id==null?null:Number(r.job_id),errorCode:r.error_code,result:r.status==="completed"?parse(r.result_json):null,createdAt:new Date(r.created_at).toISOString()}}
export async function listAdvancedEvidence(assetId:number,occurrenceId:number|null,kind:AdvancedEvidenceKind){
 await ensureEvidenceSchema()
 const rows=await query<any[]>("SELECT * FROM alt_text_accessibility_evidence WHERE tenant_id=? AND asset_id=? AND occurrence_key=? AND kind=? ORDER BY id DESC LIMIT 60",[currentTenantId(),assetId,occurrenceId??0,kind])
 return rows.map(view)
}
export async function enqueueAdvancedEvidence(input:AdvancedEvidenceInput){
 await ensureEvidenceSchema();await ensureBackgroundJobSchema()
 const tenant=currentTenantId(),requestKey=hash([input.kind,input.assetId,input.occurrenceId,input.request.requestId]),config=hash([1,input.kind,input.source,input.modelId,input.support])
 return withTransaction(async(conn)=>{
  const [assets]=await conn.query<any[]>("SELECT id FROM alt_text_assets WHERE tenant_id=? AND id=? FOR UPDATE",[tenant,input.assetId])
  if(!assets.length)throw new Error("ADVANCED_SOURCE_MISSING")
  const [replay]=await conn.query<any[]>("SELECT * FROM alt_text_accessibility_evidence WHERE tenant_id=? AND request_key=?",[tenant,requestKey])
  if(replay[0]){if(replay[0].config_key!==config)throw new Error("ADVANCED_REQUEST_CONFLICT");return {record:view(replay[0]),created:false}}
  const [prior]=await conn.query<any[]>("SELECT * FROM alt_text_accessibility_evidence WHERE tenant_id=? AND asset_id=? AND occurrence_key=? AND region_id=? AND kind=? ORDER BY version DESC LIMIT 1",[tenant,input.assetId,input.occurrenceId??0,input.request.regionId,input.kind])
  if(prior[0]&&["queued","running","received"].includes(prior[0].status)){
   if(prior[0].config_key!==config)throw new Error("ADVANCED_REQUEST_CONFLICT")
   return {record:view(prior[0]),created:false}
  }
  if(prior[0]?.status==="completed"&&prior[0].config_key===config&&!input.request.reprocess)return {record:view(prior[0]),created:false}
  const version=Number(prior[0]?.version??0)+1
  const [inserted]=await conn.query<any>(`INSERT INTO alt_text_accessibility_evidence (tenant_id,asset_id,occurrence_key,region_id,kind,version,analysis_id,request_key,config_key,status,input_json,created_by) VALUES (?,?,?,?,?,?,?,?,?,'queued',?,?)`,[tenant,input.assetId,input.occurrenceId??0,input.request.regionId,input.kind,version,`adv_${randomBytes(12).toString("hex")}`,requestKey,config,JSON.stringify(input),input.actorId])
  const id=Number(inserted.insertId),queued=await enqueueBackgroundJobInTransaction(conn,{tenantId:tenant,jobType:"alt_text.advanced_analysis",payload:{evidenceId:id},idempotencyKey:`advanced-evidence:${id}`,concurrencyKey:`advanced-evidence:tenant:${tenant}`,concurrencyLimit:1,timeoutSeconds:180,maxAttempts:3,backoffSeconds:30,createdBy:input.actorId,triggerSource:"user_request"})
  await conn.query("UPDATE alt_text_accessibility_evidence SET job_id=? WHERE tenant_id=? AND id=?",[queued.jobId,tenant,id])
  return {record:{id,version,regionId:input.request.regionId,status:"queued",jobId:queued.jobId,errorCode:null,result:null,createdAt:new Date().toISOString()} as AdvancedEvidenceRecord,created:true}
 })
}
export async function getAdvancedEvidenceWork(job:BackgroundJob,evidenceId:number){
 await ensureEvidenceSchema()
 const rows=await query<any[]>("SELECT * FROM alt_text_accessibility_evidence WHERE tenant_id=? AND id=? AND job_id=? AND kind='chart_structure'",[job.tenant_id,evidenceId,job.id])
 return rows[0]?{row:rows[0],input:parse(rows[0].input_json) as AdvancedEvidenceInput,saved:parse(rows[0].result_json)}:null
}
export async function writeAdvancedEvidence(job:BackgroundJob,id:number,status:string,result:unknown=null,error:string|null=null){
 const json=result==null?null:JSON.stringify(result)
 const r=await query<any>(`UPDATE alt_text_accessibility_evidence e JOIN platform_background_jobs j ON e.job_id=j.id AND e.tenant_id=j.tenant_id
  SET e.status=?,e.result_json=IF(? IS NULL,e.result_json,CAST(? AS JSON)),e.error_code=?
  WHERE e.tenant_id=? AND e.id=? AND e.job_id=? AND j.worker_id=? AND j.status='running' AND j.lease_expires_at>UTC_TIMESTAMP()`,[status,json,json,error,job.tenant_id,id,job.id,job.worker_id])
 if(!Number(r.affectedRows))throw new Error("ADVANCED_LEASE_LOST")
}
export async function settleAdvancedEvidence(job:BackgroundJob,status:string){
 if(!["failed","dead_letter","cancelled"].includes(status))return
 await query(`UPDATE alt_text_accessibility_evidence e JOIN platform_background_jobs j ON e.job_id=j.id AND e.tenant_id=j.tenant_id SET e.status=?,e.error_code=?
  WHERE e.tenant_id=? AND e.job_id=? AND e.kind='chart_structure' AND e.status IN ('queued','running','received') AND j.status=?`,[status==="cancelled"?"cancelled":"failed",status==="cancelled"?null:"ADVANCED_JOB_FAILED",job.tenant_id,job.id,status])
}
