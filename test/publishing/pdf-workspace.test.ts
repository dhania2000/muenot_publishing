import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { PdfWorkspace } from "@/components/publishing/conversion/pdf/pdf-workspace"
import {
  describeLocalFile,
  formatBytes,
  getTargetFormatOptions,
  getWorkflowStepState,
  nextWorkflowStep,
  PDF_GUIDELINE_PRIORITY,
  PDF_WORKFLOW_STEPS,
  resolveSettingsProfile,
} from "@/components/publishing/conversion/pdf/pdf-workspace-config"
import { PdfSectionPage } from "@/components/publishing/conversion/pdf/pdf-section-page"
import { getPdfSection } from "@/components/publishing/conversion/pdf/pdf-sections"
import { getConversionModule, getConversionPage } from "@/lib/conversion-modules"
import { FileText } from "lucide-react"

const file = (name: string, size = 1024, type = "application/pdf") => ({ name, size, type, lastModified: 0 })

describe("workflow contract", () => {
  it("has the six required stages with Guidelines marked optional", () => {
    expect(PDF_WORKFLOW_STEPS.map((s) => s.label)).toEqual(["Upload", "Configure", "Guidelines", "Preview", "Validate", "Export"])
    expect(PDF_WORKFLOW_STEPS.filter((s) => s.optional).map((s) => s.id)).toEqual(["guidelines"])
  })

  it("supports Upload → Configure → Preview → Validate → Export without guidelines", () => {
    const path = ["upload"] as string[]
    let step = nextWorkflowStep("upload")
    while (step) {
      path.push(step)
      step = nextWorkflowStep(step)
    }
    expect(path).toEqual(["upload", "configure", "preview", "validate", "export"])
    expect(nextWorkflowStep("configure", { includeGuidelines: true })).toBe("guidelines")
  })

  it("never reports a stage as completed", () => {
    for (const current of PDF_WORKFLOW_STEPS) {
      for (const step of PDF_WORKFLOW_STEPS) {
        expect(["current", "upcoming", "planned"]).toContain(getWorkflowStepState(step, current.id))
      }
    }
  })
})

describe("local source files", () => {
  it("keeps only metadata the browser provides and flags unsupported, empty and duplicate files", () => {
    const ok = describeLocalFile(file("Book.PDF"), [], "a")
    expect(ok).toMatchObject({ name: "Book.PDF", extension: "pdf", mimeType: "application/pdf", sizeBytes: 1024, issue: null })
    expect(Object.keys(ok)).not.toContain("pageCount")
    expect(describeLocalFile(file("run.exe"), [], "b").issue).toBe("unsupported-type")
    expect(describeLocalFile(file("empty.pdf", 0), [], "c").issue).toBe("empty-file")
    expect(describeLocalFile(file("Book.PDF"), [ok], "d").issue).toBe("duplicate")
  })

  it("formats sizes", () => {
    expect(formatBytes(512)).toBe("512 B")
    expect(formatBytes(1536)).toBe("1.5 KB")
    expect(formatBytes(20 * 1024 * 1024)).toBe("20 MB")
  })
})

describe("settings and optional guidelines", () => {
  it("lists target formats with their real registry status (none falsely available)", () => {
    const options = getTargetFormatOptions()
    expect(options.length).toBeGreaterThan(0)
    expect(options.every((o) => o.status !== "available")).toBe(true)
  })

  it("uses the Standard Profile when no guidelines are provided and never requires guidelines", () => {
    expect(resolveSettingsProfile("not-provided")).toMatchObject({ id: "standard", label: "Standard Profile", requiresGuidelines: false })
    expect(PDF_GUIDELINE_PRIORITY.map((r) => r.id)).toEqual(["job", "company", "preset", "standard"])
  })
})

describe("PdfWorkspace render", () => {
  const html = renderToStaticMarkup(h(PdfWorkspace, {}))

  it("renders all workspace regions with honest empty states", () => {
    for (const text of [
      "Source Files",
      "Conversion Settings",
      "Processing &amp; Validation",
      "No files uploaded. Add a document to begin.",
      "Select or upload a document to preview.",
      "No active processing job.",
      "Company guidelines are optional. Standard settings will be used.",
    ]) {
      expect(html).toContain(text)
    }
    expect(html).toContain('aria-label="Workflow steps"')
    expect(html).toContain('aria-current="step"')
  })

  it("does not show fake progress, success or compliance", () => {
    expect(html).not.toMatch(/\d+%/)
    expect(html).not.toMatch(/completed|succeeded|compliant/i)
    expect(html).not.toContain('role="progressbar"')
  })

  it("keeps processing actions disabled with a visible reason", () => {
    for (const label of ["Validate", "Process", "Download", "Save Settings"]) {
      expect(html).toMatch(new RegExp(`<button[^>]*disabled[^>]*>(<svg[^]*?</svg>)?${label}</button>`))
    }
    expect(html).toContain("Processing is planned for a later phase.")
  })

  it("exposes keyboard-operable collapse controls with aria-expanded", () => {
    expect(html).toContain('aria-label="Collapse source files panel"')
    expect(html).toContain('aria-label="Collapse settings panel"')
    expect(html).toMatch(/aria-expanded="false"[^>]*>.*?Processing &amp; Validation/)
  })
})

describe("workspace route integration", () => {
  it("marks the Workspace section UI-ready and renders inside the shared PDF shell", () => {
    expect(getPdfSection("workspace")?.status).toBe("ui-ready")
    const pdf = getConversionModule("pdf")!
    const html = renderToStaticMarkup(
      h(PdfSectionPage, { module: pdf, page: getConversionPage(pdf, "workspace"), icon: FileText }, h(PdfWorkspace, {})),
    )
    expect(html).toContain('data-slot="pdf-workspace"')
    expect(html).toContain('data-pdf-layout="full"')
    expect(html).not.toContain("is planned. Its tools will appear here")
  })
})
