import {getSession} from '@/lib/auth'
import {checkRateLimit} from '@/lib/rate-limit'
import {readBody} from '@/lib/alt-text/document-extraction-run'
import {withTransaction} from '@/lib/db'
import {listPublishingProfiles,mutatePublishingProfile,readPublishingProfile} from '@/lib/epub/guideline-profile-store'
import {ensureWorkbench} from '@/lib/epub/workbench-store'
import {EpubIntakeError} from '@/lib/epub/intake'
import {GUIDELINE_ID} from '@/lib/epub/guideline-selection'
import {STANDARD_PUBLISHER_PROFILE} from '@/lib/epub/guidelines-contract'
export const runtime='nodejs'
export const dynamic='force-dynamic'
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}})
const failure=(e:unknown)=>e instanceof EpubIntakeError?json({success:false,code:e.code,error:e.message},e.status):json({success:false,code:'GUIDELINE_SERVICE_UNAVAILABLE',error:'Client profiles are temporarily unavailable. Your current draft is kept.'},503)
export async function GET(req:Request){try{const actor=await getSession();if(!actor)return json({success:false,code:'UNAUTHENTICATED'},401);if(!(await checkRateLimit(`epub-guideline-read:${actor.tenantId}:${actor.userId}`,{max:120,windowMs:60000})).allowed)return json({success:false,error:'Please wait before refreshing.'},429);const params=new URL(req.url).searchParams;if([...params.keys()].some(k=>!['q','id','version','approved'].includes(k)))return json({success:false,error:'Choose valid profile filters.'},422);if(params.has('id')){const id=params.get('id')!,version=Number(params.get('version'));if(!GUIDELINE_ID.test(id)||!Number.isSafeInteger(version)||version<1||version>10000)return json({success:false,error:'Choose a recorded profile version.'},422);await ensureWorkbench();const item=await withTransaction(conn=>readPublishingProfile(conn,{id,version},actor));return json({success:true,item})}return json({success:true,items:await listPublishingProfiles(params.get('q')??'',actor,params.get('approved')==='1'),standard:STANDARD_PUBLISHER_PROFILE,permissions:{canShare:actor.role==='admin'}})}catch(e){return failure(e)}}
export async function POST(req:Request){try{const actor=await getSession();if(!actor)return json({success:false,code:'UNAUTHENTICATED'},401);if(req.headers.get('origin')!==new URL(req.url).origin)return json({success:false,error:'Save profiles from this website.'},403);if(!(await checkRateLimit(`epub-guideline-write:${actor.tenantId}:${actor.userId}`,{max:20,windowMs:60000})).allowed)return json({success:false,error:'Please wait before saving another revision.'},429);const bytes=await readBody(req.body,160*1024);if(!bytes)return json({success:false,error:'The profile is empty or exceeds its limit.'},413);let raw;try{raw=JSON.parse(bytes.toString('utf8'))}catch{return json({success:false,error:'The profile request is invalid.'},400)}return json({success:true,...await mutatePublishingProfile(raw,actor)})}catch(e){return failure(e)}}
