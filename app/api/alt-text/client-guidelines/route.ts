import {getSession} from "@/lib/auth"
import {hasActionGrant} from "@/lib/permission-store"
import {gateAltTextHistory,jsonError,jsonOk,unexpected} from "@/lib/alt-text/route-gate"
import {readBody} from "@/lib/alt-text/document-extraction-run"
import {rateLimited} from "@/lib/alt-text/document-review-route"
import {CLIENT_GUIDELINE_ID,parseClientProfileMutation} from "@/lib/alt-text/client-guideline-profiles"
import {ClientProfileError,getClientProfile,importLegacyClientProfile,listClientProfiles,mutateClientProfile} from "@/lib/alt-text/client-guideline-profile-store"
export const runtime="nodejs"
export const dynamic="force-dynamic"
async function manager(){const s=await getSession();return !!s&&(s.role==="admin"||await hasActionGrant(s.userId,s.role,"publishing.alt_text","manage_settings"))}
const failure=(e:unknown)=>e instanceof ClientProfileError?jsonError({status:e.status,code:e.code,error:e.message}):unexpected("client-guidelines",e)
export async function GET(req:Request){
 const gate=await gateAltTextHistory();if(!gate.ok)return gate.response
 try{
  const limited=await rateLimited("client-guidelines-read",gate.actor,{max:120,windowMs:60000});if(limited)return limited
  const sp=new URL(req.url).searchParams,id=sp.get("id"),version=Number(sp.get("version")),page=Number(sp.get("page")??1),search=(sp.get("q")??"").normalize("NFC").trim()
  if(search.length>100||!search.isWellFormed()||!Number.isSafeInteger(page)||page<1||page>1000)return jsonError({status:400,code:"INVALID_QUERY",error:"Invalid client search or page."})
  await importLegacyClientProfile(gate.actor.userId)
  if(id!==null){if(!CLIENT_GUIDELINE_ID.test(id)||!Number.isSafeInteger(version)||version<1||version>1_000_000)return jsonError({status:400,code:"INVALID_QUERY",error:"Select a client and saved version."});const profile=await getClientProfile(id,version,true);return profile?jsonOk({success:true,profile}):jsonError({status:404,code:"NOT_FOUND",error:"Client guideline not found."})}
  const canManage=await manager(),result=await listClientProfiles(search,page,sp.get("includeArchived")==="1"&&canManage)
  return jsonOk({success:true,...result,canManage})
 }catch(e){return failure(e)}
}
export async function POST(req:Request){
 const gate=await gateAltTextHistory();if(!gate.ok)return gate.response
 try{
  if(!await manager())return jsonError({status:403,code:"FORBIDDEN",error:"Manage settings permission is required to save client guidelines."})
  const limited=await rateLimited("client-guidelines-write",gate.actor,{max:30,windowMs:60000});if(limited)return limited
  const bytes=await readBody(req.body,16*1024);if(!bytes)return jsonError({status:413,code:"PAYLOAD_TOO_LARGE",error:"Client guideline body is empty or too large."})
  let body:unknown;try{body=JSON.parse(bytes.toString("utf8"))}catch{return jsonError({status:400,code:"INVALID_REQUEST",error:"Send valid client guideline JSON."})}
  const input=parseClientProfileMutation(body);if(!input)return jsonError({status:400,code:"INVALID_REQUEST",error:"Choose a valid client name, up to 10 literal rules and the current saved version."})
  const saved=await mutateClientProfile(input,gate.actor.userId)
  console.info("[alt-text/client-guidelines] saved",{actorId:gate.actor.userId,profileId:saved.id,version:saved.version,action:input.action})
  return jsonOk({success:true,...saved})
 }catch(e){return failure(e)}
}
