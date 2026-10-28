import type { NormalizedBox } from "./region-analysis"
export const STRUCTURED_REVIEW_KINDS=["scientific_structure","illustration_structure","chart_axes","chart_data"] as const
export type StructuredReviewKind=(typeof STRUCTURED_REVIEW_KINDS)[number]
export const EVIDENCE_REVIEW_STATES=["needs_review","in_review","corrected","verified","rejected"] as const
export type EvidenceReviewState=(typeof EVIDENCE_REVIEW_STATES)[number]
export type StructuredTarget={id:string;kind:"label"|"component"|"relationship"|"association"|"axis"|"point"|"cell"|"node"|"context_note";regionId:string|null;label:string;raw:unknown;reviewContext?:unknown;box:NormalizedBox|null;members?:{id:string;panelId:string|null}[];seriesIds?:string[]}
export type StructuredCorrection={targetId:string;value:{text:string;designation:"human_correction"|"unknown"}|{label:string;unit:string|null}|{targetIds:string[];designation:"human_correction"|"unknown"}|{from:string|null;to:string|null;relationship:string;direction:"from_to"|"to_from"|"both"|"unknown"}|{value:number|null;unit:string|null;seriesId:string|null;classification:"human_source_transcription"|"manual_estimate"|"unknown";precisionNote:string}}
export type StructuredReviewInput={kind:StructuredReviewKind;evidenceId:number;occurrenceId:number|null;sourceFingerprint:string;expectedVersion:number;requestId:string;state:EvidenceReviewState;comment:string;corrections:StructuredCorrection[]}
export type StructuredReviewVersion={id:number;version:number;state:EvidenceReviewState;comment:string;corrections:StructuredCorrection[];reviewerId:number;createdAt:string;sourceFingerprint:string;sourceEvidenceId:number;sourceVersion:number;sourceKind:StructuredReviewKind;sourceRegionId:string;scientificAccuracyVerified:false;descriptionApproved:false;numericValuesAreOriginalSourceExact:false}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v)
const exact=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).every(k=>keys.includes(k))
const string=(v:unknown,max:number)=>typeof v==="string"&&v.length<=max&&v.isWellFormed()&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)
export function parseStructuredReview(body:unknown):StructuredReviewInput|null{
 if(!object(body)||!exact(body,["kind","evidenceId","occurrenceId","sourceFingerprint","expectedVersion","requestId","state","comment","corrections"])||!STRUCTURED_REVIEW_KINDS.includes(body.kind as StructuredReviewKind)||!Number.isSafeInteger(body.evidenceId)||Number(body.evidenceId)<=0||body.occurrenceId!=null&&(!Number.isSafeInteger(body.occurrenceId)||Number(body.occurrenceId)<=0)||typeof body.sourceFingerprint!=="string"||!/^([a-f0-9]{64})$/.test(body.sourceFingerprint)||!Number.isSafeInteger(body.expectedVersion)||Number(body.expectedVersion)<0||typeof body.requestId!=="string"||!/^[A-Za-z0-9_-]{8,48}$/.test(body.requestId)||!EVIDENCE_REVIEW_STATES.includes(body.state as EvidenceReviewState)||!string(body.comment,1000)||!Array.isArray(body.corrections)||body.corrections.length>32)return null
 const corrections:StructuredCorrection[]=[]
 for(const c of body.corrections){if(!object(c)||!exact(c,["targetId","value"])||!string(c.targetId,180)||!c.targetId||!object(c.value))return null;corrections.push({targetId:c.targetId as string,value:c.value as StructuredCorrection["value"]})}
 if(new Set(corrections.map(c=>c.targetId)).size!==corrections.length)return null
 return {kind:body.kind as StructuredReviewKind,evidenceId:Number(body.evidenceId),occurrenceId:body.occurrenceId==null?null:Number(body.occurrenceId),sourceFingerprint:body.sourceFingerprint,expectedVersion:Number(body.expectedVersion),requestId:body.requestId,state:body.state as EvidenceReviewState,comment:body.comment as string,corrections}
}
/** Validate a complete proposed review version against only existing source targets. Corrections
 * are human evidence, never a mutation of model output or a claim of scientific validity. */
export function validateStructuredCorrections(input:StructuredReviewInput,targets:StructuredTarget[]):string|null{
 if(["corrected","verified"].includes(input.state)&&!input.corrections.length)return "Add at least one correction or label before marking this evidence corrected/verified."
 if(["verified","rejected"].includes(input.state)&&!input.comment.trim())return "A review reason is required for verification or rejection."
 for(const c of input.corrections){
  const t=targets.find(t=>t.id===c.targetId),v=c.value as unknown as Record<string,unknown>
  if(!t)return "The target is not part of this source evidence."
  if(["label","component","cell","node","context_note"].includes(t.kind)){
   if(!exact(v,["text","designation"])||!string(v.text,2000)||!["human_correction","unknown"].includes(String(v.designation))||v.designation==="unknown"&&v.text!=="")return "Use bounded literal text, or an empty unknown value."
  }else if(t.kind==="axis"){
   if(!exact(v,["label","unit"])||!string(v.label,600)||v.unit!==null&&!string(v.unit,40))return "Use a bounded axis label and printed/reviewed unit, or null."
  }else if(t.kind==="point"){
   if(!exact(v,["value","unit","seriesId","classification","precisionNote"])||!["human_source_transcription","manual_estimate","unknown"].includes(String(v.classification))||!string(v.precisionNote,200)||v.unit!==null&&!string(v.unit,40)||v.seriesId!==null&&!(t.seriesIds??[]).includes(String(v.seriesId))||v.classification==="unknown"&&v.value!==null||v.classification!=="unknown"&&(typeof v.value!=="number"||!Number.isFinite(v.value)||Math.abs(v.value)>1e15)||v.classification==="manual_estimate"&&!String(v.precisionNote).trim())return "Keep numeric provenance/precision explicit. Unknown values must be null; estimates need a precision note and source series references."
  }else if(t.kind==="association"){
   if(!exact(v,["targetIds","designation"])||!["human_correction","unknown"].includes(String(v.designation))||!Array.isArray(v.targetIds)||v.targetIds.length>8||new Set(v.targetIds).size!==v.targetIds.length||v.targetIds.some(id=>!(t.members??[]).some(m=>m.id===id))||v.designation==="unknown"&&v.targetIds.length!==0||v.designation==="human_correction"&&!v.targetIds.length)return "Choose existing same-panel association targets, or explicit unknown."
  }else{
   const members=t.members??[],from=members.find(m=>m.id===v.from),to=members.find(m=>m.id===v.to)
   if(!exact(v,["from","to","relationship","direction"])||v.from!==null&&!from||v.to!==null&&!to||from&&to&&from.id===to.id||from?.panelId&&to?.panelId&&from.panelId!==to.panelId||!["connected_to","points_to","part_of","contains","spatial","unknown"].includes(String(v.relationship))||!["from_to","to_from","both","unknown"].includes(String(v.direction))||v.direction!=="unknown"&&(!from||!to))return "Relationship endpoints must reference distinct existing elements in the same source panel; unknown endpoints/directions must remain explicit."
  }
 }
 return null
}
