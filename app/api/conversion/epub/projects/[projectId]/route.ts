import {getSession} from "@/lib/auth"
import {checkRateLimit} from "@/lib/rate-limit"
import {readBody} from "@/lib/alt-text/document-extraction-run"
import {EpubIntakeError} from "@/lib/epub/intake"
import {getWorkbench,mutateWorkbench} from "@/lib/epub/workbench-store"
import {parseWorkbenchAction} from "@/lib/epub/workbench-contract"
export const runtime="nodejs"
export const dynamic="force-dynamic"
type Context={params:Promise<{projectId:string}>}
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"private, no-store"}})
const failure=(e:unknown)=>e instanceof EpubIntakeError?json({success:false,code:e.code,error:e.message},e.status):json({success:false,code:"WORKBENCH_UNAVAILABLE",error:"The project could not be read or saved. Your browser draft is kept."},503)
export async function GET(_req:Request,ctx:Context){try{const actor=await getSession();if(!actor)return json({success:false,code:"UNAUTHENTICATED"},401);const limit=await checkRateLimit(`epub-project-read:${actor.tenantId}:${actor.userId}`,{max:120,windowMs:60000});if(!limit.allowed)return json({success:false,code:"RATE_LIMITED",error:"Please wait before refreshing."},429);return json({success:true,...await getWorkbench((await ctx.params).projectId,actor)})}catch(e){return failure(e)}}
export async function POST(req:Request,ctx:Context){try{const actor=await getSession();if(!actor)return json({success:false,code:"UNAUTHENTICATED"},401);if(req.headers.get("origin")!==new URL(req.url).origin)return json({success:false,code:"ORIGIN_DENIED",error:"Save changes from this website."},403);const limit=await checkRateLimit(`epub-project-write:${actor.tenantId}:${actor.userId}`,{max:30,windowMs:60000});if(!limit.allowed)return json({success:false,code:"RATE_LIMITED",error:"Please wait before saving again."},429);const bytes=await readBody(req.body,64*1024);if(!bytes)return json({success:false,code:"BODY_LIMIT",error:"The request is empty or too large."},413);let raw:unknown;try{raw=JSON.parse(bytes.toString("utf8"))}catch{return json({success:false,code:"INVALID_REQUEST",error:"Send valid project JSON."},400)}const input=parseWorkbenchAction(raw);if(!input)return json({success:false,code:"INVALID_REQUEST",error:"Choose a valid action, saved revision and bounded fields."},400);return json({success:true,...await mutateWorkbench((await ctx.params).projectId,input,actor)})}catch(e){return failure(e)}}
