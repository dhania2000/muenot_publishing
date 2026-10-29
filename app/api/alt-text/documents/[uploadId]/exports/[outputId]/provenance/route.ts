import {gateAltTextHistory,jsonError,jsonOk,unexpected} from "@/lib/alt-text/route-gate"
import {resolveDocument,notFound,parsePaging,rateLimited} from "@/lib/alt-text/document-review-route"
import {getExportByRef} from "@/lib/alt-text/docx-export-store"
export const runtime="nodejs"
export const dynamic="force-dynamic"
export async function GET(req:Request,{params}:{params:Promise<{uploadId:string;outputId:string}>}){
 const gate=await gateAltTextHistory({export:true});if(!gate.ok)return gate.response
 const {uploadId,outputId}=await params
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(outputId))return notFound("export")
 const paging=parsePaging(new URL(req.url).searchParams,10,50);if(!paging.ok)return paging.response
 try{
  const limited=await rateLimited("export-provenance",gate.actor,{max:60,windowMs:60000});if(limited)return limited
  const document=await resolveDocument(uploadId,gate.actor);if(!document.ok)return document.response
  const record=await getExportByRef(document.id,outputId);if(!record||record.status!=="completed")return notFound("export")
  const all=record.report?.items??[],start=(paging.page-1)*paging.pageSize
  // Explicit metadata projection: never serialize the stored output object key or raw source text.
  const items=all.slice(start,start+paging.pageSize).map(i=>({documentId:document.id,occurrenceId:i.occurrenceId,assetId:i.assetId??null,sourceLocator:i.sourceLocator??null,approvedVersionId:i.approvedVersionId??null,approvedVersion:i.approvedVersion??null,status:i.status,accessibility:i.accessibility??null,legacySnapshot:i.sourceLocator===undefined}))
  return jsonOk({success:true,documentId:document.id,outputId,format:record.format,summary:record.report?.summary.accessibility??null,items,total:all.length,page:paging.page,pageSize:paging.pageSize,conformance:"not_verified"})
 }catch(e){return unexpected("export-provenance",e)}
}
