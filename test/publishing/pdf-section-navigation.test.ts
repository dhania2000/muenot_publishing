import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { getPdfHeader } from "@/components/publishing/conversion/pdf/pdf-header-config"
import { fitPdfNavItems, PdfSectionNavigation } from "@/components/publishing/conversion/pdf/pdf-section-navigation"
import { getPdfNavItems, PdfSectionPage } from "@/components/publishing/conversion/pdf/pdf-section-page"
import { isPdfSectionNavigable, PDF_SECTIONS } from "@/components/publishing/conversion/pdf/pdf-sections"
import { conversionHref, getConversionModule, getConversionPage } from "@/lib/conversion-modules"

const pdf = getConversionModule("pdf")!

describe("PDF_SECTIONS", () => {
  it("defines all 12 sections in the required order with unique ids and slugs", () => {
    expect(PDF_SECTIONS.map((s) => s.label)).toEqual([
      "Overview",
      "Workspace",
      "Guidelines",
      "Output Settings",
      "Page Layout",
      "Content Extraction",
      "Compliance Profiles",
      "Preflight",
      "Batch Processing",
      "Output Preview",
      "Profiles & Presets",
      "History",
    ])
    expect(PDF_SECTIONS.map((s) => s.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(new Set(PDF_SECTIONS.map((s) => s.id)).size).toBe(12)
    expect(new Set(PDF_SECTIONS.map((s) => s.slug)).size).toBe(12)
  })

  it("covers every registered PDF route so no route lacks navigation metadata", () => {
    const slugs = new Set(PDF_SECTIONS.map((s) => s.slug))
    for (const page of pdf.pages) expect(slugs.has(page.slug)).toBe(true)
  })

  it("derives navigability from real routes: Guidelines and Profiles & Presets are not navigable", () => {
    const blocked = PDF_SECTIONS.filter((s) => !isPdfSectionNavigable(s, pdf)).map((s) => s.id)
    expect(blocked).toEqual(["guidelines", "profiles-presets"])
  })

  it("does not claim any section is operational while no section tools exist", () => {
    expect(PDF_SECTIONS.every((s) => s.status === "planned")).toBe(true)
  })

  it("keeps the existing Preflight URL", () => {
    const preflight = PDF_SECTIONS.find((s) => s.id === "preflight")!
    expect(preflight.slug).toBe("preflight-and-validation")
    expect(getConversionPage(pdf, preflight.slug)).toBeDefined()
  })
})

describe("getPdfNavItems", () => {
  it("marks exactly one active item for every routed section and links only to registered routes", () => {
    const routes = new Set([conversionHref("pdf"), ...pdf.pages.map((p) => conversionHref("pdf", p.slug))])
    for (const slug of ["", ...pdf.pages.map((p) => p.slug)]) {
      const items = getPdfNavItems(pdf, slug)
      expect(items.filter((i) => i.active)).toHaveLength(1)
      for (const item of items) if (item.href) expect(routes.has(item.href)).toBe(true)
    }
  })

  it("never activates or links a planned section, even if its slug is requested", () => {
    const items = getPdfNavItems(pdf, "guidelines")
    expect(items.some((i) => i.active)).toBe(false)
    expect(items.find((i) => i.id === "guidelines")?.href).toBeNull()
  })

  it("enables Guidelines automatically once its route is registered, without affecting other sections", () => {
    const withGuidelines = { ...pdf, pages: [...pdf.pages, { slug: "guidelines", label: "Guidelines" }] }
    const items = getPdfNavItems(withGuidelines, "workspace")
    expect(items.find((i) => i.id === "guidelines")?.href).toBe(conversionHref("pdf", "guidelines"))
    expect(items.find((i) => i.id === "workspace")?.active).toBe(true)
  })
})

describe("breadcrumb synchronization", () => {
  it.each([
    ["workspace", "Workspace"],
    ["output-settings", "Output Settings"],
    ["preflight-and-validation", "Preflight"],
  ])("%s ends the trail with the section breadcrumb label", (slug, label) => {
    const header = getPdfHeader(pdf, getConversionPage(pdf, slug))
    expect(header.breadcrumbs.map((c) => c.label)).toEqual(["Publishing", "Conversion", "PDF", label])
  })
})

describe("fitPdfNavItems", () => {
  const items = getPdfNavItems(pdf, "history")
  const widths = items.map(() => 100)

  it("shows everything when it fits", () => {
    expect(fitPdfNavItems(items, widths, 1200, 80).size).toBe(12)
  })

  it("overflows trailing items but keeps the active section visible", () => {
    const visible = fitPdfNavItems(items, widths, 500, 80)
    expect(visible.has("history")).toBe(true)
    expect(visible.size).toBe(4)
    expect(visible.has("overview")).toBe(true)
  })
})

describe("PdfSectionNavigation markup", () => {
  const html = renderToStaticMarkup(h(PdfSectionNavigation, { items: getPdfNavItems(pdf, "workspace") }))

  it("uses a labelled nav landmark with link semantics, not a tablist", () => {
    expect(html).toContain('<nav aria-label="PDF sections"')
    expect(html).not.toContain('role="tab"')
  })

  it("marks only the active link as the current page", () => {
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
    const current = html.match(/<a aria-current="page"[^>]*>/)?.[0] ?? ""
    expect(current).toContain(`href="${conversionHref("pdf", "workspace")}"`)
  })

  it("renders planned sections as non-navigating, aria-disabled items with an accessible reason", () => {
    expect(html).not.toContain(`href="${conversionHref("pdf", "guidelines")}"`)
    expect(html).not.toContain(`href="${conversionHref("pdf", "profiles-presets")}"`)
    expect(html.match(/role="link" aria-disabled="true"/g)).toHaveLength(2)
    expect(html).toContain("Planned, not yet available")
  })
})

describe("PdfSectionPage", () => {
  it("renders the PDF navigation instead of the generic module tabs", () => {
    const html = renderToStaticMarkup(h(PdfSectionPage, { module: pdf, icon: pdf.icon }))
    expect(html).toContain('aria-label="PDF sections"')
    expect(html).not.toContain('aria-label="PDF pages"')
  })
})
