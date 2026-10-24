/**
 * @file app/api/alt-text/documents/[uploadId]/extract/route.ts
 * @module Publishing · Alt Text
 * @kind API route handler
 * @summary POST /api/alt-text/documents/:id/extract — kept for compatibility. Since Phase 3 Task 11 it
 *   enqueues the same durable preparation job as POST /process instead of extracting synchronously,
 *   so there is a single processing path. Responds 202 with the preparation progress.
 * @security Session + publishing module + publishing.alt_text:view + :upload; tenant-scoped,
 *   owner-only unless view scope is `all`; per-user rate limit; clean security verdict re-checked server-side.
 */
import { gateAltTextHistory } from "@/lib/alt-text/route-gate"
import { handleStartPreparation } from "@/lib/alt-text/document-preparation-route"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function POST(_req: Request, ctx: { params: Promise<{ uploadId: string }> }) {
  const gate = await gateAltTextHistory({ upload: true })
  if (!gate.ok) return gate.response
  return handleStartPreparation(gate.actor, (await ctx.params).uploadId, "documents/extract")
}
