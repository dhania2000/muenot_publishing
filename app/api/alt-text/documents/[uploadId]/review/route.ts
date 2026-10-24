/**
 * @file app/api/alt-text/documents/[uploadId]/review/route.ts
 * @module Publishing · Alt Text
 * @kind API route handler
 * @summary GET /api/alt-text/documents/:id/review — Phase 3 Task 14 review queue: generated
 *   descriptions per occurrence with effective review status, server-side filter + pagination,
 *   summary counts and the caller's edit/review capabilities. Read-only.
 * @security Session + publishing module + publishing.alt_text:view; tenant + owner scoped.
 */
import { gateAltTextHistory, jsonError, jsonOk, unexpected } from "@/lib/alt-text/route-gate"
import { parsePaging, rateLimited, resolveDocument } from "@/lib/alt-text/document-review-route"
import { getReviewStats, listReviewQueue } from "@/lib/alt-text/document-approval-store"
import { filterToStatus, isReviewQueueFilter, type ReviewQueueResponse } from "@/lib/alt-text/document-approval-contract"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const PAGE_SIZE = 25
const PAGE_MAX = 100

export async function GET(req: Request, ctx: { params: Promise<{ uploadId: string }> }) {
  const gate = await gateAltTextHistory({ withPermissions: true })
  if (!gate.ok) return gate.response
  const sp = new URL(req.url).searchParams
  const filter = sp.get("status") ?? "all"
  if (!isReviewQueueFilter(filter)) return jsonError({ status: 400, code: "INVALID_QUERY", error: "Unknown review status filter." })
  const paging = parsePaging(sp, PAGE_SIZE, PAGE_MAX)
  if (!paging.ok) return paging.response
  try {
    const limited = await rateLimited("queue", gate.actor, { max: 90, windowMs: 60_000 })
    if (limited) return limited
    const doc = await resolveDocument((await ctx.params).uploadId, gate.actor)
    if (!doc.ok) return doc.response
    const [list, stats] = await Promise.all([
      listReviewQueue(doc.id, filterToStatus(filter), { limit: paging.pageSize, offset: (paging.page - 1) * paging.pageSize }),
      getReviewStats(doc.id),
    ])
    const body: ReviewQueueResponse = {
      success: true,
      documentId: doc.id,
      rows: list.rows,
      total: list.total,
      page: paging.page,
      pageSize: paging.pageSize,
      stats,
      permissions: gate.permissions ?? { canEdit: false, canReview: false },
    }
    return jsonOk(body)
  } catch (err) {
    return unexpected("documents/review", err)
  }
}
