import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import {
  capabilitiesByCategory,
  deriveFormatAvailability,
  PDF_CAPABILITIES,
  PDF_CAPABILITY_CATEGORIES,
} from "@/components/publishing/conversion/pdf/pdf-capabilities"
import { PdfOverview } from "@/components/publishing/conversion/pdf/pdf-overview"
import { PdfGuidelinesSummary } from "@/components/publishing/conversion/pdf/pdf-overview-panels"
import { conversionHref, getConversionModule } from "@/lib/conversion-modules"

const pdf = getConversionModule("pdf")!

describe("PDF capability registry", () => {
  it("defines the five capability groups with every required capability", () => {
    expect(PDF_CAPABILITY_CATEGORIES.map((c) => c.label)).toEqual([
      "PDF to Documents",
      "PDF to Publishing",
      "PDF to Images",
      "Documents to PDF",
      "Advanced PDF",
    ])
    const counts = capabilitiesByCategory().map((c) => c.capabilities.length)
    expect(counts).toEqual([6, 6, 5, 6, 13])
    expect(new Set(PDF_CAPABILITIES.map((c) => c.id)).size).toBe(PDF_CAPABILITIES.length)
  })

  it("never marks a capability available without an implemented PDF engine", () => {
    expect(PDF_CAPABILITIES.filter((c) => c.status === "available")).toEqual([])
  })

  it("derives format availability from capabilities, not a static list", () => {
    const outputs = deriveFormatAvailability("output")
    expect(outputs.find((f) => f.format === "SVG")?.status).toBe("unsupported")
    expect(outputs.find((f) => f.format === "DOCX")?.status).toBe("planned")
    const inputs = deriveFormatAvailability("input").map((f) => f.format)
    expect(inputs).toEqual(expect.arrayContaining(["PDF", "DOCX", "XLSX", "PPTX", "HTML", "XHTML", "XML", "JPEG", "PNG", "TIFF"]))
  })

  it("lets a format inherit the best status of any capability using it", () => {
    const formats = deriveFormatAvailability("output", [
      { id: "a", label: "A", category: "pdf-to-images", inputFormats: ["PDF"], outputFormats: ["PNG"], status: "planned" },
      { id: "b", label: "B", category: "pdf-to-images", inputFormats: ["PDF"], outputFormats: ["PNG"], status: "partial" },
    ])
    expect(formats).toEqual([{ format: "PNG", status: "partial" }])
  })
})

describe("PdfOverview", () => {
  const html = renderToStaticMarkup(h(PdfOverview, { module: pdf }))

  it("renders every overview section", () => {
    for (const heading of [
      "Quick Start",
      "Conversion categories",
      "Supported formats",
      "Client Guidelines",
      "Saved Profiles",
      "Processing Information",
      "Recent activity",
      "Help &amp; format guidance",
    ]) {
      expect(html).toContain(heading)
    }
  })

  it("links only to registered PDF routes and offers no run action", () => {
    expect(html).toContain(`href="${conversionHref("pdf", "workspace")}"`)
    expect(html).toContain(`href="${conversionHref("pdf", "history")}"`)
    expect(html).not.toContain(conversionHref("pdf", "guidelines"))
    expect(html).not.toContain(">Start<")
  })

  it("shows honest empty states without fabricated activity or metrics", () => {
    expect(html).toContain("No recent PDF activity available.")
    expect(html).toContain("No saved profiles yet.")
    expect(html).not.toMatch(/success rate|files converted|processed today/i)
  })

  it("keeps the guidelines step optional", () => {
    expect(html).toMatch(/Add guidelines<\/span><span class="text-xs text-muted-foreground">Optional/)
  })
})

describe("PdfGuidelinesSummary", () => {
  it("treats missing guidelines as a neutral, non-blocking state", () => {
    const html = renderToStaticMarkup(h(PdfGuidelinesSummary))
    expect(html).toContain("Guidelines: Not Provided")
    expect(html).toContain("Company guidelines are optional. Standard conversion settings will be used.")
    expect(html).not.toMatch(/required|error|compliant/i)
  })

  it("renders supplied guideline details without claiming compliance", () => {
    const html = renderToStaticMarkup(
      h(PdfGuidelinesSummary, {
        context: {
          scope: { area: "conversion", service: "pdf" },
          profile: {
            id: "g1",
            name: "House Style",
            companyLabel: "Acme Press",
            version: { profileId: "g1", versionId: "2.1" },
            documentIds: [],
            applicableFormats: ["JATS"],
            reviewStatus: "pending-review",
            availability: "available",
          },
          documents: [],
          rules: [],
        },
      }),
    )
    expect(html).toContain("House Style")
    expect(html).toContain("Acme Press")
    expect(html).toContain("2.1")
    expect(html).toContain("Pending review")
    expect(html).not.toMatch(/compliant/i)
  })
})
