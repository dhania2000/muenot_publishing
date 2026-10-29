import {getSession} from "@/lib/auth"
import {readBody} from "@/lib/alt-text/document-extraction-run"
import {checkRateLimit} from "@/lib/rate-limit"
import {EpubIntakeError} from "@/lib/epub/intake"
import {parseSettingPreset} from "@/lib/epub/workbench-contract"
import {listPresets,savePreset} from "@/lib/epub/workbench-store"
export const runtime="nodejs"
export const dynamic="force-dynamic"
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"private, no-store"}})
export async function GET(){try{const actor=await getSession();if(!actor)return json({success:false},401);return json({success:true,items:await listPresets(),canManage:actor.role==="admin"})}catch{return json({success:false,error:"Setting templates could not be loaded."},503)}}
export async function POST(req:Request){try{const actor=await getSession();if(!actor)return json({success:false},401);if(actor.role!=="admin")return json({success:false,error:"Only administrators publish templates."},403);if(req.headers.get("origin")!==new URL(req.url).origin)return json({success:false},403);if(!(await checkRateLimit(`epub-presets:${actor.tenantId}:${actor.userId}`,{max:20,windowMs:60000})).allowed)return json({success:false},429);const bytes=await readBody(req.body,16*1024);if(!bytes)return json({success:false,error:"Template body is too large."},413);let body;try{body=JSON.parse(bytes.toString("utf8"))}catch{return json({success:false,error:"Send valid template JSON."},400)}const input=parseSettingPreset(body);if(!input)return json({success:false,error:"Choose a valid name and compatible settings."},422);return json({success:true,...await savePreset(input,actor)},201)}catch(e){return e instanceof EpubIntakeError?json({success:false,code:e.code,error:e.message},e.status):json({success:false,error:"The template could not be saved."},503)}}
