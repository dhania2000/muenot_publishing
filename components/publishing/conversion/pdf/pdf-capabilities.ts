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

/**
 * What an entry actually does. Advanced PDF operations are not extension conversions, so they get their own kinds
 * instead of a misleading "PDF → PDF" pair; page rasterization, vector export and embedded-image extraction are
 * kept distinct because they produce different outputs.
 */
export type PdfOperationKind =
  | "format-conversion"
  | "page-rasterization"
  | "vector-export"
  | "image-extraction"
  | "pdf-creation"
  | "text-recognition"
  | "pdf-transformation"
  | "form-processing"
  | "conformance-profile"

export const PDF_OPERATION_KIND_META: Record<PdfOperationKind, { label: string; description: string }> = {
  "format-conversion": { label: "Format conversion", description: "Converts PDF content into a different file format." },
  "page-rasterization": { label: "Page rasterization", description: "Renders each page as a bitmap image." },
  "vector-export": { label: "Page vector export", description: "Exports page drawing as vector graphics." },
  "image-extraction": { label: "Embedded image extraction", description: "Extracts images embedded in the PDF, not page renders." },
  "pdf-creation": { label: "PDF creation", description: "Creates a new PDF from another source format." },
  "text-recognition": { label: "Text recognition", description: "Recognizes text on scanned pages." },
  "pdf-transformation": { label: "PDF → PDF transformation", description: "Changes pages or structure of an existing PDF; the format stays PDF." },
  "form-processing": { label: "Form processing", description: "Works with interactive PDF form fields." },
  "conformance-profile": { label: "Output profile", description: "Prepares a PDF for a standard profile; conformance requires separate validation." },
}

/** Configuration-driven only: no content detection exists, so these describe the operation, not a specific file. */
export type PdfOcrDependency = "required" | "optional" | "not-applicable" | "unknown"

export const PDF_OCR_META: Record<PdfOcrDependency, { label: string; description: string }> = {
  required: { label: "OCR Required", description: "The operation depends on OCR, which is not implemented yet." },
  optional: {
    label: "OCR Optional",
    description: "Text-based PDFs need no OCR; scanned or image-only pages would need OCR to produce editable text. Content detection is not implemented.",
  },
  "not-applicable": { label: "OCR Not Applicable", description: "The operation does not extract text." },
  unknown: { label: "OCR Dependency Unknown", description: "OCR dependency has not been determined for this operation." },
}

export const PDF_UNVERIFIED_FIDELITY = "Output fidelity has not been verified for this conversion."

export type PdfCapability = {
  id: string
  label: string
  category: PdfCapabilityCategoryId
  kind: PdfOperationKind
  /** Format labels as shown to users (e.g. "DOCX"); described in pdf-formats.ts. */
  inputFormats: string[]
  outputFormats: string[]
  status: PdfCapabilityStatus
  /** User-visible limitation or evidence note. */
  note?: string
  ocr: PdfOcrDependency
  /** Documented limitations only; unknowns stay unverified rather than guessed. */
  limitations: string[]
  /** Verified engine reference. Null until an engine is integrated and tested in this module. */
  engineRef: string | null
}

const ENGINE_ELSEWHERE = "Engine exists in another module; PDF integration planned."
const NO_CONFORMANCE = "No conformance validator yet; conformance is never claimed."

const DEFAULT_KIND: Record<PdfCapabilityCategoryId, PdfOperationKind> = {
  "pdf-to-documents": "format-conversion",
  "pdf-to-publishing": "format-conversion",
  "pdf-to-images": "page-rasterization",
  "documents-to-pdf": "pdf-creation",
  "advanced-pdf": "pdf-transformation",
}

const DEFAULT_OCR: Record<PdfOperationKind, PdfOcrDependency> = {
  "format-conversion": "optional",
  "page-rasterization": "not-applicable",
  "vector-export": "not-applicable",
  "image-extraction": "not-applicable",
  "pdf-creation": "not-applicable",
  "text-recognition": "required",
  "pdf-transformation": "not-applicable",
  "form-processing": "not-applicable",
  "conformance-profile": "not-applicable",
}

type CapOptions = { status?: PdfCapabilityStatus; note?: string; kind?: PdfOperationKind; ocr?: PdfOcrDependency; limitations?: string[] }

function cap(
  category: PdfCapabilityCategoryId,
  id: string,
  label: string,
  inputFormats: string[],
  outputFormats: string[],
  { status = "planned", note, kind = DEFAULT_KIND[category], ocr, limitations = [] }: CapOptions = {},
): PdfCapability {
  return {
    id: `pdf.${id}`,
    label,
    category,
    kind,
    inputFormats,
    outputFormats,
    status,
    note,
    ocr: ocr ?? DEFAULT_OCR[kind],
    limitations: status === "available" ? limitations : [...limitations, PDF_UNVERIFIED_FIDELITY],
    engineRef: null,
  }
}

const LEGACY_NOT_ACCEPTED = (formats: string) => `${formats} sources are not accepted by Workspace upload.`
const SEMANTICS = "Heading structure and reading order depend on how the source PDF is tagged; neither is verified."

export const PDF_CAPABILITIES: readonly PdfCapability[] = [
  cap("pdf-to-documents", "to-docx", "PDF to Word", ["PDF"], ["DOCX"], { limitations: ["DOC (legacy) output is not registered."] }),
  cap("pdf-to-documents", "to-xlsx", "PDF to Excel", ["PDF"], ["XLSX"], { limitations: ["Table detection is not implemented; XLS (legacy) output is not registered."] }),
  cap("pdf-to-documents", "to-pptx", "PDF to PowerPoint", ["PDF"], ["PPTX"], { limitations: ["PPT (legacy) output is not registered."] }),
  cap("pdf-to-documents", "to-txt", "PDF to Text", ["PDF"], ["TXT"], { note: ENGINE_ELSEWHERE, limitations: ["Plain text drops layout, tables and images."] }),
  cap("pdf-to-documents", "to-md", "PDF to Markdown", ["PDF"], ["MD"]),
  cap("pdf-to-documents", "to-rtf", "PDF to RTF", ["PDF"], ["RTF"]),

  cap("pdf-to-publishing", "to-xml", "PDF to XML", ["PDF"], ["XML"], { limitations: ["Generic XML output does not imply publishing semantics; no structural mapping is registered."] }),
  cap("pdf-to-publishing", "to-jats", "PDF to JATS XML", ["PDF"], ["JATS XML"], {
    limitations: [
      "JATS needs correct hierarchy, article metadata, sections, references, figures, tables, cross-references and equations.",
      "No JATS tag-set or structural validator exists, so JATS conformance is never claimed.",
    ],
  }),
  cap("pdf-to-publishing", "to-html", "PDF to HTML", ["PDF"], ["HTML"], { limitations: [SEMANTICS] }),
  cap("pdf-to-publishing", "to-xhtml", "PDF to XHTML", ["PDF"], ["XHTML"], { limitations: [SEMANTICS] }),
  cap("pdf-to-publishing", "to-epub", "PDF to ePub", ["PDF"], ["ePub"], {
    limitations: [
      "Only reflowable output is planned; fixed-layout ePub is not registered.",
      "Navigation, metadata, reading order and accessibility properties are not guaranteed from PDF sources.",
    ],
  }),
  cap("pdf-to-publishing", "to-structured", "PDF to Structured Data", ["PDF"], ["JSON"], { limitations: ["No JSON schema or structural mapping is registered."] }),

  cap("pdf-to-images", "to-png", "PDF to PNG", ["PDF"], ["PNG"], { note: "Page rasterization." }),
  cap("pdf-to-images", "to-jpeg", "PDF to JPEG", ["PDF"], ["JPEG"], { note: "Page rasterization." }),
  cap("pdf-to-images", "to-tiff", "PDF to TIFF", ["PDF"], ["TIFF"], { note: "Page rasterization." }),
  cap("pdf-to-images", "to-svg", "PDF to SVG", ["PDF"], ["SVG"], {
    status: "unsupported",
    kind: "vector-export",
    note: "Vector conversion; SVG output is blocked by current upload and preview security rules.",
  }),
  cap("pdf-to-images", "extract-images", "Image Extraction", ["PDF"], ["PNG", "JPEG"], {
    kind: "image-extraction",
    note: `Extracts embedded images, not page renders. ${ENGINE_ELSEWHERE}`,
  }),

  cap("documents-to-pdf", "from-docx", "Word to PDF", ["DOCX"], ["PDF"], { limitations: [LEGACY_NOT_ACCEPTED("DOC, RTF and ODT")] }),
  cap("documents-to-pdf", "from-xlsx", "Excel to PDF", ["XLSX"], ["PDF"], { limitations: [LEGACY_NOT_ACCEPTED("XLS and ODS")] }),
  cap("documents-to-pdf", "from-pptx", "PowerPoint to PDF", ["PPTX"], ["PDF"], { limitations: [LEGACY_NOT_ACCEPTED("PPT and ODP")] }),
  cap("documents-to-pdf", "from-html", "HTML to PDF", ["HTML", "XHTML"], ["PDF"]),
  cap("documents-to-pdf", "from-xml", "XML to PDF", ["XML"], ["PDF"], { limitations: ["Requires a stylesheet or layout mapping; none is registered."] }),
  cap("documents-to-pdf", "from-images", "Images to PDF", ["JPEG", "PNG", "TIFF"], ["PDF"], { limitations: [LEGACY_NOT_ACCEPTED("SVG")] }),

  cap("advanced-pdf", "ocr", "OCR", ["PDF"], ["Searchable PDF"], {
    kind: "text-recognition",
    note: "Only scanned-page detection exists today.",
    limitations: ["Handwriting, complex mathematics and multilingual recognition are not verified."],
  }),
  cap("advanced-pdf", "searchable", "Searchable PDF", ["PDF"], ["Searchable PDF"], { kind: "text-recognition" }),
  cap("advanced-pdf", "merge", "PDF Merge", ["PDF"], ["PDF"]),
  cap("advanced-pdf", "split", "PDF Split", ["PDF"], ["PDF"]),
  cap("advanced-pdf", "compress", "PDF Compression", ["PDF"], ["PDF"]),
  cap("advanced-pdf", "optimize", "PDF Optimization", ["PDF"], ["PDF"]),
  cap("advanced-pdf", "rotate", "Page Rotation", ["PDF"], ["PDF"]),
  cap("advanced-pdf", "crop", "Page Cropping", ["PDF"], ["PDF"]),
  cap("advanced-pdf", "reorder", "Page Reordering", ["PDF"], ["PDF"]),
  cap("advanced-pdf", "forms", "PDF Forms", ["PDF"], ["PDF"], {
    status: "unsupported",
    kind: "form-processing",
    note: "Interactive form actions are rejected by the current PDF validator.",
  }),
  cap("advanced-pdf", "pdfa", "PDF/A", ["PDF"], ["PDF/A"], { kind: "conformance-profile", note: NO_CONFORMANCE }),
  cap("advanced-pdf", "pdfua", "PDF/UA", ["PDF"], ["PDF/UA"], {
    kind: "conformance-profile",
    ocr: "unknown",
    note: NO_CONFORMANCE,
    limitations: ["Tagging and remediation are not implemented."],
  }),
  cap("advanced-pdf", "pdfx", "PDF/X", ["PDF"], ["PDF/X"], { kind: "conformance-profile", note: NO_CONFORMANCE }),
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
