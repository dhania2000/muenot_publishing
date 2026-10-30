import "server-only"
import {createHash} from "node:crypto"
import {canonicalSubmissionJson} from "./submission-contract"
import {withTransaction} from "@/lib/db"
import {runForTenant} from "@/lib/tenant-scope"
import type {BackgroundJob} from "@/lib/background-jobs"
import {JobCancelledError} from "@/lib/job-retry-policy"
import type {EpubPreflightPayload} from "./submission-contract"
export async function runEpubPreflightJob(payload:EpubPreflightPayload,ctx:{job:BackgroundJob;signal:AbortSignal}){
 return runForTenant({tenantId:ctx.job.tenant_id},()=>withTransaction(async conn=>{
  const tenant=ctx.job.tenant_id;if(ctx.signal.aborted||ctx.job.cancel_requested)throw new JobCancelledError()
  const [lease]=await conn.query<any[]>("SELECT id FROM platform_background_jobs WHERE id=? AND tenant_id=? AND job_type='epub.preflight' AND status='running' AND worker_id=? AND lease_expires_at>UTC_TIMESTAMP() AND cancel_requested=0 FOR UPDATE",[ctx.job.id,tenant,ctx.job.worker_id]);if(!lease[0])throw new JobCancelledError()
  const [projects]=await conn.query<any[]>("SELECT p.revision,p.created_by FROM conversion_projects p JOIN users u ON u.tenant_id=p.tenant_id AND u.id=p.created_by AND u.status='active' WHERE p.tenant_id=? AND p.id=? AND p.service='epub' FOR UPDATE",[tenant,payload.projectId]);if(!projects[0])throw Error("EPUB_PREFLIGHT_AUTHORITY_CHANGED")
  const [actors]=await conn.query<any[]>("SELECT u.id FROM users u WHERE u.tenant_id=? AND u.id=? AND u.status='active' AND (u.id=? OR u.role='admin' OR EXISTS(SELECT 1 FROM conversion_project_assignments a WHERE a.tenant_id=u.tenant_id AND a.project_id=? AND a.assignee_id=u.id))",[tenant,ctx.job.created_by,projects[0].created_by,payload.projectId]);if(!actors[0])throw Error("EPUB_PREFLIGHT_AUTHORITY_CHANGED")
  const [requests]=await conn.query<any[]>("SELECT status,snapshot_json,snapshot_sha256,result_json FROM conversion_preflight_requests WHERE tenant_id=? AND project_id=? AND revision=? AND job_id=? FOR UPDATE",[tenant,payload.projectId,payload.revision,ctx.job.id]);const request=requests[0];if(!request)throw Error("EPUB_PREFLIGHT_NOT_FOUND")
  let snapshot:any;const raw=typeof request.snapshot_json==='string'?request.snapshot_json:JSON.stringify(request.snapshot_json);if(Buffer.byteLength(raw)>256*1024)throw Error("EPUB_PREFLIGHT_SNAPSHOT_INVALID");snapshot=JSON.parse(raw);if(createHash("sha256").update(canonicalSubmissionJson(snapshot)).digest("hex")!==request.snapshot_sha256)throw Error("EPUB_PREFLIGHT_SNAPSHOT_CHANGED")
  if(request.result_json)return typeof request.result_json==='string'?JSON.parse(request.result_json):request.result_json
  const findings:{code:string;severity:string;detail:string}[]=[]
  const stale=Number(projects[0].revision)!==payload.revision
  if(stale)findings.push({code:"SUPERSEDED_REVISION",severity:"error",detail:"Project settings changed after this submission snapshot. Request a new preflight for the current revision."})
  const [assets]=await conn.query<any[]>("SELECT a.ordinal,a.sha256,f.checksum,f.scan_status,f.upload_status FROM conversion_project_assets a JOIN app_files f ON f.tenant_id=a.tenant_id AND f.id=a.file_id WHERE a.tenant_id=? AND a.project_id=? ORDER BY a.ordinal",[tenant,payload.projectId])
  if(assets.length!==snapshot.sources.length||assets.some((a,i)=>a.sha256!==snapshot.sources[i]?.sha256||a.checksum!==a.sha256))findings.push({code:"SOURCE_BINDING_CHANGED",severity:"error",detail:"Current source identities do not match the submitted manifest."})
  if(assets.some(a=>a.scan_status!=='clean'||a.upload_status!=='uploaded'))findings.push({code:"SOURCE_SECURITY_PENDING",severity:"error",detail:"Sources require an actual security verdict before processing."})
  findings.push({code:"CONVERSION_ENGINE_UNAVAILABLE",severity:"error",detail:"No EPUB conversion worker is connected. Metadata preflight does not execute conversion."})
  for(const detail of snapshot.serviceAssessment.warnings)findings.push({code:"SERVICE_REVIEW_REQUIRED",severity:"warning",detail})
  if(snapshot.plan.guidelineNotes?.trim())findings.push({code:"GUIDELINE_REVIEW_REQUIRED",severity:"warning",detail:"Supplied guideline notes require separate review and application."})
  if(snapshot.guidelines?.provided&&snapshot.guidelines.state!=="ready_for_work")findings.push({code:"GUIDELINES_REVIEW_REQUIRED",severity:"error",detail:"Supplied guidelines require approved, compatible rules and current source security review before production."})
  const result={preflightStatus:stale?'superseded':'blocked',revision:payload.revision,snapshotSha256:request.snapshot_sha256,findings,validationPlan:snapshot.validationPlan,conversionStarted:false}
  if(ctx.signal.aborted)throw new JobCancelledError()
  const [saved]=await conn.query<any>("UPDATE conversion_preflight_requests p JOIN platform_background_jobs j ON j.tenant_id=p.tenant_id AND j.id=p.job_id SET p.status=?,p.result_json=?,p.completed_at=UTC_TIMESTAMP() WHERE p.tenant_id=? AND p.project_id=? AND p.revision=? AND j.id=? AND j.worker_id=? AND j.status='running' AND j.lease_expires_at>UTC_TIMESTAMP() AND j.cancel_requested=0",[result.preflightStatus,JSON.stringify(result),tenant,payload.projectId,payload.revision,ctx.job.id,ctx.job.worker_id]);if(!saved.affectedRows)throw new JobCancelledError()
  await conn.query("INSERT INTO conversion_project_events (tenant_id,project_id,revision,event_type,actor_id,detail_json) VALUES (?,?,?,?,?,?)",[tenant,payload.projectId,payload.revision,"preflight_recorded",projects[0].created_by,JSON.stringify({jobId:ctx.job.id,status:result.preflightStatus})])
  return result
 }))
}
