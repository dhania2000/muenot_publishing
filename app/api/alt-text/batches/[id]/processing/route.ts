import {gateAltTextHistory,jsonError,jsonOk,unexpected} from "@/lib/alt-text/route-gate"
import {BATCH_ID_PATTERN,ownsBatch} from "@/lib/alt-text/batch-progress"
import {getBatch} from "@/lib/alt-text/store"
import {currentTenantId} from "@/lib/tenant-scope"
import {query} from "@/lib/db"
import {readBody} from "@/lib/alt-text/document-extraction-run"
import {parseProcessingSelection} from "@/lib/alt-text/processing-pipeline-contract"
import {loadProcessingActor} from "@/lib/alt-text/processing-pipeline-source"
import {configureBatchProcessing} from "@/lib/alt-text/processing-batch"
import {AdvancedEvidenceError} from "@/lib/alt-text/advanced-evidence-source"
import {ensureEvidenceSchema} from "@/lib/alt-text/math-store"
import {rateLimited} from "@/lib/alt-text/document-review-route"
export const runtime="nodejs"
export const dynamic="force-dynamic"
type Ctx={params:Promise<{id:string}>}
const failed=(e:unknown)=>e instanceof AdvancedEvidenceError?jsonError({status:e.status,code:e.code,error:e.message}):e instanceof SyntaxError?jsonError({status:400,code:"INVALID_JSON",error:"Invalid JSON."}):unexpected("batch-processing",e)
export async function GET(_req:Request,{params}:Ctx){
 const gate=await gateAltTextHistory();if(!gate.ok)return gate.response
 const id=(await params).id;if(!BATCH_ID_PATTERN.test(id))return jsonError({status:400,code:"INVALID_ID",error:"Invalid batch."})
 try{
  const batch=await getBatch(id);if(!batch||!ownsBatch(gate.actor,batch))return jsonError({status:404,code:"NOT_FOUND",error:"Batch not found."})
  if(!batch.accessibilityPipeline)return jsonOk({success:true,enabled:false})
  await ensureEvidenceSchema()
  const rows=await query<any[]>(`SELECT e.status,JSON_EXTRACT(e.result_json,'$.nodes[*].state') AS states FROM alt_text_accessibility_evidence e JOIN alt_text_assets a ON e.asset_id=a.id AND e.tenant_id=a.tenant_id WHERE e.tenant_id=? AND a.batch_id=? AND e.kind='processing_pipeline' AND NOT EXISTS (SELECT 1 FROM alt_text_accessibility_evidence newer WHERE newer.tenant_id=e.tenant_id AND newer.asset_id=e.asset_id AND newer.occurrence_key=e.occurrence_key AND newer.kind=e.kind AND newer.id>e.id) LIMIT 501`,[currentTenantId(),id])
  const stages:Record<string,number>={},runs:Record<string,number>={}
  for(const row of rows.slice(0,500)){runs[row.status]=(runs[row.status]??0)+1;const states=typeof row.states==="string"?JSON.parse(row.states):row.states;for(const state of Array.isArray(states)?states:[])stages[state]=(stages[state]??0)+1}
  return jsonOk({success:true,enabled:true,selection:batch.accessibilityPipeline,runs,stages,scheduledImages:Math.min(rows.length,500),truncated:rows.length>500,humanReviewRequired:true})
 }catch(e){return failed(e)}
}
export async function POST(req:Request,{params}:Ctx){
 const gate=await gateAltTextHistory({edit:true});if(!gate.ok)return gate.response
 const id=(await params).id;if(!BATCH_ID_PATTERN.test(id))return jsonError({status:400,code:"INVALID_ID",error:"Invalid batch."})
 try{
  const limit=await rateLimited("batch-processing-selection",gate.actor,{max:10,windowMs:60000});if(limit)return limit
  const bytes=await readBody(req.body,12000),body=bytes?JSON.parse(bytes.toString("utf8")):null
  if(!body||typeof body!=="object"||Array.isArray(body)||Object.keys(body).some(k=>k!=="selection")||!Object.hasOwn(body,"selection"))return jsonError({status:400,code:"INVALID_REQUEST",error:"Select processing modes for this draft batch."})
  const selection=body.selection===null?null:parseProcessingSelection(body.selection)
  if(body.selection!==null&&!selection)return jsonError({status:400,code:"INVALID_SELECTION",error:"Unsupported processing selection."})
  const actor=await loadProcessingActor(currentTenantId(),gate.actor.userId)
  if(!actor)return jsonError({status:403,code:"FORBIDDEN",error:"Processing permission unavailable."})
  return jsonOk(await configureBatchProcessing(id,selection,actor))
 }catch(e){return failed(e)}
}
