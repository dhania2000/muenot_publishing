import "server-only"
import {createHash} from "node:crypto"
import {isDeepStrictEqual} from "node:util"
import {getCompletedAdvancedEvidence} from "./advanced-evidence-store"
import {advancedRegionSource,authorizeAdvancedAsset,AdvancedEvidenceError,chartOcrEvidence} from "./advanced-evidence-source"
import {SCIENCE_ROOT_TYPES} from "./scientific-structure-contract"
import {illustrationPanel,ILLUSTRATION_ROOTS} from "./illustration-contract"
import {authorizedChartDataParent,assertChartDataCurrent} from "./chart-data-service"
import {reviewedChartData} from "./chart-data-review"
import {resolveDocumentPromptContext} from "./document-generation"
import {withinScope,type HistoryActor} from "./history"
import type {StructuredReviewKind,StructuredTarget} from "./structured-review-contract"
export function reviewFingerprint(value:unknown):string{
 const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==="object"?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v
 return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")
}
/** Only selected source evidence is loaded. No recognition, queue, metering or approval call. */
export async function loadStructuredReviewSource(assetId:number,occurrenceId:number|null,kind:StructuredReviewKind,evidenceId:number,actor:HistoryActor){
 const asset=await authorizeAdvancedAsset(assetId,occurrenceId,actor),record=await getCompletedAdvancedEvidence(assetId,occurrenceId,kind,evidenceId)
 if(!record?.result)throw new AdvancedEvidenceError(404,"EVIDENCE_NOT_FOUND","Completed evidence not found.")
 const document=await resolveDocumentPromptContext(assetId,actor,occurrenceId)
 if(document.kind==="ineligible")throw new AdvancedEvidenceError(404,"SOURCE_NOT_FOUND","The source occurrence/document is unavailable.")
 let raw:any=record.result,crop:any=raw.source,current=true
 if(kind==="chart_axes"||kind==="chart_data"){
  const {parent}=await authorizedChartDataParent(assetId,occurrenceId,kind==="chart_axes"?evidenceId:raw.parentAxesEvidenceId,actor)
  crop=parent.chart.result.source
  try{await assertChartDataCurrent(parent,actor,false)}catch(error){if(!(error instanceof AdvancedEvidenceError))throw error;current=false}
  if(kind==="chart_data"){const reviewed=await reviewedChartData(assetId,occurrenceId,evidenceId,actor);raw=reviewed.result;current&&=reviewed.sourceCurrent}
 }else{
  try{const source=await advancedRegionSource(assetId,{requestId:"review_source",occurrenceId,analysisId:raw.regionAnalysisId,regionId:record.regionId,reprocess:false},actor,kind==="scientific_structure"?[...SCIENCE_ROOT_TYPES]:Object.keys(ILLUSTRATION_ROOTS) as (keyof typeof ILLUSTRATION_ROOTS)[],false);const support=await chartOcrEvidence(assetId,occurrenceId,source.regions);current=isDeepStrictEqual(source.source,crop)&&isDeepStrictEqual(support.ocrEvidence,raw.ocrEvidence)&&isDeepStrictEqual(support.reviewEvidence,raw.reviewEvidence)}
  catch(error){if(!(error instanceof AdvancedEvidenceError)||[403,404].includes(error.status))throw error;current=false}
 }
 const targets:StructuredTarget[]=[],add=(t:StructuredTarget)=>targets.push(t)
 const regionBoxes=new Map<string,any>((raw.regionReferences??[]).map((r:any)=>[r.id,r.box]))
 const pixelBox=(b:any)=>b&&crop?.sourceWidth&&crop?.sourceHeight?{x:b.left/crop.sourceWidth,y:b.top/crop.sourceHeight,width:b.width/crop.sourceWidth,height:b.height/crop.sourceHeight}:null
 if(kind==="scientific_structure"){
  const members=(raw.elements??[]).map((e:any)=>({id:e.id,panelId:e.panelRegionId??null}))
  for(const e of raw.elements??[])add({id:`element:${e.id}`,kind:"component",regionId:e.regionId,label:`${e.kind} · ${e.regionId}`,raw:e,box:e.box??null})
  for(const r of raw.relationships??[])add({id:`relationship:${r.id}`,kind:"relationship",regionId:r.connectorRegionId??null,label:`Relationship · ${r.type}`,raw:r,box:regionBoxes.get(r.connectorRegionId)??null,members})
  for(const a of raw.labelAssociations??[])add({id:`association:${a.id}`,kind:"association",regionId:a.labelRegionId,label:`Label association · ${a.labelRegionId}`,raw:a,box:regionBoxes.get(a.labelRegionId)??null,members:members.filter((m:any)=>m.id!==a.labelElementId&&m.panelId===members.find((x:any)=>x.id===a.labelElementId)?.panelId)})
 }else if(kind==="illustration_structure"){
  const cells=new Set((raw.output.table?.cells??[]).map((c:any)=>c.regionId)),nodes=new Set((raw.output.nodes??[]).map((n:any)=>n.regionId)),refs=new Map<string,any>((raw.regionReferences??[]).map((r:any)=>[r.id,r])),members=(raw.elements??[]).filter((e:any)=>nodes.has(e.regionId)).map((e:any)=>({id:e.regionId,panelId:illustrationPanel(e.regionId,refs,raw.rootRegionId)}))
  for(const e of raw.elements??[])add({id:`element:${e.regionId}`,kind:cells.has(e.regionId)?"cell":raw.contentType==="flowchart"&&nodes.has(e.regionId)?"node":"label",regionId:e.regionId,label:`${e.role} · ${e.regionId}`,raw:{element:e,sourceText:(raw.sourceText??[]).filter((t:any)=>t.regionId===e.regionId)},box:e.box??null})
  for(const r of raw.output.edges??[])add({id:`connector:${r.connectorRegionId}`,kind:"relationship",regionId:r.connectorRegionId,label:`Connector · ${r.connectorRegionId}`,raw:r,box:regionBoxes.get(r.connectorRegionId)??null,members})
 }else if(kind==="chart_axes"){
  for(const a of raw.axes??[])add({id:`axis:${a.id}`,kind:"axis",regionId:a.regionId,label:`Axis · ${a.role}`,raw:a,box:a.box??null})
  for(const l of raw.labels??[])add({id:`label:${l.id}`,kind:"label",regionId:l.regionId,label:`Label · ${l.text}`,raw:l,box:pixelBox(l.box)})
 }else{
  const seriesIds=[...new Set<string>((raw.points??[]).map((p:any)=>p.seriesId).filter((v:any)=>typeof v==="string"))]
  for(const p of raw.points??[])add({id:`point:${p.id}`,kind:"point",regionId:record.regionId,label:`Point · ${p.sourceText}`,raw:record.result.kind==="chart_data"?record.result.points.find(original=>original.id===p.id)??null:null,reviewContext:p,box:pixelBox(p.labelBox),seriesIds})
 }
 if(document.kind==="document"&&document.document.packet)add({id:`context:${document.document.imageOccurrenceId}`,kind:"context_note",regionId:null,label:"Reviewer context note (not native document text)",raw:{documentId:document.document.documentId,occurrenceId,contextFingerprint:reviewFingerprint(document.document.packet)},box:null})
 if(targets.length>200||JSON.stringify(targets).length>180_000)throw new AdvancedEvidenceError(413,"REVIEW_SOURCE_LIMIT","This evidence exceeds the bounded review target budget.")
 const sourceFingerprint=reviewFingerprint({id:record.id,version:record.version,kind,original:record.result,raw,context:document.kind==="document"?document.document.packet??null:null})
 return {asset,assetId,occurrenceId,kind,evidenceId,sourceVersion:record.version,sourceRegionId:record.regionId,sourceFingerprint,sourceCurrent:current,canEdit:current&&withinScope(actor.updateScope,actor.userId,asset),targets,warnings:[...new Set<string>(raw.warnings??[]),...(!current?["Historical source: the current image, analysis or OCR review no longer matches. Corrections are read-only until source analysis is refreshed."]:[]),"Human corrections do not establish scientific truth, original exact numeric values or final description approval."],location:document.kind==="document"?document.document.locationLabel:null,previewUrl:`/api/alt-text/assets/${assetId}/image`}
}
