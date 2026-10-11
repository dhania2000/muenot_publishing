/**
 * @file app/api/alt-text/documents/route.ts
 * @module Publishing · Alt Text
 * @kind API route handler
 * @summary GET /api/alt-text/documents — paginated, newest-first list of persisted
 *   document records (Phase 3 Task 4). Metadata only; no bytes, keys or preview links.
 * @security Session + publishing module + publishing.alt_text:view; tenant-scoped,
 *   owner-only unless view scope is `all`. Client-supplied tenant/user ids are ignored.
 */
import { gateAltTextHistory, jsonError, jsonOk, unexpected } from "@/lib/alt-text/route-gate"
import { listDocumentRecords, ownerScopeFor } from "@/lib/alt-text/document-service"
import { DOCUMENT_LIST_LIMITS, type DocumentListResponse } from "@/lib/alt-text/document-records"

export const dynamic = "force-dynamic"

const POSITIVE_INT = /^[1-9]\d{0,9}$/

function intParam(raw: string | null, fallback: number, max: number) {
  if (raw == null || !POSITIVE_INT.test(raw)) return fallback
  return Math.min(Number(raw), max)
}

export async function GET(req: Request) {
  const gate = await gateAltTextHistory()
  if (!gate.ok) return gate.response
  const sp = new URL(req.url).searchParams
  const page = intParam(sp.get("page"), 1, 100_000)
  const pageSize = intParam(sp.get("pageSize"), DOCUMENT_LIST_LIMITS.defaultPageSize, DOCUMENT_LIST_LIMITS.maxPageSize)
  const rawProject = sp.get("projectId")
  if (rawProject != null && !POSITIVE_INT.test(rawProject)) {
    return jsonError({ status: 400, code: "INVALID_PROJECT", error: "projectId must be a positive integer." })
  }
  try {
    const { documents, total } = await listDocumentRecords(
      { page, pageSize, projectId: rawProject == null ? null : Number(rawProject) },
      ownerScopeFor(gate.actor),
    )
    const body: DocumentListResponse = { success: true, documents, page, pageSize, total }
    return jsonOk(body)
  } catch (err) {
    return unexpected("documents/list", err)
  }
}
