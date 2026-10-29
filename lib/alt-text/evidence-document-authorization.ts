import "server-only"
import type {HistoryActor} from "./history"
import {auditAccessibilityDenial} from "./security-audit"
/** Reuse the existing tenant, owner, scan, occurrence and current-source resolver.
 * Cached raw evidence does not bypass a document that is no longer authorized. */
export async function evidenceDocumentAllowed(assetId:number,occurrenceId:number|null,actor:HistoryActor){
 const {resolveDocumentPromptContext}=await import("./document-generation")
 const allowed=(await resolveDocumentPromptContext(assetId,actor,occurrenceId)).kind!=="ineligible"
 if(!allowed)auditAccessibilityDenial(actor.userId,"source",assetId)
 return allowed
}
