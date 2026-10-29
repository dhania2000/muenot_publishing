import {getSession} from "@/lib/auth"
import {checkRateLimit} from "@/lib/rate-limit"
import {readBody} from "@/lib/alt-text/document-extraction-run"
import {EPUB_CHUNK_BYTES} from "@/lib/epub/upload-contract"
import {readUpload,putUploadChunk,changeUpload} from "@/lib/epub/upload-store"
import {EpubIntakeError} from "@/lib/epub/intake"
export const runtime="nodejs"
export const dynamic="force-dynamic"
type Context={params:Promise<{uploadId:string}>}
const response=(body:unknown,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"private, no-store"}})
let activeMutations=0
async function handle(req:Request,ctx:Context,method:"GET"|"PUT"|"POST"){let acquired=false;try{
 const actor=await getSession();if(!actor)return response({success:false},401)
 if(method!=="GET"&&req.headers.get("origin")!==new URL(req.url).origin)return response({success:false},403)
 if(!(await checkRateLimit(`epub-upload:${actor.tenantId}:${actor.userId}`,{max:180,windowMs:60000})).allowed)return response({success:false,error:"Please wait before continuing uploads."},429)
 if(method!=="GET"){if(activeMutations>=2)return response({success:false,error:"Upload workers are busy. Retry this chunk shortly."},429);activeMutations++;acquired=true}
 const {uploadId}=await ctx.params,token=req.headers.get("x-upload-token")??""
 if(method==="GET")return response({success:true,...await readUpload(uploadId,token,actor.userId)})
 if(method==="PUT"){const bytes=await readBody(req.body,EPUB_CHUNK_BYTES);if(!bytes)return response({success:false,error:"Chunk is empty or exceeds 1 MiB."},413);const rawIndex=req.headers.get("x-chunk-index")??"";if(!/^\d{1,2}$/.test(rawIndex))return response({success:false,error:"Invalid chunk index."},422);return response({success:true,...await putUploadChunk(uploadId,token,actor.userId,Number(rawIndex),req.headers.get("x-chunk-sha256")??"",bytes)})}
 const bytes=await readBody(req.body,128);if(!bytes)return response({success:false},413);let action;try{const b=JSON.parse(bytes.toString("utf8"));if(Object.keys(b).join()!=="action")return response({success:false},400);action=b.action}catch{return response({success:false},400)}if(!["pause","resume","cancel","seal"].includes(action))return response({success:false,error:"Choose a valid upload action."},400)
 const result=await changeUpload(uploadId,token,actor.userId,action);return response({success:result.status!=="rejected",...result},result.status==="rejected"?415:200)
 }catch(e){return response({success:false,error:e instanceof EpubIntakeError?e.message:"Upload temporarily unavailable. Resume with the same file."},e instanceof EpubIntakeError?e.status:503)}finally{if(acquired)activeMutations--}}
export const GET=(req:Request,ctx:Context)=>handle(req,ctx,"GET")
export const PUT=(req:Request,ctx:Context)=>handle(req,ctx,"PUT")
export const POST=(req:Request,ctx:Context)=>handle(req,ctx,"POST")
