import "server-only"
import {randomUUID} from "node:crypto"
import {query,withTransaction} from "@/lib/db"
import {ensurePlatformSchema} from "@/lib/platform-schema"
import {DEFAULT_TENANT_ID,currentTenantId} from "@/lib/tenant-scope"
import {EpubIntakeError} from "./intake"

export const ENQUIRY_DDL=`CREATE TABLE IF NOT EXISTS conversion_enquiries (tenant_id BIGINT UNSIGNED NOT NULL,id CHAR(36) NOT NULL,request_key VARCHAR(64) NOT NULL,name VARCHAR(100) NOT NULL,email VARCHAR(254) NOT NULL,message TEXT NOT NULL,status VARCHAR(16) NOT NULL DEFAULT 'new',created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(tenant_id,id),UNIQUE KEY enquiry_request(tenant_id,request_key),KEY enquiry_inbox(tenant_id,status,created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
let schema:Promise<void>|null=null
async function ensure(){schema??=(async()=>{await ensurePlatformSchema();await query(ENQUIRY_DDL)})().catch(e=>{schema=null;throw e});return schema}
export type EpubEnquiry={requestId:string;name:string;email:string;message:string;website:string;consent:true}
export function parseEnquiry(v:unknown):EpubEnquiry|null{
 if(!v||typeof v!=="object"||Array.isArray(v))return null
 const p=v as Record<string,unknown>
 if(Object.keys(p).sort().join()!=="consent,email,message,name,requestId,website"||p.consent!==true||p.website!==""||typeof p.requestId!=="string"||!/^[A-Za-z0-9_-]{16,64}$/.test(p.requestId))return null
 for(const [k,max]of [["name",100],["email",254],["message",2000]] as const){const s=p[k];if(typeof s!=="string"||!s.trim()||s.length>max||!s.isWellFormed()|| (k==="message"?/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/:/[\x00-\x1f\x7f]/).test(s))return null}
 if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(String(p.email)))return null
 return {...p,name:String(p.name).trim(),email:String(p.email).trim().toLowerCase(),message:String(p.message).trim()} as EpubEnquiry
}
/** Public enquiries belong only to this installation's configured organisation, never a browser tenant. */
export async function saveEnquiry(input:EpubEnquiry){
 await ensure();return withTransaction(async conn=>{
  const [owners]=await conn.query<any[]>("SELECT id FROM users WHERE tenant_id=? ORDER BY id LIMIT 1 FOR UPDATE",[DEFAULT_TENANT_ID]);if(!owners.length)throw new EpubIntakeError(503,"ENQUIRY_UNAVAILABLE","Enquiries are not configured for this installation.")
  const [prior]=await conn.query<any[]>("SELECT id FROM conversion_enquiries WHERE tenant_id=? AND request_key=?",[DEFAULT_TENANT_ID,input.requestId]);if(prior.length)return
  const [count]=await conn.query<any[]>("SELECT COUNT(*) AS n FROM conversion_enquiries WHERE tenant_id=? AND created_at>DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 HOUR)",[DEFAULT_TENANT_ID])
  if(Number(count[0]?.n??0)>=50)throw new EpubIntakeError(429,"ENQUIRY_LIMIT","Please try again later.")
  await conn.query("INSERT INTO conversion_enquiries (tenant_id,id,request_key,name,email,message) VALUES (?,?,?,?,?,?)",[DEFAULT_TENANT_ID,randomUUID(),input.requestId,input.name,input.email,input.message])
 })
}
/** A new row is the durable in-app notification; no email is sent or PII logged. */
export async function listEnquiries(actor:{role:string}){if(actor.role!=="admin")throw new EpubIntakeError(403,"FORBIDDEN","Administrator access required.");await ensure();return query<any[]>("SELECT id,name,email,message,status,created_at AS createdAt FROM conversion_enquiries WHERE tenant_id=? ORDER BY created_at DESC,id DESC LIMIT 50",[currentTenantId()])}
