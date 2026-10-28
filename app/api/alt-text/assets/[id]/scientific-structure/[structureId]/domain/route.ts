import {getSession} from "@/lib/auth"
import {after} from "next/server"
import {gateAltTextHistory,jsonError,jsonOk,unexpected} from "@/lib/alt-text/route-gate"
import {parseAssetId} from "@/lib/alt-text/history"
import {parseOccurrenceId} from "@/lib/alt-text/classification-service"
import {readBody} from "@/lib/alt-text/document-extraction-run"
import {readScientificDomain,startScientificDomain} from "@/lib/alt-text/scientific-domain-service"
import {AdvancedEvidenceError} from "@/lib/alt-text/advanced-evidence-source"
import {runDueBackgroundJobs} from "@/lib/background-jobs"
import {rateLimited} from "@/lib/alt-text/document-review-route"
export const runtime="nodejs"
export const dynamic="force-dynamic"
export const maxDuration=300
type Ctx={params:Promise<{id:string;structureId:string}>}
async function identifiers(req:Request,ctx:Ctx){const p=await ctx.params;return {assetId:parseAssetId(p.id),parentId:parseAssetId(p.structureId),occurrenceId:parseOccurrenceId(new URL(req.url).searchParams.get("occurrenceId"))}}
const invalid=()=>jsonError({status:400,code:"INVALID_ID",error:"Invalid diagram, image or occurrence reference."})
function failure(error:unknown){
 if(error instanceof AdvancedEvidenceError)return jsonError({status:error.status,code:error.code,error:error.message})
 if(error instanceof SyntaxError)return jsonError({status:400,code:"INVALID_JSON",error:"Invalid request body."})
 if(error instanceof Error&&error.message==="ADVANCED_REQUEST_CONFLICT")return jsonError({status:409,code:error.message,error:"This diagram has active interpretation with different evidence. Refresh and try again."})
 return unexpected("scientific-domain",error)
}
export async function GET(req:Request,ctx:Ctx){
 const gate=await gateAltTextHistory({withPermissions:true});if(!gate.ok)return gate.response
 const {assetId,parentId,occurrenceId}=await identifiers(req,ctx)
 if(assetId==null||parentId==null||occurrenceId===undefined)return invalid()
 const session=await getSession();if(!session)return jsonError({status:401,code:"UNAUTHENTICATED",error:"Unauthorized"})
 try{const edit=gate.permissions?.canEdit?await gateAltTextHistory({edit:true}):null;return jsonOk(await readScientificDomain(assetId,occurrenceId,parentId,edit?.ok?edit.actor:gate.actor,session.role))}catch(error){return failure(error)}
}
export async function POST(req:Request,ctx:Ctx){
 const gate=await gateAltTextHistory({edit:true});if(!gate.ok)return gate.response
 const {assetId,parentId,occurrenceId}=await identifiers(req,ctx)
 if(assetId==null||parentId==null||occurrenceId===undefined)return invalid()
 const session=await getSession();if(!session)return jsonError({status:401,code:"UNAUTHENTICATED",error:"Unauthorized"})
 try{
  const limited=await rateLimited("scientific-domain",gate.actor,{max:20,windowMs:60_000});if(limited)return limited
  const bytes=await readBody(req.body,1024);if(!bytes)return jsonError({status:413,code:"PAYLOAD_TOO_LARGE",error:"The request is empty or too large."})
  const result=await startScientificDomain(assetId,occurrenceId,parentId,JSON.parse(bytes.toString("utf8")),gate.actor,session.role)
  if(result.created)after(()=>runDueBackgroundJobs({maxJobs:1}).catch(()=>console.error("[scientific-domain] worker kick failed")))
  return jsonOk({success:true,...result})
 }catch(error){return failure(error)}
}
