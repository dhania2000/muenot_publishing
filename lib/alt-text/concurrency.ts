/**
 * @file lib/alt-text/concurrency.ts
 * @module Publishing · Alt Text
 * @kind Server-side library (pure)
 * @summary Phase 2 Task 10 — Alt Text AI concurrency limits, halt classification and retry backoff.
 * @usedBy lib/alt-text/batch-processor.ts, lib/alt-text/batch-submission.ts, lib/observability/job-limits.ts
 *
 * Concurrency is enforced by the durable queue's claim transaction, never in memory:
 * - Per batch: one job per batch, images processed sequentially (1 AI request).
 * - Per tenant: the job's tenant-scoped concurrency key (ALT_TEXT_TENANT_MAX_CONCURRENCY) and the
 *   queue-wide BACKGROUND_JOB_TENANT_MAX_RUNNING cap; the stricter one wins.
 * - Global: running `alt_text.batch_processing` jobs capped at ALT_TEXT_GLOBAL_MAX_CONCURRENCY.
 */

export type AltTextConcurrencyConfig = {
  tenantMaxConcurrency: number
  globalMaxConcurrency: number
  retryBaseSeconds: number
  retryMaxSeconds: number
  creditWaitSeconds: number
  maxConfigHaltRetries: number
}

function envInt(value: string | undefined, fallback: number, min: number, max: number) {
  const n = Number(value)
  return value !== undefined && value !== "" && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback
}

export function altTextConcurrencyFromEnv(env: Record<string, string | undefined> = process.env): AltTextConcurrencyConfig {
  const retryBaseSeconds = envInt(env.ALT_TEXT_RETRY_BASE_SECONDS, 60, 30, 3600)
  return {
    tenantMaxConcurrency: envInt(env.ALT_TEXT_TENANT_MAX_CONCURRENCY, 2, 1, 20),
    globalMaxConcurrency: envInt(env.ALT_TEXT_GLOBAL_MAX_CONCURRENCY, 3, 1, 50),
    retryBaseSeconds,
    retryMaxSeconds: Math.max(retryBaseSeconds, envInt(env.ALT_TEXT_RETRY_MAX_SECONDS, 1800, 30, 3600)),
    creditWaitSeconds: envInt(env.ALT_TEXT_CREDIT_WAIT_SECONDS, 900, 30, 3600),
    maxConfigHaltRetries: envInt(env.ALT_TEXT_MAX_CONFIG_RETRIES, 3, 0, 20),
  }
}

/**
 * rate_limited / transient: provider-side, always deferred with backoff (never fails the batch).
 * credits: tenant balance exhausted; remaining images stay pending until credits are available.
 * config: governance/permission/model problems that will not clear by themselves; bounded retries.
 */
export type HaltKind = "rate_limited" | "transient" | "credits" | "config"

const CREDIT_CODES = new Set(["INSUFFICIENT_CREDITS", "DAILY_CAP_REACHED", "USER_LIMIT_REACHED", "DEPARTMENT_LIMIT_REACHED", "TENANT_BUDGET_EXCEEDED", "USER_BUDGET_EXCEEDED", "TOKEN_LIMIT_EXCEEDED", "PLATFORM_BUDGET_EXCEEDED"])

export function classifyHalt(f: { status: number; code: string; details?: Record<string, unknown> }): HaltKind {
  if (f.status === 429 || f.code === "RATE_LIMITED") return "rate_limited"
  if (f.status === 402 || CREDIT_CODES.has(f.code)) return "credits"
  if ((f.code === "PROVIDER_ERROR" || f.code === "PROVIDER_TIMEOUT") && f.details?.reason !== "credentials") return "transient"
  return "config"
}

/**
 * Bounded exponential backoff with jitter in [d/2, d]; a provider Retry-After is a floor, never shortened.
 * The queue additionally clamps deferrals to 30..3600 seconds.
 */
export function haltDelaySeconds(kind: HaltKind, deferrals: number, retryAfterSeconds: number | null, cfg: AltTextConcurrencyConfig, random: () => number = Math.random) {
  const base = kind === "credits" ? cfg.creditWaitSeconds : cfg.retryBaseSeconds
  const exp = Math.min(cfg.retryMaxSeconds, base * 2 ** Math.min(Math.max(0, deferrals), 10))
  const jittered = Math.round(exp / 2 + Math.min(1, Math.max(0, random())) * (exp / 2))
  return Math.min(3600, Math.max(retryAfterSeconds ?? 0, jittered, 30))
}

/** Parses a Retry-After header (delta-seconds or HTTP date) into bounded seconds; null when absent/invalid. */
export function parseRetryAfter(value: unknown, now: number = Date.now()): number | null {
  if (typeof value !== "string" || !value.trim()) return null
  const v = value.trim()
  const seconds = /^\d+$/.test(v) ? Number(v) : (() => {
    const at = Date.parse(v)
    return Number.isFinite(at) ? Math.ceil((at - now) / 1000) : NaN
  })()
  if (!Number.isFinite(seconds)) return null
  return Math.min(3600, Math.max(1, Math.floor(seconds)))
}

/** Reads only the Retry-After header from an AI SDK APICallError (or a RetryError's last error). */
export function retryAfterFromError(e: unknown): number | null {
  for (let cur: unknown = e, depth = 0; cur && typeof cur === "object" && depth < 3; depth++) {
    const headers = (cur as { responseHeaders?: unknown }).responseHeaders
    if (headers && typeof headers === "object") {
      const h = headers as Record<string, unknown>
      const parsed = parseRetryAfter(h["retry-after"] ?? h["Retry-After"])
      if (parsed != null) return parsed
    }
    cur = (cur as { lastError?: unknown }).lastError
  }
  return null
}
