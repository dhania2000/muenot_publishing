import "server-only"
import {readPdfPackage,PdfPackageError} from "@/lib/alt-text/pdf-package"
import {SourceInspectionError,type SourceInspection} from "./source-inspection"
export async function classifyEpubSource(inspection:SourceInspection,bytes:Buffer):Promise<SourceInspection&{observations?:Record<string,unknown>}>{
 if(inspection.kind!=="pdf")return inspection
 // Reuse the existing bounded, non-rendering parser only for small sources.
 if(bytes.length>5*1024*1024)return {...inspection,classification:"pdf_large_requires_parser_review",reviewRequired:true}
 try{
  const parsed=await readPdfPackage(bytes,{collectText:true}),textPages=parsed.text?.pages.filter(p=>p.runs.some(r=>r.text.trim())).length??0,scanPages=new Set(parsed.occurrences.filter(o=>o.classification==="likely_scanned_page").map(o=>o.pageNumber)).size,limited=parsed.report.limitations.length>0||parsed.text?.truncated
  const classification=limited?"pdf_partial_inspection_review":textPages&&scanPages?"pdf_mixed_content_observed":textPages===parsed.totalPages?"pdf_native_text_observed":!textPages&&scanPages===parsed.totalPages?"pdf_likely_scanned_pages":"pdf_ambiguous_requires_review"
  return {...inspection,classification,reviewRequired:true,observations:{pages:parsed.totalPages,nativeTextPages:textPages,likelyScannedPages:scanPages,tagged:parsed.report.tagged,limited:!!limited}}
 }catch(e){if(e instanceof PdfPackageError&&["INVALID_DOCUMENT","ENCRYPTED_DOCUMENT"].includes(e.code))throw new SourceInspectionError(e.code,"The PDF is damaged, encrypted or has no readable page tree.");return {...inspection,classification:"pdf_inspection_unavailable_review",reviewRequired:true}}
}
