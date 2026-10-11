import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/permissions", () => ({
  getUserAccessibleModules: vi.fn(),
  getFeatureChecker: vi.fn(),
  getEntity360Checker: vi.fn(),
  getDashboardChecker: vi.fn(),
}))
vi.mock("@/lib/workspace/module-marketplace-store", () => ({ loadModuleGate: vi.fn() }))
vi.mock("@/lib/access-control/server", () => ({ getAccessChecker: vi.fn() }))
vi.mock("@/lib/global-erp-scope", () => ({ ownsGlobalErpLedger: vi.fn() }))
vi.mock("@/lib/tenant-scope", () => ({ currentTenantIdOrNull: vi.fn() }))

const { BUSINESS_LINE_MODULES, mergeBusinessLineModules } = await import("@/lib/workspace-nav")

type Gates = Parameters<typeof mergeBusinessLineModules>[1]

const allowAll = (overrides: Partial<Gates> = {}): Gates => ({
  isEnabled: () => true,
  planGate: () => true,
  canAccess: () => true,
  buildChildren: (nodes) => nodes.map((n) => ({ label: n.label, href: n.href })),
  ...overrides,
})

const base = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "HR", href: "/modules/hr" },
]

describe("business-line sidebar registration", () => {
  it("registers Publishing, EdTech, BPO and Technology once, at the bottom, in order", () => {
    const nav = mergeBusinessLineModules(base, allowAll())
    expect(nav.map((i) => i.label)).toEqual(["Dashboard", "HR", "Publishing", "EdTech", "BPO", "Technology"])
    expect(BUSINESS_LINE_MODULES.map((m) => m.slug)).toEqual(["publishing", "edtech", "bpo", "technology"])
  })

  it("renders Publishing as a dropdown with the Alt Text child", () => {
    const publishing = mergeBusinessLineModules(base, allowAll()).find((i) => i.label === "Publishing")
    expect(publishing?.href).toBe("/modules/publishing")
    expect(publishing?.children).toEqual([{ label: "Alt Text", href: "/modules/publishing/alt-text" }])
  })

  it("replaces a database-backed module row instead of duplicating it", () => {
    const withDbRows = [
      ...base,
      { label: "publishing", href: "/modules/Publishing/" },
      { label: "Ed-Tech", href: "/modules/ed-tech" },
      { label: "BPO Services", href: "/modules/bpo" },
      { label: "TECHNOLOGY", href: "/modules/tech-stack" },
    ]
    const nav = mergeBusinessLineModules(withDbRows, allowAll())
    for (const label of ["Publishing", "EdTech", "BPO", "Technology"]) {
      expect(nav.filter((i) => i.label.toLowerCase() === label.toLowerCase())).toHaveLength(1)
    }
    expect(nav.some((i) => i.href.toLowerCase().startsWith("/modules/publishing") && !i.children)).toBe(false)
    expect(nav.some((i) => i.href === "/modules/ed-tech" || i.href === "/modules/bpo" && i.label === "BPO Services")).toBe(false)
  })

  it("does not create duplicates when merged twice", () => {
    const once = mergeBusinessLineModules(base, allowAll())
    const twice = mergeBusinessLineModules(once, allowAll())
    expect(twice.map((i) => i.label)).toEqual(once.map((i) => i.label))
  })

  it("hides a module that is toggled off, plan-locked or not permitted", () => {
    const nav = mergeBusinessLineModules(
      base,
      allowAll({
        isEnabled: (slug) => slug !== "edtech",
        planGate: (slug) => slug !== "bpo",
        canAccess: (feature) => feature !== "technology.view_overview",
      }),
    )
    expect(nav.map((i) => i.label)).toEqual(["Dashboard", "HR", "Publishing"])
  })

  it("hides Publishing when the user cannot see any child, and removes the DB row too", () => {
    const nav = mergeBusinessLineModules(
      [...base, { label: "Publishing", href: "/modules/publishing" }],
      allowAll({ buildChildren: () => [] }),
    )
    expect(nav.some((i) => i.label === "Publishing")).toBe(false)
  })
})
