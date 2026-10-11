/**
 * @file app/api/alt-text/assets/[id]/versions/route.ts
 * @module Publishing · Alt Text
 * @kind API route handler
 * @summary GET /api/alt-text/assets/[id]/versions — append-only version history (latest 50) for one asset.
 * @security See lib/alt-text/route-gate.ts.
 */
import type { NextRequest } from "next/server"
import { parseAssetId, readVersions } from "@/lib/alt-text/history"
import { gateAltTextHistory, jsonError, jsonOk, unexpected } from "@/lib/alt-text/route-gate"

export const dynamic = "force-dynamic"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = parseAssetId((await params).id)
  if (id == null) return jsonError({ status: 400, code: "INVALID_ID", error: "Invalid asset identifier." })
  const gate = await gateAltTextHistory()
  if (!gate.ok) return gate.response
  try {
    const result = await readVersions(id, gate.actor)
    return result.ok ? jsonOk(result.body) : jsonError(result)
  } catch (err) {
    return unexpected("versions", err)
  }
}
