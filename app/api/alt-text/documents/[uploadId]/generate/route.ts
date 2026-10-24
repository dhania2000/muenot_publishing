/**
 * @file app/api/alt-text/documents/[uploadId]/generate/route.ts
 * @module Publishing · Alt Text
 * @kind API route handler
 * @summary Phase 3 Task 12 — POST queues AI alt text generation for the document's selected, eligible
 *   image occurrences as a Phase 2 batch (durable job). Runs no AI in the request. Progress uses the
 *   existing batch APIs (/api/alt-text/batches/:id).
 * @security Session + publishing module + publishing.view_alt_text + publishing.alt_text:generate grant +
 *   view/update scope; tenant-scoped, owner-scoped document; security verdict re-checked; rate limited.
 */
import { after, NextResponse, type NextRequest } from "next/server"
import { requireFeatureInModule } from "@/lib/api-auth"
import { runDueBackgroundJobs } from "@/lib/background-jobs"
import { getScope, hasActionGrant } from "@/lib/permission-store"
import { checkRateLimit } from "@/lib/rate-limit"
import { currentTenantIdOrNull } from "@/lib/tenant-scope"
import { IDEMPOTENCY_KEY } from "@/lib/alt-text/batch-submission"
import { submitDocumentGeneration } from "@/lib/alt-text/document-generation"
import { getDocumentForExtraction, ownerScopeFor } from "@/lib/alt-text/document-service"
import { unexpected } from "@/lib/alt-text/route-gate"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "private, no-store" }
const RATE_LIMIT = { max: 10, windowMs: 60_000 }
const DOCUMENT_ID = /^[1-9]\d{0,9}$/
const MAX_BODY_BYTES = 32 * 1024
const ALLOWED_KEYS = new Set(["settings", "idempotencyKey"])

const error = (status: number, code: string, message: string, extra?: Record<string, unknown>, headers?: HeadersInit) =>
  NextResponse.json({ success: false, error: message, code, ...(extra ?? {}) }, { status, headers: { ...NO_STORE, ...(headers ?? {}) } })

export async function POST(req: NextRequest, ctx: { params: Promise<{ uploadId: string }> }) {
  const gate = await requireFeatureInModule("publishing", "publishing.view_alt_text")
  if (!gate.ok) return error(gate.status, "code" in gate ? gate.code : gate.status === 401 ? "UNAUTHENTICATED" : gate.status === 404 ? "NOT_FOUND" : "FORBIDDEN", gate.error)
  const { session } = gate
  const tenantId = currentTenantIdOrNull()
  if (tenantId == null) return error(403, "FORBIDDEN", "No tenant in context")

  const { uploadId } = await ctx.params
  if (!DOCUMENT_ID.test(uploadId)) return error(404, "NOT_FOUND", "The document could not be found.")

  try {
    const role = session.role === "admin" ? "admin" : "employee"
    if (role !== "admin" && !(await hasActionGrant(session.userId, session.role, "publishing.alt_text", "generate"))) {
      return error(403, "FORBIDDEN", "You do not have permission to generate alt text.")
    }
    const viewScope = await getScope(session.userId, session.role, "publishing.alt_text", "view")
    if (viewScope === "none") return error(403, "FORBIDDEN", "You do not have permission to view images.")
    const updateScope = await getScope(session.userId, session.role, "publishing.alt_text", "update")
    if (updateScope === "none") return error(403, "FORBIDDEN", "You do not have permission to change alt text.")

    const limit = await checkRateLimit(`alt-text-document-generate:${tenantId}:${session.userId}`, RATE_LIMIT)
    if (!limit.allowed) return error(429, "RATE_LIMITED", "Too many requests. Please wait and try again.", undefined, { "Retry-After": String(limit.retryAfter) })

    const raw = await req.text()
    if (raw.length > MAX_BODY_BYTES) return error(413, "PAYLOAD_TOO_LARGE", "Request body is too large.")
    let body: Record<string, unknown> = {}
    if (raw.trim()) {
      try {
        const parsed = JSON.parse(raw)
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return error(400, "INVALID_REQUEST", "Send a JSON object.")
        body = parsed
      } catch {
        return error(400, "INVALID_REQUEST", "Send a valid JSON body.")
      }
    }
    const extra = Object.keys(body).filter((k) => !ALLOWED_KEYS.has(k))
    if (extra.length) return error(400, "INVALID_REQUEST", "Unexpected fields in request.", { fields: extra })
    if (body.settings !== undefined && (!body.settings || typeof body.settings !== "object" || Array.isArray(body.settings))) {
      return error(400, "INVALID_SETTINGS", "Settings must be an object.")
    }
    const headerKey = req.headers.get("idempotency-key")
    const idempotencyKey = headerKey ?? (typeof body.idempotencyKey === "string" ? body.idempotencyKey : null)
    if (idempotencyKey != null && !IDEMPOTENCY_KEY.test(idempotencyKey)) return error(400, "INVALID_IDEMPOTENCY_KEY", "Idempotency key must be 8–80 letters, digits, '-' or '_'.")

    const doc = await getDocumentForExtraction(Number(uploadId), ownerScopeFor({ userId: session.userId, viewScope }))
    if (!doc) return error(404, "NOT_FOUND", "The document could not be found.")
    if (doc.securityStatus !== "clean") return error(422, "DOCUMENT_NOT_CLEAN", "The document has not passed the security scan.")

    const result = await submitDocumentGeneration(
      { id: doc.id, filename: doc.filename, projectId: doc.projectId ?? null },
      { settings: body.settings, idempotencyKey },
      { userId: session.userId, tenantId, role, updateScope },
    )
    if (!result.ok) return error(result.status, result.code, result.error, result.details)
    if (!result.body.replayed) after(() => runDueBackgroundJobs({ maxJobs: 1 }).catch((e) => console.error("[jobs] post-submit run failed", e instanceof Error ? e.message : e)))
    return NextResponse.json(result.body, { status: 202, headers: NO_STORE })
  } catch (err) {
    return unexpected("documents/generate", err)
  }
}
