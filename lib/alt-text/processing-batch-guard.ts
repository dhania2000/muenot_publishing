import "server-only"
import {query} from "@/lib/db"
import {currentTenantId} from "@/lib/tenant-scope"
import {JobDeferredError,JobCancelledError} from "@/lib/job-retry-policy"
/** Existing image batch controls apply at source/provider checkpoints. Page OCR remains
 * governed by its document job and never acquires an image occurrence identity. */
export async function guardProcessingBatchAsset(assetId:number){
 const [row]=await query<any[]>("SELECT b.status FROM alt_text_assets a JOIN alt_text_batches b ON a.batch_id=b.id AND a.tenant_id=b.tenant_id WHERE a.tenant_id=? AND a.id=? LIMIT 1",[currentTenantId(),assetId])
 const status=row?.status
 if(status==="cancel_requested"||status==="cancelled")throw new JobCancelledError("BATCH_CANCELLED")
 if(status==="pause_requested"||status==="paused")throw new JobDeferredError("ACCESSIBILITY_BATCH_PAUSED",30)
}
