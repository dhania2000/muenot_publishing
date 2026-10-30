import "server-only"
import type {PoolConnection} from "mysql2/promise"
import {withTransaction} from "@/lib/db"
import {sendMail} from "@/lib/mailer"
import {enqueueBackgroundJobInTransaction,type BackgroundJob} from "@/lib/background-jobs"
import {currentTenantId,runForTenant} from "@/lib/tenant-scope"
import {JobCancelledError} from "@/lib/job-retry-policy"
export type EpubReceiptPayload={noticeId:string;deliveryAttempt:number}
function savedJson(raw:unknown){const text=typeof raw==='string'?raw:JSON.stringify(raw);if(Buffer.byteLength(text)>32*1024)throw Error('EPUB_RECEIPT_INVALID');try{return JSON.parse(text)}catch{throw Error('EPUB_RECEIPT_INVALID')}}
export function receiptEmailState(){return process.env.EPUB_RECEIPT_EMAIL_ENABLED!=="true"?'disabled':process.env.RESEND_API_KEY&&process.env.EMAIL_FROM?'queued':'configuration_required'}
/** Existing mail transport and queue; payloads carry references, never addresses or manuscripts. */
export async function queueReceiptEmail(conn:PoolConnection,noticeId:string,deliveryAttempt:number,actorId:number){
 const tenant=currentTenantId(),state=receiptEmailState();if(state==='disabled'&&deliveryAttempt===1)return
 let jobId:number|null=null
 if(state==='queued')({jobId}=await enqueueBackgroundJobInTransaction(conn as any,{jobType:'epub.receipt_notice',tenantId:tenant,payload:{noticeId,deliveryAttempt},idempotencyKey:`epub-receipt:${noticeId}:${deliveryAttempt}`,createdBy:actorId,triggerSource:'system',priority:5,maxAttempts:3,timeoutSeconds:30,concurrencyKey:`epub:receipts:${tenant}`,concurrencyLimit:1}))
 await conn.query('UPDATE conversion_receipt_notices SET mail_status=?,mail_job_id=?,mail_payload_json=NULL WHERE tenant_id=? AND id=?',[state,jobId,tenant,noticeId])
}
export async function runEpubReceiptJob(payload:EpubReceiptPayload,ctx:{job:BackgroundJob;signal:AbortSignal}){
 return runForTenant({tenantId:ctx.job.tenant_id},async()=>{
  const tenant=ctx.job.tenant_id
  const lease=async(conn:PoolConnection)=>{if(ctx.signal.aborted||ctx.job.cancel_requested)throw new JobCancelledError();const [rows]=await conn.query<any[]>("SELECT id FROM platform_background_jobs WHERE tenant_id=? AND id=? AND job_type='epub.receipt_notice' AND status='running' AND worker_id=? AND lease_expires_at>UTC_TIMESTAMP() AND cancel_requested=0 FOR UPDATE",[tenant,ctx.job.id,ctx.job.worker_id]);if(!rows.length)throw new JobCancelledError()}
  const prepared=await withTransaction(async conn=>{
   await lease(conn)
   const [rows]=await conn.query<any[]>("SELECT n.body_json,n.project_id,n.revision,n.delivery_attempts,n.mail_job_id,n.mail_status,n.mail_payload_json,u.email,p.status AS current_status FROM conversion_receipt_notices n JOIN conversion_projects p ON p.tenant_id=n.tenant_id AND p.id=n.project_id AND p.created_by=n.recipient_id AND p.service='epub' JOIN users u ON u.tenant_id=n.tenant_id AND u.id=n.recipient_id AND u.status='active' WHERE n.tenant_id=? AND n.id=? FOR UPDATE",[tenant,payload.noticeId]),n=rows[0]
   if(!n)throw Error('EPUB_RECEIPT_AUTHORITY_CHANGED')
   if(Number(n.delivery_attempts)!==payload.deliveryAttempt||Number(n.mail_job_id)!==ctx.job.id)return null
   if(n.mail_status==='sent')return null
   if(receiptEmailState()!=='queued')throw Error('MAIL_NOT_CONFIGURED')
   if(typeof n.email!=='string'||n.email.length>254||!/^[^\s@<>\x00-\x1f\x7f]+@[^\s@<>\x00-\x1f\x7f]+\.[^\s@<>\x00-\x1f\x7f]+$/.test(n.email))throw Error('EPUB_RECEIPT_RECIPIENT_INVALID')
   if(n.mail_payload_json){const packet=savedJson(n.mail_payload_json),age=Date.now()-Date.parse(packet.preparedAt);if(!Number.isFinite(age)||age< -60000||age>23*3600000)throw Error('EPUB_RECEIPT_DELIVERY_UNKNOWN_REVIEW');if(packet.from!==process.env.EMAIL_FROM||packet.mail?.to!==n.email)throw Error('EPUB_RECEIPT_ENVELOPE_CHANGED');return {...packet.mail,projectId:n.project_id,revision:Number(n.revision)}}
   const receipt=savedJson(n.body_json)
   const text=`EPUB intake receipt\nProject: ${n.project_id}\nSubmitted revision: ${n.revision}\nSubmitted: ${receipt.submittedAt}\nSubmitted assets: ${receipt.assets.length}\nOriginal submitted status: ${receipt.submittedStatus}\nPortal status as of ${new Date().toISOString()}: ${n.current_status}\n${receipt.nextSteps}\nSign in to the EPUB project portal to review the private asset manifest and current status. No manuscript attachment or access token is included.`
   const mail={to:n.email,subject:'EPUB intake receipt',text,html:`<p>${text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!)).replaceAll('\n','<br/>')}</p>`}
   await conn.query('UPDATE conversion_receipt_notices SET mail_payload_json=? WHERE tenant_id=? AND id=? AND mail_job_id=? AND delivery_attempts=?',[JSON.stringify({preparedAt:new Date().toISOString(),from:process.env.EMAIL_FROM,mail}),tenant,payload.noticeId,ctx.job.id,payload.deliveryAttempt])
   return {...mail,projectId:n.project_id,revision:Number(n.revision)}
  })
  if(!prepared)return {sent:false,alreadyRecordedOrSuperseded:true}
  const {projectId,revision,...mail}=prepared
  const signal=AbortSignal.any([ctx.signal,AbortSignal.timeout(10000)])
  await sendMail(mail,{requireConfiguration:true,idempotencyKey:`epub-receipt:${tenant}:${payload.noticeId}:${payload.deliveryAttempt}`,signal})
  await withTransaction(async conn=>{
   await lease(conn)
   const [saved]=await conn.query<any>("UPDATE conversion_receipt_notices SET mail_status='sent',updated_at=UTC_TIMESTAMP() WHERE tenant_id=? AND id=? AND mail_job_id=? AND delivery_attempts=?",[tenant,payload.noticeId,ctx.job.id,payload.deliveryAttempt])
   if(saved.affectedRows)await conn.query('INSERT INTO conversion_project_events (tenant_id,project_id,revision,event_type,actor_id,detail_json) VALUES (?,?,?,?,?,?)',[tenant,projectId,revision,'receipt_email_sent',ctx.job.created_by,JSON.stringify({noticeId:payload.noticeId,attempt:payload.deliveryAttempt,jobId:ctx.job.id})])
  })
  return {sent:true}
 })
}
