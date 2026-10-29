import "server-only"
import {createHash} from "node:crypto"
import {query} from "@/lib/db"
import {currentTenantId} from "@/lib/tenant-scope"
import {ensureEvidenceSchema} from "./math-store"
import {withinScope,type HistoryActor} from "./history"
import type {InsertionReadinessRow} from "./document-approval-contract"
import type {DocumentAccessibilitySnapshot,DocumentEvidenceReference} from "./document-accessibility-contract"
const hash=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex")
const integer=(v:any)=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):null
const count=(v:any)=>Number.isFinite(Number(v))?Math.max(0,Math.min(100000,Math.floor(Number(v)))):0
const id=(v:any)=>typeof v==="string"&&/^[A-Za-z0-9:_-]{1,128}$/.test(v)?v:null
const sha=(v:any)=>typeof v==="string"&&/^[a-f0-9]{64}$/.test(v)?v:null
const parse=(v:any)=>{try{return typeof v==="string"?JSON.parse(v):v}catch{return null}}
export const DOCUMENT_EVIDENCE_LIMITS={occurrences:5000,chunk:100,perOccurrence:12,totalReferences:1000} as const
/** Metadata-only join against the exact approved version and exact occurrence. No image
 * reads, providers, QA execution, raw OCR/MathML/text extraction or new export framework. */
export async function captureDocumentAccessibility(documentId:number,rows:InsertionReadinessRow[],actor:HistoryActor):Promise<InsertionReadinessRow[]>{
 if(rows.length>DOCUMENT_EVIDENCE_LIMITS.occurrences)return rows
 await ensureEvidenceSchema()
 const tenant=currentTenantId(),ids=[...new Set(rows.map(r=>r.imageOccurrenceId))],metadata=new Map<number,any>()
 for(let offset=0;offset<ids.length;offset+=DOCUMENT_EVIDENCE_LIMITS.chunk){
  const chunk=ids.slice(offset,offset+DOCUMENT_EVIDENCE_LIMITS.chunk)
  const found=await query<any[]>(`SELECT i.id AS occurrence_id,i.alt_text_asset_id AS asset_id,i.source_locator,a.created_by,a.reviewer_id,a.current_version,
   v.id AS approved_id,v.version AS approved_version,
   JSON_UNQUOTE(JSON_EXTRACT(v.generation_evidence_json,'$.sourceSha256')) AS generation_sha,
   JSON_UNQUOTE(JSON_EXTRACT(v.generation_evidence_json,'$.regionAnalysisId')) AS region_analysis,
   JSON_UNQUOTE(JSON_EXTRACT(v.generation_evidence_json,'$.strategy')) AS strategy,
   JSON_EXTRACT(v.generation_evidence_json,'$.occurrenceId') AS generation_occurrence,
   JSON_LENGTH(v.generation_evidence_json,'$.evidence') AS generation_ref_count,
   IF(OCTET_LENGTH(CAST(JSON_EXTRACT(v.generation_evidence_json,'$.evidence') AS CHAR))<=24000,JSON_EXTRACT(v.generation_evidence_json,'$.evidence'),NULL) AS generation_refs,
   qa.id AS qa_id,qa.version AS qa_version,JSON_UNQUOTE(JSON_EXTRACT(qa.result_json,'$.runId')) AS qa_run,
   JSON_UNQUOTE(JSON_EXTRACT(qa.result_json,'$.ruleVersion')) AS qa_rule,JSON_EXTRACT(qa.result_json,'$.contentVersion') AS qa_content_version,
   JSON_EXTRACT(qa.result_json,'$.blockingFailures') AS qa_blockers,JSON_EXTRACT(qa.result_json,'$.summary.openManualReview') AS qa_manual
   FROM alt_text_document_images i JOIN alt_text_assets a ON a.tenant_id=i.tenant_id AND a.id=i.alt_text_asset_id
   LEFT JOIN alt_text_versions v ON v.tenant_id=i.tenant_id AND v.asset_id=i.alt_text_asset_id AND v.id=i.approved_version_id
   LEFT JOIN alt_text_accessibility_evidence qa ON qa.tenant_id=i.tenant_id AND qa.id=(SELECT q.id FROM alt_text_accessibility_evidence q WHERE q.tenant_id=i.tenant_id AND q.asset_id=i.alt_text_asset_id AND q.occurrence_key=i.id AND q.kind='quality_validation' AND q.region_id='quality_current' AND q.status='completed' ORDER BY q.version DESC LIMIT 1)
   WHERE i.tenant_id=? AND i.document_id=? AND i.id IN (${chunk.map(()=>"?").join(",")})`,[tenant,documentId,...chunk])
  for(const row of found)if(chunk.includes(Number(row.occurrence_id)))metadata.set(Number(row.occurrence_id),row)
 }
 let remaining:number=DOCUMENT_EVIDENCE_LIMITS.totalReferences
 const captured=rows.map(original=>{
  const row={...original},m=metadata.get(row.imageOccurrenceId)
  if(!row.eligible)return row
  const target=m?{createdBy:Number(m.created_by),reviewerId:m.reviewer_id==null?null:Number(m.reviewer_id)}:null
  if(!m||!target||!withinScope(actor.viewScope,actor.userId,target)||!withinScope(actor.exportScope??actor.viewScope,actor.userId,target)||row.documentId!==documentId||integer(m.approved_id)!==row.approvedVersionId||integer(m.approved_version)!==row.approvedVersion||integer(m.current_version)!==row.approvedVersion||m.source_locator!==row.sourceLocator){
   return {...row,eligible:false,approvedShortAlt:null,approvedLongDescription:null,approvedVersionId:null,approvedVersion:null,blockingReason:"VALIDATION_FAILED" as const,blockingMessage:"The approved source/version or image export permission changed. Review this occurrence before exporting."}
  }
  const warnings:string[]=[],references:DocumentEvidenceReference[]=[],raw=parse(m.generation_refs),sourceSha256=sha(m.generation_sha)
  const sourceBound=Number(m.generation_occurrence)===row.imageOccurrenceId
  if(raw&&!sourceBound)warnings.push("GENERATION_OCCURRENCE_NOT_BOUND")
  if(sourceBound&&Array.isArray(raw))for(const item of raw){if(references.length>=DOCUMENT_EVIDENCE_LIMITS.perOccurrence||remaining<=0)break;const refId=id(item?.id),kind=id(item?.kind),version=integer(item?.version);if(refId&&kind&&version){references.push({id:refId,kind,version,regionId:null,recordedState:id(item.state)});remaining--}}
  const omittedReferences=sourceBound?Math.max(0,count(m.generation_ref_count??(Array.isArray(raw)?raw.length:0))-references.length):0
  if(omittedReferences)warnings.push("EVIDENCE_REFERENCE_LIMIT")
  const qaId=integer(m.qa_id),qaRun=id(m.qa_run),qaVersion=integer(m.qa_version),contentVersion=integer(m.qa_content_version)
  const qa=qaId&&qaRun&&qaVersion&&contentVersion?{id:qaId,version:qaVersion,runId:qaRun,ruleVersion:typeof m.qa_rule==="string"&&/^[A-Za-z0-9._-]{1,80}$/.test(m.qa_rule)?m.qa_rule:"unknown",contentVersion,blockingFailures:count(m.qa_blockers),manualReview:count(m.qa_manual),matchesApprovedVersion:contentVersion===row.approvedVersion,freshness:"not_recomputed" as const}:null
  if(!qa?.matchesApprovedVersion)warnings.push("NO_QA_FOR_APPROVED_VERSION")
  if(qa?.blockingFailures)warnings.push("RECORDED_QA_BLOCKERS")
  const facts={schemaVersion:1 as const,documentId,occurrenceId:row.imageOccurrenceId,assetId:Number(m.asset_id),sourceLocator:row.sourceLocator,approvedVersionId:row.approvedVersionId!,approvedVersion:row.approvedVersion!,generation:sourceBound&&(references.length||sourceSha256)?{sourceSha256,regionAnalysisId:id(m.region_analysis),strategy:id(m.strategy),references,omittedReferences}:null,qa,warnings,nativeContent:"approved_short_alt_only" as const,structuredEvidenceEmbedded:false as const,longDescriptionRetainedInErp:true as const,conformance:"not_verified" as const}
  row.accessibility={...facts,fingerprint:hash(facts)}
  return row
 })
 // Resolve numeric evidence references only within their saved asset, occurrence and version.
 const snapshots=captured.flatMap(r=>r.accessibility?[r.accessibility]:[]),numeric=[...new Set(snapshots.flatMap(s=>s.generation?.references.map(r=>integer(r.id.split(":").at(-1))).filter((n):n is number=>n!==null)??[]))],regions=new Map<number,any>()
 for(let offset=0;offset<numeric.length;offset+=100){const chunk=numeric.slice(offset,offset+100);for(const r of await query<any[]>(`SELECT id,asset_id,occurrence_key,kind,version,region_id FROM alt_text_accessibility_evidence WHERE tenant_id=? AND id IN (${chunk.map(()=>"?").join(",")})`,[tenant,...chunk]))regions.set(Number(r.id),r)}
 const kinds:Record<string,string[]>={math:["math_recognition","math_validation"],chart:["chart_structure"],chart_axes:["chart_axes"],chart_data:["chart_data"],science:["scientific_structure","scientific_domain"],illustration:["illustration_structure"]}
 for(const s of snapshots){for(const r of s.generation?.references??[]){const saved=regions.get(Number(r.id.split(":").at(-1)));if(saved&&kinds[r.kind]?.includes(saved.kind)&&Number(saved.asset_id)===s.assetId&&Number(saved.occurrence_key)===s.occurrenceId&&Number(saved.version)===r.version)r.regionId=id(saved.region_id)}const {fingerprint:_,...facts}=s;s.fingerprint=hash(facts)}
 return captured
}
