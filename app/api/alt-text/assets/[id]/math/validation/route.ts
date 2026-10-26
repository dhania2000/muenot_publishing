import {gateAltTextHistory,jsonError,jsonOk,unexpected} from "@/lib/alt-text/route-gate"
import {parseAssetId} from "@/lib/alt-text/history"
import {MathRequestError,readMathResults} from "@/lib/alt-text/math-service"
import {readBody} from "@/lib/alt-text/document-extraction-run"
import {saveEquationValidation} from "@/lib/alt-text/math-validation-store"
import {checkRateLimit} from "@/lib/rate-limit"
import {currentTenantId} from "@/lib/tenant-scope"
export const runtime="nodejs"
export const dynamic="force-dynamic"
export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
 const gate=await gateAltTextHistory({edit:true})
 if(!gate.ok)return gate.response
 const id=parseAssetId((await params).id)
 if(id==null)return jsonError({status:400,code:"INVALID_ID",error:"Invalid image."})
 try{
  if(!(await checkRateLimit(`math-validation:${currentTenantId()}:${gate.actor.userId}`,{max:20,windowMs:60_000})).allowed)return jsonError({status:429,code:"RATE_LIMITED",error:"Please wait before validating more equations."})
  const bytes=await readBody(req.body,1024),body=bytes?JSON.parse(bytes.toString("utf8")):null
  if(!body||Object.keys(body).some((k)=>!["evidenceId","occurrenceId"].includes(k))||!Number.isSafeInteger(body.evidenceId)||body.evidenceId<=0||body.occurrenceId!=null&&(!Number.isSafeInteger(body.occurrenceId)||body.occurrenceId<=0))return jsonError({status:400,code:"INVALID_REQUEST",error:"Select a saved equation candidate."})
  const data=await readMathResults(id,body.occurrenceId??null,gate.actor)
  if(!data.canRun)return jsonError({status:403,code:"FORBIDDEN",error:"You cannot update this image."})
  const source=data.results.find((r)=>r.id===body.evidenceId)
  if(!source)return jsonError({status:404,code:"NOT_FOUND",error:"Equation evidence not found."})
  if(!source.result?.candidateLatex)return jsonError({status:409,code:"NO_MATH_CANDIDATE",error:"This recognition has no complete candidate to validate."})
  return jsonOk({success:true,...await saveEquationValidation(id,body.occurrenceId??null,source,gate.actor.userId)})
 }catch(error){
  if(error instanceof MathRequestError)return jsonError({status:error.status,code:error.code,error:error.message})
  if(error instanceof SyntaxError)return jsonError({status:400,code:"INVALID_JSON",error:"Invalid request body."})
  if(error instanceof Error&&["MATH_SOURCE_CHANGED","MATH_SOURCE_MISSING","NO_MATH_CANDIDATE"].includes(error.message))return jsonError({status:409,code:error.message,error:"The equation evidence changed. Refresh and try again."})
  return unexpected("math-validation",error)
 }
}
