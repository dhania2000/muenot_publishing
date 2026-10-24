/**
 * @file app/api/alt-text/documents/processing/route.ts
 * @module Publishing · Alt Text
 * @kind API route handler
 * @summary GET /api/alt-text/documents/processing — paginated per-document occurrence progress and
 *   scoped totals for the Live Document AI Processing dashboard (Phase 3 Task 13). Read-only.
 * @security Session + publishing module + publishing.alt_text:view; tenant-scoped, owner-only unless
 *   view scope is `all`. Client-supplied tenant/user ids are ignored.
 */
import { checkRateLimit } from "@/lib/rate-limit"
import { currentTenantIdOrNull } from "@/lib/tenant-scope"
import { gateAltTextHistory, jsonError, jsonOk, unexpected } from "@/lib/alt-text/route-gate"
import { ownerScopeFor } from "@/lib/alt-text/document-service"
import { listDocumentProcessing } from "@/lib/alt-text/document-processing"
import {
  PROCESSING_PAGE_MAX,
  PROCESSING_PAGE_SIZE,
  isProcessingTypeFilter,
  type DocumentProcessingListResponse,
} from "@/lib/alt-text/document-processing-contract"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const POSITIVE_INT = /^[1-9]\d{0,9}$/
const RATE_LIMIT = { max: 60, windowMs: 60_000 }

const intParam = (raw: string | null, fallback: number, max: number) =>
  raw == null || !POSITIVE_INT.test(raw) ? fallback : Math.min(Number(raw), max)

export async function GET(req: Request) {
  const gate = await gateAltTextHistory()
  if (!gate.ok) return gate.response
  const sp = new URL(req.url).searchParams
  const rawType = sp.get("type") ?? "all"
  if (!isProcessingTypeFilter(rawType)) return jsonError({ status: 400, code: "INVALID_TYPE", error: "type must be all, pdf, pptx or docx." })
  try {
    const limit = await checkRateLimit(`alt-text-doc-processing:${currentTenantIdOrNull()}:${gate.actor.userId}`, RATE_LIMIT)
    if (!limit.allowed) {
      const res = jsonError({ status: 429, code: "RATE_LIMITED", error: "Too many requests. Please slow down polling." })
      res.headers.set("Retry-After", String(limit.retryAfter))
      return res
    }
    const result = await listDocumentProcessing(
      {
        page: intParam(sp.get("page"), 1, 100_000),
        pageSize: intParam(sp.get("pageSize"), PROCESSING_PAGE_SIZE, PROCESSING_PAGE_MAX),
        documentType: rawType === "all" ? null : rawType,
      },
      ownerScopeFor(gate.actor),
    )
    const body: DocumentProcessingListResponse = { success: true, ...result }
    return jsonOk(body)
  } catch (err) {
    return unexpected("documents/processing", err)
  }
}
