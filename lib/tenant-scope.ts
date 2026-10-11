import { AsyncLocalStorage } from "node:async_hooks"

/** Standalone deployment: one organisation. Jobs may still run inside an explicit tenant scope. */
export const DEFAULT_TENANT_ID = 1

const scope = new AsyncLocalStorage<{ tenantId: number }>()

export function currentTenantIdOrNull(): number | null {
  return scope.getStore()?.tenantId ?? DEFAULT_TENANT_ID
}

export function currentTenantId(): number {
  return currentTenantIdOrNull() ?? DEFAULT_TENANT_ID
}

export function runForTenant<T>(ctx: { tenantId: number }, fn: () => Promise<T>): Promise<T> {
  return scope.run({ tenantId: ctx.tenantId }, fn)
}
