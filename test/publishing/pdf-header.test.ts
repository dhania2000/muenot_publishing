import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { PdfHeaderActions } from "@/components/publishing/conversion/pdf/pdf-header-actions"
import { getPdfHeader } from "@/components/publishing/conversion/pdf/pdf-header-config"
import { PdfSectionPage } from "@/components/publishing/conversion/pdf/pdf-section-page"
import { conversionHref, getConversionModule, getConversionPage } from "@/lib/conversion-modules"

const pdf = getConversionModule("pdf")!
const page = (slug: string) => getConversionPage(pdf, slug)!

describe("getPdfHeader", () => {
  it("uses the enterprise overview copy and Publishing / Conversion / PDF / Overview trail", () => {
    const header = getPdfHeader(pdf)
    expect(header.title).toBe("PDF Conversion")
    expect(header.subtitle).toBe("Convert, organize, and process documents with professional publishing workflows.")
    expect(header.breadcrumbs.map((c) => c.label)).toEqual(["Publishing", "Conversion", "PDF", "Overview"])
    expect(header.breadcrumbs[2].href).toBe(conversionHref("pdf"))
    expect(header.breadcrumbs.at(-1)?.href).toBeUndefined()
  })

  it("extends the trail for internal sections and links PDF back to the overview", () => {
    const header = getPdfHeader(pdf, page("workspace"))
    expect(header.title).toBe("Workspace")
    expect(header.subtitle).toBe("Configure and process your documents")
    expect(header.breadcrumbs.map((c) => c.label)).toEqual(["Publishing", "Conversion", "PDF", "Workspace"])
    expect(header.breadcrumbs[2].href).toBe(conversionHref("pdf"))
  })

  it("applies config overrides such as Preflight", () => {
    const header = getPdfHeader(pdf, page("preflight-and-validation"))
    expect(header.title).toBe("Preflight")
    expect(header.subtitle).toBe("Document quality and validation")
  })

  it("gives every registered PDF page a title and subtitle", () => {
    for (const p of pdf.pages) {
      const header = getPdfHeader(pdf, p)
      expect(header.title.length).toBeGreaterThan(0)
      expect(header.subtitle.length).toBeGreaterThan(0)
    }
  })

  it("only links actions to registered routes and never to the current page", () => {
    const registered = new Set(pdf.pages.map((p) => conversionHref("pdf", p.slug)))
    for (const p of [undefined, ...pdf.pages]) {
      for (const action of getPdfHeader(pdf, p).actions) {
        if (action.status === "link") {
          expect(registered.has(action.href)).toBe(true)
          expect(action.href).not.toBe(p && conversionHref("pdf", p.slug))
        }
      }
    }
    expect(getPdfHeader(pdf, page("batch-processing")).actions.some((a) => a.id === "batch-processing")).toBe(false)
  })

  it("has exactly one primary action: Open Workspace, linking to the real Workspace route", () => {
    const primary = getPdfHeader(pdf).actions.filter((a) => a.variant === "primary")
    expect(primary).toHaveLength(1)
    expect(primary[0]).toMatchObject({ id: "open-workspace", status: "link", href: conversionHref("pdf", "workspace") })
  })

  it("does not repeat Open Workspace on the Workspace itself", () => {
    const actions = getPdfHeader(pdf, page("workspace")).actions
    expect(actions.some((a) => a.id === "open-workspace")).toBe(false)
    expect(actions.some((a) => a.variant === "primary")).toBe(false)
  })

  it("consolidates Upload Files and New Conversion into the Workspace action", () => {
    const ids = getPdfHeader(pdf).actions.map((a) => a.id)
    expect(ids).not.toContain("new-conversion")
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("keeps server upload honest and unavailable until a real uploader exists", () => {
    const upload = getPdfHeader(pdf).actions.find((a) => a.id === "upload")
    expect(upload).toMatchObject({ variant: "secondary", status: "unavailable", availability: "planned" })
  })

  it("marks Batch Processing as planned even though its route exists", () => {
    const batch = getPdfHeader(pdf).actions.find((a) => a.id === "batch-processing")
    expect(batch).toMatchObject({ status: "link", availability: "planned" })
  })

  it("never marks any header action as available while no PDF engine exists", () => {
    for (const p of [undefined, ...pdf.pages]) {
      for (const action of getPdfHeader(pdf, p).actions) expect(action.availability).not.toBe("available")
    }
  })

  it("keeps guidelines optional: planned and unlinked without a route, linked once one exists", () => {
    const guidelines = getPdfHeader(pdf).actions.find((a) => a.id === "guidelines")
    expect(guidelines).toMatchObject({ status: "unavailable", availability: "planned" })
    expect(guidelines?.status === "unavailable" && guidelines.reason).toMatch(/Standard Profile/)
    const withGuidelines = { ...pdf, pages: [...pdf.pages, { slug: "guidelines", label: "Guidelines" }] }
    const linked = getPdfHeader(withGuidelines).actions.find((a) => a.id === "guidelines")
    expect(linked).toMatchObject({ variant: "secondary", status: "link" })
    for (const g of [guidelines, linked]) {
      expect(g?.label).toMatch(/optional/i)
      expect(g?.label).not.toMatch(/required/i)
    }
  })
})

describe("PdfHeaderActions", () => {
  it("renders the primary action as a described link and secondary actions behind a menu trigger", () => {
    const html = renderToStaticMarkup(h(PdfHeaderActions, { actions: getPdfHeader(pdf).actions }))
    const link = html.match(/<a\b[^>]*>/)?.[0] ?? ""
    expect(link).toContain(`href="${conversionHref("pdf", "workspace")}"`)
    expect(link).toContain('aria-describedby="pdf-action-open-workspace-hint"')
    expect(html).toContain('id="pdf-action-open-workspace-hint"')
    expect(html).toMatch(/<button[^>]*aria-haspopup="menu"[^>]*>[\s\S]*?More actions[\s\S]*?<\/button>/)
    expect(html).not.toContain('aria-label="More PDF actions"')
    expect(html).not.toContain("<button disabled")
  })

  it("renders no primary button on the Workspace, only the secondary menu", () => {
    const html = renderToStaticMarkup(h(PdfHeaderActions, { actions: getPdfHeader(pdf, page("workspace")).actions }))
    expect(html).not.toContain("<a ")
    expect(html).toContain("More actions")
  })

  it("renders nothing when there are no actions", () => {
    expect(renderToStaticMarkup(h(PdfHeaderActions, { actions: [] }))).toBe("")
  })
})

describe("PdfSectionPage header", () => {
  it("renders one h1 and a breadcrumb nav with the current page marked", () => {
    const html = renderToStaticMarkup(h(PdfSectionPage, { module: pdf, icon: pdf.icon }))
    expect(html.match(/<h1/g)).toHaveLength(1)
    expect(html).toContain('aria-label="Breadcrumb"')
    expect(html).toMatch(/aria-current="page"[^>]*>Overview</)
    expect(html).toContain(">PDF Conversion</h1>")
  })
})
