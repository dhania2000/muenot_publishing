/**
 * @file app/api/alt-text/documents/[uploadId]/history/images/[imageId]/route.ts
 * @module Publishing · Alt Text
 * @kind API route handler
 * @summary Phase 3 Task 19 — GET the immutable version + review history of one image occurrence.
 * @security Session + publishing module + publishing.alt_text:view; tenant + owner scoped;
 *   the occurrence must belong to the resolved document.
 */
import { gateAltTextHistory, jsonOk, unexpected } from "@/lib/alt-text/route-gate"
import { notFound, rateLimited, resolveDocument } from "@/lib/alt-text/document-review-route"
import { getOccurrenceHistory } from "@/lib/alt-text/document-history-store"
import type { OccurrenceHistoryResponse } from "@/lib/alt-text/document-history-contract"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(_req: Request, ctx: { params: Promise<{ uploadId: string; imageId: string }> }) {
  const gate = await gateAltTextHistory()
  if (!gate.ok) return gate.response
  const { uploadId, imageId } = await ctx.params
  if (!/^[1-9]\d{0,9}$/.test(imageId)) return notFound("image")
  try {
    const limited = await rateLimited("history-read", gate.actor, { max: 60, windowMs: 60_000 })
    if (limited) return limited
    const doc = await resolveDocument(uploadId, gate.actor)
    if (!doc.ok) return doc.response
    const history = await getOccurrenceHistory(doc.id, Number(imageId))
    if (!history) return notFound("image")
    const body: OccurrenceHistoryResponse = { success: true, ...history }
    const res = jsonOk(body)
    res.headers.set("Cache-Control", "no-store, private")
    return res
  } catch (err) {
    return unexpected("documents/history-image", err)
  }
}
