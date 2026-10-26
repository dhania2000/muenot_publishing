import "server-only"
import {createHash,randomBytes} from "node:crypto"
import {query,withTransaction} from "@/lib/db"
import {currentTenantId} from "@/lib/tenant-scope"
import {enqueueBackgroundJobInTransaction,ensureBackgroundJobSchema,type BackgroundJob} from "@/lib/background-jobs"
import {ensureAltTextSchema} from "./store"
import type {MathCrop,MathEvidenceRecord,MathRecognitionResult,MathRequest} from "./math-contract"

/** Versioned region evidence references existing assets/occurrences; it is not another asset store.
 * Other evidence kinds can extend this table in later tasks without duplicating source documents. */
export const ACCESSIBILITY_EVIDENCE_DDL=`CREATE TABLE IF NOT EXISTS alt_text_accessibility_evidence (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,tenant_id BIGINT UNSIGNED NOT NULL,asset_id BIGINT UNSIGNED NOT NULL,
 occurrence_key BIGINT UNSIGNED NOT NULL DEFAULT 0,region_id VARCHAR(48) NOT NULL,kind VARCHAR(48) NOT NULL,
 version INT UNSIGNED NOT NULL,analysis_id VARCHAR(40) NOT NULL,request_key CHAR(64) NOT NULL,config_key CHAR(64) NOT NULL,
 status VARCHAR(32) NOT NULL,input_json JSON NOT NULL,result_json JSON NULL,error_code VARCHAR(64) NULL,
 job_id BIGINT UNSIGNED NULL,created_by BIGINT UNSIGNED NOT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY evidence_request(tenant_id,request_key),UNIQUE KEY evidence_version(tenant_id,asset_id,occurrence_key,kind,region_id,version),
 KEY evidence_read(tenant_id,asset_id,occurrence_key,kind,id),KEY evidence_job(tenant_id,job_id)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
let schema:Promise<void>|null=null
export function ensureEvidenceSchema(){schema??=(async()=>{await ensureAltTextSchema();await ensureBackgroundJobSchema();await query(ACCESSIBILITY_EVIDENCE_DDL)})().catch((e)=>{schema=null;throw e});return schema}
const parsed=(v:any)=>typeof v==="string"?JSON.parse(v):v
const sha=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex")
export type MathWorkInput={assetId:number;occurrenceId:number|null;request:MathRequest;source:MathCrop;modelFingerprint:string;analysisId:string;actorId:number}
export function evidenceView(row:any):MathEvidenceRecord{return {id:Number(row.id),version:Number(row.version),regionId:row.region_id,status:row.status,jobId:row.job_id==null?null:Number(row.job_id),errorCode:row.error_code,result:parsed(row.result_json),createdAt:new Date(row.created_at).toISOString()}}
export async function listMathEvidence(assetId:number,occurrenceId:number|null){
 await ensureEvidenceSchema()
 const rows=await query<any[]>(`SELECT * FROM alt_text_accessibility_evidence WHERE tenant_id=? AND asset_id=? AND occurrence_key=? AND kind='math_recognition' ORDER BY id DESC LIMIT 60`,[currentTenantId(),assetId,occurrenceId??0])
 return rows.map(evidenceView)
}
export async function enqueueMathEvidence(input:MathWorkInput){
 await ensureEvidenceSchema()
 const tenantId=currentTenantId(),requestKey=sha([input.assetId,input.occurrenceId,input.request.requestId])
 const configKey=sha([1,input.assetId,input.occurrenceId,input.request.regionId,input.source,input.modelFingerprint,"white-crop-v1"])
 return withTransaction(async(conn)=>{
  const [assets]=await conn.query<any[]>("SELECT id FROM alt_text_assets WHERE tenant_id=? AND id=? FOR UPDATE",[tenantId,input.assetId])
  if(!assets.length)throw new Error("MATH_SOURCE_MISSING")
  const [replayed]=await conn.query<any[]>("SELECT * FROM alt_text_accessibility_evidence WHERE tenant_id=? AND request_key=?",[tenantId,requestKey])
  if(replayed[0]){if(replayed[0].config_key!==configKey)throw new Error("MATH_REQUEST_CONFLICT");return {record:evidenceView(replayed[0]),created:false}}
  const [prior]=await conn.query<any[]>(`SELECT * FROM alt_text_accessibility_evidence WHERE tenant_id=? AND asset_id=? AND occurrence_key=? AND kind='math_recognition' AND region_id=? ORDER BY version DESC LIMIT 1`,[tenantId,input.assetId,input.occurrenceId??0,input.request.regionId])
  if(prior[0]&&["queued","recognizing"].includes(prior[0].status)){
    if(prior[0].config_key!==configKey)throw new Error("MATH_REQUEST_CONFLICT")
    return {record:evidenceView(prior[0]),created:false}
  }
  if(!input.request.reprocess&&prior[0]?.status==="candidate"&&prior[0].config_key===configKey)return {record:evidenceView(prior[0]),created:false}
  const version=Number(prior[0]?.version??0)+1
  const [inserted]=await conn.query<any>(`INSERT INTO alt_text_accessibility_evidence (tenant_id,asset_id,occurrence_key,region_id,kind,version,analysis_id,request_key,config_key,status,input_json,created_by) VALUES (?,?,?,?,'math_recognition',?,?,?,?,'queued',?,?)`,
   [tenantId,input.assetId,input.occurrenceId??0,input.request.regionId,version,`math_${randomBytes(12).toString("hex")}`,requestKey,configKey,JSON.stringify(input),input.actorId])
  const id=Number(inserted.insertId)
  const queued=await enqueueBackgroundJobInTransaction(conn,{tenantId,jobType:"alt_text.math_recognition",payload:{evidenceId:id},idempotencyKey:`math-evidence:${id}`,concurrencyKey:`math-recognition:tenant:${tenantId}`,concurrencyLimit:1,timeoutSeconds:150,maxAttempts:3,backoffSeconds:30,createdBy:input.actorId,triggerSource:"user_request"})
  await conn.query("UPDATE alt_text_accessibility_evidence SET job_id=? WHERE tenant_id=? AND id=?",[queued.jobId,tenantId,id])
  return {record:{id,version,regionId:input.request.regionId,status:"queued",jobId:queued.jobId,errorCode:null,result:null,createdAt:new Date().toISOString()} as MathEvidenceRecord,created:true}
 })
}
export async function getMathWork(job:BackgroundJob,evidenceId:number){
 await ensureEvidenceSchema()
 const rows=await query<any[]>(`SELECT * FROM alt_text_accessibility_evidence WHERE tenant_id=? AND id=? AND job_id=? AND kind='math_recognition' LIMIT 1`,[job.tenant_id,evidenceId,job.id])
 return rows[0]?{row:rows[0],input:parsed(rows[0].input_json) as MathWorkInput}:null
}
export async function writeMathState(job:BackgroundJob,evidenceId:number,status:string,result:MathRecognitionResult|null=null,errorCode:string|null=null){
 const updated=await query<any>(`UPDATE alt_text_accessibility_evidence e JOIN platform_background_jobs j ON e.job_id=j.id AND e.tenant_id=j.tenant_id
 SET e.status=?,e.result_json=IF(? IS NULL,e.result_json,CAST(? AS JSON)),e.error_code=?
 WHERE e.tenant_id=? AND e.id=? AND e.job_id=? AND j.worker_id=? AND j.status='running' AND j.lease_expires_at>UTC_TIMESTAMP()`,
 [status,result?JSON.stringify(result):null,result?JSON.stringify(result):null,errorCode,job.tenant_id,evidenceId,job.id,job.worker_id])
 if(!Number(updated.affectedRows))throw new Error("MATH_LEASE_LOST")
}
export async function settleMathEvidence(job:BackgroundJob,status:string){
 if(!["dead_letter","failed","cancelled"].includes(status))return
 await query(`UPDATE alt_text_accessibility_evidence e JOIN platform_background_jobs j ON e.job_id=j.id AND e.tenant_id=j.tenant_id
 SET e.status=?,e.error_code=? WHERE e.tenant_id=? AND e.job_id=? AND e.kind='math_recognition' AND e.status IN ('queued','recognizing') AND j.status=?`,[status==="cancelled"?"cancelled":"failed",status==="cancelled"?null:"MATH_JOB_FAILED",job.tenant_id,job.id,status])
}
