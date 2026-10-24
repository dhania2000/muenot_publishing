/**
 * @file app/api/alt-text/documents/[uploadId]/route.ts
 * @module Publishing · Alt Text
 * @kind API route handler
 * @summary GET /api/alt-text/documents/:id
 *   - numeric id  → the persisted document record (Phase 3 Task 4) + `preparation` progress (Task 11)
 *   - UUID upload → the Task 3 upload + security status (polled while scanning)
 *   Returns metadata only; no bytes, storage keys or preview links.
 * @security Session + publishing module + publishing.alt_text:view; tenant-scoped, owner-only unless view scope is `all`.
 */
import { gateAltTextHistory, jsonError, jsonOk, unexpected } from "@/lib/alt-text/route-gate"
import { getDocumentUpload } from "@/lib/alt-text/document-upload"
import { getDocumentRecord, ownerScopeFor } from "@/lib/alt-text/document-service"
import { getDocumentPreparationProgress } from "@/lib/alt-text/document-preparation-job"

export const dynamic = "force-dynamic"

const DOCUMENT_ID = /^[1-9]\d{0,9}$/

const notFound = () => jsonError({ status: 404, code: "NOT_FOUND", error: "The document could not be found." })

export async function GET(_req: Request, ctx: { params: Promise<{ uploadId: string }> }) {
  const gate = await gateAltTextHistory()
  if (!gate.ok) return gate.response
  const { uploadId: id } = await ctx.params
  try {
    if (DOCUMENT_ID.test(id)) {
      const document = await getDocumentRecord(Number(id), ownerScopeFor(gate.actor))
      if (!document) return notFound()
      // Ownership is verified above before any preparation state is read.
      const preparation = await getDocumentPreparationProgress(document.id)
      return jsonOk({ success: true, document, preparation })
    }
    const document = await getDocumentUpload(id, { userId: gate.actor.userId, canViewAll: gate.actor.viewScope === "all" })
    return document ? jsonOk({ success: true, document }) : notFound()
  } catch (err) {
    return unexpected("documents/status", err)
  }
}
