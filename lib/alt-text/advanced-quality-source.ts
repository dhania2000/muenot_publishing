import "server-only"
import {createHash} from "node:crypto"
import {descriptionStrategy} from "./description-evidence"
import {query} from "@/lib/db"
import {currentTenantId} from "@/lib/tenant-scope"
import {getAsset,getLatestRegionAnalysis,getSettingsRecord,getOccurrenceClassification} from "./store"
import {withinScope,type HistoryActor} from "./history"
import {openAltTextImage} from "./preview"
import {readImageBytes} from "./generate"
import {readImageHeader} from "./image-header"
import {toAnalysisView} from "./region-service"
import {ensureEvidenceSchema} from "./math-store"
import {AdvancedEvidenceError} from "./advanced-evidence-source"
import {loadStructuredReviewSource,reviewFingerprint} from "./structured-review-source"
import {parseStructuredReview,validateStructuredCorrections,type StructuredReviewKind} from "./structured-review-contract"
import type {QualityInput,QualityReference,QualityChart} from "./advanced-quality-contract"
const parse=(v:any)=>typeof v==="string"?JSON.parse(v):v
type EvidenceRow={id:number;version:number;kind:string;region_id:string;status:string;input_json:any;result_json:any;result_bytes:number}
export async function authorizeQualitySource(assetId:number,occurrenceId:number|null,actor:HistoryActor){
 const asset=await getAsset(assetId)
 if(!asset||!withinScope(actor.viewScope,actor.userId,asset))throw new AdvancedEvidenceError(404,"NOT_FOUND","Image not found.")
 const document=await (await import("./document-generation")).resolveDocumentPromptContext(assetId,actor,occurrenceId)
 if(document.kind==="ineligible")throw new AdvancedEvidenceError(404,"NOT_FOUND","The source occurrence/document is unavailable.")
 return {asset,document}
}
/** Read-only snapshot of current saved sources. Recognition, generation, billing and approval are never invoked. */
export async function loadQualityInput(assetId:number,occurrenceId:number|null,actor:HistoryActor){
 const {asset,document}=await authorizeQualitySource(assetId,occurrenceId,actor)
 const image=await openAltTextImage(assetId,{tenantId:currentTenantId(),userId:actor.userId,scope:actor.viewScope})
 if(!image.ok)throw new AdvancedEvidenceError(image.status,image.code,image.error)
 const bytes=await readImageBytes(image.body,20*1024*1024)
 if(!bytes)throw new AdvancedEvidenceError(413,"SOURCE_LIMIT","The image exceeds the bounded QA source limit.")
 const sha=createHash("sha256").update(bytes).digest("hex")
 await ensureEvidenceSchema()
 const [analysisRow,settings,occurrence,ocrRows,rows]=await Promise.all([
  getLatestRegionAnalysis(assetId,occurrenceId),getSettingsRecord(),occurrenceId==null?null:getOccurrenceClassification(assetId,occurrenceId),
  query<any[]>(`SELECT o.result_id,o.version,o.status,JSON_UNQUOTE(JSON_EXTRACT(o.result_json,'$.rawText')) AS raw_text,
   JSON_UNQUOTE(JSON_EXTRACT(o.result_json,'$.inputSha256')) AS source_sha,JSON_EXTRACT(o.result_json,'$.region') AS region_json,
   JSON_EXTRACT(o.result_json,'$.meanConfidence') AS confidence,JSON_UNQUOTE(JSON_EXTRACT(o.result_json,'$.confidenceScale')) AS confidence_scale,
   JSON_UNQUOTE(JSON_EXTRACT(o.result_json,'$.languageMode')) AS language_mode,JSON_UNQUOTE(JSON_EXTRACT(o.result_json,'$.loadedLanguages')) AS loaded_languages,
   JSON_EXTRACT(o.result_json,'$.layout.possibleColumns') AS possible_columns,JSON_EXTRACT(o.result_json,'$.layout.truncated') AS truncated
   FROM alt_text_ocr_results o WHERE o.tenant_id=? AND o.asset_id=? AND o.occurrence_key=?
   AND NOT EXISTS (SELECT 1 FROM alt_text_ocr_results n WHERE n.tenant_id=o.tenant_id AND n.asset_id=o.asset_id AND n.occurrence_key=o.occurrence_key AND n.scope_key=o.scope_key AND n.version>o.version) ORDER BY o.id DESC LIMIT 33`,[currentTenantId(),assetId,occurrenceId??0]),
  query<EvidenceRow[]>(`SELECT e.id,e.version,e.kind,e.region_id,e.status,JSON_OBJECT('source',JSON_EXTRACT(e.input_json,'$.source'),'target',JSON_EXTRACT(e.input_json,'$.target'),'sourceRef',JSON_EXTRACT(e.input_json,'$.sourceRef'),'regionId',JSON_EXTRACT(e.input_json,'$.regionId'),'evidenceId',JSON_EXTRACT(e.input_json,'$.evidenceId'),'kind',JSON_EXTRACT(e.input_json,'$.kind')) AS input_json,IF(OCTET_LENGTH(CAST(e.result_json AS CHAR))<=200000,e.result_json,NULL) AS result_json,OCTET_LENGTH(CAST(e.result_json AS CHAR)) AS result_bytes
   FROM alt_text_accessibility_evidence e WHERE e.tenant_id=? AND e.asset_id=? AND e.occurrence_key=?
   AND e.kind IN ('math_recognition','ocr_review','chart_structure','chart_axes','chart_data','scientific_structure','scientific_domain','illustration_structure','structured_review')
   AND NOT EXISTS (SELECT 1 FROM alt_text_accessibility_evidence n WHERE n.tenant_id=e.tenant_id AND n.asset_id=e.asset_id AND n.occurrence_key=e.occurrence_key AND n.kind=e.kind AND n.region_id=e.region_id AND n.version>e.version) ORDER BY e.id DESC LIMIT 97`,[currentTenantId(),assetId,occurrenceId??0])
 ])
 const analysis=analysisRow?toAnalysisView(analysisRow):null,header=readImageHeader(bytes,asset.mimeType),frame=!!analysis&&!!header&&header.orientation===1&&!header.orientationUnknown&&analysis.source.orientation===1&&!analysis.source.orientationUnknown&&header.width===analysis.source.storedWidth&&header.height===analysis.source.storedHeight
 const category=occurrence?.manual?.primaryCategory??asset.classificationRecord?.manual?.primaryCategory??asset.classificationRecord?.automated?.primaryCategory??asset.classification
 const complex=["math","chart","scientific","flowchart","table","map","mixed"].includes(descriptionStrategy(category??null))
 const input:QualityInput={assetId,occurrenceId,contentVersion:asset.currentVersion,sourceSha256:sha,classification:category??null,description:{shortAlt:asset.shortAlt??"",longDescription:asset.longDescription??"",extractedText:asset.extractedText??"",language:asset.language==="en"||asset.language==="hi"?asset.language:null,approved:asset.status==="approved"&&asset.approvedAt!==null,decorative:asset.classification==="decorative"},policy:{requireLong:complex||asset.settingsOverride?.imagePurpose==="complex",shortTarget:settings.settings.shortMaxChars,guideline:null},coverage:{complete:ocrRows.length<=32&&rows.length<=96,staleSources:0,notes:[]},ocr:[],math:[],charts:[],science:[],illustrations:[],reviewReferences:[]}
 const ref=(kind:string,id:unknown,version:number,regionId:string|null,reviewState:string|null=null):QualityReference=>({kind,id:String(id),version:Number(version),regionId,reviewState})
 const originals=new Map<string,string>(),reviewRows=rows.filter(r=>r.kind==="ocr_review"),validReview=(sourceRef:string)=>{
  const r=reviewRows.find(r=>parse(r.input_json)?.sourceRef===sourceRef),p=r?parse(r.input_json):null,v=r?parse(r.result_json):null
  if(!r||!v||p.target?.assetId!==assetId||p.target?.occurrenceId!==occurrenceId||v.originalText!==originals.get(sourceRef)||typeof v.correctedText!=="string"||v.correctedText.length>20000)return null
  input.reviewReferences.push(ref("ocr_review",r.id,r.version,p.regionId??null,v.state));return v
 }
 const bool=(v:any)=>v===true||v===1||v==="true"
 for(const o of ocrRows.slice(0,32)){
  const region=parse(o.region_json)
  if(o.source_sha!==sha||region&&(!frame||region.analysisId!==analysis!.analysisId||region.analysisVersion!==analysis!.version||!analysis!.regions.some(r=>r.id===region.regionId))){input.coverage.staleSources++;continue}
  if(typeof o.raw_text!=="string"||o.raw_text.length>20000){input.coverage.complete=false;continue}
  originals.set(`image:${o.result_id}`,o.raw_text);const review=validReview(`image:${o.result_id}`)
  const confidence=o.confidence==null||String(o.confidence)==="null"?null:Number(o.confidence)
  input.ocr.push({ref:ref("image_ocr",o.result_id,o.version,region?.regionId??null,review?.state??null),status:o.status,raw:o.raw_text,corrected:review&&["corrected","verified"].includes(review.state)?review.correctedText:null,reviewState:review?.state??null,confidence,confidenceScale:o.confidence_scale??null,languageMode:o.language_mode??null,loadedLanguages:o.loaded_languages??null,possibleColumns:bool(o.possible_columns),truncated:bool(o.truncated),readingOrderVerified:false})
 }
 const current=new Map<number,{row:EvidenceRow;value:any}>()
 for(const r of rows.slice(0,96)){
  if(r.result_bytes>200000){input.coverage.complete=false;continue}
  if(["ocr_review","structured_review"].includes(r.kind))continue
  const v=parse(r.result_json),request=parse(r.input_json),source=v?.source??request?.source
  const sourceSha=source?.sourceSha256??v?.sourceSha256,aid=source?.analysisId??v?.regionAnalysisId
  if(sourceSha!==sha||!frame||aid!=null&&aid!==analysis!.analysisId||source?.analysisVersion!=null&&source.analysisVersion!==analysis!.version||!analysis!.regions.some(region=>region.id===r.region_id)){input.coverage.staleSources++;continue}
  if(!v){input.coverage.complete=false;continue}
  if(v.assetId!==assetId||v.occurrenceId!==occurrenceId){input.coverage.complete=false;continue}
  current.set(Number(r.id),{row:r,value:v})
 }
 for(const {row:r,value:v} of current.values())if(r.kind==="math_recognition"){
  if(input.math.length>=8){input.coverage.complete=false;break}
  originals.set(`math:${r.id}`,typeof v.rawOutput==="string"?v.rawOutput:"");const review=validReview(`math:${r.id}`)
  input.math.push({ref:ref("math_ocr",r.id,r.version,r.region_id,review?.state??null),latex:typeof v.candidateLatex==="string"?v.candidateLatex:null,reviewedLatex:review&&["corrected","verified"].includes(review.state)?review.correctedText:null,reviewState:review?.state??null,status:r.status})
 }
 const charts=new Map<number,QualityChart>(),structured=new Map<number,Awaited<ReturnType<typeof loadStructuredReviewSource>>>()
 let inspected=0
 for(const {row:r,value:v} of current.values()){
  if(!["chart_axes","chart_data","scientific_structure","illustration_structure"].includes(r.kind)||r.status!=="completed")continue
  if(++inspected>12){input.coverage.complete=false;continue}
  let source:Awaited<ReturnType<typeof loadStructuredReviewSource>>
  try{source=await loadStructuredReviewSource(assetId,occurrenceId,r.kind as StructuredReviewKind,Number(r.id),actor)}catch(error){if(!(error instanceof AdvancedEvidenceError)||![409,413,422].includes(error.status))throw error;input.coverage.staleSources++;continue}
  if(!source.sourceCurrent){input.coverage.staleSources++;continue}structured.set(Number(r.id),source)
  if(r.kind==="chart_axes"){
   const parent=current.get(v.parentChartEvidenceId)?.value
   charts.set(Number(r.id),{axesRef:ref("chart_axes",r.id,r.version,r.region_id),ref:ref("chart_axes",r.id,r.version,r.region_id),family:parent?.output?.chartType??null,labelIds:(v.labels??[]).map((label:any)=>label.id),axes:v.axes,seriesIds:[...new Set<string>((v.legends??[]).flatMap((l:any)=>l.entries.flatMap((e:any)=>[e.labelId,...(e.candidateSeriesIds??[])])))],points:[],manualPoints:[],warnings:[]})
  }else if(r.kind==="scientific_structure")input.science.push({ref:ref(r.kind,r.id,r.version,r.region_id),elements:v.elements.map(({id,regionId,kind,panelRegionId}:any)=>({id,regionId,kind,panelRegionId})),relationships:v.relationships,domainWarnings:[...(v.warnings??[])]})
  else if(r.kind==="illustration_structure")input.illustrations.push({ref:ref(r.kind,r.id,r.version,r.region_id),contentType:v.contentType,nodeIds:(v.output.nodes??[]).map((n:any)=>n.regionId),edges:v.output.edges??[],cellRegionIds:(v.output.table?.cells??[]).map((c:any)=>c.regionId),readingOrderVerified:false})
 }
 for(const {row:r,value:v} of current.values())if(r.kind==="chart_data"&&structured.has(Number(r.id))){
  const source=structured.get(Number(r.id))!,axes=charts.get(v.parentAxesEvidenceId)
  if(!axes){input.coverage.complete=false;continue}
  axes.points=source.targets.filter(t=>t.kind==="point").map(t=>t.reviewContext as QualityChart["points"][number]);axes.ref=ref("chart_data",r.id,r.version,r.region_id)
 }
 for(const {row:r,value:v} of current.values())if(r.kind==="scientific_domain"){
  const science=input.science.find(s=>s.ref.id===String(v.parentStructureEvidenceId)),parent=current.get(v.parentStructureEvidenceId)
  if(science&&parent?.row.version===v.parentStructureVersion)science.domainWarnings.push(...(v.warnings??[]),...(v.observations??[]).filter((o:any)=>o.basis==="domain_inference").map(()=>"Domain inference is not a verified fact."))
 }
 for(const r of rows.filter(r=>r.kind==="structured_review")){
  const v=parse(r.result_json),p=parse(r.input_json),source=structured.get(Number(p?.evidenceId))
  if(!v||!source||v.sourceFingerprint!==source.sourceFingerprint||!["corrected","verified"].includes(v.state))continue
  const candidate=parseStructuredReview({kind:p.kind,evidenceId:Number(p.evidenceId),occurrenceId,sourceFingerprint:source.sourceFingerprint,expectedVersion:0,requestId:"quality_source",state:v.state,comment:v.comment,corrections:v.corrections})
  if(!candidate||validateStructuredCorrections(candidate,source.targets)){input.coverage.complete=false;continue}
  input.reviewReferences.push(ref("structured_review",r.id,r.version,source.sourceRegionId,v.state));for(const item of [...input.science,...input.illustrations,...charts.values()])if(item.ref.id===String(p.evidenceId))item.ref.reviewState=v.state
  for(const c of charts.values())if(c.axesRef?.id===String(p.evidenceId))c.axesRef.reviewState=v.state
  const chart=[...charts.values()].find(c=>c.ref.id===String(p.evidenceId))
  if(chart)chart.manualPoints.push(...candidate.corrections.flatMap(c=>"classification" in c.value?[{value:c.value.value,unit:c.value.unit,classification:c.value.classification,precisionNote:c.value.precisionNote}]:[]))
 }
 input.charts=[...charts.values()]
 if(!input.coverage.complete)input.coverage.notes.push("Some saved records exceeded the bounded QA budget or could not be interpreted; omitted checks are not certified.")
 if(JSON.stringify(input).length>240000)throw new AdvancedEvidenceError(413,"QUALITY_INPUT_LIMIT","Saved evidence exceeds the bounded QA snapshot limit.")
 return {asset,document,input,fingerprint:reviewFingerprint({input,document:document.kind==="document"?{id:document.document.documentId,occurrence:document.document.imageOccurrenceId,packet:document.document.packet}:null})}
}
