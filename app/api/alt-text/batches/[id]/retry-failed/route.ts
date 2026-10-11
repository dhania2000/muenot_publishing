/**
 * @file app/api/alt-text/batches/[id]/retry-failed/route.ts
 * @summary POST — re-queue every retry-eligible failed image on the batch's existing job (Phase 2 Task 14).
 */
import type { NextRequest } from "next/server"
import { handleBatchRetry } from "@/lib/alt-text/batch-control-route"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handleBatchRetry(ctx)
}
