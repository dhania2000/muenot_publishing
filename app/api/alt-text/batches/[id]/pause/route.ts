/**
 * @file app/api/alt-text/batches/[id]/pause/route.ts
 * @summary POST — persist Pause Requested; the worker settles to Paused after in-flight images finish.
 */
import type { NextRequest } from "next/server"
import { handleBatchControl } from "@/lib/alt-text/batch-control-route"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handleBatchControl("pause", ctx)
}
