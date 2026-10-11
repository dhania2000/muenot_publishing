/**
 * @file lib/observability/job-limits.ts
 * @module Observability
 * @kind Server-side library
 * @summary Observability domain logic (JobLimits, jobLimitsFromEnv, JobLimitError, jobLimitResponse, …).
 * @exports JobLimits, jobLimitsFromEnv, JobLimitError, jobLimitResponse, payloadBytes, assertEnqueueAllowed, selectClaimable
 * @usedBy app/api/bulk/[resource]/route.ts, app/api/sales/emails/bulk/route.ts, lib/background-jobs.ts; 1 test file
 * @see docs/CODEBASE-GUIDE.md for module ownership, conventions and where to add new code.
 */
/**
 * Spec49 (#17, #109): per-tenant background job limits enforced by the
 * existing durable queue (lib/background-jobs.ts). One tenant cannot flood the
 * queue (pending cap), monopolize workers (running cap) or store huge payloads.
 * Tenant 0 is platform/system work and is exempt from tenant caps.
 */

import { altTextConcurrencyFromEnv } from "@/lib/alt-text/concurrency"

export type JobLimits = { maxPayloadBytes: number; tenantMaxPending: number; tenantMaxRunning: number }

function envInt(value: string | undefined, fallback: number, min: number, max: number) {
  const n = Number(value)
  return Number.isFinite(n) && value !== undefined && value !== "" ? Math.min(max, Math.max(min, Math.floor(n))) : fallback
}

export function jobLimitsFromEnv(env: Record<string, string | undefined> = process.env): JobLimits {
  return {
    maxPayloadBytes: envInt(env.BACKGROUND_JOB_MAX_PAYLOAD_BYTES, 256 * 1024, 1024, 4 * 1024 * 1024),
    tenantMaxPending: envInt(env.BACKGROUND_JOB_TENANT_MAX_PENDING, 1000, 1, 100_000),
    tenantMaxRunning: envInt(env.BACKGROUND_JOB_TENANT_MAX_RUNNING, 3, 1, 50),
  }
}

export class JobLimitError extends Error {
  readonly status: 413 | 429
  constructor(readonly code: "JOB_PAYLOAD_TOO_LARGE" | "JOB_TENANT_QUEUE_FULL", message: string) {
    super(message)
    this.name = "JobLimitError"
    this.status = code === "JOB_PAYLOAD_TOO_LARGE" ? 413 : 429
  }
}

/** Uniform HTTP mapping for any route whose work is enqueued; null when not a limit error. */
export function jobLimitResponse(error: unknown): Response | null {
  if (!(error instanceof JobLimitError)) return null
  const headers: Record<string, string> = error.status === 429 ? { "Retry-After": "60" } : {}
  return Response.json({ error: error.message, code: error.code }, { status: error.status, headers })
}

export function payloadBytes(payload: unknown): number {
  return new TextEncoder().encode(JSON.stringify(payload ?? null)).length
}

export function assertEnqueueAllowed(input: { tenantId: number; payloadBytes: number; tenantPending: number }, limits: JobLimits): void {
  if (input.payloadBytes > limits.maxPayloadBytes) throw new JobLimitError("JOB_PAYLOAD_TOO_LARGE", `Job payload exceeds ${limits.maxPayloadBytes} bytes`)
  if (input.tenantId > 0 && input.tenantPending >= limits.tenantMaxPending) throw new JobLimitError("JOB_TENANT_QUEUE_FULL", "Tenant background job queue is full; retry later")
}

/**
 * Phase 2 Task 10: queue-wide running cap per job type (across all workers), checked in the
 * claim transaction. Null when the job type has no type-level cap.
 */
export function globalRunningCapFor(jobType: string, env: Record<string, string | undefined> = process.env): number | null {
  if (jobType === "alt_text.batch_processing") return altTextConcurrencyFromEnv(env).globalMaxConcurrency
  return null
}

/**
 * Pick which candidates may start this claim cycle given tenants' current
 * running counts. Candidates are pre-sorted by priority; skipped ones stay
 * queued for the next cycle so a busy tenant is delayed, never dropped.
 */
export function selectClaimable<T extends { tenant_id: number }>(candidates: T[], runningByTenant: Map<number, number>, limits: JobLimits): T[] {
  const counts = new Map(runningByTenant)
  const selected: T[] = []
  for (const job of candidates) {
    const tenant = Number(job.tenant_id)
    const running = counts.get(tenant) ?? 0
    if (tenant > 0 && running >= limits.tenantMaxRunning) continue
    counts.set(tenant, running + 1)
    selected.push(job)
  }
  return selected
}
