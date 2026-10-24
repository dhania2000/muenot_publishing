/**
 * @file app/api/alt-text/documents/[uploadId]/images/selection/route.ts
 * @module Publishing · Alt Text
 * @kind API route handler
 * @summary GET — explicit snapshot of the selected, currently eligible occurrences for this
 *   document (the typed hand-off contract for Tasks 11–12). Read-only; never creates jobs.
 * @security Session + publishing module + publishing.alt_text:view; tenant-scoped, owner-only unless view scope is `all`.
 */
import { gateAltTextHistory, jsonError, jsonOk, unexpected } from "@/lib/alt-text/route-gate"
import { ownerScopeFor } from "@/lib/alt-text/document-service"
import { getDocument } from "@/lib/alt-text/document-store"
import { getSelectionSnapshot } from "@/lib/alt-text/document-image-review-store"
import type { SelectionSnapshotResponse } from "@/lib/alt-text/document-image-review"

export const dynamic = "force-dynamic"

const DOCUMENT_ID = /^[1-9]\d{0,9}$/

export async function GET(_req: Request, ctx: { params: Promise<{ uploadId: string }> }) {
  const gate = await gateAltTextHistory()
  if (!gate.ok) return gate.response
  const { uploadId: id } = await ctx.params
  if (!DOCUMENT_ID.test(id)) return jsonError({ status: 404, code: "NOT_FOUND", error: "The document could not be found." })
  try {
    const doc = await getDocument(Number(id), ownerScopeFor(gate.actor))
    if (!doc) return jsonError({ status: 404, code: "NOT_FOUND", error: "The document could not be found." })
    const snap = await getSelectionSnapshot(doc.id)
    const body: SelectionSnapshotResponse = { success: true, documentId: doc.id, total: snap.total, truncated: snap.total > snap.items.length, items: snap.items }
    return jsonOk(body)
  } catch (err) {
    return unexpected("documents/images/selection", err)
  }
}
