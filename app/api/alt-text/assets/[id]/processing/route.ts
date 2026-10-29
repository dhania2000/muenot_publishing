import {after} from "next/server"
import {gateAltTextHistory,jsonOk,jsonError,unexpected} from "@/lib/alt-text/route-gate"
import {parseAssetId,withinScope} from "@/lib/alt-text/history"
import {authorizeQualitySource} from "@/lib/alt-text/advanced-quality-source"
import {getBatch} from "@/lib/alt-text/store"
import {normalizeGenerationSettings} from "@/lib/alt-text/core"
import {resolveEffectiveSettings} from "@/lib/alt-text/batch-settings"
import {parseOccurrenceId} from "@/lib/alt-text/classification-service"
import {currentTenantId} from "@/lib/tenant-scope"
import {readBody} from "@/lib/alt-text/document-extraction-run"
import {rateLimited} from "@/lib/alt-text/document-review-route"
import {AdvancedEvidenceError} from "@/lib/alt-text/advanced-evidence-source"
import {parseProcessingRequest} from "@/lib/alt-text/processing-pipeline-contract"
import {loadProcessingActor,readProcessingCapabilities} from "@/lib/alt-text/processing-pipeline-source"
import {readProcessingPipelines,startProcessingPipeline,cancelProcessingPipeline,retryLocalProcessing} from "@/lib/alt-text/processing-pipeline-store"
import {runDueBackgroundJobs} from "@/lib/background-jobs"
export const runtime="nodejs"
export const dynamic="force-dynamic"
export const maxDuration=300
type Ctx={params:Promise<{id:string}>}
const failed=(e:unknown)=>e instanceof AdvancedEvidenceError?jsonError({status:e.status,code:e.code,error:e.message}):e instanceof SyntaxError?jsonError({status:400,code:"INVALID_JSON",error:"Send a valid JSON request."}):unexpected("processing",e)
const kick=()=>after(()=>runDueBackgroundJobs({maxJobs:2}).catch(()=>console.error("[accessibility-processing] worker kick failed")))
export async function GET(req:Request,{params}:Ctx){
 const gate=await gateAltTextHistory();if(!gate.ok)return gate.response
 const id=parseAssetId((await params).id),occurrenceId=parseOccurrenceId(new URL(req.url).searchParams.get("occurrenceId"))
 if(id===null||occurrenceId===undefined)return jsonError({status:400,code:"INVALID_REQUEST",error:"Invalid source image or occurrence."})
 try{
  const {asset,document}=await authorizeQualitySource(id,occurrenceId,gate.actor),canonicalOccurrenceId=document.kind==="document"?document.document.imageOccurrenceId:occurrenceId
  const runs=await readProcessingPipelines(id,canonicalOccurrenceId,gate.actor),actor=await loadProcessingActor(currentTenantId(),gate.actor.userId),canProcess=!!actor&&withinScope(actor.updateScope,actor.userId,asset)
  const batch=asset.batchId?await getBatch(asset.batchId):null,effectiveSettings=resolveEffectiveSettings(batch?.settings??normalizeGenerationSettings({}),asset.settingsOverride??undefined)
  return jsonOk({success:true,runs,capabilities:canProcess?await readProcessingCapabilities(id,canonicalOccurrenceId,actor!):[],canProcess,effectiveSettings,occurrenceId:canonicalOccurrenceId})
 }catch(e){return failed(e)}
}
export async function POST(req:Request,{params}:Ctx){
 const gate=await gateAltTextHistory({edit:true});if(!gate.ok)return gate.response
 const id=parseAssetId((await params).id);if(id===null)return jsonError({status:400,code:"INVALID_ID",error:"Invalid image."})
 try{
  const limited=await rateLimited("accessibility-processing",gate.actor,{max:10,windowMs:60000});if(limited)return limited
  const actor=await loadProcessingActor(currentTenantId(),gate.actor.userId)
  if(!actor)return jsonError({status:403,code:"FORBIDDEN",error:"Processing permission is unavailable."})
  const bytes=await readBody(req.body,12000),body=bytes?JSON.parse(bytes.toString("utf8")):null
  if(body?.action==="cancel"||body?.action==="retry_local"){
   if(Object.keys(body).some(k=>!["action","pipelineId","occurrenceId"].includes(k))||!Number.isSafeInteger(body.pipelineId)||body.pipelineId<=0||body.occurrenceId!=null&&(!Number.isSafeInteger(body.occurrenceId)||body.occurrenceId<=0))return jsonError({status:400,code:"INVALID_REQUEST",error:"Select a processing run and its source occurrence."})
   const result=body.action==="cancel"?await cancelProcessingPipeline(id,body.occurrenceId??null,body.pipelineId,actor):await retryLocalProcessing(id,body.occurrenceId??null,body.pipelineId,actor)
   if(body.action==="retry_local")kick()
   return jsonOk(result)
  }
  const request=parseProcessingRequest(body)
  if(!request)return jsonError({status:400,code:"INVALID_REQUEST",error:"Choose supported processing stages, settings and a request identity."})
  const result=await startProcessingPipeline(id,request,actor);if(!result.replayed)kick()
  return jsonOk({success:true,...result})
 }catch(e){return failed(e)}
}
