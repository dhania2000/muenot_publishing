/**
 * @file components/publishing/conversion/pdf/pdf-capabilities.ts
 * @module Publishing › Conversion › PDF
 * @kind Pure configuration
 * @summary Static registry of PDF capability groups, their formats and honest availability status.
 * @exports PDF_CAPABILITY_CATEGORIES, PDF_CAPABILITIES, PdfCapability, PdfCapabilityStatus, PDF_CAPABILITY_STATUS_META,
 *   capabilitiesByCategory, summarizeStatuses, deriveFormatAvailability
 * @see PDF_PHASE1_TASK2_UI_ARCHITECTURE.md §10
 *
 * Status evidence (Task 1 audit, Task 2 §10.2): no PDF conversion route, uploader or engine is
 * exposed in this module yet. Engines that exist elsewhere (text collection, image extraction in
 * Alt Text) stay "planned" here with a note — "engine exists in another module" ≠ available in PDF.
 * Change a status only when the capability is implemented and verified end-to-end.
 */
import { BookOpen, FilePlus, FileText, Images, SlidersHorizontal, type LucideIcon } from "lucide-react"

export type PdfCapabilityStatus = "available" | "partial" | "ui-ready" | "planned" | "unsupported" | "unverified"

export const PDF_CAPABILITY_STATUS_META: Record<PdfCapabilityStatus, { label: string; description: string; rank: number }> = {
  available: { label: "Available", description: "Implemented and verified.", rank: 0 },
  partial: { label: "Partially Available", description: "Some operations work; limitations remain.", rank: 1 },
  "ui-ready": { label: "UI Ready", description: "Interface exists; processing is pending.", rank: 2 },
  unverified: { label: "Not Verified", description: "Functionality has not been confirmed.", rank: 3 },
  planned: { label: "Planned", description: "Requires future development.", rank: 4 },
  unsupported: { label: "Unsupported", description: "Cannot currently be performed.", rank: 5 },
}

export const PDF_CAPABILITY_STATUS_ORDER = (Object.keys(PDF_CAPABILITY_STATUS_META) as PdfCapabilityStatus[]).sort(
  (a, b) => PDF_CAPABILITY_STATUS_META[a].rank - PDF_CAPABILITY_STATUS_META[b].rank,
)

export type PdfCapabilityCategoryId = "pdf-to-documents" | "pdf-to-publishing" | "pdf-to-images" | "documents-to-pdf" | "advanced-pdf"

export type PdfCapabilityCategory = {
  id: PdfCapabilityCategoryId
  label: string
  description: string
  icon: LucideIcon
  order: number
  /**
   * Which side of each capability the card lists as its formats: target formats for PDF → X,
   * source formats for X → PDF, and PDF itself for in-place operations.
   */
  formatAxis: "output" | "input" | "pdf"
}

export const PDF_CAPABILITY_CATEGORIES: readonly PdfCapabilityCategory[] = [
  {
    id: "pdf-to-documents",
    label: "PDF to Documents",
    description: "Convert PDF content into editable documents, spreadsheets, presentations, and text formats.",
    icon: FileText,
    order: 1,
    formatAxis: "output",
  },
  {
    id: "pdf-to-publishing",
    label: "PDF to Publishing",
    description: "Transform PDF content into structured publishing formats for digital distribution and editorial workflows.",
    icon: BookOpen,
    order: 2,
    formatAxis: "output",
  },
  {
    id: "pdf-to-images",
    label: "PDF to Images",
    description: "Export PDF pages as images or extract visual assets for design and publishing workflows.",
    icon: Images,
    order: 3,
    formatAxis: "output",
  },
  {
    id: "documents-to-pdf",
    label: "Documents to PDF",
    description: "Generate PDF documents from office files, web content, structured documents, and images.",
    icon: FilePlus,
    order: 4,
    formatAxis: "input",
  },
  {
    id: "advanced-pdf",
    label: "Advanced PDF",
    description: "Manage, optimize, recognize, and prepare PDFs for professional processing and applicable document standards.",
    icon: SlidersHorizontal,
    order: 5,
    formatAxis: "pdf",
  },
]

export type PdfCapability = {
  id: string
  label: string
  category: PdfCapabilityCategoryId
  /** Format labels as shown to users (e.g. "DOCX"). */
  inputFormats: string[]
  outputFormats: string[]
  status: PdfCapabilityStatus
  /** User-visible limitation or evidence note. */
  note?: string
}

const ENGINE_ELSEWHERE = "Engine exists in another module; PDF integration planned."

function cap(
  category: PdfCapabilityCategoryId,
  id: string,
  label: string,
  inputFormats: string[],
  outputFormats: string[],
  status: PdfCapabilityStatus = "planned",
  note?: string,
): PdfCapability {
  return { id: `pdf.${id}`, label, category, inputFormats, outputFormats, status, note }
}

export const PDF_CAPABILITIES: readonly PdfCapability[] = [
  cap("pdf-to-documents", "to-docx", "PDF to Word", ["PDF"], ["DOCX"]),
  cap("pdf-to-documents", "to-xlsx", "PDF to Excel", ["PDF"], ["XLSX"]),
  cap("pdf-to-documents", "to-pptx", "PDF to PowerPoint", ["PDF"], ["PPTX"]),
  cap("pdf-to-documents", "to-txt", "PDF to Text", ["PDF"], ["TXT"], "planned", ENGINE_ELSEWHERE),
  cap("pdf-to-documents", "to-md", "PDF to Markdown", ["PDF"], ["MD"]),
  cap("pdf-to-documents", "to-rtf", "PDF to RTF", ["PDF"], ["RTF"]),

  cap("pdf-to-publishing", "to-xml", "PDF to XML", ["PDF"], ["XML"]),
  cap("pdf-to-publishing", "to-jats", "PDF to JATS XML", ["PDF"], ["JATS XML"]),
  cap("pdf-to-publishing", "to-html", "PDF to HTML", ["PDF"], ["HTML"]),
  cap("pdf-to-publishing", "to-xhtml", "PDF to XHTML", ["PDF"], ["XHTML"]),
  cap("pdf-to-publishing", "to-epub", "PDF to ePub", ["PDF"], ["ePub"]),
  cap("pdf-to-publishing", "to-structured", "PDF to Structured Data", ["PDF"], ["JSON"]),

  cap("pdf-to-images", "to-png", "PDF to PNG", ["PDF"], ["PNG"], "planned", "Page rasterization."),
  cap("pdf-to-images", "to-jpeg", "PDF to JPEG", ["PDF"], ["JPEG"], "planned", "Page rasterization."),
  cap("pdf-to-images", "to-tiff", "PDF to TIFF", ["PDF"], ["TIFF"], "planned", "Page rasterization."),
  cap("pdf-to-images", "to-svg", "PDF to SVG", ["PDF"], ["SVG"], "unsupported", "Vector conversion; SVG output is blocked by current upload and preview security rules."),
  cap("pdf-to-images", "extract-images", "Image Extraction", ["PDF"], ["PNG", "JPEG"], "planned", `Extracts embedded images, not page renders. ${ENGINE_ELSEWHERE}`),

  cap("documents-to-pdf", "from-docx", "Word to PDF", ["DOCX"], ["PDF"]),
  cap("documents-to-pdf", "from-xlsx", "Excel to PDF", ["XLSX"], ["PDF"]),
  cap("documents-to-pdf", "from-pptx", "PowerPoint to PDF", ["PPTX"], ["PDF"]),
  cap("documents-to-pdf", "from-html", "HTML to PDF", ["HTML", "XHTML"], ["PDF"]),
  cap("documents-to-pdf", "from-xml", "XML to PDF", ["XML"], ["PDF"]),
  cap("documents-to-pdf", "from-images", "Images to PDF", ["JPEG", "PNG", "TIFF"], ["PDF"]),

  cap("advanced-pdf", "ocr", "OCR", ["PDF"], ["PDF"], "planned", "Only scanned-page detection exists today."),
  cap("advanced-pdf", "searchable", "Searchable PDF", ["PDF"], ["PDF"]),
  cap("advanced-pdf", "merge", "PDF Merge", ["PDF"], ["PDF"]),
  cap("advanced-pdf", "split", "PDF Split", ["PDF"], ["PDF"]),
  cap("advanced-pdf", "compress", "PDF Compression", ["PDF"], ["PDF"]),
  cap("advanced-pdf", "optimize", "PDF Optimization", ["PDF"], ["PDF"]),
  cap("advanced-pdf", "rotate", "Page Rotation", ["PDF"], ["PDF"]),
  cap("advanced-pdf", "crop", "Page Cropping", ["PDF"], ["PDF"]),
  cap("advanced-pdf", "reorder", "Page Reordering", ["PDF"], ["PDF"]),
  cap("advanced-pdf", "forms", "PDF Forms", ["PDF"], ["PDF"], "unsupported", "Interactive form actions are rejected by the current PDF validator."),
  cap("advanced-pdf", "pdfa", "PDF/A", ["PDF"], ["PDF/A"], "planned", "No conformance validator yet; conformance is never claimed."),
  cap("advanced-pdf", "pdfua", "PDF/UA", ["PDF"], ["PDF/UA"], "planned", "No conformance validator yet; conformance is never claimed."),
  cap("advanced-pdf", "pdfx", "PDF/X", ["PDF"], ["PDF/X"], "planned", "No conformance validator yet; conformance is never claimed."),
]

export function capabilitiesByCategory() {
  return [...PDF_CAPABILITY_CATEGORIES]
    .sort((a, b) => a.order - b.order)
    .map((category) => ({
      ...category,
      capabilities: PDF_CAPABILITIES.filter((capability) => capability.category === category.id),
    }))
}

/** Formats a category card lists, following the category's `formatAxis`. */
export function categoryFormats(category: PdfCapabilityCategory, capabilities: readonly PdfCapability[]) {
  if (category.formatAxis === "pdf") return ["PDF"]
  const key = category.formatAxis === "input" ? "inputFormats" : "outputFormats"
  return [...new Set(capabilities.flatMap((capability) => capability[key]))]
}

export type PdfCategoryAvailability = {
  /** Only "runnable" categories may expose an entry action that implies processing. */
  runnable: boolean
  summary: string
}

/** Category availability is derived from its capabilities; a category is never "available" as a whole by fiat. */
export function summarizeCategoryAvailability(capabilities: readonly PdfCapability[]): PdfCategoryAvailability {
  const available = capabilities.filter((capability) => capability.status === "available").length
  const total = capabilities.length
  if (available === total && total > 0) return { runnable: true, summary: "All operations can run." }
  if (available > 0) return { runnable: true, summary: `${available} of ${total} operations can run.` }
  return { runnable: false, summary: "No operations in this category can run yet." }
}

/** Counts per status, in display order, omitting statuses with no capabilities. */
export function summarizeStatuses(capabilities: readonly PdfCapability[]) {
  return PDF_CAPABILITY_STATUS_ORDER.map((status) => ({
    status,
    count: capabilities.filter((capability) => capability.status === status).length,
  })).filter(({ count }) => count > 0)
}

export type FormatAvailability = { format: string; status: PdfCapabilityStatus }

/**
 * Each format takes the best status of any capability that uses it in that direction, so a format
 * is never shown as more available than the capabilities that actually handle it.
 */
export function deriveFormatAvailability(direction: "input" | "output", capabilities: readonly PdfCapability[] = PDF_CAPABILITIES) {
  const best = new Map<string, PdfCapabilityStatus>()
  for (const capability of capabilities) {
    const formats = direction === "input" ? capability.inputFormats : capability.outputFormats
    for (const format of formats) {
      const current = best.get(format)
      if (!current || PDF_CAPABILITY_STATUS_META[capability.status].rank < PDF_CAPABILITY_STATUS_META[current].rank) {
        best.set(format, capability.status)
      }
    }
  }
  return [...best].map(([format, status]): FormatAvailability => ({ format, status }))
}
