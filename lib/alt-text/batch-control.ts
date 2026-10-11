/**
 * @file lib/alt-text/batch-control.ts
 * @module Publishing · Alt Text
 * @kind Server-side library
 * @summary Phase 2 Task 13 — Pause / Resume / Cancel for bulk alt-text batches.
 * @usedBy app/api/alt-text/batches/[id]/{pause,resume,cancel}/route.ts
 *
 * Guarantees:
 * - The persisted batch row is the only source of truth; workers read it before every claim.
 * - No new jobs: resume wakes the batch's existing durable job (same idempotency key).
 * - In-flight provider calls are never aborted; requested states converge once live claims settle.
 * - Cancel wins over pause; a cancelled batch can never resume. Repeats are idempotent.
 */
import "server-only"
import { AiError } from "@/lib/ai/governance-core"
import { ALT_TEXT_BATCH_JOB_TYPE, altTextBatchIdempotencyKey } from "./batch-job"
import { resolveBatchModel, type BatchActor } from "./batch-submission"
import { aiErrorToFailure } from "./generate"
import { getBatch, requestBatchControl, resumeBatch, settleBatchControl, type BatchStatus } from "./store"

export type ControlAction = "pause" | "resume" | "cancel"
export type ControlFailure = { ok: false; status: number; code: string; error: string; details?: Record<string, unknown> }
export type ControlSuccess = { ok: true; body: { success: true; batchId: string; action: ControlAction; status: BatchStatus; changed: boolean } }

const fail = (status: number, code: string, error: string, details?: Record<string, unknown>): ControlFailure => ({ ok: false, status, code, error, details })
const ok = (batchId: string, action: ControlAction, status: BatchStatus, changed: boolean): ControlSuccess => ({ ok: true, body: { success: true, batchId, action, status, changed } })

export type ControlDeps = { resolveModel?: (actor: BatchActor) => Promise<unknown> }

export async function controlBatch(batchId: string, action: ControlAction, actor: BatchActor, deps: ControlDeps = {}): Promise<ControlSuccess | ControlFailure> {
  const batch = await getBatch(batchId)
  if (!batch) return fail(404, "NOT_FOUND", "Batch not found.")
  if (actor.updateScope === "own" && batch.createdBy !== actor.userId && batch.submittedBy !== actor.userId) return fail(404, "NOT_FOUND", "Batch not found.")

  if (action === "resume") {
    if (batch.status === "cancelled" || batch.status === "cancel_requested") return fail(409, "BATCH_CANCELLED", "A cancelled batch cannot be resumed.", { status: batch.status })
    if (batch.status !== "paused" && batch.status !== "pause_requested" && batch.status !== "queued" && batch.status !== "processing") {
      return fail(409, "BATCH_NOT_RESUMABLE", "Only paused batches can be resumed.", { status: batch.status })
    }
    try {
      await (deps.resolveModel ?? resolveBatchModel)(actor)
    } catch (err) {
      if (err instanceof AiError) {
        const f = aiErrorToFailure(err)
        return fail(f.status, f.code, f.error, f.details)
      }
      throw err
    }
    const res = await resumeBatch(batchId, { type: ALT_TEXT_BATCH_JOB_TYPE, idempotencyKey: altTextBatchIdempotencyKey(batchId) })
    if (res.state === "not_found") return fail(404, "NOT_FOUND", "Batch not found.")
    if (res.state === "job_unavailable") return fail(409, "JOB_UNAVAILABLE", "This batch's processing job has ended and cannot be resumed.")
    if (res.state === "not_eligible") return fail(409, "BATCH_NOT_RESUMABLE", "Only paused batches can be resumed.", { status: res.status })
    return ok(batchId, action, res.status, res.state === "changed")
  }

  const res = await requestBatchControl(batchId, action)
  if (res.state === "not_found") return fail(404, "NOT_FOUND", "Batch not found.")
  if (res.state === "not_eligible") {
    return action === "pause" && (res.status === "cancel_requested" || res.status === "cancelled")
      ? fail(409, "BATCH_CANCELLED", "This batch is being cancelled and cannot be paused.", { status: res.status })
      : fail(409, "BATCH_NOT_ACTIVE", `This batch can no longer be ${action === "pause" ? "paused" : "cancelled"}.`, { status: res.status })
  }
  // Converge immediately when nothing is in flight; otherwise the worker finishes the transition.
  const settled = await settleBatchControl(batchId)
  return ok(batchId, action, settled?.status ?? res.status, res.state === "changed")
}
