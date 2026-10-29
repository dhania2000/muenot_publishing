import "server-only"
import {createHash,randomUUID} from "node:crypto"
import {query,withTransaction} from "@/lib/db"
import {ensurePlatformSchema} from "@/lib/platform-schema"
import {currentTenantId} from "@/lib/tenant-scope"
import {storePendingFileInTransaction} from "@/lib/storage"
import {detectEpubSource,parseEpubDraft,type EpubDraft} from "./intake-plan"

export const EPUB_INTAKE_BODY_LIMIT=101*1024*1024
export class EpubIntakeError extends Error{constructor(readonly status:number,readonly code:string,message:string){super(message)}}
export const EPUB_INTAKE_DDL=[
 `CREATE TABLE IF NOT EXISTS conversion_projects (tenant_id BIGINT UNSIGNED NOT NULL,id CHAR(36) NOT NULL,service VARCHAR(32) NOT NULL DEFAULT 'epub',title VARCHAR(160) NOT NULL,created_by BIGINT UNSIGNED NOT NULL,idempotency_key VARCHAR(64) NOT NULL,fingerprint CHAR(64) NOT NULL,plan_json JSON NOT NULL,status VARCHAR(32) NOT NULL DEFAULT 'held',hold_reason VARCHAR(64) NOT NULL,revision INT UNSIGNED NOT NULL DEFAULT 1,rights_confirmed_at DATETIME NOT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(tenant_id,id),UNIQUE KEY conversion_intake_request(tenant_id,service,created_by,idempotency_key),KEY conversion_project_owner(tenant_id,created_by,created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
 `CREATE TABLE IF NOT EXISTS conversion_project_assets (tenant_id BIGINT UNSIGNED NOT NULL,project_id CHAR(36) NOT NULL,ordinal INT UNSIGNED NOT NULL,file_id BIGINT UNSIGNED NOT NULL,sha256 CHAR(64) NOT NULL,source_kind VARCHAR(32) NOT NULL,PRIMARY KEY(tenant_id,project_id,ordinal),KEY conversion_asset_file(tenant_id,file_id),CONSTRAINT conversion_asset_project_fk FOREIGN KEY(tenant_id,project_id) REFERENCES conversion_projects(tenant_id,id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
] as const
let schema:Promise<void>|null=null
async function ensure(){schema??=(async()=>{await ensurePlatformSchema();for(const ddl of EPUB_INTAKE_DDL)await query(ddl)})().catch(e=>{schema=null;throw e});return schema}
export type IntakeSource={name:string;bytes:Buffer;kind:NonNullable<ReturnType<typeof detectEpubSource>>;sha256:string}
export async function parseEpubIntake(form:FormData):Promise<{plan:EpubDraft;requestId:string;sources:IntakeSource[]}>{
 if([...form.keys()].some(k=>!["plan","requestId","rightsConfirmed","sources"].includes(k))||form.getAll("plan").length!==1||form.getAll("requestId").length!==1||form.getAll("rightsConfirmed").length!==1)throw new EpubIntakeError(400,"INVALID_REQUEST","Send one project plan and request reference.")
 const requestId=form.get("requestId"),raw=form.get("plan")
 if(typeof requestId!=="string"||!/^[A-Za-z0-9_-]{8,64}$/.test(requestId)||typeof raw!=="string"||Buffer.byteLength(raw)>16*1024||form.get("rightsConfirmed")!=="true")throw new EpubIntakeError(400,"INVALID_REQUEST","Confirm source rights and send a valid bounded project plan.")
 let candidate:any;try{candidate=JSON.parse(raw)}catch{throw new EpubIntakeError(400,"INVALID_PLAN","The project plan is not valid JSON.")}
 const checked=parseEpubDraft(candidate),files=form.getAll("sources")
 if(!checked||!checked.title.trim()||!files.length||files.length>10)throw new EpubIntakeError(422,"INVALID_PLAN","Choose sources and enter a valid book title and compatible settings.")
 const sources:IntakeSource[]=[];let total=0
 for(const file of files){
  if(typeof file==="string"||file.size<1||file.size>25*1024*1024||(total+=file.size)>100*1024*1024)throw new EpubIntakeError(413,"FILE_LIMIT","Use up to 10 sources, 25 MiB each and 100 MiB total.")
  const kind=detectEpubSource(file.name)
  if(!kind||file.name.length>255||/[\x00-\x1f\\/]/.test(file.name))throw new EpubIntakeError(415,"UNSUPPORTED_SOURCE","Choose an allowed source format with a safe filename.")
  const bytes=Buffer.from(await file.arrayBuffer())
  if(bytes.length!==file.size||bytes.subarray(0,2).equals(Buffer.from("MZ"))||bytes.subarray(0,4).equals(Buffer.from([127,69,76,70])))throw new EpubIntakeError(415,"UNSAFE_SOURCE","Executable or invalid source bytes are not accepted.")
  if(kind==="pdf"&&!bytes.subarray(0,5).equals(Buffer.from("%PDF-"))||["docx","epub","idml"].includes(kind)&&!bytes.subarray(0,4).equals(Buffer.from([80,75,3,4])))throw new EpubIntakeError(415,"SOURCE_MISMATCH","The source bytes do not match the filename. Choose the original file.")
  sources.push({name:file.name,kind,bytes,sha256:createHash("sha256").update(bytes).digest("hex")})
 }
 // Source facts are derived from actual parts, never a browser's persisted metadata.
 const plan=parseEpubDraft({...checked,title:checked.title.trim(),step:4,sources:sources.map(s=>({name:s.name,kind:s.kind,size:s.bytes.length}))})
 if(!plan)throw new EpubIntakeError(422,"INVALID_PLAN","The actual sources do not satisfy project limits.")
 return {plan,requestId,sources}
}
export async function createEpubIntake(input:Awaited<ReturnType<typeof parseEpubIntake>>,actorId:number){
 await ensure();const tenant=currentTenantId(),id=randomUUID(),s=input.plan.selection,fingerprint=createHash("sha256").update(JSON.stringify([input.plan.title,input.plan.author,input.plan.guidelineNotes,[s.source,s.version,s.layout,s.rendition,s.profile],input.sources.map(f=>[f.name,f.kind,f.bytes.length,f.sha256])])).digest("hex")
 return withTransaction(async conn=>{
  // Serializes this intake's tenant quota and idempotency writes without introducing another queue.
  await conn.query("SELECT id FROM users WHERE tenant_id=? ORDER BY id LIMIT 1 FOR UPDATE",[tenant])
  const [prior]=await conn.query<any[]>("SELECT id,fingerprint,status,hold_reason,revision FROM conversion_projects WHERE tenant_id=? AND created_by=? AND idempotency_key=? AND service='epub' FOR UPDATE",[tenant,actorId,input.requestId])
  if(prior[0]){if(prior[0].fingerprint!==fingerprint)throw new EpubIntakeError(409,"REQUEST_CONFLICT","This submission reference belongs to a different plan. Start a new plan for changed work.");return receipt(prior[0],false)}
  const quota=Number(process.env.STORAGE_QUOTA_GB)||0
  if(quota>0){const [rows]=await conn.query<any[]>("SELECT COALESCE(SUM(size_bytes),0) AS used FROM app_files WHERE tenant_id=? AND upload_status<>'deleted'",[tenant]);if(Number(rows[0]?.used??0)+input.sources.reduce((n,s)=>n+s.bytes.length,0)>quota*1024**3)throw new EpubIntakeError(409,"STORAGE_QUOTA","Your organization has reached its storage quota.")}
  await conn.query("INSERT INTO conversion_projects (tenant_id,id,title,created_by,idempotency_key,fingerprint,plan_json,status,hold_reason,rights_confirmed_at) VALUES (?,?,?,?,?,?,?,'held','SECURITY_AND_ENGINE_PENDING',UTC_TIMESTAMP())",[tenant,id,input.plan.title,actorId,input.requestId,fingerprint,JSON.stringify(input.plan)])
  for(const [ordinal,s]of input.sources.entries()){
   const file=await storePendingFileInTransaction(conn,{path:`conversion/epub/${id}/${ordinal}-${randomUUID()}`,name:s.name,bytes:s.bytes,module:"conversion",entityType:"epub_project",entityId:id,ownerId:actorId})
   if(file.checksum!==s.sha256)throw new EpubIntakeError(409,"SOURCE_CHANGED","Source bytes changed during submission. Select the original source again.")
   await conn.query("INSERT INTO conversion_project_assets (tenant_id,project_id,ordinal,file_id,sha256,source_kind) VALUES (?,?,?,?,?,?)",[tenant,id,ordinal,file.fileId,s.sha256,s.kind])
  }
  return receipt({id,status:"held",hold_reason:"SECURITY_AND_ENGINE_PENDING",revision:1},true)
 })
}
function receipt(row:any,created:boolean){return {id:row.id,status:row.status,holdReason:row.hold_reason,revision:Number(row.revision),created,message:"Project received. Sources are private and pending security review. EPUB conversion is not available; no processing job or charge was created."}}
export async function listEpubIntakes(actorId:number){await ensure();return query<any[]>("SELECT id,title,status,hold_reason AS holdReason,revision,created_at AS createdAt FROM conversion_projects WHERE tenant_id=? AND created_by=? AND service='epub' ORDER BY created_at DESC,id DESC LIMIT 20",[currentTenantId(),actorId])}
