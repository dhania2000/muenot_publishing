import "server-only"
import {createHash,randomBytes} from "node:crypto"
import {query,withTransaction} from "@/lib/db"
import {currentTenantId} from "@/lib/tenant-scope"
import {ensureBackgroundJobSchema,enqueueBackgroundJobInTransaction,requestBackgroundJobCancel,type BackgroundJob} from "@/lib/background-jobs"
import {ensureEvidenceSchema} from "./math-store"
import {authorizeQualitySource} from "./advanced-quality-source"
import {AdvancedEvidenceError} from "./advanced-evidence-source"
import {processingSourceFingerprint,readProcessingCapabilities,type ProcessingActor} from "./processing-pipeline-source"
import {initialProcessingProgress,processingOperationId} from "./processing-pipeline-plan"
import {BILLABLE_PROCESSING_STAGES,processingSummary,PROCESSING_LIMITS,canRetryLocalProcessingNode,type ProcessingRequest,type ProcessingRun,type ProcessingProgress} from "./processing-pipeline-contract"
import type {HistoryActor} from "./history"
const hash=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex")
const parse=(v:any)=>typeof v==="string"?JSON.parse(v):v
export function processingRunView(row:any):ProcessingRun{
 const input=parse(row.input_json)
 return {id:Number(row.id),assetId:Number(row.asset_id),occurrenceId:Number(row.occurrence_key)||null,batchId:input.batchId??null,documentId:input.documentId??null,locationLabel:input.locationLabel??null,createdBy:Number(row.created_by),jobId:Number(row.job_id),sourceSha256:input.sourceSha256,selection:input.selection,externalGeneration:input.externalGeneration===true,initialContentVersion:input.initialContentVersion,resumeCount:input.resumeCount??0,progress:parse(row.result_json),status:row.status,createdAt:new Date(row.created_at).toISOString()}
}
export async function startProcessingPipeline(assetId:number,request:ProcessingRequest,actor:ProcessingActor){
 const source=await processingSourceFingerprint(assetId,request.occurrenceId,actor)
 request={...request,occurrenceId:source.document.kind==="document"?source.document.document.imageOccurrenceId:request.occurrenceId}
 const capabilities=await readProcessingCapabilities(assetId,request.occurrenceId,actor)
 const unavailable=request.selection.stages.filter(s=>!capabilities.find(c=>c.stage===s)?.available)
 if(unavailable.length)throw new AdvancedEvidenceError(409,"CAPABILITY_UNAVAILABLE",`These selected stages are unavailable: ${unavailable.join(", ")}.`)
 if(request.selection.stages.some(s=>BILLABLE_PROCESSING_STAGES.includes(s))&&!request.selection.billableConfirmed)throw new AdvancedEvidenceError(400,"BILLABLE_CONFIRMATION_REQUIRED","Confirm the selected provider-backed stages and their dependencies before scheduling.")
 await ensureEvidenceSchema();await ensureBackgroundJobSchema()
 const tenant=currentTenantId(),requestKey=hash(["processing_pipeline",assetId,request.occurrenceId,actor.userId,request.requestId]),config=hash([1,source.sourceSha256,request.selection,source.documentId,request.occurrenceId])
 return withTransaction(async conn=>{
  const [assets]=await conn.query<any[]>("SELECT id FROM alt_text_assets WHERE tenant_id=? AND id=? FOR UPDATE",[tenant,assetId])
  if(!assets.length)throw new AdvancedEvidenceError(404,"NOT_FOUND","Image not found.")
  const [replay]=await conn.query<any[]>("SELECT * FROM alt_text_accessibility_evidence WHERE tenant_id=? AND kind='processing_pipeline' AND request_key=?",[tenant,requestKey])
  if(replay[0]){if(replay[0].config_key!==config)throw new AdvancedEvidenceError(409,"REQUEST_CONFLICT","This request belongs to a different source or processing selection.");return {run:processingRunView(replay[0]),replayed:true}}
  const [active]=await conn.query<any[]>("SELECT id FROM alt_text_accessibility_evidence WHERE tenant_id=? AND asset_id=? AND occurrence_key=? AND kind='processing_pipeline' AND status IN ('queued','processing') LIMIT 1",[tenant,assetId,request.occurrenceId??0])
  if(active.length)throw new AdvancedEvidenceError(409,"PROCESSING_ACTIVE","An accessibility processing run is already active for this source.")
  const current=await processingSourceFingerprint(assetId,request.occurrenceId,actor)
  if(current.sourceSha256!==source.sourceSha256)throw new AdvancedEvidenceError(409,"SOURCE_CHANGED","The image changed before processing was scheduled.")
  const [prior]=await conn.query<any[]>("SELECT MAX(version) AS version FROM alt_text_accessibility_evidence WHERE tenant_id=? AND asset_id=? AND occurrence_key=? AND kind='processing_pipeline' AND region_id='pipeline_current'",[tenant,assetId,request.occurrenceId??0])
  const input={selection:request.selection,sourceSha256:source.sourceSha256,batchId:source.asset.batchId,documentId:source.documentId,locationLabel:source.locationLabel,initialContentVersion:source.asset.currentVersion,externalGeneration:false,resumeCount:0}
  const [inserted]=await conn.query<any>("INSERT INTO alt_text_accessibility_evidence (tenant_id,asset_id,occurrence_key,region_id,kind,version,analysis_id,request_key,config_key,status,input_json,created_by) VALUES (?,?,?,'pipeline_current','processing_pipeline',?,?,?,?,'queued',?,?)",[tenant,assetId,request.occurrenceId??0,Number(prior[0]?.version??0)+1,`pipe_${randomBytes(12).toString("hex")}`,requestKey,config,JSON.stringify(input),actor.userId])
  const id=Number(inserted.insertId),progress=initialProcessingProgress(id,request.selection,source.sourceSha256)
  const queued=await enqueueBackgroundJobInTransaction(conn,{tenantId:tenant,jobType:"alt_text.accessibility_processing",payload:{pipelineId:id},priority:4,idempotencyKey:`accessibility:${id}`,concurrencyKey:`accessibility:tenant:${tenant}`,concurrencyLimit:1,timeoutSeconds:240,maxAttempts:3,backoffSeconds:30,createdBy:actor.userId,triggerSource:"user_request"})
  await conn.query("UPDATE alt_text_accessibility_evidence SET job_id=?,result_json=? WHERE tenant_id=? AND id=?",[queued.jobId,JSON.stringify(progress),tenant,id])
  return {run:processingRunView({id,asset_id:assetId,occurrence_key:request.occurrenceId??0,created_by:actor.userId,job_id:queued.jobId,input_json:input,result_json:progress,status:"queued",created_at:new Date()}),replayed:false}
 })
}
export async function readProcessingPipelines(assetId:number,occurrenceId:number|null,actor:HistoryActor){
 await authorizeQualitySource(assetId,occurrenceId,actor);await ensureEvidenceSchema()
 const rows=await query<any[]>("SELECT * FROM alt_text_accessibility_evidence WHERE tenant_id=? AND asset_id=? AND occurrence_key=? AND kind='processing_pipeline' ORDER BY id DESC LIMIT 10",[currentTenantId(),assetId,occurrenceId??0])
 return rows.map(processingRunView)
}
export async function loadProcessingWork(job:BackgroundJob,id:number){
 const [row]=await query<any[]>("SELECT * FROM alt_text_accessibility_evidence WHERE tenant_id=? AND id=? AND job_id=? AND kind='processing_pipeline'",[job.tenant_id,id,job.id])
 return row?processingRunView(row):null
}
/** Revision plus the live queue claim fence prevents an expired worker overwriting a replacement. */
export async function checkpointProcessing(job:BackgroundJob,run:ProcessingRun,progress:ProcessingProgress){
 if(JSON.stringify(progress).length>PROCESSING_LIMITS.progressChars)throw new Error("PIPELINE_PROGRESS_LIMIT")
 const revision=progress.revision,next={...progress,revision:revision+1},status=processingSummary(next).status
 const result=await query<any>(`UPDATE alt_text_accessibility_evidence e JOIN platform_background_jobs j ON j.id=e.job_id AND j.tenant_id=e.tenant_id
 SET e.result_json=?,e.status=? WHERE e.tenant_id=? AND e.id=? AND e.kind='processing_pipeline' AND e.job_id=?
 AND j.worker_id=? AND j.status='running' AND j.lease_expires_at>UTC_TIMESTAMP() AND CAST(JSON_UNQUOTE(JSON_EXTRACT(e.result_json,'$.revision')) AS UNSIGNED)=?`,[JSON.stringify(next),status,job.tenant_id,run.id,job.id,job.worker_id,revision])
 if(!Number(result.affectedRows))throw new Error("PIPELINE_LEASE_LOST")
 Object.assign(progress,next);run.status=status
}
export async function cancelProcessingPipeline(assetId:number,occurrenceId:number|null,id:number,actor:ProcessingActor){
 await processingSourceFingerprint(assetId,occurrenceId,actor)
 const runs=await readProcessingPipelines(assetId,occurrenceId,actor),run=runs.find(r=>r.id===id)
 if(!run)throw new AdvancedEvidenceError(404,"NOT_FOUND","Processing run not found.")
 await requestBackgroundJobCancel(run.jobId,currentTenantId())
 for(const node of run.progress.nodes)if(node.childJobId&&["queued","waiting","processing"].includes(node.state))await requestBackgroundJobCancel(node.childJobId,currentTenantId())
 return {success:true,cancelRequested:true}
}
export async function retryLocalProcessing(assetId:number,occurrenceId:number|null,id:number,actor:ProcessingActor){
 const source=await processingSourceFingerprint(assetId,occurrenceId,actor),tenant=currentTenantId()
 return withTransaction(async conn=>{
  const [rows]=await conn.query<any[]>("SELECT e.* FROM alt_text_accessibility_evidence e JOIN platform_background_jobs j ON e.job_id=j.id AND e.tenant_id=j.tenant_id WHERE e.tenant_id=? AND e.asset_id=? AND e.occurrence_key=? AND e.id=? AND e.kind='processing_pipeline' AND j.status IN ('completed','failed','dead_letter') FOR UPDATE",[tenant,assetId,occurrenceId??0,id])
  if(!rows[0])throw new AdvancedEvidenceError(409,"PROCESSING_ACTIVE","Only a settled processing run can retry eligible local stages.")
  const run=processingRunView(rows[0])
  if(run.createdBy!==actor.userId||run.sourceSha256!==source.sourceSha256)throw new AdvancedEvidenceError(409,"SOURCE_CHANGED","Only the original submitter can resume this unchanged source run.")
  let count=0
  for(const node of run.progress.nodes)if(canRetryLocalProcessingNode(node)){node.state="queued";node.error=null;node.attempt++;node.requestId=processingOperationId(run.id,node.stage,node.regionId,node.attempt);count++}
  if(!count)throw new AdvancedEvidenceError(409,"NO_ELIGIBLE_RETRY","There are no eligible local stages to retry. Review paid or uncertain results before starting another run.")
  for(const node of run.progress.nodes)if(node.error?.code==="DEPENDENCY_UNAVAILABLE"&&node.requires.some(key=>run.progress.nodes.some(p=>p.key===key&&p.state==="queued"))){node.state="queued";node.error=null}
  const input=parse(rows[0].input_json);input.resumeCount=(input.resumeCount??0)+1
  const job=await enqueueBackgroundJobInTransaction(conn,{tenantId:tenant,jobType:"alt_text.accessibility_processing",payload:{pipelineId:id},priority:4,idempotencyKey:`accessibility:${id}:resume:${input.resumeCount}`,concurrencyKey:`accessibility:tenant:${tenant}`,concurrencyLimit:1,timeoutSeconds:240,maxAttempts:3,createdBy:actor.userId})
  run.progress.revision++
  await conn.query("UPDATE alt_text_accessibility_evidence SET input_json=?,result_json=?,job_id=?,status='queued' WHERE tenant_id=? AND id=?",[JSON.stringify(input),JSON.stringify(run.progress),job.jobId,tenant,id])
  return {success:true,retried:count,jobId:job.jobId}
 })
}
export async function settleProcessingPipeline(job:BackgroundJob,status:string){
 if(!["cancelled","failed","dead_letter"].includes(status))return
 const run=await loadProcessingWork(job,Number((job.payload as {pipelineId:number}).pipelineId));if(!run)return
 for(const node of run.progress.nodes)if(["queued","waiting","processing"].includes(node.state)){
  node.state=status==="cancelled"?"cancelled":"needs_reconciliation"
  node.error={code:status==="cancelled"?"CANCELLED":"WORKER_STOPPED",message:status==="cancelled"?"Cancelled at a processing checkpoint; completed evidence is retained.":"The worker stopped before this stage could be confirmed. Check saved results and usage before starting another paid run.",retrySafe:false}
  if(node.childJobId)await requestBackgroundJobCancel(node.childJobId,job.tenant_id)
 }
 run.progress.expanded=true;run.progress.revision++
 await query(`UPDATE alt_text_accessibility_evidence e JOIN platform_background_jobs j ON e.job_id=j.id AND e.tenant_id=j.tenant_id SET e.result_json=?,e.status=? WHERE e.tenant_id=? AND e.id=? AND j.status=?`,[JSON.stringify(run.progress),processingSummary(run.progress).status,job.tenant_id,run.id,status])
}
