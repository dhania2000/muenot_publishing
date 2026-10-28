import "server-only"
import {query} from "@/lib/db"
import {currentTenantId} from "@/lib/tenant-scope"
import {ensureEvidenceSchema} from "./math-store"
import {assetScope} from "./ocr-review-queue"
import type {HistoryActor} from "./history"
import {EVIDENCE_REVIEW_STATES,STRUCTURED_REVIEW_KINDS,type StructuredReviewKind} from "./structured-review-contract"
export type StructuredQueueFilter={page:number;pageSize:number;search:string;state:string;priority:string;source:string;reviewerId:number|null;kind:string}
export type StructuredQueueItem={assetId:number;occurrenceId:number|null;evidenceId:number;kind:StructuredReviewKind;label:string;regionId:string;state:string;priority:"warnings"|"routine";reviewerId:number|null;updatedAt:string}
export function parseStructuredQueue(sp:URLSearchParams):StructuredQueueFilter|null{
 const integer=(s:string|null,fallback:number)=>s===null?fallback:/^[1-9]\d*$/.test(s)?Number(s):NaN
 const page=integer(sp.get("page"),1),pageSize=integer(sp.get("pageSize"),25),reviewer=sp.get("reviewerId"),reviewerId=reviewer?integer(reviewer,NaN):null,search=sp.get("search")??"",state=sp.get("state")??"pending",priority=sp.get("priority")??"all",source=sp.get("source")??"all",kind=sp.get("kind")??"all"
 if(!Number.isSafeInteger(page)||page>10000||!Number.isSafeInteger(pageSize)||pageSize>50||reviewerId!==null&&!Number.isSafeInteger(reviewerId)||search.length>160||!search.isWellFormed()||!["all","pending",...EVIDENCE_REVIEW_STATES].includes(state)||!["all","warnings","routine"].includes(priority)||!["all","image","document"].includes(source)||!["all",...STRUCTURED_REVIEW_KINDS].includes(kind))return null
 return {page,pageSize,search,state,priority,source,reviewerId,kind}
}
/** Metadata-only, bounded queue. Source bytes and analysis JSON are loaded only when opened. */
export async function listStructuredReviewQueue(actor:HistoryActor,f:StructuredQueueFilter){
 await ensureEvidenceSchema()
 const scope=assetScope(actor),tenant=currentTenantId()
 const base=`SELECT e.id AS evidence_id,e.asset_id,e.occurrence_key,e.kind,e.region_id,a.file_name,
 COALESCE(r.status,'needs_review') AS review_state,r.created_by AS reviewer_id,COALESCE(r.created_at,e.created_at) AS last_updated,
 IF(COALESCE(JSON_LENGTH(JSON_EXTRACT(e.result_json,'$.warnings')),0)>0,'warnings','routine') AS priority
 FROM alt_text_accessibility_evidence e JOIN alt_text_assets a ON a.tenant_id=e.tenant_id AND a.id=e.asset_id
 LEFT JOIN alt_text_accessibility_evidence r ON r.tenant_id=e.tenant_id AND r.asset_id=e.asset_id AND r.occurrence_key=e.occurrence_key AND r.kind='structured_review'
 AND r.region_id=CONCAT('srev_',LEFT(SHA2(CONCAT(e.kind,':',e.id),256),40))
 AND NOT EXISTS (SELECT 1 FROM alt_text_accessibility_evidence n WHERE n.tenant_id=r.tenant_id AND n.asset_id=r.asset_id AND n.occurrence_key=r.occurrence_key AND n.kind=r.kind AND n.region_id=r.region_id AND n.version>r.version)
 WHERE e.tenant_id=? AND ${scope.sql} AND e.status='completed' AND e.kind IN ('scientific_structure','illustration_structure','chart_axes','chart_data')
 AND (e.occurrence_key=0 AND NOT EXISTS (SELECT 1 FROM alt_text_document_images j WHERE j.tenant_id=e.tenant_id AND j.alt_text_asset_id=e.asset_id)
 OR EXISTS (SELECT 1 FROM alt_text_document_images i JOIN alt_text_documents d ON d.tenant_id=i.tenant_id AND d.id=i.document_id WHERE i.tenant_id=e.tenant_id AND i.id=e.occurrence_key AND i.alt_text_asset_id=e.asset_id AND i.extraction_status='extracted' AND d.security_scan_status='clean' ${actor.viewScope==="all"?"":"AND d.uploaded_by=?"}))`
 const clauses:string[]=[],values:unknown[]=[tenant,...scope.params,...(actor.viewScope==="all"?[]:[actor.userId])]
 if(f.search){clauses.push("file_name LIKE ? ESCAPE '!'");values.push(`%${f.search.replace(/[!%_]/g,c=>`!${c}`)}%`)}
 if(f.state==="pending")clauses.push("review_state NOT IN ('verified','rejected')")
 else if(f.state!=="all"){clauses.push("review_state=?");values.push(f.state)}
 if(f.priority!=="all"){clauses.push("priority=?");values.push(f.priority)}
 if(f.source!=="all")clauses.push(f.source==="document"?"occurrence_key>0":"occurrence_key=0")
 if(f.reviewerId!==null){clauses.push("reviewer_id=?");values.push(f.reviewerId)}
 if(f.kind!=="all"){clauses.push("kind=?");values.push(f.kind)}
 const where=clauses.length?clauses.join(" AND "):"1=1"
 const [count,rows]=await Promise.all([query<any[]>(`SELECT COUNT(*) AS n FROM (${base}) queue WHERE ${where}`,values),query<any[]>(`SELECT * FROM (${base}) queue WHERE ${where} ORDER BY last_updated DESC,evidence_id DESC LIMIT ? OFFSET ?`,[...values,f.pageSize,(f.page-1)*f.pageSize])])
 return {success:true,items:rows.map((r):StructuredQueueItem=>({assetId:Number(r.asset_id),occurrenceId:Number(r.occurrence_key)||null,evidenceId:Number(r.evidence_id),kind:r.kind,label:r.file_name,regionId:r.region_id,state:r.review_state,priority:r.priority,reviewerId:r.reviewer_id==null?null:Number(r.reviewer_id),updatedAt:new Date(r.last_updated).toISOString()})),total:Number(count[0]?.n??0),page:f.page,pageSize:f.pageSize}
}
