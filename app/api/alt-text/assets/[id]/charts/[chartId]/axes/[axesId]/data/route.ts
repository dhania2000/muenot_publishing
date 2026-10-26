import {after} from "next/server"
import {gateAltTextHistory,jsonError,jsonOk,unexpected} from "@/lib/alt-text/route-gate"
import {parseAssetId} from "@/lib/alt-text/history"
import {parseOccurrenceId} from "@/lib/alt-text/classification-service"
import {readBody} from "@/lib/alt-text/document-extraction-run"
import {authorizedChartDataParent,readChartData,startChartData} from "@/lib/alt-text/chart-data-service"
import {AdvancedEvidenceError} from "@/lib/alt-text/advanced-evidence-source"
import {runDueBackgroundJobs} from "@/lib/background-jobs"
import {rateLimited} from "@/lib/alt-text/document-review-route"
export const runtime="nodejs"
export const dynamic="force-dynamic"
export const maxDuration=300
type Ctx={params:Promise<{id:string;chartId:string;axesId:string}>}
async function identifiers(req:Request,ctx:Ctx){const p=await ctx.params;return {chartId:parseAssetId(p.chartId),assetId:parseAssetId(p.id),parentId:parseAssetId(p.axesId),occurrenceId:parseOccurrenceId(new URL(req.url).searchParams.get("occurrenceId"))}}
const invalid=()=>jsonError({status:400,code:"INVALID_ID",error:"Invalid chart, image or occurrence reference."})
function failure(error:unknown){
 if(error instanceof AdvancedEvidenceError)return jsonError({status:error.status,code:error.code,error:error.message})
 if(error instanceof SyntaxError)return jsonError({status:400,code:"INVALID_JSON",error:"Invalid request body."})
 if(error instanceof Error&&error.message==="ADVANCED_REQUEST_CONFLICT")return jsonError({status:409,code:error.message,error:"This chart has active interpretation with different evidence. Refresh and try again."})
 return unexpected("chart-data",error)
}
export async function GET(req:Request,ctx:Ctx){
 const gate=await gateAltTextHistory({withPermissions:true});if(!gate.ok)return gate.response
 const {chartId,assetId,parentId,occurrenceId}=await identifiers(req,ctx)
 if(chartId==null||assetId==null||parentId==null||occurrenceId===undefined)return invalid()
 try{const scoped=await authorizedChartDataParent(assetId,occurrenceId,parentId,gate.actor);if(scoped.parent.chart.id!==chartId)return invalid();const edit=gate.permissions?.canEdit?await gateAltTextHistory({edit:true}):null;return jsonOk(await readChartData(assetId,occurrenceId,parentId,edit?.ok?edit.actor:gate.actor))}catch(error){return failure(error)}
}
export async function POST(req:Request,ctx:Ctx){
 const gate=await gateAltTextHistory({edit:true});if(!gate.ok)return gate.response
 const {chartId,assetId,parentId,occurrenceId}=await identifiers(req,ctx)
 if(chartId==null||assetId==null||parentId==null||occurrenceId===undefined)return invalid()
 try{
  const scoped=await authorizedChartDataParent(assetId,occurrenceId,parentId,gate.actor,true);if(scoped.parent.chart.id!==chartId)return invalid()
  const limited=await rateLimited("chart-data-extraction",gate.actor,{max:20,windowMs:60_000});if(limited)return limited
  const bytes=await readBody(req.body,1024);if(!bytes)return jsonError({status:413,code:"PAYLOAD_TOO_LARGE",error:"The request is empty or too large."})
  const result=await startChartData(assetId,occurrenceId,parentId,JSON.parse(bytes.toString("utf8")),gate.actor)
  if(result.created)after(()=>runDueBackgroundJobs({maxJobs:1}).catch(()=>console.error("[chart-data] worker kick failed")))
  return jsonOk({success:true,...result})
 }catch(error){return failure(error)}
}
