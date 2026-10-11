/**
 * @file app/api/alt-text/batches/[id]/resume/route.ts
 * @summary POST — clear a pause and wake the batch's existing durable job (remaining images only).
 */
import type { NextRequest } from "next/server"
import { handleBatchControl } from "@/lib/alt-text/batch-control-route"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handleBatchControl("resume", ctx)
}
