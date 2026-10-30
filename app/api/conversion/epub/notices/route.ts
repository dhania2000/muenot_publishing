import {getSession} from "@/lib/auth"
import {checkRateLimit} from "@/lib/rate-limit"
import {readBody} from "@/lib/alt-text/document-extraction-run"
import {listReceiptNotices,updateReceiptNotice} from "@/lib/epub/receipt-notices"
import {EpubIntakeError} from "@/lib/epub/intake"
import {PROJECT_ID} from "@/lib/epub/workbench-contract"
export const dynamic="force-dynamic"
const response=(b:unknown,status=200)=>Response.json(b,{status,headers:{"Cache-Control":"private, no-store"}})
export async function GET(){try{const actor=await getSession();if(!actor)return response({success:false},401);if(!(await checkRateLimit(`epub-notices:${actor.tenantId}:${actor.userId}`,{max:120,windowMs:60000})).allowed)return response({success:false},429);return response({success:true,items:await listReceiptNotices(actor.userId)})}catch(e){return response({success:false,error:"Receipts could not be loaded."},e instanceof EpubIntakeError?e.status:503)}}
export async function POST(req:Request){try{const actor=await getSession();if(!actor)return response({success:false},401);if(req.headers.get('origin')!==new URL(req.url).origin)return response({success:false},403);if(!(await checkRateLimit(`epub-notice-action:${actor.tenantId}:${actor.userId}`,{max:30,windowMs:60000})).allowed)return response({success:false},429);const bytes=await readBody(req.body,512);if(!bytes)return response({success:false},413);let b;try{b=JSON.parse(bytes.toString('utf8'))}catch{return response({success:false},400)}if(!b||Object.keys(b).sort().join()!=="action,id"||typeof b.id!=="string"||!PROJECT_ID.test(b.id)||!["read","replay"].includes(b.action))return response({success:false},400);return response({success:true,...await updateReceiptNotice(b.id,b.action,actor.userId)})}catch(e){return response({success:false,error:e instanceof EpubIntakeError?e.message:"Receipt update failed. Refresh and retry."},e instanceof EpubIntakeError?e.status:503)}}
