import "server-only"
import {query} from "@/lib/db"
import {currentTenantId} from "@/lib/tenant-scope"
import {requestBackgroundJobCancel} from "@/lib/background-jobs"
import {getAsset,getLatestRegionAnalysis} from "./store"
import {detectImageRegions,toAnalysisView} from "./region-service"
import {runOcr} from "./ocr-service"
import {generateAltTextForAsset} from "./generate"
import {startMathRecognition} from "./math-service"
import {evidenceView} from "./math-store"
import {saveEquationValidation} from "./math-validation-store"
import {startChartStructure} from "./chart-service"
import {startChartAxes} from "./chart-axis-service"
import {startChartData} from "./chart-data-service"
import {startScientificStructure} from "./scientific-structure-service"
import {startScientificDomain} from "./scientific-domain-service"
import {startIllustration} from "./illustration-service"
import {saveAdvancedQuality} from "./advanced-quality-store"
import {AdvancedEvidenceError} from "./advanced-evidence-source"
import type {ProcessingRun,ProcessingNode} from "./processing-pipeline-contract"
import type {ProcessingActor} from "./processing-pipeline-source"
import {processingCreditRequestId} from "./processing-pipeline-plan"
const kinds={math:"math_recognition",chart:"chart_structure",axes:"chart_axes",graph_data:"chart_data",science:"scientific_structure",domain:"scientific_domain",illustration:"illustration_structure"} as const
const parse=(v:any)=>typeof v==="string"?JSON.parse(v):v
const ref=(node:ProcessingNode,id:number|string,kind:string,version:number|null=null)=>{node.references=[{id:String(id),kind,version}]}
function checked<T extends {ok:boolean}>(result:T):Extract<T,{ok:true}>{if(!result.ok){const r=result as any;throw new AdvancedEvidenceError(r.status,r.code,r.error)}return result as Extract<T,{ok:true}>}
const parentId=(run:ProcessingRun,node:ProcessingNode,stage:string)=>Number(run.progress.nodes.find(n=>n.stage===stage&&n.regionId===node.regionId)?.references[0]?.id)
/** One existing leaf service per invocation. Child jobs use their own existing durable,
 * metered receipt handling; the parent never waits while occupying a worker slot. */
export async function executeProcessingNode(run:ProcessingRun,node:ProcessingNode,actor:ProcessingActor,signal:AbortSignal){
 const assetId=run.assetId,occurrenceId=run.occurrenceId
 if(signal.aborted)throw new Error("PIPELINE_INTERRUPTED")
 if(node.childJobId){
  const kind=kinds[node.stage as keyof typeof kinds]
  const [row]=await query<any[]>("SELECT * FROM alt_text_accessibility_evidence WHERE tenant_id=? AND asset_id=? AND occurrence_key=? AND kind=? AND id=? AND job_id=?",[currentTenantId(),assetId,occurrenceId??0,kind,Number(node.references[0]?.id),node.childJobId])
  if(!row)throw new AdvancedEvidenceError(409,"CHILD_RESULT_MISSING","The scheduled child result is no longer available.")
  if(["queued","running","received","recognizing"].includes(row.status)){node.state="waiting";return}
  if(row.status==="completed"||row.status==="candidate"){
   node.state="completed";ref(node,row.id,kind,Number(row.version));node.outcome={humanReviewRequired:true};return
  }
  node.state=["no_expression_detected","incomplete"].includes(row.status)?"needs_review":row.error_code==="PAID_RESULT_UNAVAILABLE"?"needs_reconciliation":"failed"
  node.error={code:row.error_code??"CHILD_RESULT_REVIEW",message:"This saved child analysis needs review. Completed evidence and recorded usage are retained.",retrySafe:false};return
 }
 const request={requestId:node.requestId,occurrenceId,analysisId:run.progress.regionAnalysisId,regionId:node.regionId,reprocess:false}
 if(node.stage==="classification"){
  const asset=await getAsset(assetId);node.state=asset?.classification?"completed":"needs_review";node.outcome={classification:asset?.classification??"unclassified",humanReviewRequired:true};return
 }
 if(node.stage==="regions"){
  const r=checked(await detectImageRegions(assetId,{requestId:node.requestId,occurrenceId},actor,{expectedSourceSha256:run.sourceSha256,signal}))
  if(!r.body.analysis)throw new AdvancedEvidenceError(409,"REGIONS_UNAVAILABLE","The region detector did not save an analysis.")
  ref(node,r.body.analysis.analysisId,"regions",r.body.analysis.version);node.state="completed";return
 }
 if(node.stage==="ocr"){
  const r=checked(await runOcr(assetId,{requestId:node.requestId,occurrenceId,regionId:node.regionId,languageMode:run.selection.ocrLanguageMode,reprocess:false},actor))
  ref(node,r.body.result.resultId,"image_ocr",r.body.result.version);node.state=["completed","completed_with_warnings","no_text_detected"].includes(r.body.result.status)?"completed":"needs_review";node.outcome={humanReviewRequired:true};return
 }
 if(node.stage==="generation"){
  const r=checked(await generateAltTextForAsset({assetId,occurrenceId,settings:run.selection.settings,requestId:node.requestId,expectedSourceSha256:run.sourceSha256,signal},actor))
  ref(node,r.body.version,"description",r.body.version);node.outcome={version:r.body.version,candidate:r.body.candidate===true,humanReviewRequired:true};node.state="completed"
  const classification=run.progress.nodes.find(n=>n.stage==="classification")
  if(classification&&r.body.result.classification){classification.state="completed";classification.outcome={classification:r.body.result.classification,humanReviewRequired:true}}
  return
 }
 if(node.stage==="qa"){
  const result=await saveAdvancedQuality(assetId,occurrenceId,node.requestId,actor)
  ref(node,result.report.runId,"quality_validation");node.outcome={qaRunId:result.report.runId,blockingFindings:result.report.blockingFailures,humanReviewRequired:true};node.state="completed";return
 }
 if(node.stage==="math_validation"){
  const id=parentId(run,node,"math"),[row]=await query<any[]>("SELECT * FROM alt_text_accessibility_evidence WHERE tenant_id=? AND asset_id=? AND occurrence_key=? AND id=? AND kind='math_recognition' AND status='candidate'",[currentTenantId(),assetId,occurrenceId??0,id])
  if(!row)throw new AdvancedEvidenceError(409,"NO_MATH_CANDIDATE","No saved equation candidate is available for syntax validation.")
  const saved=await saveEquationValidation(assetId,occurrenceId,evidenceView(row),actor.userId)
  ref(node,saved.record.id,"math_validation",saved.record.version);node.state=saved.record.result.syntaxStatus==="valid"?"completed":"needs_review";node.outcome={humanReviewRequired:true};return
 }
 // Local axes/data must use human-verified OCR, never promote fresh raw OCR into reviewed labels.
 if(node.stage==="axes"){
  const chartId=parentId(run,node,"chart"),{getCompletedAdvancedEvidence}=await import("./advanced-evidence-store"),{loadReviewedChartLabels}=await import("./chart-axis-labels")
  const chart=await getCompletedAdvancedEvidence(assetId,occurrenceId,"chart_structure",chartId)
  if(!chart?.result||(await loadReviewedChartLabels(chart.result)).length===0){node.state="needs_review";node.error={code:"REVIEW_OCR_FIRST",message:"Verify chart label OCR in Evidence review, then run axis interpretation. Raw OCR is not treated as verified evidence.",retrySafe:true};return}
 }
 let saved:any
 switch(node.stage){
  case "math":saved=await startMathRecognition(assetId,request,actor);break
  case "chart":saved=await startChartStructure(assetId,request,actor,actor.role);break
  case "axes":saved=await startChartAxes(assetId,occurrenceId,parentId(run,node,"chart"),{requestId:node.requestId,reprocess:false},actor);break
  case "graph_data":saved=await startChartData(assetId,occurrenceId,parentId(run,node,"axes"),{requestId:node.requestId,reprocess:false},actor);break
  case "science":saved=await startScientificStructure(assetId,request,actor,actor.role);break
  case "domain":saved=await startScientificDomain(assetId,occurrenceId,parentId(run,node,"science"),{requestId:node.requestId,reprocess:false},actor,actor.role);break
  case "illustration":saved=await startIllustration(assetId,request,actor,actor.role);break
  default:throw new Error("UNSUPPORTED_PROCESSING_STAGE")
 }
 const record=saved.record
 const [binding]=await query<any[]>("SELECT JSON_UNQUOTE(JSON_EXTRACT(input_json,'$.source.sourceSha256')) AS source_sha FROM alt_text_accessibility_evidence WHERE tenant_id=? AND asset_id=? AND occurrence_key=? AND id=? AND kind=?",[currentTenantId(),assetId,occurrenceId??0,record.id,kinds[node.stage as keyof typeof kinds]])
 if(binding?.source_sha!==run.sourceSha256){if(record.jobId)await requestBackgroundJobCancel(record.jobId,currentTenantId());throw new AdvancedEvidenceError(409,"CHILD_SOURCE_CHANGED","The image changed while scheduling region analysis. The queued child was cancelled before releasing the parent worker slot.")}
 ref(node,record.id,kinds[node.stage as keyof typeof kinds],record.version);node.childJobId=record.jobId
 node.creditRequestId=processingCreditRequestId(assetId,occurrenceId,node)
 node.state=record.status==="completed"||record.status==="candidate"?"completed":node.childJobId?"waiting":"needs_review"
}
export async function currentProcessingRegions(run:ProcessingRun){const row=await getLatestRegionAnalysis(run.assetId,run.occurrenceId);return row?toAnalysisView(row):null}
