/**
 * @file components/publishing/conversion/pdf/pdf-format-matrix-model.ts
 * @module Publishing › Conversion › PDF
 * @kind Pure logic
 * @summary Supported Format Matrix: filter model, derived filter options and per-format upload acceptance.
 * @exports PdfMatrixFilters, PDF_MATRIX_DEFAULT_FILTERS, filterPdfCapabilities, pdfMatrixOptions, isFormatAcceptedForUpload,
 *   capabilityDirection, canOpenCapabilityInWorkspace
 *
 * Rows come straight from `PDF_CAPABILITIES`; filtering is local and never mutates capability state.
 */
import {
  PDF_CAPABILITIES,
  PDF_CAPABILITY_CATEGORIES,
  PDF_CAPABILITY_STATUS_META,
  PDF_OPERATION_KIND_META,
  type PdfCapability,
  type PdfCapabilityCategoryId,
  type PdfCapabilityStatus,
} from "@/components/publishing/conversion/pdf/pdf-capabilities"
import { getPdfFormat } from "@/components/publishing/conversion/pdf/pdf-formats"
import { PDF_SOURCE_EXTENSIONS } from "@/components/publishing/conversion/pdf/pdf-workspace-config"

export type PdfMatrixFilters = {
  query: string
  category: PdfCapabilityCategoryId | "all"
  source: string
  target: string
  status: PdfCapabilityStatus | "all"
}

export const PDF_MATRIX_DEFAULT_FILTERS: PdfMatrixFilters = { query: "", category: "all", source: "all", target: "all", status: "all" }

const CATEGORY_LABEL = new Map(PDF_CAPABILITY_CATEGORIES.map((c) => [c.id, c.label]))

function searchText(capability: PdfCapability) {
  const formats = [...capability.inputFormats, ...capability.outputFormats]
  const extensions = formats.flatMap((label) => getPdfFormat(label)?.extensions ?? [])
  return [
    capability.id,
    capability.label,
    CATEGORY_LABEL.get(capability.category),
    PDF_OPERATION_KIND_META[capability.kind].label,
    ...formats,
    ...formats.map((label) => getPdfFormat(label)?.name),
    ...extensions,
    ...extensions.map((ext) => `.${ext}`),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
}

type FilterKey = Exclude<keyof PdfMatrixFilters, "query">

function matches(capability: PdfCapability, filters: PdfMatrixFilters, ignore?: FilterKey) {
  if (ignore !== "category" && filters.category !== "all" && capability.category !== filters.category) return false
  if (ignore !== "source" && filters.source !== "all" && !capability.inputFormats.includes(filters.source)) return false
  if (ignore !== "target" && filters.target !== "all" && !capability.outputFormats.includes(filters.target)) return false
  if (ignore !== "status" && filters.status !== "all" && capability.status !== filters.status) return false
  const terms = filters.query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true
  const text = searchText(capability)
  return terms.every((term) => text.includes(term))
}

export function filterPdfCapabilities(filters: PdfMatrixFilters, capabilities: readonly PdfCapability[] = PDF_CAPABILITIES) {
  return capabilities.filter((capability) => matches(capability, filters))
}

function unique(values: string[]) {
  return [...new Set(values)]
}

/**
 * Source options always list every registered source. Target options narrow to what the other active filters allow,
 * so a user can never pick a target that yields no row purely because of the target choice.
 */
export function pdfMatrixOptions(filters: PdfMatrixFilters, capabilities: readonly PdfCapability[] = PDF_CAPABILITIES) {
  const targets = unique(capabilities.filter((c) => matches(c, filters, "target")).flatMap((c) => c.outputFormats))
  if (filters.target !== "all" && !targets.includes(filters.target)) targets.push(filters.target)
  return {
    categories: PDF_CAPABILITY_CATEGORIES.map(({ id, label }) => ({ value: id, label })),
    sources: unique(capabilities.flatMap((c) => c.inputFormats)),
    targets,
    statuses: unique(capabilities.map((c) => c.status)).map((status) => ({
      value: status as PdfCapabilityStatus,
      label: PDF_CAPABILITY_STATUS_META[status as PdfCapabilityStatus].label,
    })),
  }
}

/** Workspace upload checks the extension only; MIME type and file content are not verified. */
export function isFormatAcceptedForUpload(label: string) {
  const extensions = getPdfFormat(label)?.extensions ?? []
  return extensions.some((ext) => (PDF_SOURCE_EXTENSIONS as readonly string[]).includes(ext))
}

export function capabilityDirection(capability: PdfCapability) {
  return `${capability.inputFormats.join(" / ")} → ${capability.outputFormats.join(" / ")}`
}

/** Only an Available capability may link into the Workspace as an operational entry point. */
export function canOpenCapabilityInWorkspace(capability: PdfCapability) {
  return capability.status === "available"
}

export function categoryLabel(id: PdfCapabilityCategoryId) {
  return CATEGORY_LABEL.get(id) ?? id
}
