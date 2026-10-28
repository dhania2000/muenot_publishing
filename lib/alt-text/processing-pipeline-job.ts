import "server-only"
import {isBackgroundJobCancelRequested,type BackgroundJob} from "@/lib/background-jobs"
import {runForTenant} from "@/lib/tenant-scope"
import {JobCancelledError,JobDeferredError} from "@/lib/job-retry-policy"
import {loadProcessingWork,checkpointProcessing} from "./processing-pipeline-store"
import {loadProcessingActor,processingSourceFingerprint} from "./processing-pipeline-source"
import {executeProcessingNode,currentProcessingRegions} from "./processing-pipeline-execute"
import {expandProcessingTargets,processingCreditRequestId} from "./processing-pipeline-plan"
import {nextProcessingNode,processingSummary} from "./processing-pipeline-contract"
import {guardProcessingBatchAsset} from "./processing-batch-guard"
export type ProcessingJobDeps={load:typeof loadProcessingWork;actor:typeof loadProcessingActor;source:typeof processingSourceFingerprint;checkpoint:typeof checkpointProcessing;execute:typeof executeProcessingNode;regions:typeof currentProcessingRegions;cancelled:typeof isBackgroundJobCancelRequested;batch:typeof guardProcessingBatchAsset}
const defaults:ProcessingJobDeps={load:loadProcessingWork,actor:loadProcessingActor,source:processingSourceFingerprint,checkpoint:checkpointProcessing,execute:executeProcessingNode,regions:currentProcessingRegions,cancelled:isBackgroundJobCancelRequested,batch:guardProcessingBatchAsset}
export async function runProcessingPipelineJob(payload:{pipelineId:number},ctx:{job:BackgroundJob;signal:AbortSignal},dependencies:Partial<ProcessingJobDeps>={}){
 return runForTenant({tenantId:ctx.job.tenant_id},async()=>{
 const d={...defaults,...dependencies},job=ctx.job,run=await d.load(job,payload.pipelineId)
 if(!run)return {missing:true}
 if(ctx.signal.aborted||job.cancel_requested||await d.cancelled(job.id))throw new JobCancelledError()
 await d.batch(run.assetId)
 const actor=await d.actor(job.tenant_id,run.createdBy)
 if(!actor)throw new Error("PIPELINE_PERMISSION_CHANGED")
 const source=await d.source(run.assetId,run.occurrenceId,actor)
 if(source.sourceSha256!==run.sourceSha256)throw new Error("PIPELINE_SOURCE_CHANGED")
 expandProcessingTargets(run.id,run.selection,run.progress,await d.regions(run))
 const node=nextProcessingNode(run.progress)
 if(!node){await d.checkpoint(job,run,run.progress);return {...processingSummary(run.progress)}}
 // These two synchronous paid services do not persist a provider receipt. An interrupted
 // delivery is reconciled by a human rather than assuming a save or issuing another charge.
 if(node.state==="processing"&&["regions","generation"].includes(node.stage)){
  node.state="needs_reconciliation";node.error={code:"INTERRUPTED_PAID_STAGE",message:"A provider-backed stage was interrupted before its save checkpoint. Check saved evidence and usage before requesting another run.",retrySafe:false}
 }else{
  node.state="processing";node.creditRequestId=processingCreditRequestId(run.assetId,run.occurrenceId,node);await d.checkpoint(job,run,run.progress)
  try{await d.execute(run,node,actor,ctx.signal)}catch(e){
   if(ctx.signal.aborted)throw e
   const error=e as {code?:string;message?:string;status?:number},code=error.code??"STAGE_FAILED",uncertain=["SAVE_FAILED","GENERATION_SUPERSEDED","ANALYSIS_IN_PROGRESS","GENERATION_IN_PROGRESS"].includes(code)
   if(error.status===402||error.status===429){node.state="queued";node.error={code,message:error.message??"Waiting for credits or the provider rate limit.",retrySafe:false};await d.checkpoint(job,run,run.progress);throw new JobDeferredError(error.status===402?"ACCESSIBILITY_AWAITING_CREDITS":"ACCESSIBILITY_RATE_LIMITED",error.status===402?900:60)}
   node.state=uncertain?"needs_reconciliation":"failed";node.error={code,message:error.message??"This stage failed. Independent stages can continue.",retrySafe:!["regions","generation","chart","science","domain","illustration"].includes(node.stage)&&!uncertain&&![401,403,404].includes(error.status??0)}
  }
 }
 await d.checkpoint(job,run,run.progress)
 if(ctx.signal.aborted||await d.cancelled(job.id))throw new JobCancelledError()
 if(node.stage==="regions"&&!run.progress.expanded){expandProcessingTargets(run.id,run.selection,run.progress,await d.regions(run));await d.checkpoint(job,run,run.progress)}
 const next=nextProcessingNode(run.progress)
 await d.checkpoint(job,run,run.progress)
 if(next)throw new JobDeferredError("ACCESSIBILITY_STAGE_CHECKPOINT",30)
 return {...processingSummary(run.progress)}
 })
}
