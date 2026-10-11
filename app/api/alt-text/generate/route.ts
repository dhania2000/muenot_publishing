/**
 * @file app/api/alt-text/generate/route.ts
 * @module Publishing · Alt Text
 * @kind API route handler
 * @summary POST /api/alt-text/generate — billed AI alt text generation for one tenant-scoped asset.
 * @security Session + publishing module toggle/plan + publishing.view_alt_text + publishing.alt_text:generate grant + view record scope.
 */
import { NextResponse, type NextRequest } from "next/server"
import { requireFeatureInModule } from "@/lib/api-auth"
import { getScope, hasActionGrant } from "@/lib/permission-store"
import { checkRateLimit } from "@/lib/rate-limit"
import { currentTenantIdOrNull } from "@/lib/tenant-scope"
import { generateAltTextForAsset, parseGenerateRequest } from "@/lib/alt-text/generate"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

const NO_STORE = { "Cache-Control": "private, no-store" }
const RATE_LIMIT = { max: 20, windowMs: 60_000 }
const MAX_BODY_BYTES = 16 * 1024

const error = (status: number, code: string, message: string, extra?: Record<string, unknown>, headers?: HeadersInit) =>
  NextResponse.json({ success: false, error: message, code, ...(extra ?? {}) }, { status, headers: { ...NO_STORE, ...(headers ?? {}) } })

export async function POST(req: NextRequest) {
  const gate = await requireFeatureInModule("publishing", "publishing.view_alt_text")
  if (!gate.ok) return error(gate.status, "code" in gate ? gate.code : gate.status === 401 ? "UNAUTHENTICATED" : gate.status === 404 ? "NOT_FOUND" : "FORBIDDEN", gate.error)
  const { session } = gate

  const tenantId = currentTenantIdOrNull()
  if (tenantId == null) return error(403, "FORBIDDEN", "No tenant in context")

  if (session.role !== "admin" && !(await hasActionGrant(session.userId, session.role, "publishing.alt_text", "generate"))) {
    return error(403, "FORBIDDEN", "You do not have permission to generate alt text.")
  }
  const viewScope = await getScope(session.userId, session.role, "publishing.alt_text", "view")
  if (viewScope === "none") return error(403, "FORBIDDEN", "You do not have permission to view images.")
  const updateScope = await getScope(session.userId, session.role, "publishing.alt_text", "update")
  if (updateScope === "none") return error(403, "FORBIDDEN", "You do not have permission to change alt text.")

  const limit = await checkRateLimit(`alt-text-generate:${tenantId}:${session.userId}`, RATE_LIMIT)
  if (!limit.allowed) return error(429, "RATE_LIMITED", "Too many generation requests. Please wait and try again.", undefined, { "Retry-After": String(limit.retryAfter) })

  if (Number(req.headers.get("content-length")) > MAX_BODY_BYTES) return error(413, "PAYLOAD_TOO_LARGE", "Request body is too large.")
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return error(400, "INVALID_REQUEST", "Send a valid JSON body.")
  }
  const parsed = parseGenerateRequest(body)
  if (!parsed.ok) return error(parsed.status, parsed.code, parsed.error, parsed.details)

  try {
    const result = await generateAltTextForAsset(parsed.value, { userId: session.userId, tenantId, role: session.role === "admin" ? "admin" : "employee", viewScope, updateScope })
    if (!result.ok) return error(result.status, result.code, result.error, result.details)
    return NextResponse.json(result.body, { headers: NO_STORE })
  } catch (err) {
    console.error("[alt-text/generate] unexpected failure", err instanceof Error ? err.name : "unknown")
    return error(500, "GENERATION_FAILED", "Alt text generation failed. Please try again.")
  }
}
