/**
 * @file app/api/alt-text/export/route.ts
 * @module Publishing · Alt Text
 * @kind API route handler
 * @summary GET /api/alt-text/export?assetId=&format=txt|csv|json — download the latest saved alt text of one asset.
 * @security See lib/alt-text/route-gate.ts; additionally requires publishing.alt_text:export.
 */
import type { NextRequest } from "next/server"
import { exportAltText, parseExportQuery } from "@/lib/alt-text/export"
import { gateAltTextHistory, jsonError, unexpected } from "@/lib/alt-text/route-gate"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const gate = await gateAltTextHistory({ export: true })
  if (!gate.ok) return gate.response
  const parsed = parseExportQuery(req.nextUrl.searchParams)
  if (!parsed.ok) return jsonError(parsed)
  try {
    const result = await exportAltText(parsed.value, gate.actor)
    if (!result.ok) return jsonError(result)
    const { body, contentType, filename } = result.file
    return new Response(body, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (err) {
    return unexpected("export", err)
  }
}
