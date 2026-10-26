import {gateAltTextHistory,jsonError,jsonOk,unexpected} from "@/lib/alt-text/route-gate"
import {readBody} from "@/lib/alt-text/document-extraction-run"
import {parseOcrReviewInput,parseReviewTarget} from "@/lib/alt-text/ocr-review-contract"
import {resolveOcrReviewSource,OcrReviewError} from "@/lib/alt-text/ocr-review-source"
import {readOcrReviews,readEarlierOcrReviews,saveOcrReview} from "@/lib/alt-text/ocr-review-store"
import {listOcrReviewQueue} from "@/lib/alt-text/ocr-review-queue"
import {parsePaging,rateLimited} from "@/lib/alt-text/document-review-route"
export const runtime="nodejs"
export const dynamic="force-dynamic"
function failed(error:unknown){return error instanceof OcrReviewError?jsonError({status:error.status,code:error.code,error:error.message}):error instanceof SyntaxError?jsonError({status:400,code:"INVALID_JSON",error:"Invalid request body."}):unexpected("ocr-review",error)}
export async function GET(req:Request){
 const gate=await gateAltTextHistory({withPermissions:true})
 if(!gate.ok)return gate.response
 try{
  const search=new URL(req.url).searchParams,targetQuery=search.get("target")
  if(!targetQuery){const page=parsePaging(search,25,50);if(!page.ok)return page.response;return jsonOk(await listOcrReviewQueue(gate.actor,page.page,page.pageSize,search.get("all")==="1"))}
  if(targetQuery.length>2048)return jsonError({status:400,code:"INVALID_TARGET",error:"Invalid recognition reference."})
  const target=parseReviewTarget(JSON.parse(targetQuery))
  if(!target)return jsonError({status:400,code:"INVALID_TARGET",error:"Invalid recognition reference."})
  const edit=gate.permissions?.canEdit?await gateAltTextHistory({edit:true}):null
  const source=await resolveOcrReviewSource(target,edit?.ok?edit.actor:gate.actor,gate.permissions?.canReview===true)
  const [history,earlierHistory]=await Promise.all([readOcrReviews(source),readEarlierOcrReviews(source)])
  return jsonOk({success:true,source,history,earlierHistory})
 }catch(error){return failed(error)}
}
export async function POST(req:Request){
 const gate=await gateAltTextHistory({edit:true})
 if(!gate.ok)return gate.response
 try{
  const limited=await rateLimited("ocr-evidence",gate.actor,{max:30,windowMs:60_000})
  if(limited)return limited
  const bytes=await readBody(req.body,100_000),input=bytes?parseOcrReviewInput(JSON.parse(bytes.toString("utf8"))):null
  if(!input)return jsonError({status:400,code:"INVALID_REQUEST",error:"Check the source, review state and text limits."})
  let canVerify=false
  if(input.state==="verified"){
   const review=await gateAltTextHistory({review:true,edit:true})
   if(!review.ok)return review.response
   canVerify=true
  }
  const source=await resolveOcrReviewSource(input.target,gate.actor,canVerify)
  return jsonOk({success:true,...await saveOcrReview(source,input,gate.actor.userId)})
 }catch(error){return failed(error)}
}
