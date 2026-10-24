/**
 * @file app/api/alt-text/documents/[uploadId]/history/route.ts
 * @module Publishing · Alt Text
 * @kind API route handler
 * @summary Phase 3 Task 19 — GET read-only document history: jobs, AI batches, outputs,
 *   validation runs and a merged timeline. Never triggers processing.
 * @security Session + publishing module + publishing.alt_text:view; tenant + owner scoped.
 */
import { gateAltTextHistory, jsonOk, unexpected } from "@/lib/alt-text/route-gate"
import { notFound, rateLimited, resolveDocument } from "@/lib/alt-text/document-review-route"
import { ownerScopeFor } from "@/lib/alt-text/document-service"
import { getDocumentHistory } from "@/lib/alt-text/document-history-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(_req: Request, ctx: { params: Promise<{ uploadId: string }> }) {
  const gate = await gateAltTextHistory()
  if (!gate.ok) return gate.response
  const { uploadId } = await ctx.params
  try {
    const limited = await rateLimited("history-read", gate.actor, { max: 60, windowMs: 60_000 })
    if (limited) return limited
    const doc = await resolveDocument(uploadId, gate.actor)
    if (!doc.ok) return doc.response
    const detail = await getDocumentHistory(doc.id, ownerScopeFor(gate.actor))
    if (!detail) return notFound()
    const res = jsonOk(detail)
    res.headers.set("Cache-Control", "no-store, private")
    return res
  } catch (err) {
    return unexpected("documents/history", err)
  }
}
