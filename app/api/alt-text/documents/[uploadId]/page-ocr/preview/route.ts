import { NextResponse } from "next/server"
import { gateAltTextHistory, jsonError, unexpected } from "@/lib/alt-text/route-gate"
import { getDocumentForExtraction, ownerScopeFor } from "@/lib/alt-text/document-service"
import { readVerifiedOriginal } from "@/lib/alt-text/document-extraction-run"
import { ALT_TEXT_UPLOAD_MAX_MB } from "@/lib/alt-text/upload"
import { openPdfForRender } from "@/lib/alt-text/pdf-page-renderer"
import { readOcrPages } from "@/lib/alt-text/pdf-page-ocr-store"
import { checkRateLimit } from "@/lib/rate-limit"
import { currentTenantId } from "@/lib/tenant-scope"
import { sourceHash } from "@/lib/alt-text/pdf-page-ocr-pipeline"
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60
/** A user opens this preview explicitly. History/status GET requests never render a page. */
export async function GET(req: Request, ctx: { params: Promise<{ uploadId: string }> }) {
  const gate = await gateAltTextHistory()
  if (!gate.ok) return gate.response
  try {
    const id = (await ctx.params).uploadId, rawPage = new URL(req.url).searchParams.get("pageIndex"), pageIndex = rawPage == null ? NaN : Number(rawPage)
    const doc = /^[1-9]\d{0,9}$/.test(id) ? await getDocumentForExtraction(Number(id), ownerScopeFor(gate.actor)) : null
    if (!doc || doc.documentType !== "pdf" || doc.securityStatus !== "clean") return jsonError({ status: 404, code: "NOT_FOUND", error: "The cleared PDF could not be found." })
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= 500) return jsonError({ status: 404, code: "INVALID_PAGE", error: "That page does not exist." })
    const [page] = await readOcrPages(doc.id, 0, 1, pageIndex)
    if (!page) return jsonError({ status: 404, code: "INVALID_PAGE", error: "That page does not exist." })
    if (page.status === "unsupported") return jsonError({ status: 422, code: "PAGE_LIMIT", error: "The page exceeds supported render limits." })
    const limit = await checkRateLimit(`pdf-page-preview:${currentTenantId()}:${gate.actor.userId}`, { max: 10, windowMs: 60_000 })
    if (!limit.allowed) return jsonError({ status: 429, code: "RATE_LIMITED", error: "Please wait before opening more previews." })
    const original = await readVerifiedOriginal(doc, ALT_TEXT_UPLOAD_MAX_MB * 1024 * 1024)
    if (!original.ok) return jsonError(original)
    if (sourceHash(original.bytes) !== page.sourceSha256) return jsonError({ status: 409, code: "SOURCE_VERSION_MISMATCH", error: "The PDF source version changed. Inspect it again." })
    const handle = await openPdfForRender(original.bytes)
    try {
      const raster = await handle.renderPage(pageIndex + 1, { targetDpi: 150 })
      return new NextResponse(new Uint8Array(raster.png), { headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } })
    } finally { await handle.destroy() }
  } catch (err) { return unexpected("page-ocr/preview", err) }
}
