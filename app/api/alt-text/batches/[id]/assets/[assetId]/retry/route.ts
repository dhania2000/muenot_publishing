/**
 * @file app/api/alt-text/batches/[id]/assets/[assetId]/retry/route.ts
 * @summary POST — re-queue one retry-eligible failed image on the batch's existing job (Phase 2 Task 14).
 */
import type { NextRequest } from "next/server"
import { handleBatchRetry } from "@/lib/alt-text/batch-control-route"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export function POST(_req: NextRequest, ctx: { params: Promise<{ id: string; assetId: string }> }) {
  return handleBatchRetry(ctx)
}
