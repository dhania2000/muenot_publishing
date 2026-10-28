import {gateAltTextHistory,jsonError,jsonOk,unexpected} from "@/lib/alt-text/route-gate"
import {parseStructuredQueue,listStructuredReviewQueue} from "@/lib/alt-text/structured-review-queue"
export const runtime="nodejs"
export const dynamic="force-dynamic"
export async function GET(req:Request){
 const gate=await gateAltTextHistory();if(!gate.ok)return gate.response
 const filter=parseStructuredQueue(new URL(req.url).searchParams)
 if(!filter)return jsonError({status:400,code:"INVALID_FILTER",error:"Check review queue filters and pagination."})
 try{return jsonOk(await listStructuredReviewQueue(gate.actor,filter))}catch(e){return unexpected("structured-review-queue",e)}
}
