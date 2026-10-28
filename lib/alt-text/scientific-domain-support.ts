import "server-only"
import {query} from "@/lib/db"
import {currentTenantId} from "@/lib/tenant-scope"
import {getAsset,getOccurrenceClassification} from "./store"
import {listMathEvidence} from "./math-store"
import {readEquationValidations} from "./math-validation-store"
import {getDocument,getDocumentImageContext} from "./document-store"
import {ownerScopeFor} from "./document-service"
import {DOCUMENT_CONTEXT_VERSION,parseStoredContext} from "./document-context"
import type {HistoryActor} from "./history"
import type {DomainParent,DomainSupport} from "./scientific-domain-contract"
const parsed=(v:any)=>typeof v==="string"?JSON.parse(v):v
/** Called only after the exact asset, occurrence and structure evidence have been authorized. */
export async function loadDomainSupport(parent:DomainParent,actor:HistoryActor):Promise<DomainSupport>{
 const p=parent.result,regions=new Set(p.regionReferences.map((r)=>r.id)),rawIds=new Set(p.ocrEvidence.map((o)=>`image:${o.resultId}`))
 const labels:DomainSupport["labels"]=[...p.ocrEvidence.filter((o)=>o.regionId&&regions.has(o.regionId)).map((o)=>({key:`ocr:${o.resultId}:${o.version}`,regionId:o.regionId!,text:o.text,designation:"raw_ocr" as const,sourceId:o.resultId,version:o.version,reviewState:"unverified",sourceTextVerified:false})),...p.reviewEvidence.filter((o)=>regions.has(o.regionId)&&rawIds.has(o.sourceRef)).map((o)=>({key:`review:${o.id}:${o.version}`,regionId:o.regionId,text:o.text,designation:"human_corrected_ocr" as const,sourceId:String(o.id),version:o.version,reviewState:o.state,sourceTextVerified:o.state==="verified"}))].slice(0,100)
 const [math,validations,reviewRows,asset,occ]=await Promise.all([listMathEvidence(p.assetId,p.occurrenceId),readEquationValidations(p.assetId,p.occurrenceId),query<any[]>(`SELECT e.id,e.version,e.input_json,e.result_json FROM alt_text_accessibility_evidence e WHERE e.tenant_id=? AND e.asset_id=? AND e.occurrence_key=? AND e.kind='ocr_review' AND JSON_UNQUOTE(JSON_EXTRACT(e.input_json,'$.target.kind'))='math_ocr' AND NOT EXISTS (SELECT 1 FROM alt_text_accessibility_evidence n WHERE n.tenant_id=e.tenant_id AND n.asset_id=e.asset_id AND n.occurrence_key=e.occurrence_key AND n.kind=e.kind AND n.region_id=e.region_id AND n.version>e.version) ORDER BY e.id DESC LIMIT 60`,[currentTenantId(),p.assetId,p.occurrenceId??0]),getAsset(p.assetId),p.occurrenceId?getOccurrenceClassification(p.assetId,p.occurrenceId):Promise.resolve(null)])
 const reviews=new Map<number,{id:number;version:number;result:any}>()
 for(const row of reviewRows){const input=parsed(row.input_json),result=parsed(row.result_json);if(input?.target?.kind!=="math_ocr"||input.target.assetId!==p.assetId||input.target.occurrenceId!==p.occurrenceId)continue;const id=Number(input.target.sourceId);if(!reviews.has(id))reviews.set(id,{id:Number(row.id),version:Number(row.version),result})}
 const matchedMath=math.filter((r)=>r.result?.candidateLatex&&r.result.candidateLatex.length<=4000&&regions.has(r.regionId)&&r.status==="candidate"&&r.result.assetId===p.assetId&&r.result.occurrenceId===p.occurrenceId&&r.result.source.analysisId===p.regionAnalysisId&&r.result.source.analysisVersion===p.source.analysisVersion&&r.result.source.sourceSha256===p.source.sourceSha256)
 const candidates:DomainSupport["equations"]=matchedMath.slice(0,16).map((r)=>{
  const review=reviews.get(r.id),usable=review&&["corrected","verified"].includes(review.result.state)&&typeof review.result.correctedText==="string"&&review.result.correctedText.length<=4000&&review.result.originalText===r.result!.rawOutput,validation=validations.find((v)=>v.result.sourceEvidenceId===r.id&&v.result.originalCandidate===r.result!.candidateLatex)
  return {id:r.id,version:r.version,regionId:r.regionId,originalLatex:r.result!.candidateLatex!,reviewedLatex:usable?review.result.correctedText:null,reviewId:review?.id??null,reviewVersion:review?.version??null,reviewState:review&&review.result.originalText!==r.result!.rawOutput?"source_mismatch":review?.result.state??null,syntaxStatus:usable?review.result.validation?.syntaxStatus??null:validation?.result.syntaxStatus??null,sourceTextVerified:!!usable&&review.result.state==="verified",scientificAccuracyVerified:false}
 })
 let equationChars=0
 const equations=candidates.filter((e)=>{const n=e.originalLatex.length+(e.reviewedLatex?.length??0);if(equationChars+n>12000)return false;equationChars+=n;return true}),warnings=matchedMath.length>equations.length?["Some saved equations exceed the bounded support budget and were omitted; no source text was truncated."]:[]
 const context=await loadDomainDocumentContext(parent,actor)
 const manual=occ?.manual??asset?.classificationRecord?.manual,classification=manual??asset?.classificationRecord?.automated
 return {warnings,labels,equations,context,classification:classification?{primaryCategory:classification.primaryCategory,secondaryCategories:classification.secondaryCategories,basis:manual?"manual":"automated"}:null,guidelines:null}
}

/** Rechecks current document scope before exposing any saved occurrence context. */
export async function loadDomainDocumentContext(parent:DomainParent,actor:HistoryActor):Promise<DomainSupport["context"]>{
 const p=parent.result
 let context:DomainSupport["context"]=null
 if(p.occurrenceId){
  const rows=await query<any[]>("SELECT document_id FROM alt_text_document_images WHERE tenant_id=? AND id=? AND alt_text_asset_id=? AND extraction_status='extracted' LIMIT 1",[currentTenantId(),p.occurrenceId,p.assetId]),documentId=Number(rows[0]?.document_id)
  if(documentId){const doc=await getDocument(documentId,ownerScopeFor(actor));if(doc?.securityStatus==="clean"){
   const saved=await getDocumentImageContext(documentId,p.occurrenceId),value=saved?.status==="analyzed"&&saved.version===DOCUMENT_CONTEXT_VERSION?parseStoredContext(saved.context):null
   if(value?.documentId===documentId&&value.imageOccurrenceId===p.occurrenceId){const items=[value.caption,value.pageTitle,...value.headings,...value.labels].filter((v)=>v&&v.text.length<=512).slice(0,12).map((v)=>({text:v!.text,provenance:v!.provenance,sourceKind:v!.source.kind,sourceRef:v!.source.ref}));context={documentId,occurrenceId:p.occurrenceId,items}}
  }}
 }
 return context
}
