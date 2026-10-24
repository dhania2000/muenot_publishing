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
  it("uses the enterprise overview copy and Publishing / Conversion / PDF trail", () => {
    const header = getPdfHeader(pdf)
    expect(header.title).toBe("PDF")
    expect(header.subtitle).toBe("Professional Document Conversion & Processing")
    expect(header.breadcrumbs.map((c) => c.label)).toEqual(["Publishing", "Conversion", "PDF"])
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

  it("keeps Upload Files honest and unavailable until a real uploader exists", () => {
    const upload = getPdfHeader(pdf).actions.find((a) => a.id === "upload")
    expect(upload).toMatchObject({ variant: "primary", status: "unavailable" })
  })

  it("never presents guidelines as required and hides them while no Guidelines route exists", () => {
    const actions = getPdfHeader(pdf).actions
    expect(actions.some((a) => a.id === "guidelines")).toBe(false)
    const withGuidelines = { ...pdf, pages: [...pdf.pages, { slug: "guidelines", label: "Guidelines" }] }
    const guidelines = getPdfHeader(withGuidelines).actions.find((a) => a.id === "guidelines")
    expect(guidelines).toMatchObject({ variant: "secondary", status: "link" })
    expect(guidelines?.label).toMatch(/optional/i)
    expect(guidelines?.label).not.toMatch(/required/i)
  })
})

describe("PdfHeaderActions", () => {
  it("renders unavailable actions as disabled buttons described by a visible reason", () => {
    const html = renderToStaticMarkup(h(PdfHeaderActions, { actions: getPdfHeader(pdf).actions }))
    expect(html).toMatch(/<button[^>]*disabled[^>]*aria-describedby="pdf-action-upload-hint"|aria-describedby="pdf-action-upload-hint"[^>]*disabled/)
    expect(html).toContain('id="pdf-action-upload-hint"')
    expect(html).toContain(`href="${conversionHref("pdf", "batch-processing")}"`)
  })
})

describe("PdfSectionPage header", () => {
  it("renders one h1 and a breadcrumb nav with the current page marked", () => {
    const html = renderToStaticMarkup(h(PdfSectionPage, { module: pdf, icon: pdf.icon }))
    expect(html.match(/<h1/g)).toHaveLength(1)
    expect(html).toContain('aria-label="Breadcrumb"')
    expect(html).toMatch(/aria-current="page"[^>]*>PDF</)
    expect(html).toContain("Professional Document Conversion &amp; Processing")
  })
})
