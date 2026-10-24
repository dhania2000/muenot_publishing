/**
 * @file app/api/alt-text/documents/[uploadId]/history/images/route.ts
 * @module Publishing · Alt Text
 * @kind API route handler
 * @summary Phase 3 Task 19 — paginated occurrence picker for per-image version history.
 * @security Session + publishing module + publishing.alt_text:view; tenant + owner scoped.
 */
import { gateAltTextHistory, jsonOk, unexpected } from "@/lib/alt-text/route-gate"
import { rateLimited, resolveDocument } from "@/lib/alt-text/document-review-route"
import { listOccurrenceOptions } from "@/lib/alt-text/document-history-store"
import type { OccurrenceOptionsResponse } from "@/lib/alt-text/document-history-contract"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request, ctx: { params: Promise<{ uploadId: string }> }) {
  const gate = await gateAltTextHistory()
  if (!gate.ok) return gate.response
  const { uploadId } = await ctx.params
  const rawPage = new URL(req.url).searchParams.get("page") ?? "1"
  const page = /^[1-9]\d{0,5}$/.test(rawPage) ? Number(rawPage) : 1
  try {
    const limited = await rateLimited("history-read", gate.actor, { max: 60, windowMs: 60_000 })
    if (limited) return limited
    const doc = await resolveDocument(uploadId, gate.actor)
    if (!doc.ok) return doc.response
    const { items, total, pageSize } = await listOccurrenceOptions(doc.id, page)
    const body: OccurrenceOptionsResponse = { success: true, items, total, page, pageSize }
    return jsonOk(body)
  } catch (err) {
    return unexpected("documents/history-images", err)
  }
}
