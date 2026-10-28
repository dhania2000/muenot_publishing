import "server-only"
import {isDeepStrictEqual as evidenceEqual} from "node:util"
import {getSettingsRecord} from "./store"
import {resolveEffectiveAccessibilitySettings} from "./accessibility-settings"
import {advancedRegionSource,authorizeAdvancedAsset,AdvancedEvidenceError} from "./advanced-evidence-source"
import {getCompletedAdvancedEvidence,listAdvancedEvidence,enqueueAdvancedEvidence} from "./advanced-evidence-store"
import type {HistoryActor} from "./history"
import {withinScope} from "./history"
import {loadReviewedChartLabels} from "./chart-axis-labels"
import type {ChartAxisOptions} from "./chart-axis-analysis"
export const CHART_AXIS_ENGINE="local_reviewed_ocr_geometry_v1"
export async function chartAxisPolicy(){
 const record=await getSettingsRecord(),disabled=process.env.ALT_TEXT_ADVANCED_DISABLED==="1"
 const resolved=resolveEffectiveAccessibilitySettings({storedAccessibility:record.accessibility,tenant:record.settings,revision:record.revision,backend:{implemented:["chart_axes"],visionModelAvailable:null,ocrLanguagePacks:[],disabledByPolicy:disabled?["chart_axes"]:[]}})
 const graph=resolved.effective.graphs,options:ChartAxisOptions={axisLabels:graph.axisLabels===true,axisScale:graph.axisScale===true,legend:graph.legend===true,dataLabels:graph.dataLabels===true}
 const enabled=!disabled&&Object.values(options).some(Boolean)
 return {available:!disabled,enabled,options,reason:disabled?"Advanced chart analysis is disabled by deployment policy.":enabled?null:"Enable axis labels, scale, legend or data-label interpretation in Accessibility Settings."}
}
export async function authorizedParentChart(assetId:number,occurrenceId:number|null,parentId:number,actor:HistoryActor,edit=false){
 const asset=await authorizeAdvancedAsset(assetId,occurrenceId,actor,edit),parent=await getCompletedAdvancedEvidence(assetId,occurrenceId,"chart_structure",parentId)
 if(!parent?.result)throw new AdvancedEvidenceError(404,"CHART_NOT_FOUND","Completed chart structure evidence not found.")
 return {asset,parent:{id:parent.id,version:parent.version,result:parent.result}}
}
export async function readChartAxes(assetId:number,occurrenceId:number|null,parentId:number,actor:HistoryActor){
 const {asset,parent}=await authorizedParentChart(assetId,occurrenceId,parentId,actor)
 const [policy,records]=await Promise.all([chartAxisPolicy(),listAdvancedEvidence(assetId,occurrenceId,"chart_axes")])
 const results=records.filter((r)=>r.parentEvidenceId===parentId)
 return {success:true as const,assetId,occurrenceId,parentId,parentChart:parent.result,policy,canRun:withinScope(actor.updateScope,actor.userId,asset),results,activeJobs:results.some((r)=>["queued","running"].includes(r.status))}
}
export async function startChartAxes(assetId:number,occurrenceId:number|null,parentId:number,body:unknown,actor:HistoryActor){
 const r=body as Record<string,unknown>|null
 if(!r||typeof r!=="object"||Array.isArray(r)||Object.keys(r).some((k)=>!["requestId","reprocess"].includes(k))||typeof r.requestId!=="string"||!/^[A-Za-z0-9_-]{8,48}$/.test(r.requestId)||r.reprocess!=null&&typeof r.reprocess!=="boolean")throw new AdvancedEvidenceError(400,"INVALID_REQUEST","A valid request identity is required.")
 const {parent}=await authorizedParentChart(assetId,occurrenceId,parentId,actor,true),policy=await chartAxisPolicy()
 if(!policy.enabled)throw new AdvancedEvidenceError(409,"AXIS_ANALYSIS_UNAVAILABLE",policy.reason??"Axis interpretation is disabled.")
 const request={requestId:r.requestId,occurrenceId,analysisId:parent.result.regionAnalysisId,regionId:parent.result.chartRegionId,reprocess:r.reprocess===true},source=await advancedRegionSource(assetId,request,actor,["graph_region"])
 if(!evidenceEqual(source.source,parent.result.source))throw new AdvancedEvidenceError(409,"CHART_SOURCE_CHANGED","The chart's region or image changed. Refresh chart structure first.")
 const reviewedLabels=await loadReviewedChartLabels(parent.result)
 return enqueueAdvancedEvidence({kind:"chart_axes",assetId,occurrenceId,request,source:source.source,actorId:actor.userId,modelId:CHART_AXIS_ENGINE,regions:source.regions,regionParentId:source.region.parentId,complexity:source.complexity,support:{ocrEvidence:[],reviewEvidence:[]},parentEvidence:parent,reviewedLabels,axisOptions:policy.options})
}
export type ChartAxesResponse=Awaited<ReturnType<typeof readChartAxes>>
