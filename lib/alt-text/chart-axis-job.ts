import "server-only"
import {isDeepStrictEqual as evidenceEqual} from "node:util"
import type {AdvancedEvidenceInput} from "./advanced-evidence-store"
import {writeAdvancedEvidence} from "./advanced-evidence-store"
import {advancedRegionSource,AdvancedEvidenceError} from "./advanced-evidence-source"
import {authorizedParentChart,chartAxisPolicy,CHART_AXIS_ENGINE} from "./chart-axis-service"
import {loadReviewedChartLabels} from "./chart-axis-labels"
import {analyzeChartAxes} from "./chart-axis-analysis"
import type {BackgroundJob} from "@/lib/background-jobs"
import type {HistoryActor} from "./history"
export async function runChartAxisDelivery(input:AdvancedEvidenceInput,job:BackgroundJob,evidenceId:number,actor:HistoryActor,guard:()=>Promise<void>){
 if(!input.parentEvidence||!input.reviewedLabels||!input.axisOptions||input.modelId!==CHART_AXIS_ENGINE)throw new AdvancedEvidenceError(422,"AXIS_INPUT_INVALID","Axis analysis input is incomplete or its interpreter changed.")
 const [{parent},policy]=await Promise.all([authorizedParentChart(input.assetId,input.occurrenceId,input.parentEvidence.id,actor,true),chartAxisPolicy()])
 if(!policy.enabled||!evidenceEqual(policy.options,input.axisOptions))throw new AdvancedEvidenceError(409,"AXIS_POLICY_CHANGED","Axis settings changed before processing. Submit a fresh request.")
 if(parent.version!==input.parentEvidence.version||!evidenceEqual(parent.result,input.parentEvidence.result))throw new AdvancedEvidenceError(409,"CHART_PARENT_CHANGED","Chart structure evidence changed.")
 const current=await advancedRegionSource(input.assetId,input.request,actor,["graph_region"])
 if(!evidenceEqual(current.source,input.source))throw new AdvancedEvidenceError(409,"SOURCE_CHANGED","The chart source or coordinate frame changed.")
 const labels=await loadReviewedChartLabels(parent.result)
 if(!evidenceEqual(labels,input.reviewedLabels))throw new AdvancedEvidenceError(409,"REVIEWED_LABELS_CHANGED","Reviewed OCR changed. Refresh the interpretation request.")
 await guard();await writeAdvancedEvidence(job,evidenceId,"running")
 const result=analyzeChartAxes(parent,labels,input.axisOptions)
 await guard();await writeAdvancedEvidence(job,evidenceId,"completed",result)
 return {evidenceId,status:"completed"}
}
