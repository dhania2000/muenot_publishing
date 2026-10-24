/**
 * @file app/api/alt-text/documents/[uploadId]/context/route.ts
 * @module Publishing · Alt Text
 * @kind API route handler
 * @summary Phase 3 Task 9 — document context for extracted image occurrences.
 *   GET  ?imageId=N  → stored context for one occurrence (read-only; never runs analysis).
 *   POST {imageId?}  → (re)analyze one occurrence or the whole document and persist the result.
 *   No AI generation, no credits; original documents and source alt text are never modified.
 * @security Session + publishing module + publishing.alt_text:view (POST also :upload, like extract);
 *   tenant-scoped, owner-only unless view scope is `all`; per-user rate limit on POST.
 */
import { checkRateLimit } from "@/lib/rate-limit"
import { currentTenantId } from "@/lib/tenant-scope"
import { gateAltTextHistory, jsonError, jsonOk, unexpected } from "@/lib/alt-text/route-gate"
import { ownerScopeFor } from "@/lib/alt-text/document-service"
import { analyzeDocumentContexts, readDocumentImageContext } from "@/lib/alt-text/document-context-service"

export const dynamic = "force-dynamic"
export const maxDuration = 300

const ID = /^[1-9]\d{0,9}$/
const RATE_LIMIT = { max: 10, windowMs: 60_000 }
const notFound = () => jsonError({ status: 404, code: "NOT_FOUND", error: "The document could not be found." })

export async function GET(req: Request, ctx: { params: Promise<{ uploadId: string }> }) {
  const gate = await gateAltTextHistory()
  if (!gate.ok) return gate.response
  const { uploadId: id } = await ctx.params
  if (!ID.test(id)) return notFound()
  const imageId = new URL(req.url).searchParams.get("imageId") ?? ""
  if (!ID.test(imageId)) return jsonError({ status: 400, code: "INVALID_INPUT", error: "imageId is required." })
  try {
    const result = await readDocumentImageContext(Number(id), Number(imageId), ownerScopeFor(gate.actor))
    if (!result.ok) return jsonError({ status: result.status, code: result.code, error: result.error })
    const { ok: _ok, ...view } = result
    return jsonOk({ success: true, ...view })
  } catch (err) {
    return unexpected("documents/context", err)
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ uploadId: string }> }) {
  const gate = await gateAltTextHistory({ upload: true })
  if (!gate.ok) return gate.response
  const { uploadId: id } = await ctx.params
  if (!ID.test(id)) return notFound()
  let imageId: number | undefined
  const raw = await req.text().catch(() => "")
  if (raw.trim()) {
    let body: unknown
    try {
      body = JSON.parse(raw)
    } catch {
      return jsonError({ status: 400, code: "INVALID_INPUT", error: "Invalid JSON body." })
    }
    const v = (body as { imageId?: unknown } | null)?.imageId
    if (v != null) {
      if (typeof v !== "number" || !ID.test(String(v))) return jsonError({ status: 400, code: "INVALID_INPUT", error: "imageId must be a positive integer." })
      imageId = v
    }
  }
  try {
    const limit = await checkRateLimit(`alt-text-document-context:${currentTenantId()}:${gate.actor.userId}`, RATE_LIMIT)
    if (!limit.allowed) return jsonError({ status: 429, code: "RATE_LIMITED", error: "Too many context analysis requests. Please wait and try again." })
    const result = await analyzeDocumentContexts(Number(id), ownerScopeFor(gate.actor), { imageId })
    if (!result.ok) return jsonError({ status: result.status, code: result.code, error: result.error })
    return jsonOk({ success: true, summary: result.summary, ...(imageId != null ? { context: result.context ?? null } : {}) })
  } catch (err) {
    return unexpected("documents/context", err)
  }
}
