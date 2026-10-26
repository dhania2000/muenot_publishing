import type {MathValidation} from "./math-validation-contract"
export type OcrReviewTarget={kind:"image_ocr"|"math_ocr"|"page_ocr";sourceId:string;assetId:number|null;occurrenceId:number|null;documentId:number|null;pageIndex:number|null}
export type OcrReviewState="needs_review"|"in_review"|"corrected"|"verified"|"rejected"
export const OCR_REVIEW_STATES:readonly OcrReviewState[]=["needs_review","in_review","corrected","verified","rejected"]
export type OcrReviewInput={target:OcrReviewTarget;expectedVersion:number;requestId:string;text:string;state:OcrReviewState;comment:string}
export type OcrReviewSource={target:OcrReviewTarget;sourceRef:string;rawText:string;analysisId:string;sourceVersion:number;regionId:string|null;warnings:string[];confidence:number|null;confidenceScale:"tesseract_0_100"|"not_reported";sourceSnapshot:unknown;previewUrl:string|null;canEdit:boolean;canVerify:boolean}
export type OcrReviewVersion={id:number;version:number;state:OcrReviewState;originalText:string;correctedText:string;comment:string;editorId:number;createdAt:string;sourceRef:string;validation:MathValidation|null;sourceDesignation:"human_corrected_ocr";altTextApproved:false}
export function parseReviewTarget(raw:unknown):OcrReviewTarget|null{
 if(!raw||typeof raw!=="object"||Array.isArray(raw))return null
 const r=raw as Record<string,unknown>,positive=(n:unknown)=>Number.isSafeInteger(n)&&Number(n)>0
 if(Object.keys(r).some((k)=>!["kind","sourceId","assetId","occurrenceId","documentId","pageIndex"].includes(k))||!["image_ocr","math_ocr","page_ocr"].includes(String(r.kind))||typeof r.sourceId!=="string"||!/^[A-Za-z0-9_:.\-]{1,140}$/.test(r.sourceId))return null
 if(r.kind==="page_ocr"){
  if(!positive(r.documentId)||!Number.isSafeInteger(r.pageIndex)||Number(r.pageIndex)<0||Number(r.pageIndex)>=500||r.assetId!=null||r.occurrenceId!=null)return null
 }else if(!positive(r.assetId)||r.occurrenceId!=null&&!positive(r.occurrenceId)||r.documentId!=null||r.pageIndex!=null)return null
 return {kind:r.kind as OcrReviewTarget["kind"],sourceId:r.sourceId,assetId:r.assetId==null?null:Number(r.assetId),occurrenceId:r.occurrenceId==null?null:Number(r.occurrenceId),documentId:r.documentId==null?null:Number(r.documentId),pageIndex:r.pageIndex==null?null:Number(r.pageIndex)}
}
const safeText=(s:unknown,max:number)=>typeof s==="string"&&s.length<=max&&s.isWellFormed()&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s)
export function parseOcrReviewInput(raw:unknown):OcrReviewInput|null{
 if(!raw||typeof raw!=="object"||Array.isArray(raw))return null
 const b=raw as Record<string,unknown>,target=parseReviewTarget(b.target)
 if(!target||Object.keys(b).some((k)=>!["target","expectedVersion","requestId","text","state","comment"].includes(k))||!Number.isSafeInteger(b.expectedVersion)||Number(b.expectedVersion)<0||typeof b.requestId!=="string"||!/^[A-Za-z0-9_-]{8,64}$/.test(b.requestId)||!safeText(b.text,target.kind==="math_ocr"?4000:20_000)||!safeText(b.comment,1000)||!OCR_REVIEW_STATES.includes(b.state as OcrReviewState))return null
 if(b.state==="verified"&&!String(b.text).trim())return null
 return {target,expectedVersion:Number(b.expectedVersion),requestId:b.requestId,text:b.text as string,state:b.state as OcrReviewState,comment:b.comment as string}
}
