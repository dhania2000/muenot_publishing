import { after } from "next/server"
import { gateAltTextHistory, jsonError, jsonOk, unexpected } from "@/lib/alt-text/route-gate"
import { parseAssetId } from "@/lib/alt-text/history"
import { parseOccurrenceId } from "@/lib/alt-text/classification-service"
import { MathRequestError, readMathResults, startMathRecognition } from "@/lib/alt-text/math-service"
import { readBody } from "@/lib/alt-text/document-extraction-run"
import { checkRateLimit } from "@/lib/rate-limit"
import { currentTenantId } from "@/lib/tenant-scope"
import { runDueBackgroundJobs } from "@/lib/background-jobs"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300
type Ctx = { params: Promise<{ id: string }> }
function failure(error: unknown) {
  if (error instanceof MathRequestError) return jsonError({status:error.status,code:error.code,error:error.message})
  if (error instanceof SyntaxError) return jsonError({status:400,code:"INVALID_JSON",error:"Request body must be valid JSON."})
  if (error instanceof Error && error.message === "MATH_REQUEST_CONFLICT") return jsonError({status:409,code:error.message,error:"This region or request changed. Refresh before submitting again."})
  return unexpected("math",error)
}
export async function GET(req: Request, {params}: Ctx) {
  const gate=await gateAltTextHistory({withPermissions:true})
  if(!gate.ok)return gate.response
  const id=parseAssetId((await params).id),occurrenceId=parseOccurrenceId(new URL(req.url).searchParams.get("occurrenceId"))
  if(id==null||occurrenceId===undefined)return jsonError({status:400,code:"INVALID_ID",error:"Invalid image or occurrence."})
  try{
    const edit=gate.permissions?.canEdit?await gateAltTextHistory({edit:true}):null
    return jsonOk(await readMathResults(id,occurrenceId,edit?.ok?edit.actor:gate.actor))
  }catch(error){return failure(error)}
}
export async function POST(req: Request,{params}:Ctx){
  const gate=await gateAltTextHistory({edit:true})
  if(!gate.ok)return gate.response
  const id=parseAssetId((await params).id)
  if(id==null)return jsonError({status:400,code:"INVALID_ID",error:"Invalid image."})
  try{
    const limit=await checkRateLimit(`math:${currentTenantId()}:${gate.actor.userId}`,{max:10,windowMs:60_000})
    if(!limit.allowed)return jsonError({status:429,code:"RATE_LIMITED",error:"Please wait before starting more recognition work."})
    const bytes=await readBody(req.body,2048)
    if(!bytes)return jsonError({status:413,code:"PAYLOAD_TOO_LARGE",error:"The request is empty or too large."})
    const result=await startMathRecognition(id,JSON.parse(bytes.toString("utf8")),gate.actor)
    if(result.created)after(()=>runDueBackgroundJobs({maxJobs:1}).catch(()=>console.error("[math] worker kick failed")))
    return jsonOk({success:true,...result})
  }catch(error){return failure(error)}
}
