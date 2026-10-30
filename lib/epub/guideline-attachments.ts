import 'server-only'
import {withTransaction} from '@/lib/db'
import {currentTenantId} from '@/lib/tenant-scope'
import {ensureWorkbench,projectRow,commitEpubProjectRevision} from './workbench-store'
import {EpubIntakeError} from './intake'
import {parseEpubDraft} from './intake-plan'
import {persistGuidelineInputs} from './guideline-documents'
import type {GuidelineInput} from './guideline-ingestion'
import type {WorkbenchActor} from './workbench-contract'
export async function attachProjectGuidelines(projectId:string,expectedRevision:number,inputs:GuidelineInput[],actor:WorkbenchActor){
 if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1||!inputs.length||inputs.length>3)throw new EpubIntakeError(422,'INVALID_GUIDELINE_ATTACHMENT','Choose source files and the current saved project revision.')
 await ensureWorkbench();return withTransaction(async conn=>{
  await conn.query('SELECT id FROM users WHERE tenant_id=? ORDER BY id LIMIT 1 FOR UPDATE',[currentTenantId()]);const p=await projectRow(projectId,actor,conn)
  if(Number(p.revision)!==expectedRevision)throw new EpubIntakeError(409,'REVISION_CONFLICT','This project changed. Reload before adding guidelines.')
  const files=[...(p.plan.guidelineFiles??[]),...inputs.map(g=>({name:g.name,size:g.size,format:g.format}))],plan=parseEpubDraft({...p.plan,guidelineFiles:files})
  if(!plan)throw new EpubIntakeError(413,'GUIDELINE_LIMIT','Use at most three guideline files of 5 MiB each, within the 100 MiB project limit.')
  const quota=Number(process.env.STORAGE_QUOTA_GB)||0
  if(quota>0){const [usage]=await conn.query<any[]>("SELECT COALESCE(SUM(size_bytes),0) AS used FROM app_files WHERE tenant_id=? AND upload_status<>'deleted'",[currentTenantId()]);const [reserved]=await conn.query<any[]>("SELECT COALESCE(SUM(total_size),0) AS reserved FROM conversion_upload_sessions WHERE tenant_id=? AND status IN ('open','paused','sealed') AND expires_at>UTC_TIMESTAMP()",[currentTenantId()]);if(Number(usage[0]?.used??0)+Number(reserved[0]?.reserved??0)+inputs.reduce((n,g)=>n+g.size,0)>quota*1024**3)throw new EpubIntakeError(409,'STORAGE_QUOTA','Your organization has reached its storage quota.')}
  const result=await commitEpubProjectRevision(conn,p,plan,actor.userId,'guidelines_attached'),documents=await persistGuidelineInputs(conn,projectId,inputs,actor.userId)
  return {...result,documents,message:'Guidelines received privately. Source review and approved rules are required; previous evidence is retained.'}
 })
}
