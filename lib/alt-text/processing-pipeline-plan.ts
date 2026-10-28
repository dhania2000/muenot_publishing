import "server-only"
import {createHash} from "node:crypto"
import type {RegionAnalysis,ImageRegion} from "./region-analysis"
import {OCR_TEXT_REGION_TYPES} from "./ocr-contract"
import {SCIENCE_ROOT_TYPES} from "./scientific-structure-contract"
import {ILLUSTRATION_ROOTS} from "./illustration-contract"
import {PROCESSING_STAGES,PROCESSING_LIMITS,type ProcessingStage,type ProcessingSelection,type ProcessingProgress,type ProcessingNode} from "./processing-pipeline-contract"
export const processingOperationId=(runId:number,stage:ProcessingStage,regionId:string|null,attempt=0)=>`p_${createHash("sha256").update(JSON.stringify([runId,stage,regionId,attempt])).digest("hex").slice(0,24)}`
export const processingNodeKey=(stage:ProcessingStage,regionId:string|null)=>`${stage}:${regionId??"full"}`
export function processingCreditRequestId(assetId:number,occurrenceId:number|null,node:ProcessingNode){
 if(node.stage==="regions")return `alttext:rg${assetId}_${occurrenceId??0}_${node.requestId}`
 if(node.stage==="generation"){const raw=`a${assetId}_${node.requestId}`;return `alttext:${occurrenceId!=null||raw.length>64?`d${createHash("sha256").update(JSON.stringify([assetId,occurrenceId,node.requestId])).digest("hex").slice(0,60)}`:raw}`}
 const prefix:Record<string,string>={chart:"chart",science:"science",domain:"domain",illustration:"illustration"},id=node.references[0]?.id
 return prefix[node.stage]&&id?`alttext:${prefix[node.stage]}${id}`:null
}
export function makeProcessingNode(runId:number,stage:ProcessingStage,regionId:string|null,requires:string[]=[]):ProcessingNode{return {key:processingNodeKey(stage,regionId),stage,regionId,requires,state:"queued",requestId:processingOperationId(runId,stage,regionId),attempt:0,childJobId:null,references:[],error:null,outcome:null}}
export function initialProcessingProgress(runId:number,selection:ProcessingSelection,sourceSha256:string):ProcessingProgress{
 const nodes:ProcessingNode[]=[]
 for(const stage of ["classification","regions","ocr","generation","qa"] as ProcessingStage[])if(selection.stages.includes(stage))nodes.push(makeProcessingNode(runId,stage,null,stage==="qa"&&selection.stages.includes("generation")?[processingNodeKey("generation",null)]:[]))
 return {version:1,revision:0,expanded:!selection.stages.includes("regions"),sourceSha256,regionAnalysisId:null,nodes,warnings:[],omittedTargets:0,humanReviewRequired:true,documentExport:"not_requested"}
}
const regionTypes:Partial<Record<ProcessingStage,readonly string[]>>={ocr:OCR_TEXT_REGION_TYPES,math:["equation_region"],math_validation:["equation_region"],chart:["graph_region"],axes:["graph_region"],graph_data:["graph_region"],science:SCIENCE_ROOT_TYPES,domain:SCIENCE_ROOT_TYPES,illustration:Object.keys(ILLUSTRATION_ROOTS)}
/** Expand only real current regions after the selected region detector finished. No guessed
 * work counts, fabricated boxes or flattening of graph/science/table roots. */
export function expandProcessingTargets(runId:number,selection:ProcessingSelection,progress:ProcessingProgress,analysis:RegionAnalysis|null){
 if(progress.expanded)return
 const root=progress.nodes.find(n=>n.stage==="regions")
 if(!root||!["completed","failed","skipped","needs_review","needs_reconciliation","cancelled"].includes(root.state))return
 const expected=root.references.find(r=>r.kind==="regions")?.id
 const current=root.state==="completed"&&analysis&&analysis.analysisId===expected
 const regions:ImageRegion[]=current?analysis.regions:[]
 progress.regionAnalysisId=current?analysis.analysisId:null
 for(const stage of PROCESSING_STAGES){
  if(!selection.stages.includes(stage)||!regionTypes[stage])continue
  const all=regions.filter(r=>regionTypes[stage]!.includes(r.primaryType)),selected=all.slice(0,PROCESSING_LIMITS.rootsPerStage)
  progress.omittedTargets+=Math.max(0,all.length-selected.length)
  if(!selected.length&&stage!=="ocr"){
   const node=makeProcessingNode(runId,stage,"unavailable",[processingNodeKey("regions",null)])
   node.state="skipped";node.error={code:"NO_ELIGIBLE_REGIONS",message:current?"No source regions of this type were detected. Nothing was recognized or billed for this stage.":"The selected source region analysis is unavailable or changed. Independent full-image stages can continue.",retrySafe:false};progress.nodes.push(node);continue
  }
  for(const region of selected){
   const parents=[processingNodeKey("regions",null)]
   if(stage==="math_validation")parents.push(processingNodeKey("math",region.id))
   if(stage==="axes")parents.push(processingNodeKey("chart",region.id))
   if(stage==="graph_data")parents.push(processingNodeKey("axes",region.id))
   if(stage==="domain")parents.push(processingNodeKey("science",region.id))
   const node=makeProcessingNode(runId,stage,region.id,parents)
   if(region.locationStatus!=="verified_frame"||analysis!.source.orientation!==1||analysis!.source.orientationUnknown){node.state="needs_review";node.error={code:"REGION_FRAME_UNVERIFIED",message:"Review this source region's coordinate frame before starting region-specific work.",retrySafe:false}}
   progress.nodes.push(node)
  }
 }
 if(progress.omittedTargets)progress.warnings.push(`${progress.omittedTargets} region-specific stage targets exceeded the bounded eight-roots-per-stage limit and were not scheduled.`)
 if(!current)progress.warnings.push("The pipeline did not substitute another region analysis for its requested source.")
 progress.expanded=true
 if(progress.nodes.length>PROCESSING_LIMITS.nodes)throw new Error("PIPELINE_NODE_LIMIT")
}
