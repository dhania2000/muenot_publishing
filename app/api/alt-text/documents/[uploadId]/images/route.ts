/**
 * @file app/api/alt-text/documents/[uploadId]/images/route.ts
 * @module Publishing · Alt Text
 * @kind API route handler
 * @summary GET /api/alt-text/documents/:id/images?limit&offset — extracted image occurrences in
 *   presentation order, with persisted per-status counts. Metadata only: previews go through
 *   the existing scan-gated /api/alt-text/assets/:assetId/image route.
 * @security Session + publishing module + publishing.alt_text:view; tenant-scoped, owner-only unless view scope is `all`.
 */
import { gateAltTextHistory, jsonError, jsonOk, unexpected } from "@/lib/alt-text/route-gate"
import { ownerScopeFor } from "@/lib/alt-text/document-service"
import { countDocumentImages, getDocument, getDocumentImages } from "@/lib/alt-text/document-store"
import { DOCUMENT_IMAGE_PAGE_MAX, type DocumentImagesResponse } from "@/lib/alt-text/document-records"

export const dynamic = "force-dynamic"

const DOCUMENT_ID = /^[1-9]\d{0,9}$/

const intParam = (v: string | null, fallback: number, min: number, max: number) => {
  const n = v == null || !/^\d{1,6}$/.test(v) ? fallback : Number(v)
  return Math.min(max, Math.max(min, n))
}

export async function GET(req: Request, ctx: { params: Promise<{ uploadId: string }> }) {
  const gate = await gateAltTextHistory()
  if (!gate.ok) return gate.response
  const { uploadId: id } = await ctx.params
  const notFound = () => jsonError({ status: 404, code: "NOT_FOUND", error: "The document could not be found." })
  if (!DOCUMENT_ID.test(id)) return notFound()
  try {
    const doc = await getDocument(Number(id), ownerScopeFor(gate.actor))
    if (!doc) return notFound()
    const sp = new URL(req.url).searchParams
    const limit = intParam(sp.get("limit"), DOCUMENT_IMAGE_PAGE_MAX, 1, DOCUMENT_IMAGE_PAGE_MAX)
    const offset = intParam(sp.get("offset"), 0, 0, 100_000)
    const [images, counts] = await Promise.all([getDocumentImages(doc.id, { limit, offset }), countDocumentImages(doc.id)])
    const body: DocumentImagesResponse = { success: true, documentId: doc.id, processingStatus: doc.processingStatus, counts, images, limit, offset }
    return jsonOk(body)
  } catch (err) {
    return unexpected("documents/images", err)
  }
}
