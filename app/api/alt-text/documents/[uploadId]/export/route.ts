/**
 * @file app/api/alt-text/documents/[uploadId]/export/route.ts
 * @module Publishing · Alt Text
 * @kind API route handler
 * @summary Phase 3 Task 15 — "Download Accessible Document" (DOCX).
 *   GET  preflight: readiness totals, approval snapshot, dry-run plan and recent exports. No writes.
 *   POST export: idempotent (idempotencyKey), single-flight per document, inserts approved alt text
 *        into a derived copy. The original document and its approvals are never modified.
 * @security Session + publishing module; GET needs alt_text:view, POST needs alt_text:export.
 *   Tenant + owner scoped.
 */
import { gateAltTextHistory, jsonError, jsonOk, unexpected } from "@/lib/alt-text/route-gate"
import { rateLimited, readJsonBody, resolveDocument } from "@/lib/alt-text/document-review-route"
import { parseDocxExportRequest } from "@/lib/alt-text/docx-export-contract"
import { getDocxExportPreflight, runDocxExport } from "@/lib/alt-text/docx-export-service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET(_req: Request, ctx: { params: Promise<{ uploadId: string }> }) {
  const gate = await gateAltTextHistory()
  if (!gate.ok) return gate.response
  try {
    const limited = await rateLimited("export-preflight", gate.actor, { max: 20, windowMs: 60_000 })
    if (limited) return limited
    const doc = await resolveDocument((await ctx.params).uploadId, gate.actor)
    if (!doc.ok) return doc.response
    const result = await getDocxExportPreflight(doc.id, gate.actor)
    if (!result.ok) return jsonError(result)
    return jsonOk(result.preflight)
  } catch (err) {
    return unexpected("documents/export-preflight", err)
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ uploadId: string }> }) {
  const gate = await gateAltTextHistory({ export: true })
  if (!gate.ok) return gate.response
  const body = await readJsonBody(req)
  if (!body.ok) return body.response
  const parsed = parseDocxExportRequest(body.body)
  if (!parsed.ok) return jsonError({ status: 400, code: "INVALID_REQUEST", error: parsed.error })
  try {
    const limited = await rateLimited("export", gate.actor, { max: 6, windowMs: 60_000 })
    if (limited) return limited
    const doc = await resolveDocument((await ctx.params).uploadId, gate.actor)
    if (!doc.ok) return doc.response
    const result = await runDocxExport(doc.id, gate.actor, parsed.request)
    if (!result.ok) return jsonError(result)
    return jsonOk(result.response)
  } catch (err) {
    return unexpected("documents/export", err)
  }
}
