import "server-only"
import { query } from "@/lib/db"
import { currentTenantId } from "@/lib/tenant-scope"
import { ensurePageOcrSchema } from "./pdf-page-ocr-store"
import { normalizePdfImageBounds } from "./image-location"
import type { ContextEvidence } from "./document-context"
import type { PageOcrResult } from "./pdf-page-ocr-types"
/** Saved OCR lines inside the exact image placement only; no OCR execution or same-page prose. */
export async function addPageOcrEvidence(documentId:number,pageNumber:number,existing:ContextEvidence,source?:{sourceSha256:string;imagePosition:Record<string,unknown>|null}):Promise<ContextEvidence>{
 if(!source||!source.imagePosition)return existing
 const p=source.imagePosition
 if(p.kind!=="pdf_ctm"||!Array.isArray(p.ctm)||!Array.isArray(p.pageBox)||typeof p.rotate!=="number")return existing
 const geometry=normalizePdfImageBounds({ctm:p.ctm,pageBox:p.pageBox,rotate:p.rotate}),box=geometry.bounds
 if(!box||geometry.accuracy!=="exact")return existing
 await ensurePageOcrSchema()
 const rows=await query<any[]>(`SELECT source_sha256,result_json FROM alt_text_document_page_ocr WHERE tenant_id=? AND document_id=? AND page_index=? AND result_json IS NOT NULL LIMIT 1`,[currentTenantId(),documentId,pageNumber-1])
 const row=rows[0],result:PageOcrResult|null=row?(typeof row.result_json==="string"?JSON.parse(row.result_json):row.result_json):null
 if(!result||row.source_sha256!==source.sourceSha256||result.sourceSha256!==source.sourceSha256||result.documentId!==documentId||result.pageIndex!==pageNumber-1||!["completed","completed_with_warnings"].includes(result.status))return existing
 const lines=[] as {text:string;ref:string}[]
 let chars=0
 for(const mapped of result.lines??[]){
  const b=mapped.pageNorm,line=result.layout?.lines[mapped.lineIndex],x=b?.x+b?.width/2,y=b?.y+b?.height/2
  if(!line?.text||![x,y,b.width,b.height].every(Number.isFinite)||b.width<=0||b.height<=0||b.x<box.x||b.y<box.y||b.x+b.width>box.x+box.width||b.y+b.height>box.y+box.height||line.text.length>600||chars+line.text.length>1800)continue
  chars+=line.text.length;lines.push({text:line.text,ref:`pdf:p${pageNumber}:ocr:${result.identity}:line:${mapped.lineIndex}`})
  if(lines.length===8)break
 }
 if(!lines.length)return existing
 return {...existing,pageOcr:{identity:result.identity,runId:result.runId,sourceSha256:result.sourceSha256,pageNumber,languageMode:result.languageMode,lines},warnings:[...(existing.warnings??[]),{code:"READING_ORDER_UNVERIFIED",message:"Mapped page OCR is unverified and separate from selectable PDF text and figure OCR. Only lines within this image placement were associated."}]}
}
