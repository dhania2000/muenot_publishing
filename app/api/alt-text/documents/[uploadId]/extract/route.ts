/**
 * @file app/api/alt-text/documents/[uploadId]/extract/route.ts
 * @module Publishing · Alt Text
 * @kind API route handler
 * @summary POST /api/alt-text/documents/:id/extract — synchronous PPTX image extraction (Phase 3 Task 5).
 *   Creates image occurrence rows and Alt Text assets only. No AI generation, no approval,
 *   the original document is never modified. Safe to repeat.
 * @security Session + publishing module + publishing.alt_text:view + :upload; tenant-scoped,
 *   owner-only unless view scope is `all`; per-user rate limit; clean security verdict re-checked server-side.
 */
import { checkRateLimit } from "@/lib/rate-limit"
import { currentTenantId } from "@/lib/tenant-scope"
import { gateAltTextHistory, jsonError, jsonOk, unexpected } from "@/lib/alt-text/route-gate"
import { ownerScopeFor } from "@/lib/alt-text/document-service"
import { extractPptxImages } from "@/lib/alt-text/pptx-extractor"

export const dynamic = "force-dynamic"
export const maxDuration = 300

const DOCUMENT_ID = /^[1-9]\d{0,9}$/
const RATE_LIMIT = { limit: 10, windowSeconds: 60 }

export async function POST(_req: Request, ctx: { params: Promise<{ uploadId: string }> }) {
  const gate = await gateAltTextHistory({ upload: true })
  if (!gate.ok) return gate.response
  const { uploadId: id } = await ctx.params
  if (!DOCUMENT_ID.test(id)) return jsonError({ status: 404, code: "NOT_FOUND", error: "The document could not be found." })
  try {
    const limit = await checkRateLimit(`alt-text-document-extract:${currentTenantId()}:${gate.actor.userId}`, RATE_LIMIT)
    if (!limit.allowed) return jsonError({ status: 429, code: "RATE_LIMITED", error: "Too many extraction requests. Please wait and try again." })
    const result = await extractPptxImages(Number(id), ownerScopeFor(gate.actor))
    if (!result.ok) return jsonError({ status: result.status, code: result.code, error: result.error })
    return jsonOk({ success: true, ...result.summary })
  } catch (err) {
    return unexpected("documents/extract", err)
  }
}
