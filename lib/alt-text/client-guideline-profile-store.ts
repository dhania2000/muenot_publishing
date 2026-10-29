import "server-only"
import {randomUUID} from "node:crypto"
import {query,withTransaction} from "@/lib/db"
import {currentTenantId} from "@/lib/tenant-scope"
import {ensureAltTextSchema,getSettingsRecord} from "./store"
import {normalizeClientGuideline,parseClientGuideline} from "./client-guideline"
import {CLIENT_GUIDELINE_ID,profilePolicy,type ClientGuidelineProfile,type ClientProfileMutation} from "./client-guideline-profiles"
export class ClientProfileError extends Error{constructor(readonly status:number,readonly code:string,message:string){super(message)}}
export const CLIENT_PROFILE_DDL=[
 `CREATE TABLE IF NOT EXISTS alt_text_client_guideline_profiles (tenant_id BIGINT UNSIGNED NOT NULL,id VARCHAR(48) NOT NULL,client_name VARCHAR(100) NOT NULL,current_version INT UNSIGNED NOT NULL,archived TINYINT(1) NOT NULL DEFAULT 0,created_by BIGINT UNSIGNED NOT NULL,updated_by BIGINT UNSIGNED NOT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(tenant_id,id),KEY client_profile_search(tenant_id,archived,client_name)) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
 `CREATE TABLE IF NOT EXISTS alt_text_client_guideline_versions (tenant_id BIGINT UNSIGNED NOT NULL,profile_id VARCHAR(48) NOT NULL,version INT UNSIGNED NOT NULL,client_name VARCHAR(100) NOT NULL,policy_json JSON NOT NULL,created_by BIGINT UNSIGNED NOT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(tenant_id,profile_id,version)) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
] as const
let schema:Promise<void>|null=null
export function ensureClientProfiles(){schema??=(async()=>{await ensureAltTextSchema();for(const ddl of CLIENT_PROFILE_DDL)await query(ddl)})().catch(e=>{schema=null;throw e});return schema}
const parsed=(v:any)=>typeof v==="string"?JSON.parse(v):v
function view(r:any):ClientGuidelineProfile{
 const policy=parseClientGuideline(parsed(r.policy_json));if(!policy.ok)throw new ClientProfileError(409,"CLIENT_GUIDELINE_INVALID","The saved client guideline needs administrator review.")
 return {...policy.value,id:r.id,version:Number(r.version),clientName:r.client_name,archived:!!r.archived,updatedAt:new Date(r.updated_at??r.created_at).toISOString()}
}
/** Idempotent additive migration of the previous single policy. Never turns it into a global selection. */
export async function importLegacyClientProfile(actorId:number){
 await ensureClientProfiles()
 const record=await getSettingsRecord(),legacy=normalizeClientGuideline(record?.clientGuideline)
 if(!legacy.clientName||!(legacy.requiredLiterals.length||legacy.forbiddenLiterals.length||legacy.requireLong))return
 const tenant=currentTenantId(),version=Math.max(1,legacy.version),{version:_,...policy}=legacy;policy.enabled=true
 await withTransaction(async conn=>{
  const [exists]=await conn.query<any[]>("SELECT id FROM alt_text_client_guideline_profiles WHERE tenant_id=? AND id='tenant-client-guideline' FOR UPDATE",[tenant]);if(exists.length)return
  await conn.query("INSERT IGNORE INTO alt_text_client_guideline_profiles (tenant_id,id,client_name,current_version,created_by,updated_by) VALUES (?,'tenant-client-guideline',?,?,?,?)",[tenant,policy.clientName,version,record?.updatedBy??actorId,actorId])
  await conn.query("INSERT IGNORE INTO alt_text_client_guideline_versions (tenant_id,profile_id,version,client_name,policy_json,created_by) VALUES (?,'tenant-client-guideline',?,?,?,?)",[tenant,version,policy.clientName,JSON.stringify(policy),record?.updatedBy??actorId])
 })
}
const SELECT=`SELECT p.id,p.archived,p.updated_at,v.version,v.client_name,v.policy_json FROM alt_text_client_guideline_profiles p JOIN alt_text_client_guideline_versions v ON v.tenant_id=p.tenant_id AND v.profile_id=p.id`
export async function listClientProfiles(search:string,page:number,includeArchived:boolean){
 await ensureClientProfiles();const tenant=currentTenantId(),where=`p.tenant_id=? ${includeArchived?"":"AND p.archived=0"} AND LOCATE(?,LOWER(p.client_name))>0`,params=[tenant,search.toLocaleLowerCase()]
 const [rows,count]=await Promise.all([query<any[]>(`${SELECT} AND v.version=p.current_version WHERE ${where} ORDER BY p.client_name,p.id LIMIT 20 OFFSET ?`,[...params,(page-1)*20]),query<any[]>(`SELECT COUNT(*) AS n FROM alt_text_client_guideline_profiles p WHERE ${where}`,params)])
 return {items:rows.map(view),total:Number(count[0]?.n??0),page,pageSize:20}
}
export async function getClientProfile(id:string,version:number,allowArchived=false){
 if(!CLIENT_GUIDELINE_ID.test(id)||!Number.isSafeInteger(version)||version<1)return null
 await ensureClientProfiles();const [r]=await query<any[]>(`${SELECT} WHERE p.tenant_id=? AND p.id=? AND v.version=? ${allowArchived?"":"AND p.archived=0"} LIMIT 1`,[currentTenantId(),id,version]);return r?view(r):null
}
export async function mutateClientProfile(input:ClientProfileMutation,actorId:number){
 await importLegacyClientProfile(actorId);const tenant=currentTenantId()
 return withTransaction(async conn=>{
  // One tenant lock serializes catalogue creation/counts; independent writers never change this row.
  await conn.query("INSERT IGNORE INTO alt_text_settings (tenant_id,settings,updated_by) VALUES (?,'{}',?)",[tenant,actorId])
  await conn.query("SELECT tenant_id FROM alt_text_settings WHERE tenant_id=? FOR UPDATE",[tenant])
  let id=input.id??randomUUID(),version=1,policy=input.policy!,archived=false
  if(input.action==="create"){
   const [counts]=await conn.query<any[]>("SELECT COUNT(*) AS n FROM alt_text_client_guideline_profiles WHERE tenant_id=?",[tenant])
   if(Number(counts[0]?.n??0)>=500)throw new ClientProfileError(409,"CLIENT_GUIDELINE_LIMIT","This organization has reached the 500-client limit.")
  }else{
   const [rows]=await conn.query<any[]>(`${SELECT} AND v.version=p.current_version WHERE p.tenant_id=? AND p.id=? FOR UPDATE`,[tenant,id]);const current=rows[0]?view(rows[0]):null
   if(!current)throw new ClientProfileError(404,"NOT_FOUND","Client guideline not found.")
   if(current.version!==input.expectedVersion)throw new ClientProfileError(409,"CLIENT_GUIDELINE_CONFLICT","This client's guidelines changed. Reload before saving.")
   if(input.action==="update"&&current.archived)throw new ClientProfileError(409,"CLIENT_GUIDELINE_ARCHIVED","Restore this client before editing its guidelines.")
   version=current.version+1;if(version>1_000_000)throw new ClientProfileError(409,"CLIENT_GUIDELINE_LIMIT","This client's version limit was reached.")
   if(!input.policy){const {id:_,version:__,archived:___,updatedAt:____,...saved}=current;policy=saved}
   archived=input.action==="archive"?true:input.action==="restore"?false:current.archived
  }
  const [sameName]=await conn.query<any[]>("SELECT id FROM alt_text_client_guideline_profiles WHERE tenant_id=? AND client_name=? AND id<>? LIMIT 1",[tenant,policy.clientName,id])
  if(sameName.length)throw new ClientProfileError(409,"CLIENT_NAME_EXISTS","A client with this name already exists. Edit or restore that client's guidelines.")
  if(input.action==="create")await conn.query("INSERT INTO alt_text_client_guideline_profiles (tenant_id,id,client_name,current_version,archived,created_by,updated_by) VALUES (?,?,?,?,0,?,?)",[tenant,id,policy.clientName,version,actorId,actorId])
  else await conn.query("UPDATE alt_text_client_guideline_profiles SET client_name=?,current_version=?,archived=?,updated_by=?,updated_at=UTC_TIMESTAMP() WHERE tenant_id=? AND id=?",[policy.clientName,version,archived?1:0,actorId,tenant,id])
  await conn.query("INSERT INTO alt_text_client_guideline_versions (tenant_id,profile_id,version,client_name,policy_json,created_by) VALUES (?,?,?,?,?,?)",[tenant,id,version,policy.clientName,JSON.stringify(policy),actorId])
  return {id,version,archived}
 })
}
export async function resolveSelectedClientGuideline(settings:{clientGuidelineId?:string|null;clientGuidelineVersion?:number|null}){
 if(settings.clientGuidelineId==null&&settings.clientGuidelineVersion==null)return null
 const row=settings.clientGuidelineId&&settings.clientGuidelineVersion?await getClientProfile(settings.clientGuidelineId,settings.clientGuidelineVersion):null
 if(!row)throw new ClientProfileError(409,"CLIENT_GUIDELINE_UNAVAILABLE","The selected client guideline is unavailable or archived. Select a client again; no generation was charged.")
 return profilePolicy(row)
}
