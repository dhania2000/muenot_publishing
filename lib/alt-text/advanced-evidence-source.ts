import "server-only"
import {evidenceDocumentAllowed} from "./evidence-document-authorization"
import {createHash} from "node:crypto"
import {getAsset,getLatestRegionAnalysis,occurrenceBelongsToAsset,listOcrResults} from "./store"
import {toAnalysisView} from "./region-service"
import {withinScope,type HistoryActor} from "./history"
import {openAltTextImage} from "./preview"
import {readImageBytes} from "./generate"
import {readImageHeader} from "./image-header"
import {regionCrop} from "./ocr-contract"
import {isValidNormalizedBox,type ImageRegion} from "./region-analysis"
import type {MathCrop} from "./math-contract"
import {currentTenantId} from "@/lib/tenant-scope"
import {toOcrView} from "./ocr-service"
import {query} from "@/lib/db"
import {ensureEvidenceSchema} from "./math-store"
export class AdvancedEvidenceError extends Error{constructor(readonly status:number,readonly code:string,message:string){super(message)}}
export type AdvancedRegionRequest={requestId:string;occurrenceId:number|null;analysisId:string;regionId:string;reprocess:boolean}
export function parseAdvancedRegionRequest(body:unknown):AdvancedRegionRequest|null{
 if(!body||typeof body!=="object"||Array.isArray(body))return null
 const r=body as Record<string,unknown>
 if(Object.keys(r).some((k)=>!["requestId","occurrenceId","analysisId","regionId","reprocess"].includes(k))||typeof r.requestId!=="string"||!/^[A-Za-z0-9_-]{8,48}$/.test(r.requestId)||typeof r.analysisId!=="string"||!/^rga_[a-f0-9]{8,40}$/.test(r.analysisId)||typeof r.regionId!=="string"||!/^rgn_[a-f0-9]{8,32}$/.test(r.regionId)||r.occurrenceId!=null&&(!Number.isSafeInteger(r.occurrenceId)||Number(r.occurrenceId)<=0)||r.reprocess!=null&&typeof r.reprocess!=="boolean")return null
 return {requestId:r.requestId,occurrenceId:r.occurrenceId==null?null:Number(r.occurrenceId),analysisId:r.analysisId,regionId:r.regionId,reprocess:r.reprocess===true}
}
export async function authorizeAdvancedAsset(assetId:number,occurrenceId:number|null,actor:HistoryActor,edit=false){
 const asset=await getAsset(assetId)
 if(!asset||!withinScope(actor.viewScope,actor.userId,asset)||occurrenceId!=null&&!(await occurrenceBelongsToAsset(assetId,occurrenceId)))throw new AdvancedEvidenceError(404,"NOT_FOUND","Image not found.")
 if(!await evidenceDocumentAllowed(assetId,occurrenceId,actor))throw new AdvancedEvidenceError(404,"NOT_FOUND","Source document occurrence is unavailable.")
 if(actor.exportScope!==undefined&&!withinScope(actor.exportScope,actor.userId,asset))throw new AdvancedEvidenceError(403,"FORBIDDEN","You cannot export this image's analysis.")
 if(edit&&!withinScope(actor.updateScope,actor.userId,asset))throw new AdvancedEvidenceError(403,"FORBIDDEN","You cannot analyze this image.")
 return asset
}
export async function advancedRegionSource(assetId:number,request:AdvancedRegionRequest,actor:HistoryActor,allowedTypes:ImageRegion["primaryType"][],edit=true){
 await authorizeAdvancedAsset(assetId,request.occurrenceId,actor,edit)
 const row=await getLatestRegionAnalysis(assetId,request.occurrenceId),analysis=row?toAnalysisView(row):null,region=analysis?.regions.find((r)=>r.id===request.regionId)
 if(!analysis||analysis.analysisId!==request.analysisId||!region||!allowedTypes.includes(region.primaryType))throw new AdvancedEvidenceError(409,"REGION_CHANGED","Choose a current eligible region before starting analysis.")
 const image=await openAltTextImage(assetId,{tenantId:currentTenantId(),userId:actor.userId,scope:actor.viewScope})
 if(!image.ok)throw new AdvancedEvidenceError(image.status,image.code,image.error)
 const bytes=await readImageBytes(image.body,20_000_000),header=bytes?readImageHeader(bytes,image.contentType):null
 if(!bytes||!header||header.orientation!==1||header.orientationUnknown||header.width*header.height>25_000_000||analysis.source.storedWidth!==header.width||analysis.source.storedHeight!==header.height||analysis.source.orientation!==1||analysis.source.orientationUnknown||region.locationStatus!=="verified_frame"||!isValidNormalizedBox(region.box))throw new AdvancedEvidenceError(422,"REGION_FRAME_UNSAFE","The region cannot be mapped safely to the stored image.")
 const crop=regionCrop(region.box,header.width,header.height)
 if(!crop||crop.width*crop.height>4_000_000)throw new AdvancedEvidenceError(413,"REGION_LIMIT","The selected region exceeds the crop limit.")
 const source:MathCrop={analysisId:analysis.analysisId,analysisVersion:analysis.version,regionId:region.id,normalizedBox:region.box,pixelBox:crop,sourceWidth:header.width,sourceHeight:header.height,sourceSha256:createHash("sha256").update(bytes).digest("hex"),coordinateSystem:"stored_pixels_top_left",locationIsEstimate:true}
 const included=new Set([region.id]),traversable=new Set([region.id])
 for(let depth=0;depth<5;depth++)for(const child of analysis.regions)if(child.parentId&&traversable.has(child.parentId)){
  included.add(child.id)
  if(child.primaryType!=="graph_region"&&!["scientific_diagram_region","chemical_structure_region","circuit_region","geometry_region","flowchart_region","table_region","map_region","mixed_content_region"].includes(child.primaryType))traversable.add(child.id)
 }
 // An attached label/caption may sit outside the chart crop. It remains a referenced region and
 // is never presented as a confirmed title or label without review.
 for(const relation of analysis.relationships)if(["associated_label","adjacent_to"].includes(relation.type)&&(relation.from===region.id||relation.to===region.id)){
  const id=relation.from===region.id?relation.to:relation.from,candidate=analysis.regions.find((r)=>r.id===id)
  if(candidate&&["caption_region","heading_region","chart_label_region","text_region"].includes(candidate.primaryType))included.add(id)
 }
 const regions=analysis.regions.filter((r)=>included.has(r.id)&&r.locationStatus==="verified_frame")
 return {bytes,source,region,regions,relationships:analysis.relationships.filter((r)=>included.has(r.from)&&included.has(r.to)),complexity:analysis.complexityAtAnalysis}
}
/** No full-image prose is mixed into another panel's chart. Only region-scoped OCR is supplied. */
export async function chartOcrEvidence(assetId:number,occurrenceId:number|null,regions:ImageRegion[]){
 await ensureEvidenceSchema()
 let supportChars=0
 const ids=new Set(regions.map((r)=>r.id)),ocrEvidence=[] as {resultId:string;regionId:string|null;version:number;text:string;verified:false;sourceDesignation:"raw_ocr"}[]
 for(const row of await listOcrResults(assetId,occurrenceId)){
  const result=toOcrView(row)
  if(!result?.region||!ids.has(result.region.regionId)||ocrEvidence.some((r)=>r.regionId===result.region!.regionId)||!result.rawText||result.rawText.length>2000||supportChars+result.rawText.length>12000)continue
  supportChars+=result.rawText.length
  ocrEvidence.push({resultId:result.resultId,regionId:result.region.regionId,version:result.version,text:result.rawText,verified:false,sourceDesignation:"raw_ocr"})
  if(ocrEvidence.length>=20)break
 }
 const rows=await query<any[]>(`SELECT id,version,input_json,result_json FROM alt_text_accessibility_evidence WHERE tenant_id=? AND asset_id=? AND occurrence_key=? AND kind='ocr_review' ORDER BY id DESC LIMIT 60`,[currentTenantId(),assetId,occurrenceId??0])
 const reviewEvidence=[] as {id:number;version:number;regionId:string;sourceRef:string;state:string;text:string;sourceDesignation:"human_corrected_ocr"}[],seen=new Set<string>()
 for(const row of rows){
  const input=typeof row.input_json==="string"?JSON.parse(row.input_json):row.input_json,result=typeof row.result_json==="string"?JSON.parse(row.result_json):row.result_json
  if(input?.target?.kind!=="image_ocr"||!input?.regionId||!ids.has(input.regionId)||seen.has(input.sourceRef))continue
  seen.add(input.sourceRef)
  if(!["corrected","verified"].includes(result?.state)||typeof result.correctedText!=="string"||result.correctedText.length>2000||supportChars+result.correctedText.length>12000)continue
  supportChars+=result.correctedText.length
  reviewEvidence.push({id:Number(row.id),version:Number(row.version),regionId:input.regionId,sourceRef:input.sourceRef,state:result.state,text:result.correctedText,sourceDesignation:"human_corrected_ocr"})
 }
 return {ocrEvidence,reviewEvidence}
}

