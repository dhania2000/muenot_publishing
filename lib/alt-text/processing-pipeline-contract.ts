import {normalizeGenerationSettings,validateGenerationSettings,LANGUAGES,type GenerationSettings} from "./core"
import {OCR_LANGUAGE_MODE_IDS,type OcrLanguageMode} from "./ocr-contract"
export const PROCESSING_PIPELINE_VERSION=1
export const PROCESSING_STAGES=["classification","regions","ocr","math","math_validation","chart","axes","graph_data","science","domain","illustration","generation","qa"] as const
export type ProcessingStage=(typeof PROCESSING_STAGES)[number]
export const PROCESSING_LABELS:Record<ProcessingStage,string>={classification:"Saved classification / classification within generation",regions:"Image regions",ocr:"OCR text",math:"Mathematical OCR",math_validation:"Equation syntax / MathML",chart:"Chart structure",axes:"Axes and legend",graph_data:"Reviewed graph data",science:"Scientific components",domain:"Scientific domain hints",illustration:"Flowchart / table / map",generation:"Description generation",qa:"Saved-image quality checks"}
export const BILLABLE_PROCESSING_STAGES:readonly ProcessingStage[]=["regions","chart","science","domain","illustration","generation"]
const dependencies:Partial<Record<ProcessingStage,ProcessingStage[]>>={math:["regions"],math_validation:["math"],chart:["regions"],axes:["chart","ocr"],graph_data:["axes"],science:["regions"],domain:["science"],illustration:["regions"]}
export function processingStageClosure(stages:readonly ProcessingStage[]):ProcessingStage[]{const selected=new Set(stages);for(let n=0;n<PROCESSING_STAGES.length;n++){const before=selected.size;for(const stage of [...selected])for(const dependency of dependencies[stage]??[])selected.add(dependency);if(selected.has("math"))selected.add("math_validation");if(selected.has("generation")){selected.add("classification");selected.add("qa")}if(selected.size===before)break}return PROCESSING_STAGES.filter(s=>selected.has(s))}
export type ProcessingSelection={version:1;stages:ProcessingStage[];ocrLanguageMode:OcrLanguageMode|null;billableConfirmed:boolean;settings:GenerationSettings}
export type ProcessingRequest={requestId:string;occurrenceId:number|null;selection:ProcessingSelection}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v)
export function parseProcessingSelection(raw:unknown):ProcessingSelection|null{
 if(!object(raw)||Object.keys(raw).some(k=>!["version","stages","ocrLanguageMode","billableConfirmed","settings"].includes(k))||raw.version!==1||!Array.isArray(raw.stages)||!raw.stages.length||raw.stages.length>PROCESSING_STAGES.length||raw.stages.some(s=>!PROCESSING_STAGES.includes(s as ProcessingStage))||typeof raw.billableConfirmed!=="boolean"||raw.ocrLanguageMode!=null&&!OCR_LANGUAGE_MODE_IDS.includes(raw.ocrLanguageMode as OcrLanguageMode))return null
 if(raw.settings!==undefined&&(!object(raw.settings)||Object.keys(raw.settings).some(k=>!Object.hasOwn(normalizeGenerationSettings({}),k))||raw.settings.outputLanguage!=null&&(typeof raw.settings.outputLanguage!=="string"||!Object.hasOwn(LANGUAGES,raw.settings.outputLanguage))))return null
 const settings=normalizeGenerationSettings(raw.settings),stages=processingStageClosure(raw.stages as ProcessingStage[])
 if(Object.keys(validateGenerationSettings(settings)).length)return null
 return {version:1,stages,ocrLanguageMode:raw.ocrLanguageMode==null?null:raw.ocrLanguageMode as OcrLanguageMode,billableConfirmed:raw.billableConfirmed,settings}
}
export function parseProcessingRequest(raw:unknown):ProcessingRequest|null{
 if(!object(raw)||Object.keys(raw).some(k=>!["requestId","occurrenceId","selection"].includes(k))||typeof raw.requestId!=="string"||!/^[A-Za-z0-9_-]{8,48}$/.test(raw.requestId)||raw.occurrenceId!=null&&(!Number.isSafeInteger(raw.occurrenceId)||Number(raw.occurrenceId)<=0))return null
 const selection=parseProcessingSelection(raw.selection)
 return selection?{requestId:raw.requestId,occurrenceId:raw.occurrenceId==null?null:Number(raw.occurrenceId),selection}:null
}
export type ProcessingNodeState="queued"|"processing"|"waiting"|"completed"|"failed"|"skipped"|"needs_review"|"needs_reconciliation"|"cancelled"
export type ProcessingNode={key:string;stage:ProcessingStage;regionId:string|null;requires:string[];state:ProcessingNodeState;requestId:string;attempt:number;childJobId:number|null;creditRequestId?:string|null;references:{id:string;kind:string;version:number|null}[];error:{code:string;message:string;retrySafe:boolean}|null;outcome:{classification?:string;version?:number;candidate?:boolean;qaRunId?:string;blockingFindings?:number;humanReviewRequired?:boolean}|null}
export type ProcessingProgress={version:1;revision:number;expanded:boolean;sourceSha256:string;regionAnalysisId:string|null;nodes:ProcessingNode[];warnings:string[];omittedTargets:number;humanReviewRequired:true;documentExport:"not_requested"}
export type ProcessingRun={id:number;assetId:number;occurrenceId:number|null;batchId:string|null;documentId:number|null;locationLabel:string|null;createdBy:number;jobId:number;sourceSha256:string;selection:ProcessingSelection;externalGeneration:boolean;initialContentVersion:number;resumeCount:number;progress:ProcessingProgress;status:string;createdAt:string}
export const PROCESSING_LIMITS={rootsPerStage:8,nodes:128,imageBytes:20*1024*1024,progressChars:120000} as const
export function canRetryLocalProcessingNode(node:ProcessingNode){return !!node.error?.retrySafe&&!node.childJobId&&["failed","needs_review"].includes(node.state)&&["ocr","math_validation","axes","graph_data","qa"].includes(node.stage)}
export function isProcessingNodeTerminal(state:ProcessingNodeState){return ["completed","failed","skipped","needs_review","needs_reconciliation","cancelled"].includes(state)}
export function processingAnalysisReady(progress:ProcessingProgress){return progress.expanded&&progress.nodes.filter(n=>!["generation","qa"].includes(n.stage)).every(n=>isProcessingNodeTerminal(n.state))}
export function processingSummary(progress:ProcessingProgress){
 const counts={total:progress.nodes.length,queued:0,processing:0,waiting:0,completed:0,failed:0,skipped:0,needs_review:0,needs_reconciliation:0,cancelled:0}
 for(const node of progress.nodes)counts[node.state]++
 const active=counts.queued+counts.processing+counts.waiting>0||!progress.expanded
 const status=active?(counts.processing||counts.waiting?"processing":"queued"):counts.needs_reconciliation?"needs_reconciliation":counts.needs_review?"awaiting_review":counts.failed||counts.skipped?"partial":counts.cancelled?"cancelled":"ready_for_review"
 return {status,counts,analysisReady:processingAnalysisReady(progress),humanReviewRequired:true as const,documentExport:"not_requested" as const}
}
/** Hard dependencies skip only their own children; generation consumes available saved evidence
 * once analysis settles, including honest partial failures. It never implies human approval. */
export function nextProcessingNode(progress:ProcessingProgress):ProcessingNode|null{
 if(progress.nodes.length>PROCESSING_LIMITS.nodes||JSON.stringify(progress).length>PROCESSING_LIMITS.progressChars)throw new Error("PIPELINE_PROGRESS_LIMIT")
 for(const node of progress.nodes){
  if(node.state!=="queued"&&node.state!=="waiting"&&node.state!=="processing")continue
  if(node.stage==="generation"&&!processingAnalysisReady(progress))continue
  if(node.stage==="qa"&&(!processingAnalysisReady(progress)||progress.nodes.some(n=>n.stage==="generation"&&!isProcessingNodeTerminal(n.state))))continue
  const parents=node.requires.map(key=>progress.nodes.find(n=>n.key===key))
  if(parents.some(p=>!p||isProcessingNodeTerminal(p.state)&&p.state!=="completed")){node.state="skipped";node.error={code:"DEPENDENCY_UNAVAILABLE",message:"A required source stage did not produce usable evidence. Independent stages continue.",retrySafe:false};continue}
  if(parents.some(p=>p!.state!=="completed"))continue
  return node
 }
 return null
}
