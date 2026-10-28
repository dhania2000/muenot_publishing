import "server-only"
import {listOcrResults} from "./store"
import {toOcrView} from "./ocr-service"
import {chartOcrEvidence} from "./advanced-evidence-source"
import type {ImageRegion} from "./region-analysis"
import type {MathCrop} from "./math-contract"
import type {IllustrationOcrOrder} from "./illustration-contract"
export async function illustrationSupport(assetId:number,occurrenceId:number|null,regions:ImageRegion[],source:MathCrop){
 const [support,rows]=await Promise.all([chartOcrEvidence(assetId,occurrenceId,regions),listOcrResults(assetId,occurrenceId)]),valid=new Map(rows.map(toOcrView).filter((r)=>r&&r.assetId===assetId&&r.occurrenceId===occurrenceId&&r.inputSha256===source.sourceSha256&&r.region?.analysisId===source.analysisId&&r.region.analysisVersion===source.analysisVersion&&r.source.storedWidth===source.sourceWidth&&r.source.storedHeight===source.sourceHeight&&r.source.orientation===1&&!r.source.orientationUnknown).map((r)=>[r!.resultId,r!]))
 const ocrEvidence=support.ocrEvidence.filter((r)=>valid.has(r.resultId)),sourceRefs=new Set(ocrEvidence.map((r)=>`image:${r.resultId}`)),reviewEvidence=support.reviewEvidence.filter((r)=>sourceRefs.has(r.sourceRef)),ocrOrder:IllustrationOcrOrder[]=[]
 for(const r of ocrEvidence){const raw=valid.get(r.resultId)!;if(!raw.layout?.drawable||!raw.region)continue;ocrOrder.push({resultId:r.resultId,version:r.version,regionId:raw.region.regionId,lines:raw.layout.lines.slice(0,40).map((l,index)=>({index,block:l.block??null,paragraph:l.paragraph??null,box:l.box})),truncated:raw.layout.truncated||raw.layout.lines.length>40,basis:"raw_engine_order",readingOrderVerified:false})}
 return {support:{ocrEvidence,reviewEvidence},ocrOrder}
}
