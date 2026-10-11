/**
 * @file app/api/alt-text/assets/[id]/image/route.ts
 * @module Publishing · Alt Text
 * @kind API route handler
 * @summary GET /api/alt-text/assets/[id]/image — streams a tenant-scoped, scan-cleared private image.
 * @security Session + publishing module toggle/plan + publishing.view_alt_text + publishing.alt_text:view record scope.
 */
import { NextResponse, type NextRequest } from "next/server"
import { requireFeatureInModule } from "@/lib/api-auth"
import { getScope } from "@/lib/permission-store"
import { currentTenantIdOrNull } from "@/lib/tenant-scope"
import { openAltTextImage } from "@/lib/alt-text/preview"

export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" }

const error = (status: number, code: string, message: string) =>
  NextResponse.json({ success: false, error: message, code }, { status, headers: NO_STORE })

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params
  if (!/^\d{1,15}$/.test(rawId) || Number(rawId) <= 0) return error(400, "INVALID_ID", "Invalid asset identifier.")
  const id = Number(rawId)

  const gate = await requireFeatureInModule("publishing", "publishing.view_alt_text")
  if (!gate.ok) return error(gate.status, "code" in gate ? gate.code : gate.status === 401 ? "UNAUTHENTICATED" : gate.status === 404 ? "NOT_FOUND" : "FORBIDDEN", gate.error)
  const { session } = gate

  const tenantId = currentTenantIdOrNull()
  if (tenantId == null) return error(403, "FORBIDDEN", "No tenant in context")

  try {
    const scope = await getScope(session.userId, session.role, "publishing.alt_text", "view")
    if (scope === "none") return error(403, "FORBIDDEN", "You do not have permission to view images.")

    const result = await openAltTextImage(id, { userId: session.userId, tenantId, scope })
    if (!result.ok) return error(result.status, result.code, result.error)

    const headers: Record<string, string> = {
      ...NO_STORE,
      "Content-Type": result.contentType,
      "Content-Disposition": `inline; filename="${result.filename}"`,
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Referrer-Policy": "no-referrer",
    }
    if (result.size != null) headers["Content-Length"] = String(result.size)
    return new Response(result.body as BodyInit, { status: 200, headers })
  } catch (err) {
    console.error("[alt-text/image] unexpected failure", err instanceof Error ? err.name : "unknown")
    return error(500, "PREVIEW_FAILED", "The image could not be loaded. Please try again.")
  }
}
