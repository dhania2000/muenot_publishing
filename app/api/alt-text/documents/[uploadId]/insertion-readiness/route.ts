/**
 * @file app/api/alt-text/documents/[uploadId]/insertion-readiness/route.ts
 * @module Publishing · Alt Text
 * @kind API route handler
 * @summary GET — Phase 3 Task 14 read-only insertion-readiness contract for the future document
 *   writer: per occurrence, the approved immutable version (or decorative approval) and, when not
 *   eligible, the single blocking reason. Never writes to the document.
 * @security Session + publishing module + publishing.alt_text:view; tenant + owner scoped.
 */
import { gateAltTextHistory, jsonOk, unexpected } from "@/lib/alt-text/route-gate"
import { parsePaging, rateLimited, resolveDocument } from "@/lib/alt-text/document-review-route"
import { listInsertionReadiness } from "@/lib/alt-text/document-approval-store"
import type { InsertionReadinessResponse } from "@/lib/alt-text/document-approval-contract"
import { getSettings } from "@/lib/alt-text/store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request, ctx: { params: Promise<{ uploadId: string }> }) {
  const gate = await gateAltTextHistory()
  if (!gate.ok) return gate.response
  const paging = parsePaging(new URL(req.url).searchParams, 100, 500)
  if (!paging.ok) return paging.response
  try {
    const limited = await rateLimited("readiness", gate.actor, { max: 30, windowMs: 60_000 })
    if (limited) return limited
    const doc = await resolveDocument((await ctx.params).uploadId, gate.actor)
    if (!doc.ok) return doc.response
    const { shortMaxChars } = await getSettings()
    const result = await listInsertionReadiness(doc.id, { limit: paging.pageSize, offset: (paging.page - 1) * paging.pageSize }, { shortMaxChars })
    const body: InsertionReadinessResponse = { success: true, documentId: doc.id, page: paging.page, pageSize: paging.pageSize, ...result }
    return jsonOk(body)
  } catch (err) {
    return unexpected("documents/insertion-readiness", err)
  }
}
