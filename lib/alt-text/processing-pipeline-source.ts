import "server-only"
import {createHash} from "node:crypto"
import {currentTenantId} from "@/lib/tenant-scope"
import {getTenantAiSettings} from "@/lib/ai/assistant-store"
import {resolveTenantModels} from "@/lib/ai/model-catalog"
import {hasActionGrant,getScope} from "@/lib/permission-store"
import {query} from "@/lib/db"
import {authorizeQualitySource} from "./advanced-quality-source"
import {withinScope} from "./history"
import {openAltTextImage} from "./preview"
import {readImageBytes,type GenerateActor} from "./generate"
import {getSettingsRecord} from "./store"
import {regionCapability} from "./region-service"
import {ocrPolicy} from "./ocr-service"
import {mathPolicy} from "./math-service"
import {chartPolicy} from "./chart-service"
import {chartAxisPolicy} from "./chart-axis-service"
import {chartDataPolicy} from "./chart-data-service"
import {scientificStructurePolicy} from "./scientific-structure-service"
import {scientificDomainPolicy} from "./scientific-domain-service"
import {illustrationPolicy} from "./illustration-service"
import {selectVisionModel} from "./vision-service"
import {AdvancedEvidenceError} from "./advanced-evidence-source"
import {PROCESSING_STAGES,BILLABLE_PROCESSING_STAGES,PROCESSING_LIMITS,type ProcessingStage} from "./processing-pipeline-contract"
export type ProcessingActor=GenerateActor
export type ProcessingCapability={stage:ProcessingStage;available:boolean;billable:boolean;reason:string|null}
export async function loadProcessingActor(tenantId:number,userId:number):Promise<ProcessingActor|null>{
 const [user]=await query<any[]>("SELECT id,role,status FROM users WHERE tenant_id=? AND id=? LIMIT 1",[tenantId,userId])
 if(!user||user.status!=null&&user.status!=="active")return null
 const role=user.role==="admin"?"admin":"employee",[viewScope,updateScope]=await Promise.all([getScope(userId,role,"publishing.alt_text","view"),getScope(userId,role,"publishing.alt_text","update")])
 return viewScope==="none"||updateScope==="none"?null:{userId,tenantId,role,viewScope,updateScope}
}
export async function processingSourceMetadata(assetId:number,occurrenceId:number|null,actor:ProcessingActor){
 if(actor.tenantId!==currentTenantId())throw new AdvancedEvidenceError(403,"TENANT_MISMATCH","The processing actor belongs to another tenant.")
 const authorized=await authorizeQualitySource(assetId,occurrenceId,actor)
 if(!withinScope(actor.updateScope,actor.userId,authorized.asset))throw new AdvancedEvidenceError(403,"FORBIDDEN","You cannot process this image.")
 return authorized
}
export async function processingSourceFingerprint(assetId:number,occurrenceId:number|null,actor:ProcessingActor){
 const meta=await processingSourceMetadata(assetId,occurrenceId,actor),image=await openAltTextImage(assetId,{tenantId:actor.tenantId,userId:actor.userId,scope:actor.viewScope})
 if(!image.ok)throw new AdvancedEvidenceError(image.status,image.code,image.error)
 const bytes=await readImageBytes(image.body,PROCESSING_LIMITS.imageBytes)
 if(!bytes)throw new AdvancedEvidenceError(413,"PIPELINE_SOURCE_LIMIT","The source exceeds the bounded advanced-processing image limit.")
 return {...meta,sourceSha256:createHash("sha256").update(bytes).digest("hex"),documentId:meta.document.kind==="document"?meta.document.document.documentId:null,locationLabel:meta.document.kind==="document"?meta.document.document.locationLabel:null}
}
/** Existing service policy/readiness functions only. No recognition, model call, reservation or queue mutation. */
export async function readProcessingCapabilities(assetId:number,occurrenceId:number|null,actor:ProcessingActor){
 await processingSourceMetadata(assetId,occurrenceId,actor)
 const checks:Partial<Record<ProcessingStage,()=>Promise<{available?:boolean;enabled?:boolean;reason?:string|null}>>>= {
  regions:async()=>{const capability=await regionCapability({tenantId:actor.tenantId,role:actor.role});return {available:capability.status==="available",enabled:true,reason:capability.reason}},
  ocr:async()=>{const p=await ocrPolicy(actor);return {available:p.capability.status==="available",enabled:p.policy.enabled,reason:p.policy.reason??p.capability.reason}},
  math:mathPolicy,chart:()=>chartPolicy(actor.role),axes:chartAxisPolicy,graph_data:chartDataPolicy,science:()=>scientificStructurePolicy(actor.role),domain:()=>scientificDomainPolicy(actor.role),illustration:()=>illustrationPolicy(actor.role),
  generation:async()=>{if(actor.role!=="admin"&&!await hasActionGrant(actor.userId,actor.role,"publishing.alt_text","generate"))return {available:false,enabled:false,reason:"Description generation requires the existing Generate permission."};const [tenant,settings]=await Promise.all([getTenantAiSettings(),getSettingsRecord()]),models=await resolveTenantModels(actor.tenantId,tenant,actor.role);selectVisionModel({usable:models.usable,tenantSettings:tenant,preferredModelId:settings.settings.preferredModelId,defaultModelId:models.defaultModel?.id,fallbackModelId:models.fallbackModel?.id});return {available:true,enabled:true}}
 }
 const statuses=await Promise.allSettled(PROCESSING_STAGES.map(async(stage):Promise<ProcessingCapability>=>{
  if(stage==="classification"||stage==="math_validation"||stage==="qa")return {stage,available:true,billable:false,reason:stage==="classification"?"Reads saved classification; automatic classification is included in an explicitly selected generation call, not a separate recognition service.":null}
  try{const p=await checks[stage]!();return {stage,available:p.available!==false&&p.enabled===true,billable:BILLABLE_PROCESSING_STAGES.includes(stage),reason:p.reason??null}}catch{return {stage,available:false,billable:BILLABLE_PROCESSING_STAGES.includes(stage),reason:"This capability is not currently authorized, enabled or ready."}}
 }))
 return statuses.map((r,n)=>r.status==="fulfilled"?r.value:{stage:PROCESSING_STAGES[n],available:false,billable:BILLABLE_PROCESSING_STAGES.includes(PROCESSING_STAGES[n]),reason:"Capability readiness could not be verified."})
}
