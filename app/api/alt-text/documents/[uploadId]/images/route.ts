import {readBody} from "@/lib/alt-text/document-extraction-run"
/**
 * @file app/api/alt-text/documents/[uploadId]/images/route.ts
 * @module Publishing · Alt Text
 * @kind API route handler
 * @summary GET /api/alt-text/documents/:id/images — extracted image occurrences with server-side
 *   filters (extraction, alt, context, selection, mediaSha256), search, stable sort and
 *   pagination, plus the persisted readiness summary and per-status counts. Metadata only:
 *   previews go through the existing scan-gated /api/alt-text/assets/:assetId/image route.
 *
 *   PATCH /api/alt-text/documents/:id/images — persisted selection / source-review updates
 *   (select, deselect, select_all_eligible, clear_selection, set_review). Bounded, idempotent,
 *   eligibility enforced in SQL. Never generates alt text, reserves credits or creates jobs.
 * @security Session + publishing module + publishing.alt_text:view (GET) / :upload (PATCH);
 *   tenant-scoped, owner-only unless the action scope is `all`.
 */
import { checkRateLimit } from "@/lib/rate-limit"
import { currentTenantId } from "@/lib/tenant-scope"
import { gateAltTextHistory, jsonError, jsonOk, unexpected } from "@/lib/alt-text/route-gate"
import { ownerScopeFor } from "@/lib/alt-text/document-service"
import { countDocumentImages, getDocument } from "@/lib/alt-text/document-store"
import { parseImageListQuery, parseImageMutation, type DocumentReviewImagesResponse, type ImageMutationResponse } from "@/lib/alt-text/document-image-review"
import { clearSelection, getReadinessSummary, listReviewImages, selectAllEligible, setReviewStatus, setSelection } from "@/lib/alt-text/document-image-review-store"

export const dynamic = "force-dynamic"

const DOCUMENT_ID = /^[1-9]\d{0,9}$/
const RATE_LIMIT = { max: 60, windowMs: 60_000 }
const BODY_MAX = 16_384

const notFound = () => jsonError({ status: 404, code: "NOT_FOUND", error: "The document could not be found." })
const invalid = (error: string) => jsonError({ status: 400, code: "INVALID_REQUEST", error })

export async function GET(req: Request, ctx: { params: Promise<{ uploadId: string }> }) {
  const gate = await gateAltTextHistory()
  if (!gate.ok) return gate.response
  const { uploadId: id } = await ctx.params
  if (!DOCUMENT_ID.test(id)) return notFound()
  const parsed = parseImageListQuery(new URL(req.url).searchParams)
  if (!parsed.ok) return invalid(parsed.error)
  try {
    const doc = await getDocument(Number(id), ownerScopeFor(gate.actor))
    if (!doc) return notFound()
    const q = parsed.query
    const [page, summary, counts] = await Promise.all([listReviewImages(doc.id, q), getReadinessSummary(doc.id), countDocumentImages(doc.id)])
    const body: DocumentReviewImagesResponse = {
      success: true,
      documentId: doc.id,
      processingStatus: doc.processingStatus,
      images: page.images,
      page: q.page,
      pageSize: q.pageSize,
      total: page.total,
      summary,
      counts,
    }
    return jsonOk(body)
  } catch (err) {
    return unexpected("documents/images", err)
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ uploadId: string }> }) {
  const gate = await gateAltTextHistory({ upload: true })
  if (!gate.ok) return gate.response
  const { uploadId: id } = await ctx.params
  if (!DOCUMENT_ID.test(id)) return notFound()
  const bytes=await readBody(req.body,BODY_MAX).catch(()=>null)
  if(!bytes)return jsonError({status:413,code:"PAYLOAD_TOO_LARGE",error:"Request body exceeds the byte limit."})
  const raw=bytes.toString("utf8")
  if (!raw || raw.length > BODY_MAX) return invalid("Invalid request body.")
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return invalid("Invalid request body.")
  }
  const parsed = parseImageMutation(json)
  if (!parsed.ok) return invalid(parsed.error)
  try {
    const limit = await checkRateLimit(`alt-text-document-images:${currentTenantId()}:${gate.actor.userId}`, RATE_LIMIT)
    if (!limit.allowed) return jsonError({ status: 429, code: "RATE_LIMITED", error: "Too many selection updates. Please wait and try again." })
    const doc = await getDocument(Number(id), ownerScopeFor(gate.actor))
    if (!doc) return notFound()
    const r = parsed.request
    const userId = gate.actor.userId
    let outcome: Omit<ImageMutationResponse, "success" | "action" | "summary">
    switch (r.action) {
      case "select":
      case "deselect":
        outcome = await setSelection(doc.id, r.imageIds, r.action === "select", userId)
        break
      case "set_review":
        outcome = await setReviewStatus(doc.id, r.imageIds, r.reviewStatus, userId)
        break
      case "select_all_eligible":
        outcome = { applied: [], ineligible: [], notFound: [], changed: await selectAllEligible(doc.id, userId) }
        break
      case "clear_selection":
        outcome = { applied: [], ineligible: [], notFound: [], changed: await clearSelection(doc.id, userId) }
        break
    }
    const body: ImageMutationResponse = { success: true, action: r.action, ...outcome, summary: await getReadinessSummary(doc.id) }
    return jsonOk(body)
  } catch (err) {
    return unexpected("documents/images:patch", err)
  }
}
