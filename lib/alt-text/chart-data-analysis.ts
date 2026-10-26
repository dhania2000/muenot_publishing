import type {ChartDataParent,ChartDataResult,ChartLabelDecision} from "./chart-data-contract"
import type {ReviewedChartLabel} from "./chart-axis-contract"
import {parseAxisScalar} from "./chart-axis-scale"
const center=(l:ReviewedChartLabel)=>l.box?{x:l.box.left+l.box.width/2,y:l.box.top+l.box.height/2}:null
export function chartDataCandidates(parent:ChartDataParent){
 const axes=parent.axes.result,chart=parent.chart.result
 const excluded=new Set([...axes.axes.flatMap((a)=>[...a.titleLabelIds,...a.ticks.map((t)=>t.labelId)]),...axes.titles,...axes.captions,...axes.legends.flatMap((l)=>l.entries.map((e)=>e.labelId))])
 return axes.labels.filter((label)=>{
  if(excluded.has(label.id)||!label.verifiedText||!label.box||label.geometryBasis==="unmapped")return false
  const scalar=parseAxisScalar(label.text),p=center(label)!
  if(scalar.value==null||!["number","scientific","percentage"].includes(scalar.kind))return false
  if(axes.plotBounds.length)return axes.plotBounds.some((plot)=>p.x/axes.sourceWidth>=plot.box.x&&p.x/axes.sourceWidth<=plot.box.x+plot.box.width&&p.y/axes.sourceHeight>=plot.box.y&&p.y/axes.sourceHeight<=plot.box.y+plot.box.height)
  const crop=chart.source.pixelBox
  return p.x>=crop.left&&p.x<=crop.left+crop.width&&p.y>=crop.top&&p.y<=crop.top+crop.height
 }).slice(0,500)
}
export function allowedChartMappings(parent:ChartDataParent){
 const axes=parent.axes.result
 return {seriesLabels:axes.legends.flatMap((l)=>l.entries.map((e)=>({id:e.labelId,text:e.text}))),categories:axes.axes.filter((a)=>a.orientation==="horizontal"||a.scale.kind==="categorical").flatMap((a)=>a.ticks.map((t)=>({id:t.labelId,text:t.text}))),axes:axes.axes.map((a)=>({id:a.id,unit:a.unit,role:a.role}))}
}
/** Human-reviewed label roles are distinct from OCR text review and from final dataset approval. */
export function extractChartLabelData(parent:ChartDataParent,decisions:ChartLabelDecision[]=[],trendsEnabled=true):ChartDataResult{
 const axes=parent.axes.result,mappings=allowedChartMappings(parent),byLabel=new Map(decisions.map((d)=>[d.sourceLabelId,d]))
 const result:ChartDataResult={schemaVersion:1,kind:"chart_data",method:"reviewed_visible_labels",assetId:axes.assetId,occurrenceId:axes.occurrenceId,chartRegionId:axes.chartRegionId,parentAxesEvidenceId:parent.axes.id,parentAxesVersion:parent.axes.version,parentChartEvidenceId:parent.chart.id,sourceSha256:axes.sourceSha256,points:[],trendsEnabled,trends:[],capabilities:{labelExact:true,nativeSourceExact:false,imageEstimated:false},warnings:["Only explicitly confirmed visible data labels can become Label Exact. Numeric annotations are otherwise unknown-role candidates.","Native chart frames are not linked to extracted image occurrences in this repository. No native source values were inferred.","Candidate axis fits are not pixel-verified calibration. Image digitization and hidden/overlapping unlabelled marks are unsupported.","The dataset remains unapproved; label confirmation does not approve Alt Text or publish data."],reviewStatus:"needs_review",datasetApproved:false,createdAt:new Date().toISOString()}
 if(!axes.plotBounds.length)result.warnings.push("Plot bounds are unavailable. Candidate labels are limited to the existing chart crop and need explicit role verification.")
 for(const label of chartDataCandidates(parent)){
  const scalar=parseAxisScalar(label.text),decision=byLabel.get(label.id),confirmed=decision?.state==="confirmed_label",valueAxis=decision?.axisId?axes.axes.find((a)=>a.id===decision.axisId):null
  const series=decision?.seriesLabelId?mappings.seriesLabels.find((l)=>l.id===decision.seriesLabelId):null,category=decision?.categoryLabelId?mappings.categories.find((l)=>l.id===decision.categoryLabelId):null
  const unit=scalar.unit??valueAxis?.unit??null,warnings:string[]=[]
  if(!confirmed)warnings.push("The visible text is reviewed, but its role as a data value has not been confirmed.")
  if(!series)warnings.push("Series association is unknown; this value is not merged into another series.")
  if(!category)warnings.push("Category/time association is unknown.")
  if(scalar.unit&&valueAxis?.unit&&scalar.unit!==valueAxis.unit)warnings.push("Printed value and selected axis units disagree; no unit conversion was applied.")
  const exact=confirmed&&!warnings.some((w)=>w.includes("units disagree"))
  result.points.push({id:`label:${label.id}`,sourceLabelId:label.id,sourceText:label.text,classification:exact?"label_exact":"unknown",candidateValue:scalar.value!,value:exact?scalar.value:null,unit,seriesId:series?`legend:${series.id}`:null,seriesName:series?.text??null,categoryLabelId:category?.id??null,category:category?.text??null,axisId:decision?.axisId??null,labelBox:label.box,visualMark:null,precision:{basis:"printed_label",rounding:"none",originalText:label.text},reviewState:decision?.state??"needs_review",reviewReference:decision?{id:decision.id,version:decision.version,editorId:decision.editorId}:null,sourceReview:{id:label.reviewId,version:label.reviewVersion},warnings})
 }
 for(let i=0;i<result.points.length;i++)for(let j=i+1;j<result.points.length;j++){
  const a=result.points[i],b=result.points[j]
  if(a.candidateValue===b.candidateValue&&a.labelBox&&b.labelBox&&Math.abs(a.labelBox.left-b.labelBox.left)<3&&Math.abs(a.labelBox.top-b.labelBox.top)<3){a.warnings.push("Another source label at this position may be duplicate OCR; verify it separately.");b.warnings.push("Another source label at this position may be duplicate OCR; verify it separately.")}
 }
 const groups=new Map<string,typeof result.points>()
 for(const point of result.points)if(point.classification==="label_exact"&&point.seriesId&&point.category&&point.value!=null&&!point.warnings.some((w)=>/disagree|duplicate/.test(w))){const key=JSON.stringify([point.seriesId,point.axisId,point.unit]);groups.set(key,[...(groups.get(key)??[]),point])}
 for(const points of trendsEnabled?groups.values():[]){
  if(points.length<2)continue
  const first=points[0],ranked=[...points].sort((a,b)=>b.value!-a.value!)
  result.trends.push({seriesId:first.seriesId!,axisId:first.axisId,unit:first.unit,kind:"visible_ranking",pointIds:ranked.map((p)=>p.id),basis:"reviewed_label_values"})
  const ordered=points.map((p)=>({point:p,category:parseAxisScalar(p.category!)}))
  if(ordered.some((p)=>p.category.value==null||p.category.kind==="time")||new Set(ordered.map((p)=>p.category.kind==="date"?"date":"numeric")).size!==1||new Set(ordered.map((p)=>p.category.value)).size!==ordered.length||new Set(ordered.map((p)=>p.category.unit)).size!==1)continue
  ordered.sort((a,b)=>a.category.value!-b.category.value!)
  const changes=ordered.slice(1).map((p,i)=>p.point.value!-ordered[i].point.value!),trend=(kind:ChartDataResult["trends"][number]["kind"],pointIds=ordered.map((p)=>p.point.id))=>result.trends.push({seriesId:first.seriesId!,axisId:first.axisId,unit:first.unit,kind,pointIds,basis:"reviewed_label_values"})
  if(changes.every((n)=>n>0))trend("increasing");else if(changes.every((n)=>n<0))trend("decreasing");else if(changes.every((n)=>n===0))trend("stable_at_printed_precision")
  for(let i=1;i<ordered.length-1;i++){const a=ordered[i-1].point.value!,v=ordered[i].point.value!,b=ordered[i+1].point.value!;if(v>a&&v>b)trend("local_peak",[ordered[i].point.id]);if(v<a&&v<b)trend("local_minimum",[ordered[i].point.id])}
 }
 if(!result.points.length)result.warnings.push("No compatible reviewed, positioned numeric data-label candidates are available.")
 if(result.points.some((p)=>p.classification==="unknown"))result.warnings.push("Some values remain unknown or unassigned. Missing/hidden values were not reconstructed.")
 return result
}
