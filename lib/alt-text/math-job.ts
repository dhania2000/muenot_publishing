import "server-only"
import {isDeepStrictEqual as evidenceEqual} from "node:util"
import {cropRegionImage} from "./region-image-crop"
import {query} from "@/lib/db"
import {runForTenant} from "@/lib/tenant-scope"
import {isBackgroundJobCancelRequested,type BackgroundJob,type MathRecognitionJobPayload} from "@/lib/background-jobs"
import {JobCancelledError,JobDeferredError} from "@/lib/job-retry-policy"
import {guardProcessingBatchAsset} from "./processing-batch-guard"
import {getMathWork,writeMathState} from "./math-store"
import {MATH_MODEL,MathEngineError,recognizeMath} from "./math-engine"
import {mathPolicy,MathRequestError,resolveEquationSource,authorizeMathWorker} from "./math-service"
import type {MathRecognitionResult} from "./math-contract"

/** Private in-memory crop. Image orientation and bounds were validated against the saved region. */
export async function cropEquationImage(bytes:Uint8Array,box:{left:number;top:number;width:number;height:number}){
 return cropRegionImage(bytes,box)
}
export async function runMathRecognitionJob(payload:MathRecognitionJobPayload,{job,signal}:{job:BackgroundJob;signal:AbortSignal}){
 return runForTenant({tenantId:job.tenant_id},async()=>{
  const work=await getMathWork(job,payload.evidenceId)
  if(!work)return {superseded:true}
  if(["candidate","no_expression_detected","incomplete"].includes(work.row.status))return {replayed:true}
  const guard=async()=>{
   await guardProcessingBatchAsset(work.input.assetId)
   if(signal.aborted)throw Object.assign(new Error("MATH_JOB_TIMEOUT"),{name:"AbortError"})
   if(await isBackgroundJobCancelRequested(job.id))throw new JobCancelledError("MATH_CANCELLED")
   const lease=await query<any[]>("SELECT id FROM platform_background_jobs WHERE id=? AND tenant_id=? AND worker_id=? AND status='running' AND lease_expires_at>UTC_TIMESTAMP()",[job.id,job.tenant_id,job.worker_id])
   if(!lease.length)throw new Error("MATH_LEASE_LOST")
  }
  await guard()
  try{
   if(!(await mathPolicy()).enabled)throw new MathRequestError(409,"MATH_UNAVAILABLE","Mathematical OCR was disabled before this work started.")
   const {input}=work
   const actor=await authorizeMathWorker(input.assetId,input.occurrenceId,input.actorId,job.tenant_id)
   if(input.modelFingerprint!==JSON.stringify(MATH_MODEL))throw new MathRequestError(409,"MATH_MODEL_CHANGED","The model version changed. Submit a new recognition request.")
   const current=await resolveEquationSource(input.assetId,input.occurrenceId,input.request,{userId:input.actorId,tenantId:job.tenant_id,scope:actor.viewScope})
   if(!evidenceEqual(current.source,input.source))throw new MathRequestError(409,"MATH_SOURCE_CHANGED","Source image or region changed after submission.")
   await writeMathState(job,payload.evidenceId,"recognizing")
   const png=await cropEquationImage(current.bytes,current.source.pixelBox)
   await guard()
   const output=await recognizeMath(png,signal)
   await guard()
   const candidate=output.generation.truncated?null:output.rawOutput.trim()||null
   const result:MathRecognitionResult={schemaVersion:1,analysisId:work.row.analysis_id,assetId:input.assetId,occurrenceId:input.occurrenceId,regionId:input.request.regionId,source:input.source,
    providerId:"mixtex_transformers_cpu",modelId:output.modelId,modelRevision:output.revision,weightsSha256:output.weightsSha256,rawOutput:output.rawOutput,candidateLatex:candidate,
    confidence:null,confidenceBasis:"not_reported",status:output.generation.truncated?"incomplete":candidate?"candidate":"no_expression_detected",warnings:["Recognizer output is unverified and may contain mathematical errors. Human review is required.","The crop follows an estimated equation region; its position is not pixel-verified.",...(output.generation.truncated?["The generation token limit was reached. Raw output is incomplete and is not offered as a LaTeX candidate."]:[])],verified:false,untrustedSource:true,durationMs:output.durationMs,createdAt:new Date().toISOString(),preprocessing:output.preprocessing,generation:output.generation}
   await writeMathState(job,payload.evidenceId,result.status,result)
   return {evidenceId:payload.evidenceId,status:result.status}
  }catch(error){
   if(error instanceof JobCancelledError||error instanceof JobDeferredError||signal.aborted||error instanceof Error&&error.message==="MATH_LEASE_LOST")throw error
   const code=error instanceof MathEngineError||error instanceof MathRequestError?error.code:"MATH_EXECUTION_FAILED"
   if(code==="MATH_BUSY"){await writeMathState(job,payload.evidenceId,"queued",null,code);throw new JobDeferredError(code,30)}
   if(error instanceof MathRequestError){await writeMathState(job,payload.evidenceId,"failed",null,code);throw error}
   // Keep the row queued during retry backoff; settlement marks terminal failures without erasing older evidence.
   await writeMathState(job,payload.evidenceId,"queued",null,code)
   throw Object.assign(new Error(code),{status:503})
  }
 })
}
