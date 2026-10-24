/**
 * @file components/publishing/conversion/pdf/pdf-formats.ts
 * @module Publishing › Conversion › PDF
 * @kind Pure configuration
 * @summary Format reference for the PDF module: families, extensions, MIME types and variant relationships.
 * @exports PDF_FORMAT_FAMILIES, PDF_FORMATS, PdfFormat, PdfFormatFamilyId, getPdfFormat
 *
 * Keys are the same format labels used by `PDF_CAPABILITIES` input/output lists, so capabilities stay the single
 * source of truth for what can be converted; this file only describes the formats themselves. A format being listed
 * here does not mean any operation supports it. MIME types are the registered types for each format; the Workspace
 * currently checks the filename extension only (see pdf-workspace-config.ts `describeLocalFile`).
 */

export type PdfFormatFamilyId = "pdf" | "office" | "text-structured" | "digital-publishing" | "image"

export const PDF_FORMAT_FAMILIES: readonly { id: PdfFormatFamilyId; label: string }[] = [
  { id: "pdf", label: "PDF formats" },
  { id: "office", label: "Office documents" },
  { id: "text-structured", label: "Text & structured documents" },
  { id: "digital-publishing", label: "Digital publishing" },
  { id: "image", label: "Images & graphics" },
]

export type PdfFormat = {
  /** Display label; matches capability format labels exactly. */
  label: string
  name: string
  family: PdfFormatFamilyId
  extensions: string[]
  mimeTypes: string[]
  /** Set when this is a subtype or profile of another format rather than a separate file type. */
  variantOf?: string
  generation?: "legacy" | "modern" | "open-document"
  /** Standards/profile families: selecting the profile never makes a document conformant by itself. */
  standardProfile?: boolean
  note?: string
}

const PDF_MIME = ["application/pdf"]
const PROFILE_NOTE = "Standard profile family. Version and conformance levels are not registered yet; conformance is never claimed without validation."

export const PDF_FORMATS: readonly PdfFormat[] = [
  { label: "PDF", name: "Portable Document Format", family: "pdf", extensions: ["pdf"], mimeTypes: PDF_MIME },
  { label: "Searchable PDF", name: "PDF with a text layer", family: "pdf", extensions: ["pdf"], mimeTypes: PDF_MIME, variantOf: "PDF", note: "Produced from scanned pages by OCR." },
  { label: "Image-only PDF", name: "Scanned PDF without a text layer", family: "pdf", extensions: ["pdf"], mimeTypes: PDF_MIME, variantOf: "PDF", note: "Text cannot be extracted without OCR." },
  { label: "Tagged PDF", name: "PDF with a structure tree", family: "pdf", extensions: ["pdf"], mimeTypes: PDF_MIME, variantOf: "PDF", note: "Tagging is not detected or produced yet." },
  { label: "PDF/A", name: "PDF/A (ISO 19005) archival profile", family: "pdf", extensions: ["pdf"], mimeTypes: PDF_MIME, variantOf: "PDF", standardProfile: true, note: PROFILE_NOTE },
  { label: "PDF/UA", name: "PDF/UA (ISO 14289) accessibility profile", family: "pdf", extensions: ["pdf"], mimeTypes: PDF_MIME, variantOf: "PDF", standardProfile: true, note: PROFILE_NOTE },
  { label: "PDF/X", name: "PDF/X (ISO 15930) print-exchange profile", family: "pdf", extensions: ["pdf"], mimeTypes: PDF_MIME, variantOf: "PDF", standardProfile: true, note: PROFILE_NOTE },

  { label: "DOC", name: "Word 97–2003 document", family: "office", extensions: ["doc"], mimeTypes: ["application/msword"], generation: "legacy" },
  { label: "DOCX", name: "Word document", family: "office", extensions: ["docx"], mimeTypes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"], generation: "modern" },
  { label: "RTF", name: "Rich Text Format", family: "office", extensions: ["rtf"], mimeTypes: ["application/rtf"], generation: "legacy" },
  { label: "ODT", name: "OpenDocument text", family: "office", extensions: ["odt"], mimeTypes: ["application/vnd.oasis.opendocument.text"], generation: "open-document" },
  { label: "XLS", name: "Excel 97–2003 workbook", family: "office", extensions: ["xls"], mimeTypes: ["application/vnd.ms-excel"], generation: "legacy" },
  { label: "XLSX", name: "Excel workbook", family: "office", extensions: ["xlsx"], mimeTypes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], generation: "modern" },
  { label: "ODS", name: "OpenDocument spreadsheet", family: "office", extensions: ["ods"], mimeTypes: ["application/vnd.oasis.opendocument.spreadsheet"], generation: "open-document" },
  { label: "PPT", name: "PowerPoint 97–2003 presentation", family: "office", extensions: ["ppt"], mimeTypes: ["application/vnd.ms-powerpoint"], generation: "legacy" },
  { label: "PPTX", name: "PowerPoint presentation", family: "office", extensions: ["pptx"], mimeTypes: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"], generation: "modern" },
  { label: "ODP", name: "OpenDocument presentation", family: "office", extensions: ["odp"], mimeTypes: ["application/vnd.oasis.opendocument.presentation"], generation: "open-document" },

  { label: "TXT", name: "Plain text", family: "text-structured", extensions: ["txt"], mimeTypes: ["text/plain"] },
  { label: "MD", name: "Markdown", family: "text-structured", extensions: ["md", "markdown"], mimeTypes: ["text/markdown"] },
  { label: "HTML", name: "HTML document", family: "text-structured", extensions: ["html", "htm"], mimeTypes: ["text/html"] },
  { label: "XHTML", name: "XHTML document", family: "text-structured", extensions: ["xhtml"], mimeTypes: ["application/xhtml+xml"] },
  { label: "XML", name: "Generic XML", family: "text-structured", extensions: ["xml"], mimeTypes: ["application/xml", "text/xml"], note: "Generic XML carries no publishing semantics by itself." },
  { label: "JATS XML", name: "Journal Article Tag Suite XML", family: "text-structured", extensions: ["xml"], mimeTypes: ["application/xml"], variantOf: "XML", note: "A tag-set vocabulary of XML. Conformance requires tag-set and structural validation." },
  { label: "JSON", name: "Structured JSON", family: "text-structured", extensions: ["json"], mimeTypes: ["application/json"], note: "Requires a defined structural mapping; no schema is registered yet." },

  { label: "ePub", name: "EPUB publication", family: "digital-publishing", extensions: ["epub"], mimeTypes: ["application/epub+zip"], note: "Reflowable output is planned; fixed-layout ePub is not registered." },

  { label: "PNG", name: "PNG image", family: "image", extensions: ["png"], mimeTypes: ["image/png"] },
  { label: "JPEG", name: "JPEG image", family: "image", extensions: ["jpg", "jpeg"], mimeTypes: ["image/jpeg"] },
  { label: "TIFF", name: "TIFF image", family: "image", extensions: ["tif", "tiff"], mimeTypes: ["image/tiff"] },
  { label: "SVG", name: "SVG vector graphic", family: "image", extensions: ["svg"], mimeTypes: ["image/svg+xml"], note: "Blocked by current upload and preview security rules." },
]

const BY_LABEL = new Map(PDF_FORMATS.map((format) => [format.label, format]))

export function getPdfFormat(label: string): PdfFormat | undefined {
  return BY_LABEL.get(label)
}
