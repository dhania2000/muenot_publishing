/**
 * @file lib/billing/usage-guard.ts
 * @module Billing & Subscriptions
 * @kind Server-side library
 * @summary Billing & Subscriptions domain logic (meterUsage, enforceUsageIfScoped, UsageLimitError).
 * @exports meterUsage, enforceUsageIfScoped, UsageLimitError
 * @usedBy app/api/marketing/whatsapp/send/route.ts, app/api/recruit/calls/route.ts, app/api/sales/calls/route.ts, lib/api-platform/handler.ts, lib/notification-engine/service.ts (+3 more); 4 test files
 * @see docs/CODEBASE-GUIDE.md for module ownership, conventions and where to add new code.
 */
import "server-only"
/**
 * Thin metering/enforcement helpers for wiring usage into real backend send
 * paths (storage, WhatsApp, SMS, voice, API, AI, automation).
 *
 * These wrap the primitives in `usage-metering.ts` with a tenant-binding guard
 * so they are safe to call from choke points that may (WhatsApp store, storage
 * facade, app route handlers) or may not (the public `/api/v1` pipeline, cron
 * workers) run inside a bound tenant scope. When no tenant is bound, callers
 * that know their tenant should pass it explicitly via `tenantId`; otherwise the
 * call is a no-op instead of throwing.
 */
import { currentTenantIdOrNull, runForTenant } from "@/lib/tenant-scope"
import {
  recordUsage,
  recordUsageSafe,
  enforceUsageLimit,
  UsageLimitError,
  type RecordUsageInput,
  type LimitCheck,
} from "@/lib/billing/usage-metering"
import { reserveQuota, type ReserveOptions } from "@/lib/billing/quota-reservation"
import { METER_DIMENSION, WARNING_RATIO } from "@/lib/billing/quota-model"

/**
 * Record a metered event. When a tenant is already bound in context this is a
 * fire-and-forget call; when `tenantId` is supplied (system entry points with
 * no session, e.g. the public API pipeline or a cron worker) the event is
 * recorded under that tenant explicitly. Never throws into the caller.
 */
export function meterUsage(input: RecordUsageInput & { tenantId?: number }): void {
  const { tenantId, ...rest } = input
  if (tenantId != null) {
    void runForTenant({ tenantId }, () => recordUsage(rest)).catch((err) =>
      {},
    )
    return
  }
  if (currentTenantIdOrNull() == null) return
  recordUsageSafe(rest)
}

/**
 * Enforce a HARD quota before a metered backend action. Returns the limit check
 * (so callers can also surface a soft-limit "warning"/"over" status) or `null`
 * when no tenant is bound and none is supplied. Throws `UsageLimitError` when a
 * hard limit would be exceeded so the caller can map it to a 402/429.
 */
export async function enforceUsageIfScoped(
  meterKey: string,
  amount = 1,
  tenantId?: number,
  opts: ReserveOptions = {},
): Promise<LimitCheck | null> {
  const scoped = tenantId ?? currentTenantIdOrNull()
  if (scoped == null) return null
  const dimension = METER_DIMENSION[meterKey]
  // Spec60: plan-gated meters use the atomic, idempotent reservation so
  // concurrent requests cannot overshoot and blocks are surfaced to admins.
  if (dimension) {
    const units = Math.max(1, Math.ceil(Number.isFinite(amount) ? amount : 1))
    const decision = await reserveQuota(scoped, dimension, units, opts)
    const check: LimitCheck = decision.ok
      ? {
          allowed: true,
          used: decision.used,
          limit: decision.limit,
          remaining: decision.limit == null ? null : Math.max(0, decision.limit - decision.used),
          hardLimit: decision.limit != null,
          status: decision.limit == null ? "no_limit" : decision.used >= decision.limit * WARNING_RATIO ? "warning" : "ok",
        }
      : { allowed: false, used: decision.used, limit: decision.limit, remaining: 0, hardLimit: true, status: "over" }
    if (!check.allowed) throw new UsageLimitError(meterKey, check)
    return check
  }
  if (tenantId != null) {
    return runForTenant({ tenantId }, () => enforceUsageLimit(meterKey, amount))
  }
  return enforceUsageLimit(meterKey, amount)
}

export { UsageLimitError }
