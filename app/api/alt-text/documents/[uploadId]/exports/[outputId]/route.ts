/**
 * @file app/api/alt-text/documents/[uploadId]/exports/[outputId]/route.ts
 * @module Publishing · Alt Text
 * @kind API route handler
 * @summary Phase 3 Task 15 — streams a completed accessible DOCX export as an attachment.
 * @security Session + publishing module + publishing.alt_text:export; tenant + owner scoped;
 *   the storage key must belong to the current tenant. Never cached.
 */
import { NextResponse } from "next/server"
import { gateAltTextHistory, jsonError, unexpected } from "@/lib/alt-text/route-gate"
import { notFound, rateLimited, resolveDocument } from "@/lib/alt-text/document-review-route"
import { readDocxExportFile } from "@/lib/alt-text/docx-export-service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]+/g, "_").replace(/["\\]/g, "_")
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

export async function GET(_req: Request, ctx: { params: Promise<{ uploadId: string; outputId: string }> }) {
  const gate = await gateAltTextHistory({ export: true })
  if (!gate.ok) return gate.response
  const { uploadId, outputId } = await ctx.params
  if (!UUID.test(outputId)) return notFound("export")
  try {
    const limited = await rateLimited("export-download", gate.actor, { max: 30, windowMs: 60_000 })
    if (limited) return limited
    const doc = await resolveDocument(uploadId, gate.actor)
    if (!doc.ok) return doc.response
    const file = await readDocxExportFile(doc.id, outputId, gate.actor)
    if (!file.ok) return jsonError(file)
    return new NextResponse(new Uint8Array(file.body), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Length": String(file.body.length),
        "Content-Disposition": contentDisposition(file.filename),
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (err) {
    return unexpected("documents/export-download", err)
  }
}
