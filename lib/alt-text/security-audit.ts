import "server-only"
import {currentTenantId} from "@/lib/tenant-scope"
/** Existing structured server logs, metadata only. Never accept messages, raw text,
 * URLs, filenames, provider bodies or credentials as audit arguments. */
export function auditAccessibilityDenial(userId:number,action:"source"|"export"|"review",assetId:number){
 console.warn("[alt-text/security]",{tenantId:currentTenantId(),userId,assetId,action,code:"ACCESS_DENIED"})
}
