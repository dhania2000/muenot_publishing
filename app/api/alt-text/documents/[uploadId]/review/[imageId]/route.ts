/**
 * @file app/api/alt-text/documents/[uploadId]/review/[imageId]/route.ts
 * @module Publishing · Alt Text
 * @kind API route handler
 * @summary Phase 3 Task 14 review detail for one occurrence.
 *   GET   — image, source context, current/original AI/approved versions, review state, quality checks.
 *   PATCH — save a reviewer draft as a new immutable version (expectedVersion required). Saving
 *           never approves; it supersedes any approval held for the previous version.
 * @security Session + publishing module + publishing.alt_text:view (GET) / :update (PATCH); tenant + owner scoped.
 */
import { gateAltTextHistory, jsonError, jsonOk, unexpected } from "@/lib/alt-text/route-gate"
import { notFound, parseId, rateLimited, readJsonBody, resolveDocument } from "@/lib/alt-text/document-review-route"
import { buildReviewDetail, saveReviewDraft } from "@/lib/alt-text/document-approval-service"
import { parseEditRequest } from "@/lib/alt-text/history"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ uploadId: string; imageId: string }> }

export async function GET(_req: Request, ctx: Ctx) {
  const gate = await gateAltTextHistory({ withPermissions: true })
  if (!gate.ok) return gate.response
  const { uploadId, imageId: rawImage } = await ctx.params
  const imageId = parseId(rawImage)
  if (imageId == null) return notFound("image")
  try {
    const limited = await rateLimited("detail", gate.actor, { max: 120, windowMs: 60_000 })
    if (limited) return limited
    const doc = await resolveDocument(uploadId, gate.actor)
    if (!doc.ok) return doc.response
    const result = await buildReviewDetail(doc.id, imageId, gate.permissions ?? { canEdit: false, canReview: false })
    return result.ok ? jsonOk(result.body) : jsonError(result)
  } catch (err) {
    return unexpected("documents/review-detail", err)
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  const gate = await gateAltTextHistory({ edit: true })
  if (!gate.ok) return gate.response
  const { uploadId, imageId: rawImage } = await ctx.params
  const imageId = parseId(rawImage)
  if (imageId == null) return notFound("image")
  const read = await readJsonBody(req)
  if (!read.ok) return read.response
  const parsed = parseEditRequest(read.body)
  if (!parsed.ok) return jsonError(parsed)
  try {
    const limited = await rateLimited("draft", gate.actor, { max: 60, windowMs: 60_000 })
    if (limited) return limited
    const doc = await resolveDocument(uploadId, gate.actor)
    if (!doc.ok) return doc.response
    const result = await saveReviewDraft(doc.id, imageId, parsed.value, gate.actor)
    return result.ok ? jsonOk(result.body) : jsonError(result)
  } catch (err) {
    return unexpected("documents/review-draft", err)
  }
}
