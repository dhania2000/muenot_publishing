/**
 * @file app/api/alt-text/batches/[id]/export/route.ts
 * @module Publishing · Alt Text
 * @kind API route handler
 * @summary GET /api/alt-text/batches/:id/export?format=csv|txt|json|xlsx&scope=completed — bulk download of saved alt text (xlsx: five-sheet workbook of all batch images).
 * @security See lib/alt-text/route-gate.ts; additionally requires publishing.alt_text:export and batch ownership.
 */
import type { NextRequest } from "next/server"
import { exportBatchAltText, parseBatchExportQuery } from "@/lib/alt-text/batch-export"
import { gateAltTextHistory, jsonError, unexpected } from "@/lib/alt-text/route-gate"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await gateAltTextHistory({ export: true })
  if (!gate.ok) return gate.response
  const { id } = await ctx.params
  const parsed = parseBatchExportQuery(id, req.nextUrl.searchParams)
  if (!parsed.ok) return jsonError(parsed)
  try {
    const result = await exportBatchAltText(parsed.value, gate.actor)
    if (!result.ok) return jsonError(result)
    const { body, contentType, filename } = result.file
    return new Response(body as BodyInit, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Export-Count": String(result.count),
      },
    })
  } catch (err) {
    return unexpected("batch-export", err)
  }
}
