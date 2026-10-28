import {gateAltTextHistory,jsonError,jsonOk,unexpected} from "@/lib/alt-text/route-gate"
import {parseAssetId} from "@/lib/alt-text/history"
import {parseOccurrenceId} from "@/lib/alt-text/classification-service"
import {AdvancedEvidenceError} from "@/lib/alt-text/advanced-evidence-source"
import {readBody} from "@/lib/alt-text/document-extraction-run"
import {rateLimited} from "@/lib/alt-text/document-review-route"
import {readAdvancedQuality,saveAdvancedQuality} from "@/lib/alt-text/advanced-quality-store"
import {qualityCsv} from "@/lib/alt-text/advanced-quality-contract"
export const runtime="nodejs"
export const dynamic="force-dynamic"
type Ctx={params:Promise<{id:string}>}
const failed=(e:unknown)=>e instanceof AdvancedEvidenceError?jsonError({status:e.status,code:e.code,error:e.message}):e instanceof SyntaxError?jsonError({status:400,code:"INVALID_JSON",error:"Invalid JSON request."}):e instanceof Error&&/^QUALITY_/.test(e.message)?jsonError({status:422,code:e.message,error:"The saved QA input exceeds supported limits or has an unsupported policy."}):unexpected("advanced-quality",e)
export async function GET(req:Request,{params}:Ctx){
 const url=new URL(req.url),download=url.searchParams.get("download"),gate=await gateAltTextHistory({export:download!==null})
 if(!gate.ok)return gate.response
 const id=parseAssetId((await params).id),occurrence=parseOccurrenceId(url.searchParams.get("occurrenceId"))
 if(id===null||occurrence===undefined||download!==null&&!["json","csv"].includes(download))return jsonError({status:400,code:"INVALID_REQUEST",error:"Invalid image, occurrence or report format."})
 try{
  const result=await readAdvancedQuality(id,occurrence,gate.actor)
  if(!download)return jsonOk(result)
  if(!result.report)return jsonError({status:404,code:"NO_REPORT",error:"Run QA on this saved image before exporting its report."})
  const body=download==="json"?JSON.stringify({report:result.report,sourceCurrent:result.sourceCurrent},null,2):qualityCsv(result.report,result.sourceCurrent===true)
  return new Response(body,{headers:{"Content-Type":download==="json"?"application/json; charset=utf-8":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="image-${id}-qa-${result.report.runId}.${download}"`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","X-QA-Snapshot-Current":String(result.sourceCurrent)}})
 }catch(e){return failed(e)}
}
export async function POST(req:Request,{params}:Ctx){
 const gate=await gateAltTextHistory({edit:true});if(!gate.ok)return gate.response
 const id=parseAssetId((await params).id);if(id===null)return jsonError({status:400,code:"INVALID_ID",error:"Invalid image."})
 try{
  const limited=await rateLimited("advanced-quality",gate.actor,{max:10,windowMs:60000});if(limited)return limited
  const bytes=await readBody(req.body,2048),b=bytes?JSON.parse(bytes.toString("utf8")):null
  if(!b||typeof b!=="object"||Array.isArray(b)||Object.keys(b).some(k=>!["requestId","occurrenceId"].includes(k))||typeof b.requestId!=="string"||!/^[A-Za-z0-9_-]{8,48}$/.test(b.requestId)||b.occurrenceId!=null&&(!Number.isSafeInteger(b.occurrenceId)||b.occurrenceId<=0))return jsonError({status:400,code:"INVALID_REQUEST",error:"Select a saved source occurrence and validation request. Client findings or guidelines are not accepted."})
  return jsonOk({success:true,...await saveAdvancedQuality(id,b.occurrenceId??null,b.requestId,gate.actor)})
 }catch(e){return failed(e)}
}
