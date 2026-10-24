import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { PdfSplitContent, PdfThreePanelContent } from "@/components/publishing/conversion/pdf/pdf-content"
import { getPdfSectionLayout, PdfModuleLayout } from "@/components/publishing/conversion/pdf/pdf-module-layout"
import { getConversionModule } from "@/lib/conversion-modules"

const render = (props: Partial<Parameters<typeof PdfModuleLayout>[0]> = {}) =>
  renderToStaticMarkup(h(PdfModuleLayout, { header: h("h1", null, "PDF"), children: h("p", null, "body"), ...props }))

describe("getPdfSectionLayout", () => {
  it("covers every registered PDF page plus the overview", () => {
    const pdf = getConversionModule("pdf")!
    for (const slug of ["", ...pdf.pages.map((p) => p.slug)]) {
      expect(getPdfSectionLayout(slug)).toMatchObject({ width: expect.any(String), spacing: expect.any(String) })
    }
  })

  it("uses full-width compact layout for the workspace and falls back to default for unknown slugs", () => {
    expect(getPdfSectionLayout("workspace")).toEqual({ width: "full", spacing: "compact" })
    expect(getPdfSectionLayout("does-not-exist")).toEqual({ width: "default", spacing: "standard" })
  })

  it("keeps a future guidelines section in the table without making it a prerequisite", () => {
    expect(getPdfSectionLayout("guidelines")).toEqual({ width: "default", spacing: "standard" })
  })
})

describe("PdfModuleLayout", () => {
  it("renders header and content slots, and omits optional regions when unused", () => {
    const html = render()
    expect(html).toContain('data-slot="pdf-header"')
    expect(html).toContain('data-slot="pdf-content"')
    expect(html).not.toContain('data-slot="pdf-navigation"')
    expect(html).not.toContain('data-slot="pdf-toolbar"')
    expect(html).not.toContain("<aside")
    expect(html).not.toContain("grid-cols")
  })

  it("adds a labelled contextual panel column only when an aside is supplied", () => {
    const html = render({ aside: h("div", null, "Guideline status"), asideLabel: "Guideline summary" })
    expect(html).toContain('<aside data-slot="pdf-context" aria-label="Guideline summary"')
    expect(html).toContain("@3xl/pdf-module:grid-cols-[minmax(0,1fr)_minmax(260px,320px)]")
  })

  it("renders navigation, a polite status region and a sticky toolbar when provided", () => {
    const html = render({ navigation: h("nav", null), status: h("div", null, "s"), toolbar: h("button", null, "Run") })
    expect(html).toContain('data-slot="pdf-navigation"')
    expect(html).toContain('data-slot="pdf-status" aria-live="polite"')
    expect(html).toMatch(/data-slot="pdf-toolbar" class="sticky top-0/)
  })

  it.each([
    ["default", "max-w-screen-xl"],
    ["wide", "max-w-screen-2xl"],
    ["full", "max-w-none"],
  ] as const)("applies the %s width", (width, cls) => {
    const html = render({ width })
    expect(html).toContain(`data-pdf-layout="${width}"`)
    expect(html).toContain(cls)
    expect(html).toContain("min-w-0")
  })
})

describe("content primitives", () => {
  it("split content stacks below lg and uses the requested ratio", () => {
    const html = renderToStaticMarkup(h(PdfSplitContent, { primary: "a", secondary: "b", ratio: "primary" }))
    expect(html).toContain("lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]")
    expect(html).not.toMatch(/(?<!lg:)grid-cols-/)
  })

  it("three-panel content renders source, preview and settings in order without fixed heights", () => {
    const html = renderToStaticMarkup(h(PdfThreePanelContent, { source: "s", preview: "p", settings: "c" }))
    const order = ["pdf-source", "pdf-preview", "pdf-settings"].map((slot) => html.indexOf(`data-slot="${slot}"`))
    expect(order.every((i, n) => i > -1 && (n === 0 || i > order[n - 1]))).toBe(true)
    expect(html).toContain("@4xl/pdf-panels:grid-cols-")
    expect(html).not.toMatch(/\bh-\[|\bh-screen|\bh-dvh/)
  })
})
