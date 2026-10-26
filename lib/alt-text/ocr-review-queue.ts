import "server-only"
import {query} from "@/lib/db"
import {currentTenantId} from "@/lib/tenant-scope"
import type {HistoryActor} from "./history"
import type {OcrReviewTarget} from "./ocr-review-contract"
import {ensureOcrReviewSchema} from "./ocr-review-store"
function assetScope(actor:HistoryActor){
 if(actor.viewScope==="all")return {sql:"1=1",params:[] as number[]}
 if(actor.viewScope==="added")return {sql:"a.created_by=?",params:[actor.userId]}
 if(actor.viewScope==="owned")return {sql:"a.reviewer_id=?",params:[actor.userId]}
 if(actor.viewScope==="both")return {sql:"(a.created_by=? OR a.reviewer_id=?)",params:[actor.userId,actor.userId]}
 return {sql:"1=0",params:[] as number[]}
}
export type OcrReviewQueueItem={target:OcrReviewTarget;label:string;recognitionStatus:string;reviewState:string|null;confidence:number|null;updatedAt:string;reason:string}
/** Paginated read over existing recognition sources. No model execution or eager image decoding. */
export async function listOcrReviewQueue(actor:HistoryActor,page:number,pageSize:number,all=false){
 await ensureOcrReviewSchema()
 const tenant=currentTenantId(),scope=assetScope(actor)
 const imageFilter=all?"1=1":"(o.status<>'completed' OR JSON_LENGTH(JSON_EXTRACT(o.result_json,'$.warnings'))>0 OR CAST(JSON_EXTRACT(o.result_json,'$.meanConfidence') AS DECIMAL(6,2))<60 OR EXISTS (SELECT 1 FROM alt_text_accessibility_evidence r WHERE r.tenant_id=o.tenant_id AND r.kind='ocr_review' AND r.region_id=CONCAT('rev_',LEFT(SHA2(CONCAT('image:',o.result_id),256),40))))"
 const pageFilter=all?"1=1":"(p.status<>'completed' OR JSON_LENGTH(JSON_EXTRACT(p.result_json,'$.warnings'))>0 OR CAST(JSON_EXTRACT(p.result_json,'$.meanConfidence') AS DECIMAL(6,2))<60 OR EXISTS (SELECT 1 FROM alt_text_accessibility_evidence r WHERE r.tenant_id=p.tenant_id AND r.kind='ocr_review' AND JSON_UNQUOTE(JSON_EXTRACT(r.input_json,'$.target.kind'))='page_ocr' AND JSON_EXTRACT(r.input_json,'$.target.documentId')=p.document_id AND JSON_EXTRACT(r.input_json,'$.target.pageIndex')=p.page_index))"
 const union=`SELECT 'image_ocr' AS source_kind,o.result_id AS source_id,o.asset_id,o.occurrence_id,NULL AS document_id,NULL AS page_index,a.file_name AS label,o.status,JSON_EXTRACT(o.result_json,'$.meanConfidence') AS confidence,o.created_at AS at_time,CONCAT('image:',o.result_id) AS source_ref
  FROM alt_text_ocr_results o JOIN alt_text_assets a ON a.id=o.asset_id AND a.tenant_id=o.tenant_id
  WHERE o.tenant_id=? AND ${scope.sql} AND ${imageFilter}
  UNION ALL SELECT 'math_ocr',CAST(e.id AS CHAR),e.asset_id,NULLIF(e.occurrence_key,0),NULL,NULL,a.file_name,e.status,NULL,e.created_at,CONCAT('math:',e.id)
  FROM alt_text_accessibility_evidence e JOIN alt_text_assets a ON a.id=e.asset_id AND a.tenant_id=e.tenant_id
  WHERE e.tenant_id=? AND e.kind='math_recognition' AND ${scope.sql} AND e.status NOT IN ('queued','recognizing')
  UNION ALL SELECT 'page_ocr',COALESCE(JSON_UNQUOTE(JSON_EXTRACT(p.result_json,'$.identity')),CONCAT('failure_',COALESCE(p.job_id,0))),NULL,NULL,p.document_id,p.page_index,d.original_filename,p.status,JSON_EXTRACT(p.result_json,'$.meanConfidence'),p.updated_at,
   IF(p.result_json IS NULL,CONCAT('page:',p.document_id,':',p.page_index,':failure:',COALESCE(p.job_id,0),':',DATE_FORMAT(p.updated_at,'%Y-%m-%dT%H:%i:%s.000Z')),CONCAT('page:',p.document_id,':',p.page_index,':',JSON_UNQUOTE(JSON_EXTRACT(p.result_json,'$.identity')),':',JSON_UNQUOTE(JSON_EXTRACT(p.result_json,'$.runId'))))
  FROM alt_text_document_page_ocr p JOIN alt_text_documents d ON d.id=p.document_id AND d.tenant_id=p.tenant_id
  WHERE p.tenant_id=? AND d.security_scan_status='clean' ${actor.viewScope==="all"?"":"AND d.uploaded_by=?"} AND p.status IN ('completed','completed_with_warnings','no_text_detected','failed','cancelled') AND ${pageFilter}`
 const params=[tenant,...scope.params,tenant,...scope.params,tenant,...(actor.viewScope==="all"?[]:[actor.userId])]
 const reviewed=`SELECT s.*,(SELECT r.status FROM alt_text_accessibility_evidence r WHERE r.tenant_id=? AND r.kind='ocr_review' AND r.region_id=CONCAT('rev_',LEFT(SHA2(s.source_ref,256),40)) ORDER BY r.version DESC LIMIT 1) AS review_state FROM (${union}) s`
 const where=all?"1=1":"(review_state IS NULL OR review_state NOT IN ('verified','rejected'))",bound=[tenant,...params]
 const [counts,rows]=await Promise.all([query<any[]>(`SELECT COUNT(*) AS n FROM (${reviewed}) sources WHERE ${where}`,bound),query<any[]>(`SELECT * FROM (${reviewed}) sources WHERE ${where} ORDER BY at_time DESC,source_kind,source_id,document_id,page_index,asset_id LIMIT ? OFFSET ?`,[...bound,pageSize,(page-1)*pageSize])])
 const items:OcrReviewQueueItem[]=rows.map((r)=>({target:{kind:r.source_kind,sourceId:String(r.source_id),assetId:r.asset_id==null?null:Number(r.asset_id),occurrenceId:r.occurrence_id==null?null:Number(r.occurrence_id),documentId:r.document_id==null?null:Number(r.document_id),pageIndex:r.page_index==null?null:Number(r.page_index)},label:String(r.label),recognitionStatus:r.status,reviewState:r.review_state??null,confidence:r.confidence==null||String(r.confidence)==="null"?null:Number(r.confidence),updatedAt:new Date(r.at_time).toISOString(),reason:r.source_kind==="math_ocr"?"Equation verification required":r.status==="failed"?"Recognition failed":r.confidence!=null&&Number(r.confidence)<60?"Engine score below 60; not an accuracy percentage":"Recognition warnings or manual review"}))
 return {success:true,items,total:Number(counts[0]?.n??0),page,pageSize}
}

