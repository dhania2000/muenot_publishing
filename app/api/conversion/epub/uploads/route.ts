import {getSession} from "@/lib/auth"
import {checkRateLimit} from "@/lib/rate-limit"
import {readBody} from "@/lib/alt-text/document-extraction-run"
import {parseUploadStart} from "@/lib/epub/upload-contract"
import {startUpload} from "@/lib/epub/upload-store"
import {EpubIntakeError} from "@/lib/epub/intake"
export const runtime="nodejs"
export const dynamic="force-dynamic"
const uploadResponse=(body:unknown,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"private, no-store"}})
export async function POST(req:Request){try{const actor=await getSession();if(!actor)return uploadResponse({success:false},401);if(req.headers.get("origin")!==new URL(req.url).origin)return uploadResponse({success:false},403);if(!(await checkRateLimit(`epub-upload-start:${actor.tenantId}:${actor.userId}`,{max:30,windowMs:60000})).allowed)return uploadResponse({success:false,error:"Please wait before starting more files."},429);const bytes=await readBody(req.body,2048);if(!bytes)return uploadResponse({success:false,error:"Upload metadata is too large."},413);let input;try{input=parseUploadStart(JSON.parse(bytes.toString("utf8")))}catch{}if(!input)return uploadResponse({success:false,error:"Choose a valid file, size and SHA-256 checksum."},422);return uploadResponse({success:true,...await startUpload(input,actor.userId)},201)}catch(e){return uploadResponse({success:false,error:e instanceof EpubIntakeError?e.message:"Upload staging is temporarily unavailable."},e instanceof EpubIntakeError?e.status:503)}}
