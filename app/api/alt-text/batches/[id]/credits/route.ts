/**
 * @file app/api/alt-text/batches/[id]/credits/route.ts
 * @module Publishing · Alt Text
 * @kind API route handler
 * @summary GET /api/alt-text/batches/[id]/credits — read-only AI credit usage attributable to one
 *   batch via its deterministic reservation request ids (Phase 3 Task 13). Never reserves or settles.
 * @security Session + publishing module + publishing.alt_text:view + batch visibility; non-`all`
 *   viewers only see their own reservations. No tenant balance is returned.
 */
import type { NextRequest } from "next/server"
import { checkRateLimit } from "@/lib/rate-limit"
import { currentTenantIdOrNull } from "@/lib/tenant-scope"
import { readBatchCreditUsage } from "@/lib/alt-text/document-processing"
import { gateAltTextHistory, jsonError, jsonOk, unexpected } from "@/lib/alt-text/route-gate"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const RATE_LIMIT = { max: 30, windowMs: 60_000 }

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await gateAltTextHistory()
  if (!gate.ok) return gate.response
  const { id } = await ctx.params
  try {
    const limit = await checkRateLimit(`alt-text-batch-credits:${currentTenantIdOrNull()}:${gate.actor.userId}`, RATE_LIMIT)
    if (!limit.allowed) {
      const res = jsonError({ status: 429, code: "RATE_LIMITED", error: "Too many requests." })
      res.headers.set("Retry-After", String(limit.retryAfter))
      return res
    }
    const result = await readBatchCreditUsage(id, gate.actor)
    return result.ok ? jsonOk(result.body) : jsonError(result)
  } catch (err) {
    return unexpected("batches/credits", err)
  }
}
