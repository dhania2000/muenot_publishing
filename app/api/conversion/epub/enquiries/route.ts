import {getSession} from "@/lib/auth"
import {checkRateLimit} from "@/lib/rate-limit"
import {readBody} from "@/lib/alt-text/document-extraction-run"
import {parseEnquiry,saveEnquiry,listEnquiries} from "@/lib/epub/enquiries"
import {EpubIntakeError} from "@/lib/epub/intake"
export const runtime="nodejs"
export const dynamic="force-dynamic"
const response=(v:unknown,status=200)=>Response.json(v,{status,headers:{"Cache-Control":"private, no-store"}})
export async function POST(req:Request){try{
 if(req.headers.get("origin")!==new URL(req.url).origin)return response({success:false,error:"Use the enquiry form on this website."},403)
 const limit=await checkRateLimit("epub-public-enquiry",{max:50,windowMs:3600000});if(!limit.allowed)return response({success:false,error:"Please try again later."},429)
 if(!req.headers.get("content-type")?.startsWith("application/json"))return response({success:false,error:"Send an enquiry form."},415)
 const bytes=await readBody(req.body,8192);if(!bytes)return response({success:false,error:"The enquiry is too large."},413)
 let input;try{input=parseEnquiry(JSON.parse(bytes.toString("utf8")))}catch{}
 if(!input)return response({success:false,error:"Check your name, email, message and contact consent."},422)
 await saveEnquiry(input);return response({success:true,message:"Enquiry received for administrator review. This is not a production submission. No account or conversion job was created."},202)
 }catch(e){if(e instanceof EpubIntakeError)return response({success:false,error:e.message},e.status);return response({success:false,error:"Enquiries are temporarily unavailable. Please retry with the same form."},503)}}
export async function GET(){try{const actor=await getSession();if(!actor)return response({success:false},401);return response({success:true,items:await listEnquiries(actor)})}catch(e){return response({success:false,error:"Enquiry inbox unavailable."},e instanceof EpubIntakeError?e.status:503)}}
