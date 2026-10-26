import {gateAltTextHistory,jsonError,jsonOk,unexpected} from "@/lib/alt-text/route-gate"
import {parseAssetId} from "@/lib/alt-text/history"
import {parseOccurrenceId} from "@/lib/alt-text/classification-service"
import {readBody} from "@/lib/alt-text/document-extraction-run"
import {AdvancedEvidenceError} from "@/lib/alt-text/advanced-evidence-source"
import {chartDataReviewSource,reviewedChartData,saveChartLabelDecision} from "@/lib/alt-text/chart-data-review"
import {parseChartLabelDecision} from "@/lib/alt-text/chart-data-contract"
import {chartDataCsv} from "@/lib/alt-text/chart-data-export"
import {rateLimited} from "@/lib/alt-text/document-review-route"
export const runtime="nodejs"
export const dynamic="force-dynamic"
type Ctx={params:Promise<{id:string;dataId:string}>}
async function ids(req:Request,ctx:Ctx){const p=await ctx.params;return {assetId:parseAssetId(p.id),dataId:parseAssetId(p.dataId),occurrenceId:parseOccurrenceId(new URL(req.url).searchParams.get("occurrenceId"))}}
const invalid=()=>jsonError({status:400,code:"INVALID_REQUEST",error:"Invalid chart data reference or review decision."})
function failure(e:unknown){return e instanceof AdvancedEvidenceError?jsonError({status:e.status,code:e.code,error:e.message}):e instanceof SyntaxError?invalid():unexpected("chart-data-review",e)}
export async function GET(req:Request,ctx:Ctx){
 const csv=new URL(req.url).searchParams.get("format")==="csv",gate=await gateAltTextHistory({withPermissions:true,export:csv});if(!gate.ok)return gate.response
 const {assetId,dataId,occurrenceId}=await ids(req,ctx);if(assetId==null||dataId==null||occurrenceId===undefined)return invalid()
 try{const data=await reviewedChartData(assetId,occurrenceId,dataId,gate.actor)
  if(csv)return new Response(chartDataCsv(data.result,data.analysisVersion),{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="chart-data-${dataId}.csv"`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}})
  let canReview=false
  if(gate.permissions?.canReview){const edit=await gateAltTextHistory({edit:true});if(edit.ok){try{await chartDataReviewSource(assetId,occurrenceId,dataId,edit.actor,true);canReview=true}catch(e){if(!(e instanceof AdvancedEvidenceError)||e.status!==403)throw e}}}
  return jsonOk({success:true,...data,canReview})
 }catch(e){return failure(e)}
}
export async function POST(req:Request,ctx:Ctx){
 const gate=await gateAltTextHistory({edit:true,review:true});if(!gate.ok)return gate.response
 const {assetId,dataId,occurrenceId}=await ids(req,ctx);if(assetId==null||dataId==null||occurrenceId===undefined)return invalid()
 try{const limited=await rateLimited("chart-label-review",gate.actor,{max:30,windowMs:60_000});if(limited)return limited
  const bytes=await readBody(req.body,8192),input=bytes?parseChartLabelDecision(JSON.parse(bytes.toString("utf8"))):null;if(!input)return invalid()
  return jsonOk({success:true,...await saveChartLabelDecision(assetId,occurrenceId,dataId,input,gate.actor)})
 }catch(e){return failure(e)}
}
