import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "tok" }) }) }))
vi.mock("@/lib/platform-schema", () => ({ ensurePlatformSchema: vi.fn(async () => {}) }))
vi.mock("@/lib/db", () => ({
  query: vi.fn(async () => [{ id: 7, tenant_id: 42, email: "a@b.c", name: "A", role: "employee" }]),
}))

import { getSession } from "@/lib/auth"
import { DEFAULT_TENANT_ID, currentTenantId, runForTenant } from "@/lib/tenant-scope"

describe("session tenant scope", () => {
  it("scopes tenant queries to the signed-in user's tenant, not the default", async () => {
    const tenant = await (async () => {
      const session = await getSession()
      expect(session?.tenantId).toBe(42)
      return currentTenantId()
    })()
    expect(tenant).toBe(42)
    expect(tenant).not.toBe(DEFAULT_TENANT_ID)
  })

  it("never lets a session override an explicit job tenant scope", async () => {
    const tenant = await runForTenant({ tenantId: 5 }, async () => {
      await getSession()
      return currentTenantId()
    })
    expect(tenant).toBe(5)
  })
})
