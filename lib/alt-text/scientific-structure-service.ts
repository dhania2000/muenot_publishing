import "server-only"
import {getTenantAiSettings} from "@/lib/ai/assistant-store"
import {resolveTenantModels} from "@/lib/ai/model-catalog"
import {selectVisionModel} from "./vision-service"
import {getSettingsRecord,getLatestRegionAnalysis} from "./store"
import {resolveEffectiveAccessibilitySettings} from "./accessibility-settings"
import type {HistoryActor} from "./history"
import {currentTenantId} from "@/lib/tenant-scope"
import {toAnalysisView} from "./region-service"
import {advancedRegionSource,authorizeAdvancedAsset,chartOcrEvidence,parseAdvancedRegionRequest,AdvancedEvidenceError} from "./advanced-evidence-source"
import {SCIENCE_ROOT_TYPES,type ScienceOptions} from "./scientific-structure-contract"
import {enqueueAdvancedEvidence,listAdvancedEvidence} from "./advanced-evidence-store"
export async function scientificStructurePolicy(role:"admin"|"employee"){
 try{
  if(process.env.ALT_TEXT_ADVANCED_DISABLED==="1")return {available:false,enabled:false,reason:"Advanced analysis is disabled by deployment policy.",model:null}
  const [tenant,record]=await Promise.all([getTenantAiSettings(),getSettingsRecord()]),models=await resolveTenantModels(currentTenantId(),tenant,role)
  const model=selectVisionModel({usable:models.usable,tenantSettings:tenant,preferredModelId:record.settings.preferredModelId,defaultModelId:models.defaultModel?.id,fallbackModelId:models.fallbackModel?.id})
  const settings=resolveEffectiveAccessibilitySettings({storedAccessibility:record.accessibility,tenant:record.settings,revision:record.revision,backend:{implemented:["scientific_diagram_analysis"],visionModelAvailable:true,ocrLanguagePacks:[],disabledByPolicy:[]}})
  const science=settings.effective.science
  const options:ScienceOptions={components:science.components===true,labels:science.diagramLabels===true,directions:science.directions===true,structure:science.structure===true,subjects:Array.isArray(science.subjects)?science.subjects.filter((s)=>typeof s==="string"):[]}
  const enabled=Object.values(options).some((v)=>v===true)
  return {available:true,enabled,reason:enabled?null:"Enable scientific components, labels, directions or structure in Accessibility Settings.",model,options}
 }catch{return {available:false,enabled:false,reason:"No authorized, configured vision model is available for scientific structure analysis.",model:null}}
}
export async function readScientificStructure(assetId:number,occurrenceId:number|null,actor:HistoryActor,role:"admin"|"employee"){
 const asset=await authorizeAdvancedAsset(assetId,occurrenceId,actor)
 const [policy,row,results]=await Promise.all([scientificStructurePolicy(role),getLatestRegionAnalysis(assetId,occurrenceId),listAdvancedEvidence(assetId,occurrenceId,"scientific_structure")])
 const analysis=row?toAnalysisView(row):null
 const {withinScope}=await import("./history")
 let currentSourceSha256:string|null=null
 const eligible=analysis?.regions.find((r)=>SCIENCE_ROOT_TYPES.includes(r.primaryType as any)&&r.locationStatus==="verified_frame")
 if(eligible&&analysis&&results.some((r)=>r.result)){
  try{currentSourceSha256=(await advancedRegionSource(assetId,{requestId:"source_check",occurrenceId,analysisId:analysis.analysisId,regionId:eligible.id,reprocess:false},actor,[...SCIENCE_ROOT_TYPES],false)).source.sourceSha256}catch(error){if(!(error instanceof AdvancedEvidenceError))throw error}
 }
 const records=results.map((r)=>({...r,sourceMatchesCurrent:!!r.result&&r.result.regionAnalysisId===analysis?.analysisId&&r.result.source.sourceSha256===currentSourceSha256}))
 return {success:true as const,assetId,occurrenceId,available:policy.available,enabled:policy.enabled,reason:policy.reason,canRun:withinScope(actor.updateScope,actor.userId,asset),regions:(analysis?.regions??[]).filter((r)=>SCIENCE_ROOT_TYPES.includes(r.primaryType as any)).map((r)=>({id:r.id,analysisId:analysis!.analysisId,parentId:r.parentId,box:r.box,sourceWidth:analysis!.source.storedWidth,sourceHeight:analysis!.source.storedHeight,eligible:r.locationStatus==="verified_frame"&&analysis!.source.orientation===1&&!analysis!.source.orientationUnknown})),results:records,activeJobs:results.some((r)=>["queued","running","received"].includes(r.status))}
}
export async function startScientificStructure(assetId:number,body:unknown,actor:HistoryActor,role:"admin"|"employee"){
 const request=parseAdvancedRegionRequest(body)
 if(!request)throw new AdvancedEvidenceError(400,"INVALID_REQUEST","Choose a current diagram region and valid request identity.")
 await authorizeAdvancedAsset(assetId,request.occurrenceId,actor,true)
 const policy=await scientificStructurePolicy(role)
 if(!policy.enabled||!policy.model)throw new AdvancedEvidenceError(409,"SCIENCE_UNAVAILABLE",policy.reason??"Scientific diagram analysis is unavailable.")
 const selected=await advancedRegionSource(assetId,request,actor,[...SCIENCE_ROOT_TYPES]),support=await chartOcrEvidence(assetId,request.occurrenceId,selected.regions)
 return enqueueAdvancedEvidence({kind:"scientific_structure",assetId,occurrenceId:request.occurrenceId,request,source:selected.source,actorId:actor.userId,modelId:policy.model.id,regions:selected.regions,regionParentId:selected.region.parentId,complexity:selected.complexity,support,scienceOptions:policy.options,regionRelationships:selected.relationships??[]})
}
export type ScientificStructureResponse=Awaited<ReturnType<typeof readScientificStructure>>
