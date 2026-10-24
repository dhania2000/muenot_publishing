import { AsyncLocalStorage } from "node:async_hooks"
import { getCurrentTenant } from "@/lib/tenant-context"

/** Fallback for code running with no session and no explicit job scope (single-organisation installs). */
export const DEFAULT_TENANT_ID = 1

type Scope = { tenantId: number | null; fixed: boolean }

const scope = new AsyncLocalStorage<Scope>()

export function currentTenantIdOrNull(): number | null {
  return scope.getStore()?.tenantId ?? getCurrentTenant()?.tenantId ?? DEFAULT_TENANT_ID
}

export function currentTenantId(): number {
  return currentTenantIdOrNull() ?? DEFAULT_TENANT_ID
}

/** Explicit scope for background jobs; a session resolved inside it cannot override the job's tenant. */
export function runForTenant<T>(ctx: { tenantId: number }, fn: () => Promise<T>): Promise<T> {
  return scope.run({ tenantId: ctx.tenantId, fixed: true }, fn)
}

/**
 * Must be called synchronously, before the caller's first await, so the caller's continuation
 * inherits the container. Every tenant-scoped query in the request then reads the session tenant
 * instead of silently falling back to DEFAULT_TENANT_ID.
 */
export function enterRequestTenantScope(): Scope {
  const existing = scope.getStore()
  if (existing) return existing
  const created: Scope = { tenantId: null, fixed: false }
  scope.enterWith(created)
  return created
}

export function bindRequestTenant(container: Scope, tenantId: number) {
  if (container.fixed) return
  container.tenantId = tenantId
}
