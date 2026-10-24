/**
 * @file app/api/alt-text/documents/[uploadId]/original/route.ts
 * @module Publishing · Alt Text
 * @kind API route handler
 * @summary Phase 3 Task 19 — streams the stored original document as an attachment.
 *   Bytes are re-verified (file ref, tenant key, clean scan, size, checksum) before serving.
 * @security Session + publishing module + publishing.alt_text:export; tenant + owner scoped;
 *   never cached; no storage keys or signed URLs are exposed. Downloads are logged server-side
 *   (no persisted audit table exists for document downloads yet).
 */
import { NextResponse } from "next/server"
import { gateAltTextHistory, jsonError, unexpected } from "@/lib/alt-text/route-gate"
import { notFound, rateLimited, resolveDocument } from "@/lib/alt-text/document-review-route"
import { ownerScopeFor } from "@/lib/alt-text/document-service"
import { getDocument } from "@/lib/alt-text/document-store"
import { readVerifiedOriginal } from "@/lib/alt-text/document-extraction-run"
import { ALT_TEXT_UPLOAD_MAX_MB } from "@/lib/alt-text/upload"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]+/g, "_").replace(/["\\]/g, "_")
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

export async function GET(_req: Request, ctx: { params: Promise<{ uploadId: string }> }) {
  const gate = await gateAltTextHistory({ export: true })
  if (!gate.ok) return gate.response
  const { uploadId } = await ctx.params
  try {
    const limited = await rateLimited("original-download", gate.actor, { max: 20, windowMs: 60_000 })
    if (limited) return limited
    const resolved = await resolveDocument(uploadId, gate.actor)
    if (!resolved.ok) return resolved.response
    const doc = await getDocument(resolved.id, ownerScopeFor(gate.actor))
    if (!doc) return notFound()
    const file = await readVerifiedOriginal(doc, ALT_TEXT_UPLOAD_MAX_MB * 1024 * 1024)
    if (!file.ok) return jsonError(file)
    console.info("[alt-text/download-audit]", JSON.stringify({ kind: "original", documentId: doc.id, userId: gate.actor.userId }))
    return new NextResponse(new Uint8Array(file.bytes), {
      status: 200,
      headers: {
        "Content-Type": doc.mimeType || "application/octet-stream",
        "Content-Length": String(file.bytes.length),
        "Content-Disposition": contentDisposition(doc.filename),
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (err) {
    return unexpected("documents/original-download", err)
  }
}
