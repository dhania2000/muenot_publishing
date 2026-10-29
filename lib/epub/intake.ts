import "server-only"
import type {PoolConnection} from "mysql2/promise"
import {EPUB_UPLOAD_DDL} from "./upload-contract"
import {PackageInspectionError} from "./package-inspection"
import {PROJECT_EVENTS_DDL} from "./project-events"
import {createHash,randomUUID} from "node:crypto"
import {query,withTransaction} from "@/lib/db"
import {ensurePlatformSchema} from "@/lib/platform-schema"
import {currentTenantId} from "@/lib/tenant-scope"
import {storePendingFileInTransaction} from "@/lib/storage"
import {detectEpubSource,parseEpubDraft,type EpubDraft} from "./intake-plan"
import {classifyEpubSource} from "./source-classification"
import {inspectEpubSource,SourceInspectionError,type SourceInspection} from "./source-inspection"
import {DEFAULT_EPUB_CONFIGURATION} from "./configuration"

export const EPUB_INTAKE_BODY_LIMIT=101*1024*1024
export class EpubIntakeError extends Error{constructor(readonly status:number,readonly code:string,message:string,readonly details?:unknown){super(message)}}
export const SOURCE_INSPECTIONS_DDL=`CREATE TABLE IF NOT EXISTS conversion_source_inspections (tenant_id BIGINT UNSIGNED NOT NULL,project_id CHAR(36) NOT NULL,ordinal INT UNSIGNED NOT NULL,inspection_json JSON NOT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(tenant_id,project_id,ordinal)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
export const UPLOAD_REJECTIONS_DDL=`CREATE TABLE IF NOT EXISTS conversion_upload_rejections (tenant_id BIGINT UNSIGNED NOT NULL,id CHAR(36) NOT NULL,actor_id BIGINT UNSIGNED NULL,sha256 CHAR(64) NOT NULL,code VARCHAR(48) NOT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(tenant_id,id),KEY upload_rejections(tenant_id,created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
export const EPUB_INTAKE_DDL=[
 ...EPUB_UPLOAD_DDL,
 UPLOAD_REJECTIONS_DDL,
 SOURCE_INSPECTIONS_DDL,
 PROJECT_EVENTS_DDL,
 `CREATE TABLE IF NOT EXISTS conversion_projects (tenant_id BIGINT UNSIGNED NOT NULL,id CHAR(36) NOT NULL,service VARCHAR(32) NOT NULL DEFAULT 'epub',title VARCHAR(160) NOT NULL,created_by BIGINT UNSIGNED NOT NULL,idempotency_key VARCHAR(64) NOT NULL,fingerprint CHAR(64) NOT NULL,plan_json JSON NOT NULL,status VARCHAR(32) NOT NULL DEFAULT 'held',hold_reason VARCHAR(64) NOT NULL,revision INT UNSIGNED NOT NULL DEFAULT 1,rights_confirmed_at DATETIME NOT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(tenant_id,id),UNIQUE KEY conversion_intake_request(tenant_id,service,created_by,idempotency_key),KEY conversion_project_owner(tenant_id,created_by,created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
 `CREATE TABLE IF NOT EXISTS conversion_project_assets (tenant_id BIGINT UNSIGNED NOT NULL,project_id CHAR(36) NOT NULL,ordinal INT UNSIGNED NOT NULL,file_id BIGINT UNSIGNED NOT NULL,sha256 CHAR(64) NOT NULL,source_kind VARCHAR(32) NOT NULL,PRIMARY KEY(tenant_id,project_id,ordinal),KEY conversion_asset_file(tenant_id,file_id),CONSTRAINT conversion_asset_project_fk FOREIGN KEY(tenant_id,project_id) REFERENCES conversion_projects(tenant_id,id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
] as const
let schema:Promise<void>|null=null
export async function ensureEpubIntake(){schema??=(async()=>{await ensurePlatformSchema();for(const ddl of EPUB_INTAKE_DDL)await query(ddl)})().catch(e=>{schema=null;throw e});return schema}
export type IntakeSource={name:string;bytes:Buffer;kind:NonNullable<ReturnType<typeof detectEpubSource>>;sha256:string;inspection?:SourceInspection}
export async function parseEpubIntake(form:FormData,actorId?:number):Promise<{plan:EpubDraft;requestId:string;sources:IntakeSource[]}>{
 if([...form.keys()].some(k=>!["plan","requestId","rightsConfirmed","sources"].includes(k))||form.getAll("plan").length!==1||form.getAll("requestId").length!==1||form.getAll("rightsConfirmed").length!==1)throw new EpubIntakeError(400,"INVALID_REQUEST","Send one project plan and request reference.")
 const requestId=form.get("requestId"),raw=form.get("plan")
 if(typeof requestId!=="string"||!/^[A-Za-z0-9_-]{8,64}$/.test(requestId)||typeof raw!=="string"||Buffer.byteLength(raw)>16*1024||form.get("rightsConfirmed")!=="true")throw new EpubIntakeError(400,"INVALID_REQUEST","Confirm source rights and send a valid bounded project plan.")
 let candidate:any;try{candidate=JSON.parse(raw)}catch{throw new EpubIntakeError(400,"INVALID_PLAN","The project plan is not valid JSON.")}
 const checked=parseEpubDraft(candidate),files=form.getAll("sources")
 if(!checked||!checked.title.trim()||!files.length||files.length>10)throw new EpubIntakeError(422,"INVALID_PLAN","Choose sources and enter a valid book title and compatible settings.")
 const sources:IntakeSource[]=[],failures:{ordinal:number;name:string;code:string;error:string}[]=[];let total=0
 for(const [ordinal,file]of files.entries()){
  if(typeof file==="string"||file.size<1||file.size>25*1024*1024||(total+=file.size)>100*1024*1024)throw new EpubIntakeError(413,"FILE_LIMIT","Use up to 10 sources, 25 MiB each and 100 MiB total.")
  const kind=detectEpubSource(file.name)
  if(!kind||file.name.length>255||/[\x00-\x1f\\/]/.test(file.name))throw new EpubIntakeError(415,"UNSUPPORTED_SOURCE","Choose an allowed source format with a safe filename.")
  const bytes=Buffer.from(await file.arrayBuffer())
  if(bytes.length!==file.size)throw new EpubIntakeError(415,"SOURCE_MISMATCH","The file changed while reading it.")
  let inspection:SourceInspection;try{inspection=await classifyEpubSource(inspectEpubSource(file.name,bytes,file.type),bytes)}catch(e){if(e instanceof SourceInspectionError||e instanceof PackageInspectionError){const code=e instanceof SourceInspectionError?e.code:"UNSAFE_PACKAGE";await ensureEpubIntake();await query("INSERT INTO conversion_upload_rejections (tenant_id,id,actor_id,sha256,code) VALUES (?,?,?,?,?)",[currentTenantId(),randomUUID(),actorId??null,createHash("sha256").update(bytes).digest("hex"),code]);failures.push({ordinal,name:file.name,code,error:e.message});continue}throw e}
  sources.push({name:file.name,kind,bytes,sha256:inspection.sha256,inspection})
 }
 if(failures.length)throw new EpubIntakeError(415,"SOURCE_VALIDATION_FAILED","Some sources need correction. No files were uploaded.",{files:files.map((f,i)=>{const failure=failures.find(x=>x.ordinal===i);return failure?{...failure,status:"rejected"}:{ordinal:i,name:typeof f==="string"?"":f.name,status:"not_uploaded"}})})
 // Source facts are derived from actual parts, never a browser's persisted metadata.
 const plan=parseEpubDraft({...checked,title:checked.title.trim(),step:4,sources:sources.map((s,i)=>({name:s.name,kind:s.kind,size:s.bytes.length,...(checked.sources[i]?.purpose?{purpose:checked.sources[i].purpose}:{})}))})
 if(!plan)throw new EpubIntakeError(422,"INVALID_PLAN","The actual sources do not satisfy project limits.")
 return {plan,requestId,sources}
}
export async function createEpubIntake(input:Awaited<ReturnType<typeof parseEpubIntake>>,actorId:number,options:{connection?:PoolConnection;reservedCredit?:number}={}){
 await ensureEpubIntake();const tenant=currentTenantId(),id=randomUUID(),s=input.plan.selection,parts:unknown[]=[input.plan.title,input.plan.author,input.plan.guidelineNotes,[s.source,s.version,s.layout,s.rendition,s.profile],input.sources.map(f=>[f.name,f.kind,f.bytes.length,f.sha256])]
 if(input.plan.configuration&&JSON.stringify(input.plan.configuration)!==JSON.stringify(DEFAULT_EPUB_CONFIGURATION))parts.push(input.plan.configuration)
 if(input.plan.sources.some(f=>f.purpose&&f.purpose!=="main"))parts.push(input.plan.sources.map(f=>f.purpose??"main"))
 const manifestSha256=createHash("sha256").update(JSON.stringify(input.sources.map((f,i)=>({ordinal:i,name:f.name,sha256:f.sha256,size:f.bytes.length,kind:f.kind,purpose:input.plan.sources[i]?.purpose??"main"})))).digest("hex")
 const fileReceipts=input.sources.map((f,ordinal)=>{const first=input.sources.findIndex(s=>s.sha256===f.sha256);return {ordinal,name:f.name,status:"received_security_pending",purpose:input.plan.sources[ordinal]?.purpose??"main",...(first<ordinal?{duplicateOfOrdinal:first}:{})}})
 const fingerprint=createHash("sha256").update(JSON.stringify(parts)).digest("hex")
 const persist=async(conn:PoolConnection)=>{
  // Serializes this intake's tenant quota and idempotency writes without introducing another queue.
  await conn.query("SELECT id FROM users WHERE tenant_id=? ORDER BY id LIMIT 1 FOR UPDATE",[tenant])
  const [prior]=await conn.query<any[]>("SELECT id,fingerprint,status,hold_reason,revision FROM conversion_projects WHERE tenant_id=? AND created_by=? AND idempotency_key=? AND service='epub' FOR UPDATE",[tenant,actorId,input.requestId])
  if(prior[0]){if(prior[0].fingerprint!==fingerprint)throw new EpubIntakeError(409,"REQUEST_CONFLICT","This submission reference belongs to a different plan. Start a new plan for changed work.");return {...receipt(prior[0],false),manifestSha256,files:fileReceipts}}
  const quota=Number(process.env.STORAGE_QUOTA_GB)||0
  if(quota>0){const [rows]=await conn.query<any[]>("SELECT COALESCE(SUM(size_bytes),0) AS used FROM app_files WHERE tenant_id=? AND upload_status<>'deleted'",[tenant]);const [reserved]=await conn.query<any[]>("SELECT COALESCE(SUM(total_size),0) AS reserved FROM conversion_upload_sessions WHERE tenant_id=? AND status IN ('open','paused','sealed') AND expires_at>UTC_TIMESTAMP()",[tenant]);if(Number(rows[0]?.used??0)+Number(reserved[0]?.reserved??0)-(options.reservedCredit??0)+input.sources.reduce((n,s)=>n+s.bytes.length,0)>quota*1024**3)throw new EpubIntakeError(409,"STORAGE_QUOTA","Your organization has reached its storage quota.")}
  await conn.query("INSERT INTO conversion_projects (tenant_id,id,title,created_by,idempotency_key,fingerprint,plan_json,status,hold_reason,rights_confirmed_at) VALUES (?,?,?,?,?,?,?,'held','SECURITY_AND_ENGINE_PENDING',UTC_TIMESTAMP())",[tenant,id,input.plan.title,actorId,input.requestId,fingerprint,JSON.stringify(input.plan)])
  const storedByChecksum=new Map<string,{fileId:number;checksum:string}>()
  for(const [ordinal,s]of input.sources.entries()){
   if(createHash("sha256").update(s.bytes).digest("hex")!==s.sha256)throw new EpubIntakeError(409,"SOURCE_CHANGED","Source checksum changed before storage.")
   const inspection=s.inspection??await classifyEpubSource(inspectEpubSource(s.name,s.bytes),s.bytes)
   const file=storedByChecksum.get(s.sha256)??await storePendingFileInTransaction(conn,{path:`conversion/epub/${id}/${ordinal}-${randomUUID()}`,name:s.name,bytes:s.bytes,module:"conversion",entityType:"epub_project",entityId:id,ownerId:actorId})
   storedByChecksum.set(s.sha256,file)
   if(file.checksum!==s.sha256)throw new EpubIntakeError(409,"SOURCE_CHANGED","Source bytes changed during submission. Select the original source again.")
   await conn.query("INSERT INTO conversion_project_assets (tenant_id,project_id,ordinal,file_id,sha256,source_kind) VALUES (?,?,?,?,?,?)",[tenant,id,ordinal,file.fileId,s.sha256,s.kind])
   await conn.query("INSERT INTO conversion_source_inspections (tenant_id,project_id,ordinal,inspection_json) VALUES (?,?,?,?)",[tenant,id,ordinal,JSON.stringify(inspection)])
  }
  await conn.query("INSERT INTO conversion_project_events (tenant_id,project_id,revision,event_type,actor_id,detail_json) VALUES (?,?,1,'project_received',?,?)",[tenant,id,actorId,JSON.stringify({sourceCount:input.sources.length,status:"held",manifestSha256})])
  return {...receipt({id,status:"held",hold_reason:"SECURITY_AND_ENGINE_PENDING",revision:1},true),manifestSha256,files:fileReceipts}
 }
 return options.connection?persist(options.connection):withTransaction(persist)
}
function receipt(row:any,created:boolean){return {id:row.id,status:row.status,holdReason:row.hold_reason,revision:Number(row.revision),created,message:"Project received. Sources are private and pending security review. EPUB conversion is not available; no processing job or charge was created."}}
export async function listEpubIntakes(actorId:number){await ensureEpubIntake();return query<any[]>("SELECT id,title,status,hold_reason AS holdReason,revision,created_at AS createdAt FROM conversion_projects WHERE tenant_id=? AND created_by=? AND service='epub' ORDER BY created_at DESC,id DESC LIMIT 20",[currentTenantId(),actorId])}
