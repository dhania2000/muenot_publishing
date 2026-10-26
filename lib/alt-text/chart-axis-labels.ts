import "server-only"
import {query} from "@/lib/db"
import {currentTenantId} from "@/lib/tenant-scope"
import {ensureEvidenceSchema} from "./math-store"
import type {ChartStructureResult} from "./chart-contract"
import type {ReviewedChartLabel} from "./chart-axis-contract"
import type {OcrPixelBox} from "./ocr-contract"
import {parseAxisScalar} from "./chart-axis-scale"
const parsed=(v:any)=>typeof v==="string"?JSON.parse(v):v
/** Adapt only reviewer-verified text. Changed block text never inherits old token coordinates. */
export function reviewedChartLabelsFromRows(rows:any[],chart:ChartStructureResult):ReviewedChartLabel[]{
 const labels:ReviewedChartLabel[]=[],seen=new Set<string>(),W=chart.source.sourceWidth,H=chart.source.sourceHeight,crop=chart.source.pixelBox
 const validBox=(b:any):b is OcrPixelBox=>!!b&&[b.left,b.top,b.width,b.height].every(Number.isFinite)&&b.left>=0&&b.top>=0&&b.width>0&&b.height>0&&b.left+b.width<=W+1&&b.top+b.height<=H+1
 const inside=(b:OcrPixelBox)=>b.left>=crop.left-1&&b.top>=crop.top-1&&b.left+b.width<=crop.left+crop.width+1&&b.top+b.height<=crop.top+crop.height+1
 const attached=(b:OcrPixelBox)=>chart.regionReferences.some((r)=>(["caption_region","heading_region"].includes(r.primaryType)||chart.output.titleRegionIds.includes(r.id))&&b.left>=r.box.x*W-1&&b.top>=r.box.y*H-1&&b.left+b.width<=(r.box.x+r.box.width)*W+1&&b.top+b.height<=(r.box.y+r.box.height)*H+1)
 for(const row of rows){
  if(labels.length>=1000)break
  const input=parsed(row.input_json),review=parsed(row.result_json)
  if(!input?.sourceRef||seen.has(input.sourceRef))continue
  seen.add(input.sourceRef)
  if(review?.state!=="verified"||input.target?.kind!=="image_ocr"||input.target.assetId!==chart.assetId||(input.target.occurrenceId??null)!==chart.occurrenceId||typeof review.correctedText!=="string"||!Number.isSafeInteger(input.sourceVersion)||input.sourceVersion<1||typeof input.analysisId!=="string")continue
  const ocr=input.sourceSnapshot
  if(!ocr||ocr.inputSha256!==chart.source.sourceSha256||ocr.source?.storedWidth!==W||ocr.source?.storedHeight!==H||ocr.source?.orientation!==1||ocr.source?.orientationUnknown)continue
  const sourceRegionId=typeof input.regionId==="string"?input.regionId:null
  if(sourceRegionId&&!chart.regionReferences.some((r)=>r.id===sourceRegionId))continue
  const add=(text:string,box:OcrPixelBox|null,basis:ReviewedChartLabel["geometryBasis"],suffix:string)=>{
   if(labels.length>=1000||!text||text.length>500||box&&(!validBox(box)||!inside(box)&&!attached(box)))return
   const containing=box?chart.regionReferences.filter((r)=>r.primaryType!=="graph_region"&&r.locationStatus==="verified_frame"&&(box.left+box.width/2)/W>=r.box.x&&(box.left+box.width/2)/W<=r.box.x+r.box.width&&(box.top+box.height/2)/H>=r.box.y&&(box.top+box.height/2)/H<=r.box.y+r.box.height).sort((a,b)=>a.box.width*a.box.height-b.box.width*b.box.height):[]
   const regionId=sourceRegionId??containing[0]?.id??chart.chartRegionId
   labels.push({id:`review:${row.id}:${suffix}`,regionId,sourceRegionId,text,box,geometryBasis:basis,reviewId:Number(row.id),reviewVersion:Number(row.version),sourceOcrId:input.analysisId,sourceOcrVersion:Number(input.sourceVersion),sourceRef:input.sourceRef,verifiedText:true})
  }
  if(review.correctedText===review.originalText&&ocr.layout?.frame==="stored_pixels"&&ocr.layout?.drawable&&Array.isArray(ocr.layout.lines)){
   for(const [i,line] of ocr.layout.lines.slice(0,400).entries()){
    if(typeof line.text!=="string"||!review.correctedText.includes(line.text.trim()))continue
    const scalar=parseAxisScalar(line.text)
    if(validBox(line.box)&&(inside(line.box)||attached(line.box))&&scalar.kind!=="unknown"){
     // Numeric/category single lines retain their actual OCR line geometry.
     // Multiple numbers on one OCR line are separated below using real word boxes.
     add(line.text,line.box,"ocr_line",`line:${i}`)
     if(scalar.value!=null||scalar.kind==="category")continue
    }
    for(const [j,word] of (Array.isArray(line.words)?line.words:[]).slice(0,120).entries())if(typeof word.text==="string"&&review.correctedText.includes(word.text)&&parseAxisScalar(word.text).value!=null&&validBox(word.box))add(word.text,word.box,"ocr_word",`word:${i}:${j}`)
   }
  }else{
   const region=sourceRegionId?chart.regionReferences.find((r)=>r.id===sourceRegionId):null
   const single=review.correctedText.trim().length<=120&&!/[\r\n]/.test(review.correctedText)&&region&&["chart_label_region","heading_region","caption_region"].includes(region.primaryType)
   const box=single?{left:Math.floor(region.box.x*W),top:Math.floor(region.box.y*H),width:Math.ceil(region.box.width*W),height:Math.ceil(region.box.height*H)}:null
   add(review.correctedText,box,box?"region_box_estimate":"unmapped","corrected")
  }
 }
 return labels
}
export async function loadReviewedChartLabels(chart:ChartStructureResult){
 await ensureEvidenceSchema()
 const ids=chart.regionReferences.map((r)=>r.id)
 if(!ids.length)return []
 const rows=await query<any[]>(`SELECT e.id,e.version,e.input_json,e.result_json FROM alt_text_accessibility_evidence e WHERE e.tenant_id=? AND e.asset_id=? AND e.occurrence_key=? AND e.kind='ocr_review'
  AND NOT EXISTS (SELECT 1 FROM alt_text_accessibility_evidence n WHERE n.tenant_id=e.tenant_id AND n.asset_id=e.asset_id AND n.occurrence_key=e.occurrence_key AND n.kind=e.kind AND n.region_id=e.region_id AND n.id>e.id)
  AND JSON_UNQUOTE(JSON_EXTRACT(e.input_json,'$.target.kind'))='image_ocr'
  AND (JSON_EXTRACT(e.input_json,'$.regionId')=CAST('null' AS JSON) OR JSON_UNQUOTE(JSON_EXTRACT(e.input_json,'$.regionId')) IN (${ids.map(()=>"?").join(",")}))
  AND OCTET_LENGTH(CAST(e.input_json AS CHAR))<=256000 ORDER BY e.id DESC LIMIT 40`,[currentTenantId(),chart.assetId,chart.occurrenceId??0,...ids])
 return reviewedChartLabelsFromRows(rows,chart)
}
