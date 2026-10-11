/**
 * @file app/api/alt-text/batches/route.ts
 * @module Publishing · Alt Text
 * @kind API route handler
 * @summary POST /api/alt-text/batches — create a draft bulk batch from uploaded assets (Phase 2 Task 7).
 * @security Session + publishing module toggle/plan + publishing.view_alt_text + publishing.alt_text:upload grant + view/update record scope.
 */
import { NextResponse, type NextRequest } from "next/server"
import { requireFeatureInModule } from "@/lib/api-auth"
import { getScope, hasActionGrant } from "@/lib/permission-store"
import { checkRateLimit } from "@/lib/rate-limit"
import { currentTenantIdOrNull } from "@/lib/tenant-scope"
import { createBatchFromRequest, parseCreateBatchRequest } from "@/lib/alt-text/batch-submission"
import { gateAltTextHistory, jsonError, jsonOk, unexpected } from "@/lib/alt-text/route-gate"
import { listBatchHistory, parseBatchHistoryQuery } from "@/lib/alt-text/batch-history"

const LIST_RATE_LIMIT = { max: 60, windowMs: 60_000 }

/**
 * GET /api/alt-text/batches — paginated, tenant- and scope-filtered Batch History (Phase 2 Task 17). Read-only.
 * @security Session + publishing module + publishing.view_alt_text + publishing.alt_text:view scope; tenant from context only.
 */
export async function GET(req: NextRequest) {
  const gate = await gateAltTextHistory()
  if (!gate.ok) return gate.response
  try {
    const limit = await checkRateLimit(`alt-text-batch-list:${currentTenantIdOrNull()}:${gate.actor.userId}`, LIST_RATE_LIMIT)
    if (!limit.allowed) {
      const res = jsonError({ status: 429, code: "RATE_LIMITED", error: "Too many requests. Please wait and try again." })
      res.headers.set("Retry-After", String(limit.retryAfter))
      return res
    }
    const parsed = parseBatchHistoryQuery(req.nextUrl.searchParams)
    if (!parsed.ok) return jsonError(parsed)
    const result = await listBatchHistory(parsed.value, gate.actor)
    return jsonOk(result.body)
  } catch (err) {
    return unexpected("batches/list", err)
  }
}

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "private, no-store" }
const RATE_LIMIT = { max: 20, windowMs: 60_000 }
const MAX_BODY_BYTES = 256 * 1024

const error = (status: number, code: string, message: string, extra?: Record<string, unknown>, headers?: HeadersInit) =>
  NextResponse.json({ success: false, error: message, code, ...(extra ?? {}) }, { status, headers: { ...NO_STORE, ...(headers ?? {}) } })

export async function POST(req: NextRequest) {
  const gate = await requireFeatureInModule("publishing", "publishing.view_alt_text")
  if (!gate.ok) return error(gate.status, "code" in gate ? gate.code : gate.status === 401 ? "UNAUTHENTICATED" : gate.status === 404 ? "NOT_FOUND" : "FORBIDDEN", gate.error)
  const { session } = gate
  const tenantId = currentTenantIdOrNull()
  if (tenantId == null) return error(403, "FORBIDDEN", "No tenant in context")

  try {
    if (session.role !== "admin" && !(await hasActionGrant(session.userId, session.role, "publishing.alt_text", "upload"))) {
      return error(403, "FORBIDDEN", "You do not have permission to create batches.")
    }
    if ((await getScope(session.userId, session.role, "publishing.alt_text", "view")) === "none") return error(403, "FORBIDDEN", "You do not have permission to view images.")
    const updateScope = await getScope(session.userId, session.role, "publishing.alt_text", "update")
    if (updateScope === "none") return error(403, "FORBIDDEN", "You do not have permission to change alt text.")

    const limit = await checkRateLimit(`alt-text-batch-create:${tenantId}:${session.userId}`, RATE_LIMIT)
    if (!limit.allowed) return error(429, "RATE_LIMITED", "Too many requests. Please wait and try again.", undefined, { "Retry-After": String(limit.retryAfter) })

    if (Number(req.headers.get("content-length")) > MAX_BODY_BYTES) return error(413, "PAYLOAD_TOO_LARGE", "Request body is too large.")
    const raw = await req.text()
    if (raw.length > MAX_BODY_BYTES) return error(413, "PAYLOAD_TOO_LARGE", "Request body is too large.")
    let body: unknown
    try {
      body = JSON.parse(raw)
    } catch {
      return error(400, "INVALID_REQUEST", "Send a valid JSON body.")
    }

    const parsed = parseCreateBatchRequest(body, req.headers.get("idempotency-key"))
    if (!parsed.ok) return error(parsed.status, parsed.code, parsed.error, parsed.details)

    const result = await createBatchFromRequest(parsed.value, { userId: session.userId, tenantId, role: session.role === "admin" ? "admin" : "employee", updateScope })
    if (!result.ok) return error(result.status, result.code, result.error, result.details)
    return NextResponse.json(result.body, { status: result.status, headers: NO_STORE })
  } catch (err) {
    return unexpected("batches/create", err)
  }
}
