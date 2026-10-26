import type {ChartStructureResult} from "./chart-contract"
import type {ChartAxesResult,ChartAxisEvidence,ReviewedChartLabel} from "./chart-axis-contract"
import {deriveAxisScale,parseAxisScalar} from "./chart-axis-scale"
import {REGION_COORDINATE_SYSTEM,type NormalizedBox} from "./region-analysis"
export type ChartAxisOptions={axisLabels:boolean;axisScale:boolean;legend:boolean;dataLabels:boolean}
const center=(label:ReviewedChartLabel)=>label.box?{x:label.box.left+label.box.width/2,y:label.box.top+label.box.height/2}:null
const inBox=(x:number,y:number,b:NormalizedBox,pad=0)=>x>=b.x-pad&&x<=b.x+b.width+pad&&y>=b.y-pad&&y<=b.y+b.height+pad
export function analyzeChartAxes(parent:{id:number;version:number;result:ChartStructureResult},labels:ReviewedChartLabel[],options:ChartAxisOptions):ChartAxesResult{
 const chart=parent.result,W=chart.source.sourceWidth,H=chart.source.sourceHeight,refs=new Map(chart.regionReferences.map((r)=>[r.id,r]))
 const result:ChartAxesResult={schemaVersion:1,kind:"chart_axes",method:"reviewed_ocr_geometry",assetId:chart.assetId,occurrenceId:chart.occurrenceId,chartRegionId:chart.chartRegionId,parentChartEvidenceId:parent.id,parentChartVersion:parent.version,regionAnalysisId:chart.regionAnalysisId,sourceSha256:chart.source.sourceSha256,sourceWidth:W,sourceHeight:H,coordinateSystems:{regions:REGION_COORDINATE_SYSTEM,labels:"stored_pixels_top_left",positionsAreEstimates:true},axes:[],labels,plotBounds:chart.output.plotRegionIds.flatMap((id)=>refs.has(id)?[{regionId:id,box:refs.get(id)!.box,estimated:true as const}]:[]),titles:[],subtitles:null,captions:[],annotations:[],footnotes:null,legends:[],needsReview:true,numericalDataExtracted:false,warnings:["Text comes only from saved reviewer-verified OCR. Its role, position and scale association remain candidates.","No zero origin, invisible axis, missing unit or series-to-axis relationship is assumed."],createdAt:new Date().toISOString()}
 if(!labels.length)result.warnings.push("No compatible reviewer-verified OCR labels are available. Run OCR and review the relevant regions first.")
 const axisIds=(options.axisLabels||options.axisScale)?chart.output.axisRegionIds:[]
 for(const id of axisIds){
  const region=refs.get(id)
  if(!region||region.primaryType!=="axis_region")continue
  const box=region.box,orientation=box.width*W>=box.height*H*3?"horizontal":box.height*H>=box.width*W*3?"vertical":"unknown",plot=result.plotBounds.length===1?result.plotBounds[0].box:null
  const role=orientation==="horizontal"?"x_candidate":orientation==="vertical"&&plot&&box.x+box.width/2<=plot.x+plot.width*.15?"y_left_candidate":orientation==="vertical"&&plot&&box.x+box.width/2>=plot.x+plot.width*.85?"y_right_candidate":"unknown"
  result.axes.push({id:`axis:${id}`,regionId:id,box,orientation,role,titleLabelIds:[],unit:null,ticks:[],scale:deriveAxisScale([]),visibleIntersection:null,gridlines:{status:"unknown",regionIds:[]},warnings:["Axis bounds and orientation use the existing estimated region frame; gridlines and broken-axis marks are not detected by this local interpreter."]})
 }
 const assignments=new Map(result.axes.map((a)=>[a.id,[] as ReviewedChartLabel[]]))
 for(const label of labels){
  const linked=refs.get(label.regionId),point=center(label)
  if(linked?.primaryType==="caption_region"||chart.output.titleRegionIds.includes(label.regionId)||chart.output.legendRegionIds.includes(label.regionId)||chart.output.legendRegionIds.includes(linked?.parentId??""))continue
  let candidates=result.axes.filter((a)=>label.regionId===a.regionId||linked?.parentId===a.regionId)
  if(!candidates.length&&point&&!chart.output.titleRegionIds.includes(label.regionId)&&!chart.output.legendRegionIds.includes(label.regionId))candidates=result.axes.filter((a)=>inBox(point.x/W,point.y/H,a.box,.025))
  if(candidates.length===1)assignments.get(candidates[0].id)!.push(label)
  else if(candidates.length>1)result.warnings.push(`Label ${label.id} overlaps multiple axis candidates and was not assigned.`)
 }
 for(const axis of result.axes){
  const assigned=assignments.get(axis.id)!,positioned=assigned.filter((l)=>center(l)&&l.geometryBasis!=="unmapped")
  const numeric=positioned.filter((l)=>{const scalar=parseAxisScalar(l.text);return scalar.value!=null})
  const textLabels=assigned.filter((l)=>parseAxisScalar(l.text).kind==="category")
  let selected=numeric
  if(!numeric.length&&axis.orientation!=="unknown"){
   // Keep only a dominant row/column of categorical labels, excluding isolated axis titles.
   const eligible=positioned.filter((l)=>parseAxisScalar(l.text).kind==="category"&&l.text.length<=80),tolerance=Math.max(8,(axis.orientation==="horizontal"?H:W)*.015)
   const clusters=eligible.map((seed)=>eligible.filter((l)=>Math.abs((axis.orientation==="horizontal"?center(l)!.y:center(l)!.x)-(axis.orientation==="horizontal"?center(seed)!.y:center(seed)!.x))<=tolerance)).sort((a,b)=>b.length-a.length)
   if(clusters[0]?.length>=3)selected=clusters[0]
  }
  axis.titleLabelIds=textLabels.filter((l)=>!selected.includes(l)).map((l)=>l.id)
  const explicitUnits=new Set(textLabels.filter((l)=>axis.titleLabelIds.includes(l.id)).flatMap((l)=>{const match=l.text.match(/[([]([^()[\]]{1,24})[)\]]/);return match&&!/^[\d\s+\-.]+$/.test(match[1])?[match[1].trim()]:[]}))
  if(explicitUnits.size===1)axis.unit=[...explicitUnits][0]
  if(explicitUnits.size>1)axis.warnings.push("Several explicit title units conflict; no common unit was assigned.")
  if(axis.orientation!=="unknown")axis.ticks=selected.map((l)=>({labelId:l.id,text:l.text,position:axis.orientation==="horizontal"?center(l)!.x:center(l)!.y,scalar:parseAxisScalar(l.text)})).sort((a,b)=>a.position-b.position)
  if(options.axisScale){axis.scale=deriveAxisScale(axis.ticks,axis.unit);if(explicitUnits.size>1){axis.scale={...deriveAxisScale([]),warnings:["Conflicting explicit title units prevent scale fitting."]};axis.unit=null}}
  else axis.scale.warnings=["Scale interpretation is disabled in Accessibility Settings."]
  axis.unit=axis.scale.unit??axis.unit
  if(!axis.ticks.length)axis.warnings.push("No reviewed, positioned tick labels could be associated with this axis.")
  if(assigned.some((l)=>l.geometryBasis==="unmapped"))axis.warnings.push("Edited block text has no verified token-to-position alignment; it was not used to fit ticks.")
  for(const label of assigned){const scalar=parseAxisScalar(label.text);if(scalar.warning)axis.warnings.push(`Label ${label.id}: ${scalar.warning}`)}
 }
 for(const horizontal of result.axes.filter((a)=>a.orientation==="horizontal"))for(const vertical of result.axes.filter((a)=>a.orientation==="vertical")){
  const x=vertical.box.x+vertical.box.width/2,y=horizontal.box.y+horizontal.box.height/2
  if(inBox(x,y,horizontal.box,.01)&&inBox(x,y,vertical.box,.01)){
   const intersection={x:x*W,y:y*H,basis:"region_centerline_estimate" as const}
   horizontal.visibleIntersection??=intersection;vertical.visibleIntersection??=intersection
  }
 }
 if(options.axisLabels||options.dataLabels){
  result.titles=labels.filter((l)=>chart.output.titleRegionIds.includes(l.regionId)).map((l)=>l.id)
  result.captions=labels.filter((l)=>refs.get(l.regionId)?.primaryType==="caption_region").map((l)=>l.id)
  const assignedIds=new Set(result.axes.flatMap((a)=>[...a.titleLabelIds,...a.ticks.map((t)=>t.labelId)]))
  result.annotations=labels.filter((l)=>!assignedIds.has(l.id)&&!result.titles.includes(l.id)&&!result.captions.includes(l.id)&&!chart.output.legendRegionIds.includes(l.regionId)&&!chart.output.legendRegionIds.includes(refs.get(l.regionId)?.parentId??"")&&refs.get(l.regionId)?.primaryType==="chart_label_region").map((l)=>l.id)
 }
 if(options.legend)result.legends=chart.output.legendRegionIds.filter((id)=>refs.has(id)).map((id)=>({regionId:id,entries:labels.filter((l)=>l.regionId===id||refs.get(l.regionId)?.parentId===id).map((l)=>({labelId:l.id,text:l.text,candidateMarkerRegionIds:[],linePattern:null,color:null,candidateSeriesIds:[],association:"unverified" as const}))}))
 if(options.legend)result.warnings.push("Legend text is preserved without guessing marker/color/pattern or series matches. Similar colors never establish an association.")
 if(result.axes.filter((a)=>a.orientation==="vertical").length>1)result.warnings.push("Multiple Y-axis candidates remain separate. Series-to-axis mappings and differing units require human verification.")
 if((options.axisLabels||options.axisScale)&&!result.axes.length)result.warnings.push("The chart has no eligible existing axis references. No invisible axes were created.")
 return result
}


