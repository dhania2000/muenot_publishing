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
import {enqueueAdvancedEvidence,listAdvancedEvidence} from "./advanced-evidence-store"
export async function chartPolicy(role:"admin"|"employee"){
 try{
  if(process.env.ALT_TEXT_ADVANCED_DISABLED==="1")return {available:false,enabled:false,reason:"Advanced analysis is disabled by deployment policy.",model:null}
  const [tenant,record]=await Promise.all([getTenantAiSettings(),getSettingsRecord()]),models=await resolveTenantModels(currentTenantId(),tenant,role)
  const model=selectVisionModel({usable:models.usable,tenantSettings:tenant,preferredModelId:record.settings.preferredModelId,defaultModelId:models.defaultModel?.id,fallbackModelId:models.fallbackModel?.id})
  const settings=resolveEffectiveAccessibilitySettings({storedAccessibility:record.accessibility,tenant:record.settings,revision:record.revision,backend:{implemented:["chart_analysis"],visionModelAvailable:true,ocrLanguagePacks:[],disabledByPolicy:[]}})
  const enabled=settings.effective.graphs.graphDetection===true&&settings.effective.graphs.chartTypeDetection===true
  return {available:true,enabled,reason:enabled?null:"Enable graph detection and chart type detection in Accessibility Settings.",model}
 }catch{return {available:false,enabled:false,reason:"No authorized, configured vision model is available for chart structure analysis.",model:null}}
}
export async function readChartStructure(assetId:number,occurrenceId:number|null,actor:HistoryActor,role:"admin"|"employee"){
 const asset=await authorizeAdvancedAsset(assetId,occurrenceId,actor)
 const [policy,row,results]=await Promise.all([chartPolicy(role),getLatestRegionAnalysis(assetId,occurrenceId),listAdvancedEvidence(assetId,occurrenceId,"chart_structure")])
 const analysis=row?toAnalysisView(row):null
 const {withinScope}=await import("./history")
 return {success:true as const,assetId,occurrenceId,available:policy.available,enabled:policy.enabled,reason:policy.reason,canRun:withinScope(actor.updateScope,actor.userId,asset),regions:(analysis?.regions??[]).filter((r)=>r.primaryType==="graph_region").map((r)=>({id:r.id,analysisId:analysis!.analysisId,parentId:r.parentId,box:r.box,sourceWidth:analysis!.source.storedWidth,sourceHeight:analysis!.source.storedHeight,eligible:r.locationStatus==="verified_frame"&&analysis!.source.orientation===1&&!analysis!.source.orientationUnknown})),results,activeJobs:results.some((r)=>["queued","running","received"].includes(r.status))}
}
export async function startChartStructure(assetId:number,body:unknown,actor:HistoryActor,role:"admin"|"employee"){
 const request=parseAdvancedRegionRequest(body)
 if(!request)throw new AdvancedEvidenceError(400,"INVALID_REQUEST","Choose a current chart region and valid request identity.")
 await authorizeAdvancedAsset(assetId,request.occurrenceId,actor,true)
 const policy=await chartPolicy(role)
 if(!policy.enabled||!policy.model)throw new AdvancedEvidenceError(409,"CHART_UNAVAILABLE",policy.reason??"Chart analysis is unavailable.")
 const selected=await advancedRegionSource(assetId,request,actor,["graph_region"]),support=await chartOcrEvidence(assetId,request.occurrenceId,selected.regions)
 return enqueueAdvancedEvidence({kind:"chart_structure",assetId,occurrenceId:request.occurrenceId,request,source:selected.source,actorId:actor.userId,modelId:policy.model.id,regions:selected.regions,regionParentId:selected.region.parentId,complexity:selected.complexity,support})
}
export type ChartResponse=Awaited<ReturnType<typeof readChartStructure>>
