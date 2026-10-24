import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { PDF_CAPABILITIES, PDF_UNVERIFIED_FIDELITY, type PdfCapability } from "@/components/publishing/conversion/pdf/pdf-capabilities"
import { getPdfFormat, PDF_FORMATS } from "@/components/publishing/conversion/pdf/pdf-formats"
import {
  canOpenCapabilityInWorkspace,
  capabilityDirection,
  capabilityRequirements,
  filterPdfCapabilities,
  isFormatAcceptedForUpload,
  PDF_MATRIX_DEFAULT_FILTERS,
  pdfMatrixOptions,
} from "@/components/publishing/conversion/pdf/pdf-format-matrix-model"
import { PdfFormatMatrix, PdfFormatReference } from "@/components/publishing/conversion/pdf/pdf-format-matrix"

const byId = (id: string) => PDF_CAPABILITIES.find((c) => c.id === id)!
const filter = (overrides: Partial<typeof PDF_MATRIX_DEFAULT_FILTERS>) =>
  filterPdfCapabilities({ ...PDF_MATRIX_DEFAULT_FILTERS, ...overrides }).map((c) => c.id)

describe("Format registry", () => {
  it("represents all 36 operations with unique, stable ids", () => {
    expect(PDF_CAPABILITIES).toHaveLength(36)
    expect(new Set(PDF_CAPABILITIES.map((c) => c.id)).size).toBe(36)
    for (const c of PDF_CAPABILITIES) expect(c.id).toMatch(/^pdf\.[a-z0-9-]+$/)
  })

  it("resolves every capability format label to a registered format", () => {
    for (const c of PDF_CAPABILITIES) {
      for (const label of [...c.inputFormats, ...c.outputFormats]) expect(getPdfFormat(label), label).toBeDefined()
    }
    expect(new Set(PDF_FORMATS.map((f) => f.label)).size).toBe(PDF_FORMATS.length)
  })

  it("keeps directions separate: supporting one direction never implies the reverse", () => {
    expect(capabilityDirection(byId("pdf.to-docx"))).toBe("PDF → DOCX")
    expect(capabilityDirection(byId("pdf.from-docx"))).toBe("DOCX → PDF")
    expect(PDF_CAPABILITIES.find((c) => c.inputFormats.includes("MD") && c.outputFormats.includes("PDF"))).toBeUndefined()
  })

  it("classifies Advanced PDF operations by kind rather than as extension conversions", () => {
    const advanced = PDF_CAPABILITIES.filter((c) => c.category === "advanced-pdf")
    expect(advanced.some((c) => c.kind === "format-conversion")).toBe(false)
    expect(["pdf.pdfa", "pdf.pdfua", "pdf.pdfx"].map((id) => byId(id).kind)).toEqual(Array(3).fill("conformance-profile"))
    expect(byId("pdf.ocr").kind).toBe("text-recognition")
    expect(byId("pdf.forms").kind).toBe("form-processing")
  })

  it("distinguishes rasterization, vector export and embedded image extraction", () => {
    expect(byId("pdf.to-png").kind).toBe("page-rasterization")
    expect(byId("pdf.to-svg").kind).toBe("vector-export")
    expect(byId("pdf.extract-images").kind).toBe("image-extraction")
  })

  it("marks standard profiles and variants without claiming conformance", () => {
    for (const label of ["PDF/A", "PDF/UA", "PDF/X"]) {
      expect(getPdfFormat(label)).toMatchObject({ variantOf: "PDF", standardProfile: true })
    }
    expect(getPdfFormat("JATS XML")?.variantOf).toBe("XML")
    expect(getPdfFormat("DOC")?.generation).toBe("legacy")
    expect(getPdfFormat("DOCX")?.generation).toBe("modern")
  })
})

describe("Data integrity", () => {
  it("has no Available capability and no verified engine reference", () => {
    expect(PDF_CAPABILITIES.filter((c) => c.status === "available" || c.engineRef !== null)).toEqual([])
  })

  it("labels fidelity as unverified for every non-available capability and never shows percentages", () => {
    for (const c of PDF_CAPABILITIES) {
      expect(c.limitations).toContain(PDF_UNVERIFIED_FIDELITY)
      expect([c.note, ...c.limitations].join(" ")).not.toMatch(/\d+\s?%|(?<!not )lossless|(?<!not )guarantee/i)
    }
  })

  it("derives OCR from the operation, not the PDF extension", () => {
    expect(byId("pdf.to-docx").ocr).toBe("optional")
    expect(byId("pdf.to-png").ocr).toBe("not-applicable")
    expect(byId("pdf.ocr").ocr).toBe("required")
    expect(byId("pdf.pdfua").ocr).toBe("unknown")
  })

  it("checks upload acceptance against the Workspace extension list", () => {
    expect(isFormatAcceptedForUpload("PDF")).toBe(true)
    expect(isFormatAcceptedForUpload("SVG")).toBe(false)
  })
})

describe("Matrix filtering", () => {
  it("returns every operation with default filters", () => {
    expect(filter({})).toHaveLength(36)
  })

  it("searches case-insensitively across formats, extensions, kinds and categories", () => {
    expect(filter({ query: "jats" })).toEqual(["pdf.to-jats"])
    expect(filter({ query: ".TIF" })).toEqual(expect.arrayContaining(["pdf.to-tiff", "pdf.from-images"]))
    expect(filter({ query: "Rasterization" })).toEqual(["pdf.to-png", "pdf.to-jpeg", "pdf.to-tiff"])
    expect(filter({ query: "pdf to images" }).length).toBeGreaterThan(0)
  })

  it("filters by category, source, target and availability, and combines them", () => {
    expect(filter({ category: "advanced-pdf" })).toHaveLength(13)
    expect(filter({ source: "DOCX" })).toEqual(["pdf.from-docx"])
    expect(filter({ target: "DOCX" })).toEqual(["pdf.to-docx"])
    expect(filter({ status: "unsupported" })).toEqual(["pdf.to-svg", "pdf.forms"])
    expect(filter({ category: "pdf-to-images", status: "unsupported" })).toEqual(["pdf.to-svg"])
    expect(filter({ category: "documents-to-pdf", target: "DOCX" })).toEqual([])
  })

  it("derives filter options from registered data and narrows targets", () => {
    const all = pdfMatrixOptions(PDF_MATRIX_DEFAULT_FILTERS)
    expect(all.sources).toContain("PDF")
    expect(all.statuses.map((s) => s.value).sort()).toEqual(["planned", "unsupported"])
    const narrowed = pdfMatrixOptions({ ...PDF_MATRIX_DEFAULT_FILTERS, category: "pdf-to-images" })
    expect(narrowed.targets).toEqual(["PNG", "JPEG", "TIFF", "SVG"])
  })

  it("never mutates capability state while filtering", () => {
    const before = JSON.stringify(PDF_CAPABILITIES)
    filter({ query: "pdf", status: "planned", category: "advanced-pdf" })
    expect(JSON.stringify(PDF_CAPABILITIES)).toBe(before)
  })
})

describe("Requirements and Workspace actions", () => {
  it("summarizes requirements from registry data only", () => {
    expect(capabilityRequirements(byId("pdf.pdfa"))).toContain("Conformance not validated")
    expect(capabilityRequirements(byId("pdf.to-svg"))[0]).toBe("OCR Not Applicable")
    expect(capabilityRequirements(byId("pdf.to-docx")).some((item) => /known limitation/.test(item))).toBe(true)
  })

  it("only lets Available capabilities open the Workspace", () => {
    expect(PDF_CAPABILITIES.some(canOpenCapabilityInWorkspace)).toBe(false)
    const available: PdfCapability = { ...byId("pdf.to-docx"), status: "available" }
    expect(canOpenCapabilityInWorkspace(available)).toBe(true)
  })
})

describe("PdfFormatMatrix rendering", () => {
  const html = renderToStaticMarkup(h(PdfFormatMatrix, { workspaceHref: "/modules/publishing/conversion/pdf/workspace" }))

  it("renders an accessible table with caption, column headers and labelled filters", () => {
    expect(html).toContain("<caption")
    for (const header of ["Source", "Output / operation", "Category", "Availability", "Requirements", "Action"]) {
      expect(html).toContain(`>${header}</th>`)
    }
    expect(html).toContain('role="search"')
    expect(html).toMatch(/aria-expanded="false"/)
    expect(html).toContain("Showing 36 of 36 operations")
  })

  it("offers no Workspace link or fake run action while nothing is available", () => {
    expect(html).not.toContain("Open Workspace")
    expect(html).toContain("Not runnable yet")
  })

  it("does not require or flag missing guidelines", () => {
    expect(html).not.toMatch(/guidelines? (are )?required|missing guideline|compliant/i)
  })

  it("renders the format reference grouped by family", () => {
    const reference = renderToStaticMarkup(h(PdfFormatReference))
    for (const family of ["PDF formats", "Office documents", "Text &amp; structured documents", "Digital publishing", "Images &amp; graphics"]) {
      expect(reference).toContain(family)
    }
  })
})
