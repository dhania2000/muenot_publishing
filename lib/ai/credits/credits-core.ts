/**
 * @file lib/ai/credits/credits-core.ts
 * @module AI Features
 * @kind Server-side library
 * @summary AI Features domain logic (CREDIT_TIERS, CreditTier, CREDIT_TIER_LABELS, CREDIT_SOURCES, …).
 * @exports CREDIT_TIERS, CreditTier, CREDIT_TIER_LABELS, CREDIT_SOURCES, CreditSource, LEDGER_TYPES, LedgerType, ResetFrequency, … (28 total)
 * @usedBy lib/ai/credits/credits-platform.ts, lib/ai/credits/credits-service.ts, lib/ai/credits/credits-store.ts
 * @see docs/CODEBASE-GUIDE.md for module ownership, conventions and where to add new code.
 */
/**
 * AI Credits — pure rating, allocation and limit logic. No I/O, so every rule
 * here is deterministic and unit-testable. Provider cost (USD) stays internal;
 * customers only ever see whole/decimal AI Credits.
 */

export const CREDIT_TIERS = ["economy", "standard", "premium", "premium_plus"] as const
export type CreditTier = (typeof CREDIT_TIERS)[number]

export const CREDIT_TIER_LABELS: Record<CreditTier, string> = {
  economy: "Economy",
  standard: "Standard",
  premium: "Premium",
  premium_plus: "Premium+",
}

export const CREDIT_SOURCES = ["promotional", "subscription", "carry_forward", "purchased", "manual"] as const
export type CreditSource = (typeof CREDIT_SOURCES)[number]

export const LEDGER_TYPES = [
  "subscription_credit",
  "carry_forward",
  "topup_purchase",
  "promotional_credit",
  "manual_adjustment",
  "usage_debit",
  "refund",
  "reversal",
  "expiry",
  "user_allocation",
  "department_allocation",
  "promotional_grant",
  "manual_grant",
  "manual_debit",
  "payment_reversal",
] as const
export type LedgerType = (typeof LEDGER_TYPES)[number]

export type ResetFrequency = "monthly" | "quarterly" | "yearly"
export type OverageMode = "hard_limit" | "overage"
export type UserLimitMode = "none" | "pool" | "fixed" | "percent" | "unlimited"

/** Platform-wide pricing defaults; individual models override via ModelRate. */
export type PlatformCreditConfig = {
  /** Credits charged per 1K tokens at multiplier 1 (economy). */
  baseInputPer1K: number
  baseCachedInputPer1K: number
  baseOutputPer1K: number
  baseReasoningPer1K: number
  baseToolCall: number
  minimumCharge: number
  tierMultipliers: Record<CreditTier, number>
  /** Default % thresholds that trigger low-balance alerts. */
  alertThresholds: number[]
  defaultDeductionPriority: CreditSource[]
  /** Months purchased credits remain valid; null = never expire. */
  purchasedExpiryMonths: number | null
}

export const DEFAULT_PLATFORM_CONFIG: PlatformCreditConfig = {
  baseInputPer1K: 1,
  baseCachedInputPer1K: 0.25,
  baseOutputPer1K: 4,
  baseReasoningPer1K: 4,
  baseToolCall: 1,
  minimumCharge: 1,
  tierMultipliers: { economy: 1, standard: 3, premium: 8, premium_plus: 20 },
  alertThresholds: [50, 75, 90, 100],
  defaultDeductionPriority: ["promotional", "subscription", "carry_forward", "purchased", "manual"],
  purchasedExpiryMonths: 12,
}

/** A versioned per-model rate card. Rates are credits per 1K tokens. */
export type ModelRate = {
  id: number
  modelId: string
  tier: CreditTier
  inputPer1K: number
  cachedInputPer1K: number
  outputPer1K: number
  reasoningPer1K: number
  toolCall: number
  multiplier: number
  minimumCharge: number
  maxOutputTokens: number | null
  enabled: boolean
  premium: boolean
  effectiveFrom: string
  version: number
}

export type UsageMeasure = {
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningTokens: number
  toolCalls: number
}

export type RatedUsage = { credits: number; rateVersion: number | null; tier: CreditTier; multiplier: number }

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export function deriveTier(m: { costTier: "economy" | "standard" | "advanced"; supportsReasoning: boolean }): CreditTier {
  if (m.costTier === "economy") return "economy"
  if (m.costTier === "standard") return "standard"
  return m.supportsReasoning ? "premium_plus" : "premium"
}

/** Effective rate for a model: an explicit rate card wins, else tier defaults. */
export function effectiveRate(
  modelId: string,
  tier: CreditTier,
  explicit: ModelRate | null,
  cfg: PlatformCreditConfig,
): Omit<ModelRate, "id" | "effectiveFrom"> {
  if (explicit) return explicit
  return {
    modelId,
    tier,
    inputPer1K: cfg.baseInputPer1K,
    cachedInputPer1K: cfg.baseCachedInputPer1K,
    outputPer1K: cfg.baseOutputPer1K,
    reasoningPer1K: cfg.baseReasoningPer1K,
    toolCall: cfg.baseToolCall,
    multiplier: cfg.tierMultipliers[tier] ?? 1,
    minimumCharge: cfg.minimumCharge,
    maxOutputTokens: null,
    enabled: true,
    premium: tier === "premium" || tier === "premium_plus",
    version: 0,
  }
}

/**
 * Credits = multiplier × Σ(tokens/1000 × rate) + toolCalls × toolRate,
 * floored at the minimum charge, rounded UP to 2dp so we never under-bill.
 * Cached input tokens are billed at the cached rate and excluded from input.
 */
export function rateUsage(usage: UsageMeasure, rate: Omit<ModelRate, "id" | "effectiveFrom">): RatedUsage {
  const fresh = Math.max(0, usage.inputTokens - usage.cachedInputTokens)
  const tokenCredits =
    (fresh / 1000) * rate.inputPer1K +
    (usage.cachedInputTokens / 1000) * rate.cachedInputPer1K +
    (usage.outputTokens / 1000) * rate.outputPer1K +
    (usage.reasoningTokens / 1000) * rate.reasoningPer1K
  const raw = tokenCredits * rate.multiplier + usage.toolCalls * rate.toolCall
  const credits = Math.max(rate.minimumCharge, Math.ceil(raw * 100) / 100)
  return { credits: round2(credits), rateVersion: rate.version || null, tier: rate.tier, multiplier: rate.multiplier }
}

/** Worst-case credits for a request, reserved before the provider call. */
export function estimateCredits(promptChars: number, maxOutputTokens: number, rate: Omit<ModelRate, "id" | "effectiveFrom">): number {
  const inputTokens = Math.ceil(promptChars / 3.5)
  return rateUsage({ inputTokens, cachedInputTokens: 0, outputTokens: maxOutputTokens, reasoningTokens: 0, toolCalls: 0 }, rate).credits
}

/** Relative cost shown in the model picker (economy = 1×). */
export function relativeMultiplier(multiplier: number, cfg: PlatformCreditConfig): number {
  const base = cfg.tierMultipliers.economy || 1
  return round2(multiplier / base)
}

export type Bucket = { id: number; source: CreditSource; remaining: number; expiresAt: string | null }

/**
 * Split a debit across buckets following the deduction priority; within one
 * source the soonest-expiring bucket is drained first. Returns the portion
 * that could not be covered (overage).
 */
export function allocateDebit(
  buckets: Bucket[],
  amount: number,
  priority: CreditSource[],
): { draws: { bucketId: number; source: CreditSource; amount: number }[]; uncovered: number } {
  const rank = (s: CreditSource) => {
    const i = priority.indexOf(s)
    return i === -1 ? priority.length : i
  }
  const ordered = [...buckets]
    .filter((b) => b.remaining > 0)
    .sort((a, b) => {
      const r = rank(a.source) - rank(b.source)
      if (r !== 0) return r
      const ae = a.expiresAt ? Date.parse(a.expiresAt) : Number.POSITIVE_INFINITY
      const be = b.expiresAt ? Date.parse(b.expiresAt) : Number.POSITIVE_INFINITY
      return ae - be || a.id - b.id
    })
  let left = round2(amount)
  const draws: { bucketId: number; source: CreditSource; amount: number }[] = []
  for (const b of ordered) {
    if (left <= 0) break
    const take = round2(Math.min(b.remaining, left))
    draws.push({ bucketId: b.id, source: b.source, amount: take })
    left = round2(left - take)
  }
  return { draws, uncovered: Math.max(0, left) }
}

/** Period window for subscription credit resets, anchored to calendar starts (UTC). */
export function periodWindow(freq: ResetFrequency, now = new Date()): { key: string; start: Date; end: Date } {
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()
  if (freq === "yearly") {
    return { key: `${y}`, start: new Date(Date.UTC(y, 0, 1)), end: new Date(Date.UTC(y + 1, 0, 1)) }
  }
  if (freq === "quarterly") {
    const q = Math.floor(m / 3)
    return { key: `${y}-Q${q + 1}`, start: new Date(Date.UTC(y, q * 3, 1)), end: new Date(Date.UTC(y, q * 3 + 3, 1)) }
  }
  return { key: `${y}-${String(m + 1).padStart(2, "0")}`, start: new Date(Date.UTC(y, m, 1)), end: new Date(Date.UTC(y, m + 1, 1)) }
}

export type UserLimit = { mode: UserLimitMode; monthlyLimit: number | null; percent: number | null; bonus: number }

/** The credits a user may still consume this period; null = bounded only by the pool. */
export function userRemaining(limit: UserLimit, used: number, periodAllowance: number | null): number | null {
  if (limit.mode === "none") return 0
  if (limit.mode === "pool" || limit.mode === "unlimited") return null
  const base =
    limit.mode === "fixed"
      ? limit.monthlyLimit ?? 0
      : periodAllowance == null
        ? null
        : (periodAllowance * (limit.percent ?? 0)) / 100
  if (base == null) return null
  return round2(Math.max(0, base + limit.bonus - used))
}

/** Thresholds newly crossed when usage moves from `before` to `after`. */
export function crossedThresholds(before: number, after: number, allowance: number, thresholds: number[]): number[] {
  if (allowance <= 0) return []
  const pb = (before / allowance) * 100
  const pa = (after / allowance) * 100
  return thresholds.filter((t) => pb < t && pa >= t).sort((a, b) => a - b)
}

export function formatCredits(n: number | null | undefined): string {
  if (n == null) return "Unlimited"
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: n % 1 === 0 ? 0 : 2 }).format(n)
}

export class CreditError extends Error {
  constructor(
    public code:
      | "ai_suspended"
      | "insufficient_credits"
      | "user_limit_reached"
      | "department_limit_reached"
      | "daily_cap_reached"
      | "request_too_large"
      | "rate_limited"
      | "model_not_allowed"
      | "premium_not_allowed"
      | "duplicate_request",
    message: string,
    public meta?: Record<string, unknown>,
  ) {
    super(message)
    this.name = "CreditError"
  }
}
