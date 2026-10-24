/**
 * @file app/api/alt-text/documents/[uploadId]/review/bulk/route.ts
 * @module Publishing · Alt Text
 * @kind API route handler
 * @summary POST — Phase 3 Task 14 bulk review (start_review | approve | request_changes) for up to
 *   BULK_MAX explicitly selected occurrences, each pinned to the version the reviewer saw. Items are
 *   validated and applied individually; the response reports accepted / skipped / rejected per item.
 *   Rejection is single-item only.
 * @security Session + publishing module + publishing.alt_text:view + :update + :approve; tenant + owner scoped.
 */
import { gateAltTextHistory, jsonError, jsonOk, unexpected } from "@/lib/alt-text/route-gate"
import { rateLimited, readJsonBody, resolveDocument } from "@/lib/alt-text/document-review-route"
import { bulkDecide } from "@/lib/alt-text/document-approval-service"
import { parseBulkReviewRequest } from "@/lib/alt-text/document-approval-contract"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request, ctx: { params: Promise<{ uploadId: string }> }) {
  const gate = await gateAltTextHistory({ review: true })
  if (!gate.ok) return gate.response
  const read = await readJsonBody(req)
  if (!read.ok) return read.response
  const parsed = parseBulkReviewRequest(read.body)
  if (!parsed.ok) return jsonError({ status: 400, code: parsed.code, error: parsed.error, ...(parsed.field ? { details: { field: parsed.field } } : {}) })
  try {
    const limited = await rateLimited("bulk", gate.actor, { max: 10, windowMs: 60_000 })
    if (limited) return limited
    const doc = await resolveDocument((await ctx.params).uploadId, gate.actor)
    if (!doc.ok) return doc.response
    return jsonOk(await bulkDecide(doc.id, parsed.value, gate.actor.userId))
  } catch (err) {
    return unexpected("documents/review-bulk", err)
  }
}
