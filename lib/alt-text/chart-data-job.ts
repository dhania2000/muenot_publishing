import "server-only"
import type {AdvancedEvidenceInput} from "./advanced-evidence-store"
import {writeAdvancedEvidence} from "./advanced-evidence-store"
import {AdvancedEvidenceError} from "./advanced-evidence-source"
import {authorizedChartDataParent,assertChartDataCurrent,chartDataPolicy,CHART_DATA_ENGINE} from "./chart-data-service"
import {extractChartLabelData} from "./chart-data-analysis"
import type {BackgroundJob} from "@/lib/background-jobs"
import type {HistoryActor} from "./history"
export async function runChartDataDelivery(input:AdvancedEvidenceInput,job:BackgroundJob,evidenceId:number,actor:HistoryActor,guard:()=>Promise<void>){
 if(!input.dataParent||input.modelId!==CHART_DATA_ENGINE)throw new AdvancedEvidenceError(422,"DATA_INPUT_INVALID","Chart data input is incomplete.")
 const {parent}=await authorizedChartDataParent(input.assetId,input.occurrenceId,input.dataParent.axes.id,actor,true)
 const policy=await chartDataPolicy()
 if(policy.trendsEnabled!==input.dataTrendEnabled)throw new AdvancedEvidenceError(409,"DATA_POLICY_CHANGED","Trend settings changed. Refresh the extraction request.")
 if(!policy.enabled)throw new AdvancedEvidenceError(409,"DATA_DISABLED","Data-label interpretation is disabled.")
 if(JSON.stringify(parent)!==JSON.stringify(input.dataParent))throw new AdvancedEvidenceError(409,"DATA_PARENT_CHANGED","Chart or axis evidence changed.")
 await assertChartDataCurrent(parent,actor);await guard();await writeAdvancedEvidence(job,evidenceId,"running")
 const result=extractChartLabelData(parent,[],policy.trendsEnabled===true)
 await guard();await writeAdvancedEvidence(job,evidenceId,"completed",result)
 return {evidenceId,status:"completed"}
}
