/**
 * @file app/api/alt-text/batches/[id]/assets/route.ts
 * @module Publishing · Alt Text
 * @kind API route handler
 * @summary GET /api/alt-text/batches/[id]/assets — paginated per-image processing status (Phase 2 Task 11). Read-only.
 * @security Session + publishing module toggle/plan + publishing.view_alt_text + publishing.alt_text:view scope (applied per asset) + tenant/batch ownership.
 */
import type { NextRequest } from "next/server"
import { checkRateLimit } from "@/lib/rate-limit"
import { currentTenantIdOrNull } from "@/lib/tenant-scope"
import { parseBatchAssetsQuery, readBatchAssets } from "@/lib/alt-text/batch-progress"
import { gateAltTextHistory, jsonError, jsonOk, unexpected } from "@/lib/alt-text/route-gate"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const RATE_LIMIT = { max: 60, windowMs: 60_000 }

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await gateAltTextHistory()
  if (!gate.ok) return gate.response
  const { id } = await ctx.params
  const q = parseBatchAssetsQuery(req.nextUrl.searchParams)
  if (!q.ok) return jsonError(q)
  try {
    const limit = await checkRateLimit(`alt-text-batch-assets:${currentTenantIdOrNull()}:${gate.actor.userId}`, RATE_LIMIT)
    if (!limit.allowed) {
      const res = jsonError({ status: 429, code: "RATE_LIMITED", error: "Too many requests. Please slow down polling." })
      res.headers.set("Retry-After", String(limit.retryAfter))
      return res
    }
    const result = await readBatchAssets(id, q.value, gate.actor)
    return result.ok ? jsonOk(result.body) : jsonError(result)
  } catch (err) {
    return unexpected("batches/assets", err)
  }
}
