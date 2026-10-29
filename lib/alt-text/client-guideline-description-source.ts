import "server-only"
import {query} from "@/lib/db"
import {currentTenantId} from "@/lib/tenant-scope"
import {getClientProfile,ClientProfileError} from "./client-guideline-profile-store"
import {profilePolicy} from "./client-guideline-profiles"
/** QA follows this saved image's selected version, never another writer's current settings. */
export async function descriptionClientGuideline(asset:{id:number;currentVersion:number;settingsOverride?:{clientGuidelineId?:string|null;clientGuidelineVersion?:number|null}|null}){
 const selection=asset.settingsOverride
 if(selection&&Object.prototype.hasOwnProperty.call(selection,"clientGuidelineId")){
  if(selection.clientGuidelineId==null)return null
  const profile=await getClientProfile(selection.clientGuidelineId,Number(selection.clientGuidelineVersion),true)
  if(!profile)throw new ClientProfileError(409,"CLIENT_GUIDELINE_UNAVAILABLE","The description's saved client guideline version could not be found.")
  return profilePolicy(profile)
 }
 // Older descriptions predate per-work selection. Preserve only their recorded snapshot.
 const [row]=await query<any[]>(`SELECT JSON_EXTRACT(generation_evidence_json,'$.clientGuideline') AS client_policy FROM alt_text_versions WHERE tenant_id=? AND asset_id=? AND version<=? AND action='generated' ORDER BY version DESC,id DESC LIMIT 1`,[currentTenantId(),asset.id,asset.currentVersion])
 const p=typeof row?.client_policy==="string"?JSON.parse(row.client_policy):row?.client_policy
 if(p==null)return null
 if(typeof p.id!=="string"||p.id.length>80||typeof p.version!=="string"||p.version.length>80||!Array.isArray(p.rules)||p.rules.length>10||p.rules.some((r:any)=>!r||!["required_literal","forbidden_literal","require_long"].includes(r.type)||r.type!=="require_long"&&(typeof r.text!=="string"||!r.text||r.text.length>100)))throw new ClientProfileError(409,"CLIENT_GUIDELINE_INVALID","The historical guideline snapshot needs review.")
 return p as import("./advanced-quality-contract").QualityGuideline
}
