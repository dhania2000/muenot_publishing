/**
 * @file app/api/alt-text/documents/[uploadId]/process/route.ts
 * @module Publishing · Alt Text
 * @kind API route handler
 * @summary Phase 3 Task 11 — durable document preparation (extraction → mapping → context → AI readiness).
 *   POST   enqueue (or reuse) the preparation job; returns 202 once the queue accepted it.
 *   DELETE request cancellation; a running job stops at its next stage checkpoint.
 *   Progress is read from GET /api/alt-text/documents/:id (`preparation`). Runs no AI generation.
 * @security Session + publishing module + publishing.alt_text:view + :upload; tenant-scoped,
 *   owner-only unless view scope is `all`; per-user rate limit on enqueue.
 */
import { gateAltTextHistory } from "@/lib/alt-text/route-gate"
import { handleCancelPreparation, handleStartPreparation } from "@/lib/alt-text/document-preparation-route"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

type Ctx = { params: Promise<{ uploadId: string }> }

export async function POST(_req: Request, ctx: Ctx) {
  const gate = await gateAltTextHistory({ upload: true })
  if (!gate.ok) return gate.response
  return handleStartPreparation(gate.actor, (await ctx.params).uploadId, "documents/process")
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const gate = await gateAltTextHistory({ upload: true })
  if (!gate.ok) return gate.response
  return handleCancelPreparation(gate.actor, (await ctx.params).uploadId)
}
