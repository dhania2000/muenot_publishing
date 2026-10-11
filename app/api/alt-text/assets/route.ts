/**
 * @file app/api/alt-text/assets/route.ts
 * @module Publishing · Alt Text
 * @kind API route handler
 * @summary GET /api/alt-text/assets — paginated, tenant- and record-scoped Alt Text history.
 * @security See lib/alt-text/route-gate.ts.
 */
import type { NextRequest } from "next/server"
import { listHistory, parseListQuery } from "@/lib/alt-text/history"
import { gateAltTextHistory, jsonError, jsonOk, unexpected } from "@/lib/alt-text/route-gate"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const gate = await gateAltTextHistory()
  if (!gate.ok) return gate.response
  const parsed = parseListQuery(req.nextUrl.searchParams)
  if (!parsed.ok) return jsonError(parsed)
  try {
    const result = await listHistory(parsed.value, gate.actor)
    return result.ok ? jsonOk(result.body) : jsonError(result)
  } catch (err) {
    return unexpected("assets", err)
  }
}
