import {after} from "next/server"
import {getSession} from "@/lib/auth"
import {gateAltTextHistory,jsonError,jsonOk,unexpected} from "@/lib/alt-text/route-gate"
import {parseAssetId} from "@/lib/alt-text/history"
import {parseOccurrenceId} from "@/lib/alt-text/classification-service"
import {readBody} from "@/lib/alt-text/document-extraction-run"
import {readScientificStructure,startScientificStructure} from "@/lib/alt-text/scientific-structure-service"
import {AdvancedEvidenceError} from "@/lib/alt-text/advanced-evidence-source"
import {runDueBackgroundJobs} from "@/lib/background-jobs"
import {rateLimited} from "@/lib/alt-text/document-review-route"
export const runtime="nodejs"
export const dynamic="force-dynamic"
export const maxDuration=300
type Ctx={params:Promise<{id:string}>}
const failure=(e:unknown)=>e instanceof AdvancedEvidenceError?jsonError({status:e.status,code:e.code,error:e.message}):e instanceof SyntaxError?jsonError({status:400,code:"INVALID_JSON",error:"Invalid request body."}):e instanceof Error&&e.message==="ADVANCED_REQUEST_CONFLICT"?jsonError({status:409,code:e.message,error:"This diagram has active analysis with different source or settings. Refresh before continuing."}):unexpected("scientific-structure",e)
export async function GET(req:Request,{params}:Ctx){
 const gate=await gateAltTextHistory({withPermissions:true})
 if(!gate.ok)return gate.response
 const id=parseAssetId((await params).id),occurrence=parseOccurrenceId(new URL(req.url).searchParams.get("occurrenceId")),session=await getSession()
 if(!session)return jsonError({status:401,code:"UNAUTHENTICATED",error:"Unauthorized"})
 if(id==null||occurrence===undefined)return jsonError({status:400,code:"INVALID_ID",error:"Invalid image or occurrence."})
 try{const edit=gate.permissions?.canEdit?await gateAltTextHistory({edit:true}):null;return jsonOk(await readScientificStructure(id,occurrence,edit?.ok?edit.actor:gate.actor,session.role))}catch(e){return failure(e)}
}
export async function POST(req:Request,{params}:Ctx){
 const gate=await gateAltTextHistory({edit:true})
 if(!gate.ok)return gate.response
 const id=parseAssetId((await params).id),session=await getSession()
 if(!session)return jsonError({status:401,code:"UNAUTHENTICATED",error:"Unauthorized"})
 if(id==null)return jsonError({status:400,code:"INVALID_ID",error:"Invalid image."})
 try{
  const limited=await rateLimited("scientific-structure",gate.actor,{max:10,windowMs:60_000});if(limited)return limited
  const bytes=await readBody(req.body,2048)
  if(!bytes)return jsonError({status:413,code:"PAYLOAD_TOO_LARGE",error:"Request body is empty or too large."})
  const result=await startScientificStructure(id,JSON.parse(bytes.toString("utf8")),gate.actor,session.role)
  if(result.created)after(()=>runDueBackgroundJobs({maxJobs:1}).catch(()=>console.error("[scientific-structure] worker kick failed")))
  return jsonOk({success:true,...result})
 }catch(e){return failure(e)}
}
