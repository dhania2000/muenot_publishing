import {queueReceiptEmail} from "./receipt-notification"
import "server-only"
import {createHash,randomUUID} from "node:crypto"
import type {PoolConnection} from "mysql2/promise"
import {enqueueBackgroundJobInTransaction} from "@/lib/background-jobs"
import {currentTenantId} from "@/lib/tenant-scope"
import {canonicalSubmissionJson} from "./submission-contract"
import type {EpubDraft} from "./intake-plan"
import {epubValidationPlan} from "./reader-requirements"
import {compatibilityCaveats} from "./selection-policy"
import {parseServiceRequest,serviceRequestAssessment} from "./service-request"
import {epubPlanningCapabilities} from "./planning-capabilities"
type SourceFact={name:string;sha256:string;kind:string;size:number}
export async function recordEpubSubmission(conn:PoolConnection,id:string,actorId:number,plan:EpubDraft,sources:SourceFact[],manifestSha256:string,revision=1,recipientId=actorId){
 const tenant=currentTenantId(),submittedAt=new Date(),snapshot={schemaVersion:1,submittedAt:submittedAt.toISOString(),projectId:id,revision,plan,manifestSha256,sources:sources.map((s,ordinal)=>({ordinal,name:s.name,kind:s.kind,sha256:s.sha256,size:s.size,purpose:plan.sources[ordinal]?.purpose??"main"})),compatibility:compatibilityCaveats(plan),validationPlan:epubValidationPlan(plan),serviceAssessment:serviceRequestAssessment(parseServiceRequest(plan.serviceRequest)!,submittedAt),capabilities:epubPlanningCapabilities(),pricingNotice:"No price or delivery promise is accepted by this submission; complexity/capacity review is required."},json=canonicalSubmissionJson(snapshot),snapshotSha256=createHash("sha256").update(json).digest("hex")
 await conn.query("INSERT INTO conversion_preflight_requests (tenant_id,project_id,revision,snapshot_sha256,snapshot_json,created_at) VALUES (?,?,?,?,?,?)",[tenant,id,revision,snapshotSha256,json,submittedAt])
 const {jobId}=await enqueueBackgroundJobInTransaction(conn as any,{jobType:"epub.preflight",tenantId:tenant,payload:{projectId:id,revision,stage:"preflight"},idempotencyKey:`epub:${id}:r${revision}:preflight`,createdBy:actorId,triggerSource:"user_request",priority:5,maxAttempts:3,timeoutSeconds:60,concurrencyKey:`epub:preflight:${tenant}`,concurrencyLimit:1})
 await conn.query("UPDATE conversion_preflight_requests SET job_id=? WHERE tenant_id=? AND project_id=? AND revision=?",[jobId,tenant,id,revision])
 const noticeId=randomUUID(),notice={projectId:id,revision,submittedAt:submittedAt.toISOString(),submittedStatus:"held",manifestSha256,assets:snapshot.sources,nextSteps:"Metadata preflight has been requested; open the project timeline for its current assessment. Sources remain held for security review and EPUB conversion availability. No conversion charge was made."}
 await conn.query("INSERT INTO conversion_receipt_notices (tenant_id,id,project_id,revision,recipient_id,body_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",[tenant,noticeId,id,revision,recipientId,JSON.stringify(notice),submittedAt,submittedAt])
 await conn.query("INSERT INTO conversion_project_events (tenant_id,project_id,revision,event_type,actor_id,detail_json) VALUES (?,?,?,?,?,?)",[tenant,id,revision,"receipt_notice_created",actorId,JSON.stringify({noticeId,jobId,snapshotSha256})])
 await queueReceiptEmail(conn,noticeId,1,actorId)
 return {submittedAt:submittedAt.toISOString(),preflightJobId:jobId,snapshotSha256,noticeId}
}
