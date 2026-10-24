/**
 * @file app/api/alt-text/documents/[uploadId]/review/[imageId]/decision/route.ts
 * @module Publishing · Alt Text
 * @kind API route handler
 * @summary POST — Phase 3 Task 14 review decision (start_review | approve | request_changes | reject)
 *   for exactly the saved version the reviewer saw (expectedVersion). Approval re-runs quality
 *   checks server-side and pins the immutable version row. Idempotent for repeated decisions.
 * @security Session + publishing module + publishing.alt_text:view + :update + :approve; tenant + owner scoped.
 */
import { gateAltTextHistory, jsonError, jsonOk, unexpected } from "@/lib/alt-text/route-gate"
import { notFound, parseId, rateLimited, readJsonBody, resolveDocument } from "@/lib/alt-text/document-review-route"
import { decideAndReload } from "@/lib/alt-text/document-approval-service"
import { parseDecisionRequest } from "@/lib/alt-text/document-approval-contract"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request, ctx: { params: Promise<{ uploadId: string; imageId: string }> }) {
  const gate = await gateAltTextHistory({ review: true })
  if (!gate.ok) return gate.response
  const { uploadId, imageId: rawImage } = await ctx.params
  const imageId = parseId(rawImage)
  if (imageId == null) return notFound("image")
  const read = await readJsonBody(req)
  if (!read.ok) return read.response
  const parsed = parseDecisionRequest(read.body)
  if (!parsed.ok) return jsonError({ status: 400, code: parsed.code, error: parsed.error, ...(parsed.field ? { details: { field: parsed.field } } : {}) })
  try {
    const limited = await rateLimited("decision", gate.actor, { max: 60, windowMs: 60_000 })
    if (limited) return limited
    const doc = await resolveDocument(uploadId, gate.actor)
    if (!doc.ok) return doc.response
    const result = await decideAndReload(doc.id, imageId, parsed.value, gate.actor.userId)
    return result.ok ? jsonOk(result.body) : jsonError(result)
  } catch (err) {
    return unexpected("documents/review-decision", err)
  }
}
