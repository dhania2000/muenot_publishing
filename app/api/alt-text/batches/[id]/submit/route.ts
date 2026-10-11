/**
 * @file app/api/alt-text/batches/[id]/submit/route.ts
 * @module Publishing · Alt Text
 * @kind API route handler
 * @summary POST /api/alt-text/batches/[id]/submit — validate and queue a draft batch for Task 8 processing. Runs no AI.
 * @security Session + publishing module toggle/plan + publishing.view_alt_text + publishing.alt_text:generate grant + view/update record scope.
 */
import { NextResponse, type NextRequest } from "next/server"
import { requireFeatureInModule } from "@/lib/api-auth"
import { getScope, hasActionGrant } from "@/lib/permission-store"
import { checkRateLimit } from "@/lib/rate-limit"
import { currentTenantIdOrNull } from "@/lib/tenant-scope"
import { submitBatchForProcessing } from "@/lib/alt-text/batch-submission"
import { unexpected } from "@/lib/alt-text/route-gate"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "private, no-store" }
const RATE_LIMIT = { max: 20, windowMs: 60_000 }
const BATCH_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const error = (status: number, code: string, message: string, extra?: Record<string, unknown>, headers?: HeadersInit) =>
  NextResponse.json({ success: false, error: message, code, ...(extra ?? {}) }, { status, headers: { ...NO_STORE, ...(headers ?? {}) } })

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireFeatureInModule("publishing", "publishing.view_alt_text")
  if (!gate.ok) return error(gate.status, "code" in gate ? gate.code : gate.status === 401 ? "UNAUTHENTICATED" : gate.status === 404 ? "NOT_FOUND" : "FORBIDDEN", gate.error)
  const { session } = gate
  const tenantId = currentTenantIdOrNull()
  if (tenantId == null) return error(403, "FORBIDDEN", "No tenant in context")

  const { id } = await ctx.params
  if (!BATCH_ID.test(id)) return error(404, "NOT_FOUND", "Batch not found.")

  try {
    if (session.role !== "admin" && !(await hasActionGrant(session.userId, session.role, "publishing.alt_text", "generate"))) {
      return error(403, "FORBIDDEN", "You do not have permission to generate alt text.")
    }
    if ((await getScope(session.userId, session.role, "publishing.alt_text", "view")) === "none") return error(403, "FORBIDDEN", "You do not have permission to view images.")
    const updateScope = await getScope(session.userId, session.role, "publishing.alt_text", "update")
    if (updateScope === "none") return error(403, "FORBIDDEN", "You do not have permission to change alt text.")

    const limit = await checkRateLimit(`alt-text-batch-submit:${tenantId}:${session.userId}`, RATE_LIMIT)
    if (!limit.allowed) return error(429, "RATE_LIMITED", "Too many requests. Please wait and try again.", undefined, { "Retry-After": String(limit.retryAfter) })

    const result = await submitBatchForProcessing(id, { userId: session.userId, tenantId, role: session.role === "admin" ? "admin" : "employee", updateScope })
    if (!result.ok) return error(result.status, result.code, result.error, result.details)
    return NextResponse.json(result.body, { status: 202, headers: NO_STORE })
  } catch (err) {
    return unexpected("batches/submit", err)
  }
}
