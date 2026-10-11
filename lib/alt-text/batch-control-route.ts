/**
 * @file lib/alt-text/batch-control-route.ts
 * @module Publishing · Alt Text
 * @kind Route helper
 * @summary Shared gate for POST /api/alt-text/batches/[id]/{pause,resume,cancel,retry-failed} and assets/[assetId]/retry.
 * @security Session + publishing module + publishing.view_alt_text + publishing.alt_text:generate grant + view/update scope (same as submit).
 */
import "server-only"
import { NextResponse } from "next/server"
import { requireFeatureInModule } from "@/lib/api-auth"
import { getScope, hasActionGrant } from "@/lib/permission-store"
import { checkRateLimit } from "@/lib/rate-limit"
import { currentTenantIdOrNull } from "@/lib/tenant-scope"
import { controlBatch, type ControlAction } from "./batch-control"
import { retryBatchFailures } from "./batch-retry"
import type { BatchActor } from "./batch-submission"
import { unexpected } from "./route-gate"

const NO_STORE = { "Cache-Control": "private, no-store" }
const RATE_LIMIT = { max: 30, windowMs: 60_000 }
const BATCH_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const error = (status: number, code: string, message: string, extra?: Record<string, unknown>, headers?: HeadersInit) =>
  NextResponse.json({ success: false, error: message, code, ...(extra ?? {}) }, { status, headers: { ...NO_STORE, ...(headers ?? {}) } })

type Outcome = { ok: true; body: unknown } | { ok: false; status: number; code: string; error: string; details?: Record<string, unknown> }

/** Session, module, generate grant, view/update scope, tenant and rate limit — shared by every batch mutation. */
async function withBatchActor(
  ctx: { params: Promise<{ id: string }> },
  opts: { label: string; rateKey: string; rateLimit?: { max: number; windowMs: number } },
  run: (batchId: string, actor: BatchActor) => Promise<Outcome>,
) {
  const gate = await requireFeatureInModule("publishing", "publishing.view_alt_text")
  if (!gate.ok) return error(gate.status, "code" in gate ? gate.code : gate.status === 401 ? "UNAUTHENTICATED" : gate.status === 404 ? "NOT_FOUND" : "FORBIDDEN", gate.error)
  const { session } = gate
  const tenantId = currentTenantIdOrNull()
  if (tenantId == null) return error(403, "FORBIDDEN", "No tenant in context")

  const { id } = await ctx.params
  if (!BATCH_ID.test(id)) return error(404, "NOT_FOUND", "Batch not found.")

  try {
    if (session.role !== "admin" && !(await hasActionGrant(session.userId, session.role, "publishing.alt_text", "generate"))) {
      return error(403, "FORBIDDEN", "You do not have permission to manage alt text batches.")
    }
    if ((await getScope(session.userId, session.role, "publishing.alt_text", "view")) === "none") return error(403, "FORBIDDEN", "You do not have permission to view images.")
    const updateScope = await getScope(session.userId, session.role, "publishing.alt_text", "update")
    if (updateScope === "none") return error(403, "FORBIDDEN", "You do not have permission to change alt text.")

    const limit = await checkRateLimit(`${opts.rateKey}:${tenantId}:${session.userId}`, opts.rateLimit ?? RATE_LIMIT)
    if (!limit.allowed) return error(429, "RATE_LIMITED", "Too many requests. Please wait and try again.", undefined, { "Retry-After": String(limit.retryAfter) })

    const result = await run(id, { userId: session.userId, tenantId, role: session.role === "admin" ? "admin" : "employee", updateScope })
    if (!result.ok) return error(result.status, result.code, result.error, result.details)
    return NextResponse.json(result.body, { status: 200, headers: NO_STORE })
  } catch (err) {
    return unexpected(`batches/${opts.label}`, err)
  }
}

export function handleBatchControl(action: ControlAction, ctx: { params: Promise<{ id: string }> }) {
  return withBatchActor(ctx, { label: action, rateKey: "alt-text-batch-control" }, (id, actor) => controlBatch(id, action, actor))
}

const RETRY_RATE_LIMIT = { max: 20, windowMs: 60_000 }
const ASSET_ID = /^\d{1,15}$/

/** POST retry-failed (whole batch) or assets/[assetId]/retry (one image). */
export async function handleBatchRetry(ctx: { params: Promise<{ id: string; assetId?: string }> }) {
  const { assetId: rawAssetId } = await ctx.params
  let assetId: number | undefined
  if (rawAssetId !== undefined) {
    assetId = ASSET_ID.test(rawAssetId) ? Number(rawAssetId) : NaN
    if (!Number.isSafeInteger(assetId) || assetId <= 0) return error(404, "NOT_FOUND", "Image not found.")
  }
  return withBatchActor(ctx, { label: assetId ? "asset-retry" : "retry-failed", rateKey: "alt-text-batch-retry", rateLimit: RETRY_RATE_LIMIT }, (id, actor) =>
    retryBatchFailures(id, actor, { assetId }),
  )
}
