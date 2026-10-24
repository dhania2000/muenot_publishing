import { describe, expect, it } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import {
  assessGuidelineCompliance,
  GUIDELINE_PRIORITY_LEVELS,
  hasGuidelines,
  type GuidelineContext,
  type GuidelineRule,
} from "@/lib/guidelines/guideline-contracts"
import { PDF_GUIDELINE_CATEGORIES, PDF_GUIDELINE_CATEGORY_IDS } from "@/components/publishing/conversion/pdf/pdf-guideline-categories"
import { deriveGuidelineState } from "@/components/publishing/conversion/pdf/pdf-workspace-config"
import {
  PdfGuidelineRuleItem,
  PdfGuidelinesComplianceSummary,
  PdfGuidelinesStatus,
} from "@/components/publishing/conversion/pdf/pdf-guidelines-components"

const rule = (over: Partial<GuidelineRule> = {}): GuidelineRule => ({
  id: "r1",
  requirement: "Use A4 page size",
  categoryId: "formatting.page-size",
  level: "mandatory",
  priority: "company",
  applicability: "applicable",
  status: "accepted",
  verificationStatus: "not-run",
  ...over,
})

const ctx = (over: Partial<GuidelineContext> = {}): GuidelineContext => ({
  scope: { area: "conversion", service: "pdf" },
  profile: null,
  documents: [{ id: "d1", title: "Acme Style Guide", status: "uploaded" }],
  rules: [],
  ...over,
})

describe("Scenario A: no guidelines", () => {
  it("is not applicable, not-provided and non-blocking", () => {
    expect(hasGuidelines(null)).toBe(false)
    expect(assessGuidelineCompliance(null).verdict).toBe("not-applicable")
    expect(deriveGuidelineState(null)).toBe("not-provided")
  })

  it("renders neutral copy without error or compliance language", () => {
    const html = renderToStaticMarkup(h(PdfGuidelinesStatus))
    expect(html).toContain("Company guidelines are optional. Standard settings will be used.")
    expect(html).toContain("Standard Profile")
    expect(html).not.toMatch(/compliant|failed|required|missing/i)
  })

  it("verification summary shows Company Guidelines as Not applicable", () => {
    const html = renderToStaticMarkup(h(PdfGuidelinesComplianceSummary))
    expect(html).toContain("Company Guidelines")
    expect(html).toContain("Not applicable")
    expect(html).not.toMatch(/Failed|Compliant/)
  })
})

describe("Scenario B: separate statuses", () => {
  it("an uploaded document alone is pending review, never applied or verified", () => {
    expect(assessGuidelineCompliance(ctx()).verdict).toBe("requirements-pending")
    expect(deriveGuidelineState(ctx())).toBe("pending-review")
  })

  it("applied but unverified rules are not verified", () => {
    const c = ctx({
      documents: [{ id: "d1", title: "Guide", status: "reviewed" }],
      rules: [rule()],
      mappings: [{ ruleId: "r1", kind: "mapped", requirement: "A4", applicability: "applicable", applicationStatus: "applied", verificationStatus: "not-run" }],
    })
    expect(assessGuidelineCompliance(c).verdict).toBe("not-verified")
    expect(deriveGuidelineState(c)).toBe("applied")
  })

  it("a pass without evidence is not compliance", () => {
    const c = ctx({ documents: [{ id: "d1", title: "G", status: "reviewed" }], rules: [rule()], results: [{ ruleId: "r1", method: "automated", status: "passed" }] })
    expect(assessGuidelineCompliance(c).verdict).toBe("review-required")
  })

  it("compliant only with evidenced passes; approved exceptions are labelled", () => {
    const base = { documents: [{ id: "d1", title: "G", status: "reviewed" as const }] }
    const ok = ctx({ ...base, rules: [rule()], results: [{ ruleId: "r1", method: "automated", status: "passed", evidenceRef: "ev-1" }] })
    expect(assessGuidelineCompliance(ok).verdict).toBe("compliant")
    expect(deriveGuidelineState(ok)).toBe("verified")

    const withException = ctx({
      ...base,
      rules: [rule(), rule({ id: "r2", status: "unsupported" })],
      results: [{ ruleId: "r1", method: "automated", status: "passed", evidenceRef: "ev-1" }],
      exceptions: [{ id: "e1", ruleId: "r2", kind: "unsupported", explanation: "Not representable", approval: { status: "approved" } }],
    })
    expect(assessGuidelineCompliance(withException).verdict).toBe("compliant-with-exceptions")
  })

  it("unresolved conflicts and failures are surfaced", () => {
    const base = { documents: [{ id: "d1", title: "G", status: "reviewed" as const }], rules: [rule()] }
    const conflict = ctx({
      ...base,
      conflicts: [{ id: "c1", affectedSettingKey: "page.size", ruleIds: ["r1"], description: "A4 vs Letter", severity: "major", resolution: "open" }],
    })
    expect(assessGuidelineCompliance(conflict).verdict).toBe("review-required")
    expect(deriveGuidelineState(conflict)).toBe("conflict")
    const failed = ctx({ ...base, results: [{ ruleId: "r1", method: "automated", status: "failed", evidenceRef: "ev" }] })
    expect(assessGuidelineCompliance(failed).verdict).toBe("failed")
  })

  it("rule row shows rule, application and verification separately", () => {
    const html = renderToStaticMarkup(h(PdfGuidelineRuleItem, { rule: rule({ sourceLocation: "§4.2" }) }))
    expect(html).toContain("Rule: Accepted")
    expect(html).toContain("Not applied")
    expect(html).toContain("Verification: Not run")
    expect(html).toContain("Document Formatting · Page size")
    expect(html).toContain("§4.2")
  })
})

describe("Contracts", () => {
  it("priority runs job > company > preset > standard", () => {
    expect(GUIDELINE_PRIORITY_LEVELS.map((l) => l.id)).toEqual(["job", "company", "preset", "standard"])
  })

  it("category registry has six groups with unique ids", () => {
    expect(PDF_GUIDELINE_CATEGORIES).toHaveLength(6)
    const total = PDF_GUIDELINE_CATEGORIES.reduce((n, g) => n + g.items.length, 0)
    expect(PDF_GUIDELINE_CATEGORY_IDS.size).toBe(total)
  })
})
