/**
 * @file lib/alt-text/document-preparation-route.ts
 * @module Publishing · Alt Text
 * @kind Server-side library (route helpers)
 * @summary Phase 3 Task 11 — shared start/cancel handlers for durable document preparation, used by
 *   POST/DELETE /documents/:id/process and the legacy POST /documents/:id/extract (which now enqueues
 *   the same job instead of running a competing synchronous extraction).
 * @security Caller must pass a gate result from gateAltTextHistory({ upload: true }). Ownership is
 *   re-checked via the owner scope; security verdict is re-checked server-side before enqueue.
 */
import "server-only"
import { after, NextResponse } from "next/server"
import { runDueBackgroundJobs } from "@/lib/background-jobs"
import { checkRateLimit } from "@/lib/rate-limit"
import { currentTenantId } from "@/lib/tenant-scope"
import type { HistoryActor } from "./history"
import { cancelDocumentPreparation, getDocumentPreparationProgress, startDocumentPreparation } from "./document-preparation-job"
import { getDocumentForExtraction, ownerScopeFor } from "./document-service"
import { jsonError, jsonOk, unexpected } from "./route-gate"

const NO_STORE = { "Cache-Control": "private, no-store" }
const DOCUMENT_ID = /^[1-9]\d{0,9}$/
const RATE_LIMIT = { max: 10, windowMs: 60_000 }
const notFound = () => jsonError({ status: 404, code: "NOT_FOUND", error: "The document could not be found." })

/** Kick the shared worker after the response; the scheduled cron remains the durable fallback. */
const kickWorker = () =>
  after(() => runDueBackgroundJobs({ maxJobs: 1 }).catch((e) => console.error("[jobs] post-enqueue run failed", e instanceof Error ? e.message : e)))

export async function handleStartPreparation(actor: HistoryActor, rawId: string, where: string) {
  if (!DOCUMENT_ID.test(rawId)) return notFound()
  try {
    const limit = await checkRateLimit(`alt-text-document-prepare:${currentTenantId()}:${actor.userId}`, RATE_LIMIT)
    if (!limit.allowed) return jsonError({ status: 429, code: "RATE_LIMITED", error: "Too many processing requests. Please wait and try again." })
    const doc = await getDocumentForExtraction(Number(rawId), ownerScopeFor(actor))
    if (!doc) return notFound()
    const result = await startDocumentPreparation(doc, actor.userId)
    if (!result.ok) return jsonError({ status: result.status, code: result.code, error: result.error })
    if (result.created) kickWorker()
    const preparation = await getDocumentPreparationProgress(doc.id)
    return NextResponse.json({ success: true, jobId: result.jobId, created: result.created, preparation }, { status: 202, headers: NO_STORE })
  } catch (err) {
    return unexpected(where, err)
  }
}

export async function handleCancelPreparation(actor: HistoryActor, rawId: string) {
  if (!DOCUMENT_ID.test(rawId)) return notFound()
  try {
    const doc = await getDocumentForExtraction(Number(rawId), ownerScopeFor(actor))
    if (!doc) return notFound()
    const { result, jobId } = await cancelDocumentPreparation(doc.id)
    if (result === "not_active") return jsonError({ status: 409, code: "NOT_ACTIVE", error: "There is no active processing job for this document." })
    const preparation = await getDocumentPreparationProgress(doc.id)
    return jsonOk({ success: true, result, jobId, preparation })
  } catch (err) {
    return unexpected("documents/process-cancel", err)
  }
}
