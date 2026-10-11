/**
 * @file app/api/alt-text/batches/[id]/cancel/route.ts
 * @summary POST — persist Cancel Requested; unstarted images become cancelled, completed results are kept.
 */
import type { NextRequest } from "next/server"
import { handleBatchControl } from "@/lib/alt-text/batch-control-route"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handleBatchControl("cancel", ctx)
}
