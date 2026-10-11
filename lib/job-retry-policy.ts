/**
 * @file lib/job-retry-policy.ts
 * @module Background Jobs
 * @kind Server-side library
 * @summary Background Jobs domain logic (FailureKind, classifyJobFailure, retryDisposition).
 * @exports FailureKind, classifyJobFailure, retryDisposition
 * @usedBy lib/background-jobs.ts, lib/notification-engine/service.ts, lib/scheduler.ts; 2 test files
 * @see docs/CODEBASE-GUIDE.md for module ownership, conventions and where to add new code.
 */
export type FailureKind = "transient" | "permanent" | "uncertain"
export function classifyJobFailure(error: unknown, timedOut = false): FailureKind {
  if (timedOut) return "uncertain"
  const e = (error && typeof error === "object" ? error : {}) as Record<string, unknown>
  const code = String(e.code ?? "")
  const status = Number(e.status ?? e.responseCode ?? 0)
  // A dropped connection or timeout may occur after remote acceptance.
  if (["ETIMEDOUT", "ESOCKET", "ECONNRESET", "EPIPE"].includes(code) || e.name === "AbortError") return "uncertain"
  // SMTP 4xx means temporary rejection; 5xx means permanent rejection.
  // Check numeric SMTP response before broad transport error codes.
  if (e.responseCode != null && status >= 400 && status < 600) return status < 500 ? "transient" : "permanent"
  if (["EAUTH", "EENVELOPE", "EMESSAGE"].includes(code)) return "permanent"
  if (status >= 400 && status < 500 && status !== 429) return "permanent"
  if (["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"].includes(code) || status === 429 || status >= 500 && status < 600) return "transient"
  return "uncertain"
}
/**
 * Thrown by a handler that ran safely but cannot make progress yet (e.g. its
 * downstream processor is not deployed). The queue returns the job to `queued`
 * after `delaySeconds` without consuming a retry attempt or marking completion.
 */
export class JobDeferredError extends Error {
  readonly delaySeconds: number
  constructor(readonly code: string, delaySeconds: number) {
    super(code)
    this.name = "JobDeferredError"
    this.delaySeconds = Math.min(3600, Math.max(30, Math.floor(delaySeconds)))
  }
}

export function retryDisposition(kind: FailureKind, attempts: number, maxAttempts: number): "queued" | "dead_letter" {
  return kind === "transient" && attempts < maxAttempts ? "queued" : "dead_letter"
}
