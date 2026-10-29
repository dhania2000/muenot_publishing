import "server-only"
import {createHash,randomBytes} from "node:crypto"
import {query,withTransaction} from "@/lib/db"
import {currentTenantId} from "@/lib/tenant-scope"
import {getCompletedAdvancedEvidence} from "./advanced-evidence-store"
import {authorizedChartDataParent,assertChartDataCurrent} from "./chart-data-service"
import {AdvancedEvidenceError} from "./advanced-evidence-source"
import {allowedChartMappings,chartDataCandidates,extractChartLabelData} from "./chart-data-analysis"
import type {ChartLabelDecision,ChartLabelDecisionInput,ChartDataParent} from "./chart-data-contract"
import type {HistoryActor} from "./history"
import {withinScope} from "./history"
const hash=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex")
const parse=(v:any)=>typeof v==="string"?JSON.parse(v):v
function view(r:any):ChartLabelDecision{return {...parse(r.result_json),id:Number(r.id),version:Number(r.version)}}
export async function chartDataReviewSource(assetId:number,occurrenceId:number|null,evidenceId:number,actor:HistoryActor,edit=false){
 const evidence=await getCompletedAdvancedEvidence(assetId,occurrenceId,"chart_data",evidenceId)
 if(!evidence?.result)throw new AdvancedEvidenceError(404,"DATA_NOT_FOUND","Completed chart data evidence not found.")
 const {parent,asset}=await authorizedChartDataParent(assetId,occurrenceId,evidence.result.parentAxesEvidenceId,actor,edit)
 if(edit&&!withinScope(actor.approveScope,actor.userId,asset))throw new AdvancedEvidenceError(403,"FORBIDDEN","You cannot verify chart labels for this image.")
 if(parent.axes.version!==evidence.result.parentAxesVersion||parent.chart.id!==evidence.result.parentChartEvidenceId||parent.axes.result.sourceSha256!==evidence.result.sourceSha256)throw new AdvancedEvidenceError(409,"DATA_PARENT_CHANGED","The saved chart data does not match its source.")
 return {evidence,parent}
}
export async function listChartLabelDecisions(assetId:number,occurrenceId:number|null,evidenceId:number){
 const rows=await query<any[]>(`SELECT e.* FROM alt_text_accessibility_evidence e WHERE e.tenant_id=? AND e.asset_id=? AND e.occurrence_key=? AND e.kind='chart_data_review' AND JSON_EXTRACT(e.input_json,'$.evidenceId')=?
 AND NOT EXISTS (SELECT 1 FROM alt_text_accessibility_evidence n WHERE n.tenant_id=e.tenant_id AND n.asset_id=e.asset_id AND n.occurrence_key=e.occurrence_key AND n.kind=e.kind AND n.region_id=e.region_id AND n.version>e.version) ORDER BY e.id DESC LIMIT 500`,[currentTenantId(),assetId,occurrenceId??0,evidenceId])
 return rows.map(view)
}
export function validateChartLabelMapping(parent:ChartDataParent,input:ChartLabelDecisionInput){
 const allowed=allowedChartMappings(parent)
 if(!chartDataCandidates(parent).some((l)=>l.id===input.sourceLabelId)||input.seriesLabelId&&!allowed.seriesLabels.some((l)=>l.id===input.seriesLabelId)||input.categoryLabelId&&!allowed.categories.some((l)=>l.id===input.categoryLabelId)||input.axisId&&!allowed.axes.some((a)=>a.id===input.axisId))throw new AdvancedEvidenceError(422,"INVALID_LABEL_REFERENCE","Select labels and axes from this chart evidence only.")
}
export async function saveChartLabelDecision(assetId:number,occurrenceId:number|null,evidenceId:number,input:ChartLabelDecisionInput,actor:HistoryActor){
 const {parent}=await chartDataReviewSource(assetId,occurrenceId,evidenceId,actor,true)
 validateChartLabelMapping(parent,input)
 const tenant=currentTenantId(),region=`drev_${hash([evidenceId,input.sourceLabelId]).slice(0,40)}`,request=hash(["chart_data_review",evidenceId,input.requestId]),config=hash([input,actor.userId])
 return withTransaction(async(conn)=>{
  const [assets]=await conn.query<any[]>("SELECT id FROM alt_text_assets WHERE tenant_id=? AND id=? FOR UPDATE",[tenant,assetId])
  if(!assets.length)throw new AdvancedEvidenceError(404,"NOT_FOUND","The image no longer exists.")
  const [replay]=await conn.query<any[]>("SELECT * FROM alt_text_accessibility_evidence WHERE tenant_id=? AND kind='chart_data_review' AND request_key=?",[tenant,request])
  if(replay[0]){if(replay[0].config_key!==config)throw new AdvancedEvidenceError(409,"REQUEST_CONFLICT","This request was used for another decision.");return {record:view(replay[0]),replayed:true}}
  await assertChartDataCurrent(parent,actor)
  await chartDataReviewSource(assetId,occurrenceId,evidenceId,actor,true)
  const [prior]=await conn.query<any[]>("SELECT version FROM alt_text_accessibility_evidence WHERE tenant_id=? AND asset_id=? AND occurrence_key=? AND region_id=? AND kind='chart_data_review' ORDER BY version DESC LIMIT 1",[tenant,assetId,occurrenceId??0,region])
  if(Number(prior[0]?.version??0)!==input.expectedVersion)throw new AdvancedEvidenceError(409,"VERSION_CONFLICT","Another reviewer saved changes. Reload before saving.")
  const version=input.expectedVersion+1,{expectedVersion:_,requestId:__,...decision}=input,result={...decision,editorId:actor.userId,createdAt:new Date().toISOString()}
  const [insert]=await conn.query<any>(`INSERT INTO alt_text_accessibility_evidence (tenant_id,asset_id,occurrence_key,region_id,kind,version,analysis_id,request_key,config_key,status,input_json,result_json,created_by) VALUES (?,?,?,?,'chart_data_review',?,?,?,?,?,?,?,?)`,[tenant,assetId,occurrenceId??0,region,version,`drev_${randomBytes(10).toString("hex")}`,request,config,input.state,JSON.stringify({evidenceId,sourceLabelId:input.sourceLabelId,parentAxesId:parent.axes.id}),JSON.stringify(result),actor.userId])
  await conn.query(`INSERT INTO alt_text_versions (tenant_id,asset_id,version,action,classification,short_alt,long_description,extracted_text,note,model_id,actor_id) SELECT tenant_id,id,current_version,'chart_data_review',classification,short_alt,long_description,extracted_text,?,NULL,? FROM alt_text_assets WHERE tenant_id=? AND id=?`,[`Chart data #${evidenceId}, label decision #${insert.insertId}, version ${version}`,actor.userId,tenant,assetId])
  return {record:{...result,id:Number(insert.insertId),version},replayed:false}
 })
}
export async function reviewedChartData(assetId:number,occurrenceId:number|null,evidenceId:number,actor:HistoryActor){
 const {parent,evidence}=await chartDataReviewSource(assetId,occurrenceId,evidenceId,actor),decisions=await listChartLabelDecisions(assetId,occurrenceId,evidenceId)
 const result=extractChartLabelData(parent,decisions,evidence.result!.trendsEnabled===true)
 result.createdAt=evidence.result!.createdAt
 let sourceCurrent=true
 try{await assertChartDataCurrent(parent,actor,false)}catch(error){if(!(error instanceof AdvancedEvidenceError))throw error;sourceCurrent=false;result.warnings.push("Historical evidence: the current image, region or OCR review no longer matches this extraction. Refresh analysis before using its values.")}
 return {result,sourceCurrent,decisions,analysisVersion:evidence.version,mappings:allowedChartMappings(parent)}
}
