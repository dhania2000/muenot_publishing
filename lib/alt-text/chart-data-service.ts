import "server-only"
import {getSettingsRecord} from "./store"
import {resolveEffectiveAccessibilitySettings} from "./accessibility-settings"
import {getCompletedAdvancedEvidence,listAdvancedEvidence,enqueueAdvancedEvidence} from "./advanced-evidence-store"
import {authorizedParentChart,chartAxisPolicy} from "./chart-axis-service"
import {advancedRegionSource,AdvancedEvidenceError} from "./advanced-evidence-source"
import {loadReviewedChartLabels} from "./chart-axis-labels"
import {withinScope,type HistoryActor} from "./history"
import type {ChartDataParent} from "./chart-data-contract"
import {allowedChartMappings} from "./chart-data-analysis"
export const CHART_DATA_ENGINE="local_reviewed_labels_v1"
export async function authorizedChartDataParent(assetId:number,occurrenceId:number|null,axesId:number,actor:HistoryActor,edit=false){
 const axes=await getCompletedAdvancedEvidence(assetId,occurrenceId,"chart_axes",axesId)
 if(!axes?.result)throw new AdvancedEvidenceError(404,"AXES_NOT_FOUND","Completed axis evidence not found.")
 const {asset,parent:chart}=await authorizedParentChart(assetId,occurrenceId,axes.result.parentChartEvidenceId,actor,edit)
 if(chart.version!==axes.result.parentChartVersion)throw new AdvancedEvidenceError(409,"PARENT_CHANGED","Chart evidence changed.")
 return {asset,parent:{axes:{id:axes.id,version:axes.version,result:axes.result},chart} satisfies ChartDataParent}
}
export async function assertChartDataCurrent(parent:ChartDataParent,actor:HistoryActor,edit=true){
 const chart=parent.chart.result,source=await advancedRegionSource(chart.assetId,{requestId:"source_check",occurrenceId:chart.occurrenceId,analysisId:chart.regionAnalysisId,regionId:chart.chartRegionId,reprocess:false},actor,["graph_region"],edit)
 if(JSON.stringify(source.source)!==JSON.stringify(chart.source)||JSON.stringify(await loadReviewedChartLabels(chart))!==JSON.stringify(parent.axes.result.labels))throw new AdvancedEvidenceError(409,"SOURCE_CHANGED","Image, regions or reviewed OCR changed. Refresh chart and axis evidence.")
 return source
}
export async function chartDataPolicy(){const policy=await chartAxisPolicy(),record=await getSettingsRecord(),resolved=resolveEffectiveAccessibilitySettings({storedAccessibility:record.accessibility,tenant:record.settings,revision:record.revision,backend:{implemented:["chart_data_extraction"],visionModelAvailable:null,ocrLanguagePacks:[],disabledByPolicy:[]}}),enabled=policy.enabled&&policy.options.dataLabels&&resolved.effective.graphs.dataExtraction===true;return {enabled,trendsEnabled:resolved.effective.graphs.trendDescription===true,reason:policy.reason??(!enabled?"Enable data extraction and data-label interpretation in Accessibility Settings.":null)}}
export async function readChartData(assetId:number,occurrenceId:number|null,axesId:number,actor:HistoryActor){
 const {asset,parent}=await authorizedChartDataParent(assetId,occurrenceId,axesId,actor)
 const [policy,all]=await Promise.all([chartDataPolicy(),listAdvancedEvidence(assetId,occurrenceId,"chart_data")])
 const results=all.filter((r)=>r.parentEvidenceId===axesId)
 return {success:true as const,parent,policy,canRun:withinScope(actor.updateScope,actor.userId,asset),mappings:allowedChartMappings(parent),results,activeJobs:results.some((r)=>["queued","running"].includes(r.status))}
}
export async function startChartData(assetId:number,occurrenceId:number|null,axesId:number,body:unknown,actor:HistoryActor){
 const r=body as Record<string,unknown>|null
 if(!r||typeof r!=="object"||Array.isArray(r)||Object.keys(r).some((k)=>!["requestId","reprocess"].includes(k))||typeof r.requestId!=="string"||!/^[A-Za-z0-9_-]{8,48}$/.test(r.requestId)||r.reprocess!=null&&typeof r.reprocess!=="boolean")throw new AdvancedEvidenceError(400,"INVALID_REQUEST","Invalid request identity.")
 const {parent}=await authorizedChartDataParent(assetId,occurrenceId,axesId,actor,true),policy=await chartDataPolicy()
 if(!policy.enabled)throw new AdvancedEvidenceError(409,"DATA_DISABLED",policy.reason??"Chart data extraction is disabled.")
 const source=await assertChartDataCurrent(parent,actor),chart=parent.chart.result
 return enqueueAdvancedEvidence({kind:"chart_data",assetId,occurrenceId,request:{requestId:r.requestId,reprocess:r.reprocess===true,occurrenceId,analysisId:chart.regionAnalysisId,regionId:chart.chartRegionId},source:source.source,actorId:actor.userId,modelId:CHART_DATA_ENGINE,regions:source.regions,regionParentId:source.region.parentId,complexity:source.complexity,support:{ocrEvidence:[],reviewEvidence:[]},dataParent:parent,dataTrendEnabled:policy.trendsEnabled})
}
export type ChartDataResponse=Awaited<ReturnType<typeof readChartData>>
