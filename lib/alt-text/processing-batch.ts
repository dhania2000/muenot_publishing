import "server-only"
import {createHash} from "node:crypto"
import {query,withTransaction} from "@/lib/db"
import {currentTenantId} from "@/lib/tenant-scope"
import {getBatch} from "./store"
import {withinScope} from "./history"
import {AdvancedEvidenceError} from "./advanced-evidence-source"
import {startProcessingPipeline} from "./processing-pipeline-store"
import {processingSummary,parseProcessingSelection,type ProcessingSelection} from "./processing-pipeline-contract"
import type {ProcessingActor} from "./processing-pipeline-source"
import type {GenerationSettings} from "./core"
/** Configuration lives in the existing batch settings JSON. Existing batch revision and
 * owner scope apply; per-image generation settings are resolved by the existing processor. */
export async function configureBatchProcessing(batchId:string,selection:ProcessingSelection|null,actor:ProcessingActor){
 if(actor.tenantId!==currentTenantId())throw new AdvancedEvidenceError(403,"TENANT_MISMATCH","The batch actor belongs to another tenant.")
 const batch=await getBatch(batchId)
 if(!batch||!withinScope(actor.viewScope,actor.userId,{createdBy:batch.createdBy,reviewerId:null}))throw new AdvancedEvidenceError(404,"NOT_FOUND","Batch not found.")
 if(!withinScope(actor.updateScope,actor.userId,{createdBy:batch.createdBy,reviewerId:null}))throw new AdvancedEvidenceError(403,"FORBIDDEN","You cannot configure this batch.")
 if(selection&&(!selection.stages.includes("generation")||!selection.billableConfirmed))throw new AdvancedEvidenceError(400,"INVALID_BATCH_SELECTION","Advanced batch processing must include description generation and explicit provider usage confirmation.")
 return withTransaction(async conn=>{
  const [rows]=await conn.query<any[]>("SELECT status,revision FROM alt_text_batches WHERE tenant_id=? AND id=? FOR UPDATE",[currentTenantId(),batchId])
  if(!rows[0]||rows[0].status!=="draft"||Number(rows[0].revision)!==batch.revision)throw new AdvancedEvidenceError(409,"BATCH_CHANGED","Only the current draft batch can change its processing modes.")
  await conn.query("UPDATE alt_text_batches SET settings=JSON_SET(settings,'$.accessibilityPipeline',CAST(? AS JSON)),revision=revision+1 WHERE tenant_id=? AND id=?",[JSON.stringify(selection),currentTenantId(),batchId])
  return {success:true,selection}
 })
}
export async function scheduleBatchImageProcessing(batchId:string,assetId:number,occurrenceId:number|null,selection:ProcessingSelection,settings:GenerationSettings,actor:ProcessingActor){
 const parsed=parseProcessingSelection({...selection,settings})
 if(!parsed||!parsed.stages.includes("generation"))throw new AdvancedEvidenceError(400,"INVALID_BATCH_SELECTION","The batch's saved processing selection is invalid.")
 const requestId=`bp_${createHash("sha256").update(JSON.stringify([batchId,assetId,occurrenceId])).digest("hex").slice(0,28)}`
 const result=await startProcessingPipeline(assetId,{requestId,occurrenceId,selection:parsed},actor)
 return {run:result.run,summary:processingSummary(result.run.progress)}
}
