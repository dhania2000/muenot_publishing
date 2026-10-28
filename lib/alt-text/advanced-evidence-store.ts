import "server-only"
import {createHash,randomBytes} from "node:crypto"
import {query,withTransaction} from "@/lib/db"
import {currentTenantId} from "@/lib/tenant-scope"
import {ensureEvidenceSchema} from "./math-store"
import {ensureBackgroundJobSchema,enqueueBackgroundJobInTransaction,type BackgroundJob} from "@/lib/background-jobs"
import type {AdvancedRegionRequest} from "./advanced-evidence-source"
import type {ChartStructureResult} from "./chart-contract"
import type {MathCrop} from "./math-contract"
import type {ImageRegion,RegionRelationship} from "./region-analysis"
import type {ComplexityLevel} from "./classification"
import type {ChartAxesResult,ReviewedChartLabel} from "./chart-axis-contract"
import type {ChartAxisOptions} from "./chart-axis-analysis"
import type {ChartDataResult,ChartDataParent} from "./chart-data-contract"
import type {ScientificStructureResult,ScienceOptions} from "./scientific-structure-contract"
import type {DomainParent,DomainOptions,DomainSupport,ScientificDomainResult} from "./scientific-domain-contract"
import type {IllustrationResult,IllustrationOptions,IllustrationOcrOrder} from "./illustration-contract"
export type AdvancedResultMap={chart_structure:ChartStructureResult;chart_axes:ChartAxesResult;chart_data:ChartDataResult;scientific_structure:ScientificStructureResult;scientific_domain:ScientificDomainResult;illustration_structure:IllustrationResult}
export type AdvancedEvidenceKind=keyof AdvancedResultMap
export type AdvancedEvidenceInput={kind:AdvancedEvidenceKind;assetId:number;occurrenceId:number|null;request:AdvancedRegionRequest;source:MathCrop;actorId:number;modelId:string;regions:ImageRegion[];regionParentId:string|null;complexity:ComplexityLevel;support:Pick<ChartStructureResult,"ocrEvidence"|"reviewEvidence">;parentEvidence?:{id:number;version:number;result:ChartStructureResult};reviewedLabels?:ReviewedChartLabel[];axisOptions?:ChartAxisOptions;dataParent?:ChartDataParent;dataTrendEnabled?:boolean;scienceOptions?:ScienceOptions;regionRelationships?:RegionRelationship[];domainParent?:DomainParent;domainOptions?:DomainOptions;domainSupport?:DomainSupport;illustrationOptions?:IllustrationOptions;illustrationOrder?:IllustrationOcrOrder[]}
export type AdvancedEvidenceRecord<K extends AdvancedEvidenceKind=AdvancedEvidenceKind>={id:number;version:number;regionId:string;status:string;jobId:number|null;errorCode:string|null;result:AdvancedResultMap[K]|null;createdAt:string;parentEvidenceId:number|null}
const hash=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex")
const parse=(v:any)=>typeof v==="string"?JSON.parse(v):v
function view<K extends AdvancedEvidenceKind>(r:any):AdvancedEvidenceRecord<K>{return {id:Number(r.id),version:Number(r.version),regionId:r.region_id,status:r.status,jobId:r.job_id==null?null:Number(r.job_id),errorCode:r.error_code,result:r.status==="completed"?parse(r.result_json):null,createdAt:new Date(r.created_at).toISOString(),parentEvidenceId:parse(r.input_json)?.domainParent?.id??parse(r.input_json)?.dataParent?.axes?.id??parse(r.input_json)?.parentEvidence?.id??null}}
export async function listAdvancedEvidence<K extends AdvancedEvidenceKind>(assetId:number,occurrenceId:number|null,kind:K):Promise<AdvancedEvidenceRecord<K>[]>{
 await ensureEvidenceSchema()
 const rows=await query<any[]>("SELECT * FROM alt_text_accessibility_evidence WHERE tenant_id=? AND asset_id=? AND occurrence_key=? AND kind=? ORDER BY id DESC LIMIT 60",[currentTenantId(),assetId,occurrenceId??0,kind])
 return rows.map((r)=>view<K>(r))
}
export async function getCompletedAdvancedEvidence<K extends AdvancedEvidenceKind>(assetId:number,occurrenceId:number|null,kind:K,id:number):Promise<AdvancedEvidenceRecord<K>|null>{
 await ensureEvidenceSchema()
 const rows=await query<any[]>("SELECT * FROM alt_text_accessibility_evidence WHERE tenant_id=? AND asset_id=? AND occurrence_key=? AND kind=? AND id=? AND status='completed' LIMIT 1",[currentTenantId(),assetId,occurrenceId??0,kind,id])
 return rows[0]?view<K>(rows[0]):null
}
export async function enqueueAdvancedEvidence(input:AdvancedEvidenceInput){
 await ensureEvidenceSchema();await ensureBackgroundJobSchema()
 const tenant=currentTenantId(),requestKey=hash([input.kind,input.assetId,input.occurrenceId,input.request.requestId])
 const config=hash(input.kind==="illustration_structure"?[1,input.kind,input.source,input.modelId,input.support,input.illustrationOptions,input.illustrationOrder,input.regionRelationships]:input.kind==="scientific_domain"?[1,input.kind,input.source,input.modelId,input.domainParent,input.domainOptions,input.domainSupport]:input.kind==="scientific_structure"?[1,input.kind,input.source,input.modelId,input.support,input.scienceOptions,input.regionRelationships]:input.kind==="chart_data"?[1,input.kind,input.source,input.modelId,input.dataParent,input.dataTrendEnabled]:input.kind==="chart_structure"?[1,input.kind,input.source,input.modelId,input.support]:[1,input.kind,input.source,input.modelId,input.support,input.parentEvidence?.id,input.parentEvidence?.version,input.reviewedLabels,input.axisOptions])
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
  return {record:{id,version,regionId:input.request.regionId,status:"queued",jobId:queued.jobId,errorCode:null,result:null,createdAt:new Date().toISOString(),parentEvidenceId:input.domainParent?.id??input.dataParent?.axes.id??input.parentEvidence?.id??null} as AdvancedEvidenceRecord,created:true}
 })
}
export async function getAdvancedEvidenceWork(job:BackgroundJob,evidenceId:number){
 await ensureEvidenceSchema()
 const rows=await query<any[]>("SELECT * FROM alt_text_accessibility_evidence WHERE tenant_id=? AND id=? AND job_id=? AND kind IN ('chart_structure','chart_axes','chart_data','scientific_structure','scientific_domain','illustration_structure')",[job.tenant_id,evidenceId,job.id])
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
  WHERE e.tenant_id=? AND e.job_id=? AND e.kind IN ('chart_structure','chart_axes','chart_data','scientific_structure','scientific_domain','illustration_structure') AND e.status IN ('queued','running','received') AND j.status=?`,[status==="cancelled"?"cancelled":"failed",status==="cancelled"?null:"ADVANCED_JOB_FAILED",job.tenant_id,job.id,status])
}
