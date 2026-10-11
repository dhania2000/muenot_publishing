/**
 * @file lib/alt-text/retry-policy.ts
 * @module Publishing · Alt Text
 * @kind Server/client-safe library (pure)
 * @summary Phase 2 Task 14 — failed-image classification and manual retry eligibility.
 * @usedBy lib/alt-text/batch-retry.ts, lib/alt-text/batch-progress.ts
 *
 * Classification uses only the persisted `error_code` written alongside `error_message`.
 * Unknown or missing codes (legacy rows) require explicit review: retries are never assumed safe.
 */

export type FailureCategory = "transient" | "credits" | "configuration" | "permanent" | "needs_review"

const TRANSIENT = new Set(["PROVIDER_ERROR", "PROVIDER_TIMEOUT", "RATE_LIMITED", "STORAGE_UNAVAILABLE", "NETWORK_ERROR", "DATABASE_UNAVAILABLE", "JOB_INTERRUPTED", "INVALID_AI_RESPONSE"])
const CREDITS = new Set(["INSUFFICIENT_CREDITS", "DAILY_CAP_REACHED", "USER_LIMIT_REACHED", "DEPARTMENT_LIMIT_REACHED", "TENANT_BUDGET_EXCEEDED", "USER_BUDGET_EXCEEDED", "TOKEN_LIMIT_EXCEEDED", "PLATFORM_BUDGET_EXCEEDED"])
const CONFIGURATION = new Set(["AI_DISABLED", "AI_EMERGENCY_DISABLED", "AI_SUSPENDED", "FEATURE_DISABLED", "MODULE_NOT_ENTITLED", "NO_MODEL_AVAILABLE", "MODEL_NOT_ALLOWED", "PREMIUM_NOT_ALLOWED"])
const PERMANENT = new Set([
  "UNSUPPORTED_TYPE",
  "FILE_TOO_LARGE",
  "INVALID_SETTINGS",
  "INVALID_IMAGE",
  "CORRUPT_IMAGE",
  "NOT_FOUND",
  "FORBIDDEN",
  "PERMISSION_DENIED",
  "TENANT_MISMATCH",
  "UNSAFE_FILE",
  "QUARANTINED",
])

export const FAILURE_CATEGORY_LABELS: Record<FailureCategory, string> = {
  transient: "Temporary error",
  credits: "AI credits",
  configuration: "AI configuration",
  permanent: "Permanent",
  needs_review: "Needs review",
}

export function classifyFailureCode(code: string | null | undefined): FailureCategory {
  if (!code) return "needs_review"
  if (TRANSIENT.has(code)) return "transient"
  if (CREDITS.has(code)) return "credits"
  if (CONFIGURATION.has(code)) return "configuration"
  if (PERMANENT.has(code)) return "permanent"
  return "needs_review"
}

export const DEFAULT_MAX_IMAGE_ATTEMPTS = 5

export function maxImageAttemptsFromEnv(env: Record<string, string | undefined> = process.env) {
  const n = Number(env.ALT_TEXT_MAX_IMAGE_ATTEMPTS)
  return Number.isFinite(n) && n >= 1 ? Math.min(20, Math.floor(n)) : DEFAULT_MAX_IMAGE_ATTEMPTS
}

/** Server-only blockers (UNSAFE_FILE, OUT_OF_SCOPE) are decided by batch-retry.ts before the store runs. */
export type RetryBlocker = "NOT_FAILED" | "HAS_RESULT" | "PERMANENT_FAILURE" | "NEEDS_REVIEW" | "ATTEMPTS_EXHAUSTED" | "UNSAFE_FILE" | "OUT_OF_SCOPE"

/**
 * Credit and configuration failures are retryable: the processor re-checks credits/governance at
 * generation time and holds images pending (Awaiting Credits backoff) instead of re-failing them.
 */
export function retryBlocker(a: { status: string; currentVersion: number; errorCode: string | null; attempts: number }, maxAttempts: number): RetryBlocker | null {
  if (a.status !== "failed") return "NOT_FAILED"
  if (a.currentVersion > 0) return "HAS_RESULT"
  const category = classifyFailureCode(a.errorCode)
  if (category === "permanent") return "PERMANENT_FAILURE"
  if (category === "needs_review") return "NEEDS_REVIEW"
  if (a.attempts >= maxAttempts) return "ATTEMPTS_EXHAUSTED"
  return null
}

export const RETRY_BLOCKER_MESSAGES: Record<RetryBlocker, string> = {
  NOT_FAILED: "Only failed images can be retried.",
  HAS_RESULT: "This image already has saved alt text.",
  PERMANENT_FAILURE: "This failure cannot be fixed by retrying.",
  NEEDS_REVIEW: "The failure could not be classified safely and needs review.",
  ATTEMPTS_EXHAUSTED: "The maximum number of attempts was reached.",
  UNSAFE_FILE: "The file failed its security check or is no longer available.",
  OUT_OF_SCOPE: "You do not have permission to change this image.",
}

/** Batch states that accept a manual retry. Cancelled/draft never do; paused keeps its hold. */
export const RETRY_BATCH_STATUSES: ReadonlySet<string> = new Set(["queued", "processing", "pause_requested", "paused", "completed", "partially_completed", "failed"])
