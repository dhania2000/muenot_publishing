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
import { FileImage, FileInput, FileOutput, FileText, Settings2, type LucideIcon } from "lucide-react"

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
}

export const PDF_CAPABILITY_CATEGORIES: readonly PdfCapabilityCategory[] = [
  { id: "pdf-to-documents", label: "PDF to Documents", description: "Editable office and plain-text documents from PDF sources.", icon: FileOutput },
  { id: "pdf-to-publishing", label: "PDF to Publishing", description: "Structured publishing formats for journals, books and the web.", icon: FileText },
  { id: "pdf-to-images", label: "PDF to Images", description: "Page renders and embedded image extraction.", icon: FileImage },
  { id: "documents-to-pdf", label: "Documents to PDF", description: "Print-ready PDF output from office, web and image sources.", icon: FileInput },
  { id: "advanced-pdf", label: "Advanced PDF", description: "Page operations, optimization, OCR and conformance profiles.", icon: Settings2 },
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
  cap("pdf-to-documents", "to-md", "PDF to Markdown", ["PDF"], ["Markdown"]),
  cap("pdf-to-documents", "to-rtf", "PDF to RTF", ["PDF"], ["RTF"]),

  cap("pdf-to-publishing", "to-xml", "PDF to XML", ["PDF"], ["XML"]),
  cap("pdf-to-publishing", "to-jats", "PDF to JATS", ["PDF"], ["JATS"]),
  cap("pdf-to-publishing", "to-html", "PDF to HTML", ["PDF"], ["HTML"]),
  cap("pdf-to-publishing", "to-xhtml", "PDF to XHTML", ["PDF"], ["XHTML"]),
  cap("pdf-to-publishing", "to-epub", "PDF to ePub", ["PDF"], ["ePub"]),
  cap("pdf-to-publishing", "to-structured", "PDF to Structured Data", ["PDF"], ["JSON"]),

  cap("pdf-to-images", "to-png", "PDF to PNG", ["PDF"], ["PNG"]),
  cap("pdf-to-images", "to-jpeg", "PDF to JPEG", ["PDF"], ["JPEG"]),
  cap("pdf-to-images", "to-tiff", "PDF to TIFF", ["PDF"], ["TIFF"]),
  cap("pdf-to-images", "to-svg", "PDF to SVG", ["PDF"], ["SVG"], "unsupported", "SVG output is blocked by current upload and preview security rules."),
  cap("pdf-to-images", "extract-images", "Image Extraction", ["PDF"], ["PNG", "JPEG"], "planned", ENGINE_ELSEWHERE),

  cap("documents-to-pdf", "from-docx", "Word to PDF", ["DOCX"], ["PDF"]),
  cap("documents-to-pdf", "from-xlsx", "Excel to PDF", ["XLSX"], ["PDF"]),
  cap("documents-to-pdf", "from-pptx", "PowerPoint to PDF", ["PPTX"], ["PDF"]),
  cap("documents-to-pdf", "from-html", "HTML to PDF", ["HTML", "XHTML"], ["PDF"]),
  cap("documents-to-pdf", "from-xml", "XML to PDF", ["XML"], ["PDF"]),
  cap("documents-to-pdf", "from-images", "Images to PDF", ["JPEG", "PNG", "TIFF"], ["PDF"]),

  cap("advanced-pdf", "merge", "PDF Merge", ["PDF"], ["PDF"]),
  cap("advanced-pdf", "split", "PDF Split", ["PDF"], ["PDF"]),
  cap("advanced-pdf", "compress", "PDF Compression", ["PDF"], ["PDF"]),
  cap("advanced-pdf", "optimize", "PDF Optimization", ["PDF"], ["PDF"]),
  cap("advanced-pdf", "rotate", "Page Rotation", ["PDF"], ["PDF"]),
  cap("advanced-pdf", "crop", "Page Cropping", ["PDF"], ["PDF"]),
  cap("advanced-pdf", "reorder", "Page Reordering", ["PDF"], ["PDF"]),
  cap("advanced-pdf", "ocr", "OCR", ["PDF"], ["PDF"], "planned", "Only scanned-page detection exists today."),
  cap("advanced-pdf", "searchable", "Searchable PDF", ["PDF"], ["PDF"]),
  cap("advanced-pdf", "pdfa", "PDF/A", ["PDF"], ["PDF"], "planned", "No conformance validator yet; conformance is never claimed."),
  cap("advanced-pdf", "pdfua", "PDF/UA", ["PDF"], ["PDF"], "planned", "No conformance validator yet; conformance is never claimed."),
  cap("advanced-pdf", "pdfx", "PDF/X", ["PDF"], ["PDF"], "planned", "No conformance validator yet; conformance is never claimed."),
  cap("advanced-pdf", "forms", "PDF Forms", ["PDF"], ["PDF"], "unsupported", "Interactive form actions are rejected by the current PDF validator."),
]

export function capabilitiesByCategory() {
  return PDF_CAPABILITY_CATEGORIES.map((category) => ({
    ...category,
    capabilities: PDF_CAPABILITIES.filter((capability) => capability.category === category.id),
  }))
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
