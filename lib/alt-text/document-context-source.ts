import "server-only"
import { createHash } from "node:crypto"
import { getFileById } from "@/lib/storage/file-metadata"
import { keyBelongsToTenant } from "@/lib/storage/keys"
import { currentTenantId } from "@/lib/tenant-scope"
import { query } from "@/lib/db"
import type { StoredDocument } from "./document-store"
import type { DocumentImageContext } from "./document-context"
/** Caller has already authorized the parent document and refreshed its security verdict. */
export async function documentContextSource(doc: StoredDocument) {
  const file = await getFileById(doc.fileObjectId)
  if (!file || file.fileRef !== doc.storageReferenceId || file.uploadStatus !== "completed" || !file.isCurrent || file.size !== doc.size || !keyBelongsToTenant(file.objectKey,currentTenantId())) return null
  return { sourceSha256: file.checksum, sourceRevision: createHash("sha256").update(JSON.stringify([file.id,file.version,file.checksum])).digest("hex") }
}
export function contextSourceMatches(ctx: DocumentImageContext, source: {sourceSha256:string|null;sourceRevision:string}|null, occurrence: {sourceLocator:string;mediaSha256:string|null}) {
  const binding = ctx.sourceBinding
  return !!binding && !!source?.sourceSha256 && binding.sourceSha256 === source.sourceSha256 && binding.sourceRevision === source.sourceRevision && binding.sourceLocator === occurrence.sourceLocator && binding.imageSha256 === occurrence.mediaSha256
}
export async function contextOcrMatches(ctx: DocumentImageContext) {
  if (!ctx.pageOcr) return true
  const rows = await query<any[]>("SELECT source_sha256,result_json FROM alt_text_document_page_ocr WHERE tenant_id=? AND document_id=? AND page_index=? LIMIT 1",[currentTenantId(),ctx.documentId,ctx.pageOcr.pageNumber-1])
  const row=rows[0], result=typeof row?.result_json === "string" ? JSON.parse(row.result_json) : row?.result_json
  return row?.source_sha256 === ctx.pageOcr.sourceSha256 && result?.identity === ctx.pageOcr.identity && result?.runId === ctx.pageOcr.runId
}
