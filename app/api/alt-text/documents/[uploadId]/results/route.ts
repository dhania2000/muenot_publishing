/**
 * @file app/api/alt-text/documents/[uploadId]/results/route.ts
 * @module Publishing · Alt Text
 * @kind API route handler
 * @summary GET /api/alt-text/documents/:id/results — Phase 3 Task 13 per-occurrence AI results
 *   (location, context state, AI status, alt preview, failure, retry eligibility) with a
 *   server-side status filter and pagination. Read-only; never triggers jobs, retries or AI.
 * @security Session + publishing module + publishing.alt_text:view; tenant-scoped, owner-only
 *   unless the view scope is `all`.
 */
import { checkRateLimit } from "@/lib/rate-limit"
import { currentTenantIdOrNull } from "@/lib/tenant-scope"
import { gateAltTextHistory, jsonError, jsonOk, unexpected } from "@/lib/alt-text/route-gate"
import { ownerScopeFor } from "@/lib/alt-text/document-service"
import { getDocument } from "@/lib/alt-text/document-store"
import { listDocumentImageResults } from "@/lib/alt-text/document-processing"
import {
  IMAGE_RESULTS_PAGE_MAX,
  IMAGE_RESULTS_PAGE_SIZE,
  isImageResultFilter,
  type DocumentImageResultsResponse,
} from "@/lib/alt-text/document-processing-contract"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const DOCUMENT_ID = /^[1-9]\d{0,9}$/
const RATE_LIMIT = { max: 60, windowMs: 60_000 }

const invalid = (error: string) => jsonError({ status: 400, code: "INVALID_QUERY", error })

export async function GET(req: Request, ctx: { params: Promise<{ uploadId: string }> }) {
  const gate = await gateAltTextHistory()
  if (!gate.ok) return gate.response
  const { uploadId: id } = await ctx.params
  if (!DOCUMENT_ID.test(id)) return jsonError({ status: 404, code: "NOT_FOUND", error: "The document could not be found." })

  const sp = new URL(req.url).searchParams
  const page = sp.get("page") ?? "1"
  const pageSize = sp.get("pageSize") ?? String(IMAGE_RESULTS_PAGE_SIZE)
  const filter = sp.get("status") ?? "all"
  if (!/^\d{1,6}$/.test(page) || Number(page) < 1) return invalid("page must be a positive integer.")
  if (!/^\d{1,3}$/.test(pageSize) || Number(pageSize) < 1 || Number(pageSize) > IMAGE_RESULTS_PAGE_MAX)
    return invalid(`pageSize must be between 1 and ${IMAGE_RESULTS_PAGE_MAX}.`)
  if (!isImageResultFilter(filter)) return invalid("Unknown status filter.")

  try {
    const limit = await checkRateLimit(`alt-text-document-results:${currentTenantIdOrNull()}:${gate.actor.userId}`, RATE_LIMIT)
    if (!limit.allowed) {
      const res = jsonError({ status: 429, code: "RATE_LIMITED", error: "Too many requests. Please slow down polling." })
      res.headers.set("Retry-After", String(limit.retryAfter))
      return res
    }
    const doc = await getDocument(Number(id), ownerScopeFor(gate.actor))
    if (!doc) return jsonError({ status: 404, code: "NOT_FOUND", error: "The document could not be found." })
    const result = await listDocumentImageResults(doc.id, { page: Number(page), pageSize: Number(pageSize), filter })
    const body: DocumentImageResultsResponse = { success: true, documentId: doc.id, ...result }
    return jsonOk(body)
  } catch (err) {
    return unexpected("documents/results", err)
  }
}
