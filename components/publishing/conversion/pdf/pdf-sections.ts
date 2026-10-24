/**
 * @file components/publishing/conversion/pdf/pdf-sections.ts
 * @module Publishing › Conversion › PDF
 * @kind Pure configuration
 * @summary Single source of truth for the 12 PDF sections: order, labels, breadcrumb, header copy, layout and status.
 * @exports PDF_SECTIONS, PdfSection, PdfSectionStatus, getPdfSection, isPdfSectionNavigable, pdfSectionHref
 * @see PDF_PHASE1_TASK2_UI_ARCHITECTURE.md §4.0
 *
 * Header, breadcrumbs, internal navigation and layout all read from this table.
 *
 * `status` describes the section's functionality, not its route. Navigation availability is derived
 * from the conversion registry (`module.pages`): a section is navigable only when its route exists, so
 * enabling a future section means adding its registry row and updating `status` here.
 *
 * Guidelines is always optional: no other section depends on its status or availability.
 */
import {
  BookOpen,
  ClipboardCheck,
  Eye,
  FileOutput,
  History,
  LayoutDashboard,
  LayoutTemplate,
  Layers,
  ScanText,
  ShieldCheck,
  SlidersHorizontal,
  SquarePen,
  type LucideIcon,
} from "lucide-react"
import { conversionHref, type ConversionModule } from "@/lib/conversion-modules"
import type { PdfSectionLayout } from "@/components/publishing/conversion/pdf/pdf-module-layout"

/**
 * - available: section exists and its supported actions work.
 * - ui-ready: frontend exists; some processing functions are not implemented.
 * - planned: functionality arrives in a later task (a route shell may already exist).
 * - unavailable: cannot be accessed in the current configuration.
 */
export type PdfSectionStatus = "available" | "ui-ready" | "planned" | "unavailable"

export type PdfSection = {
  /** Stable identifier; never changes even if labels or slugs do. */
  id: string
  /** Route segment under the PDF module; "" is the module root (Overview). */
  slug: string
  /** Short display name used in tabs and menus. */
  label: string
  breadcrumbLabel: string
  /** Header title override (Overview shows the module name). Defaults to `label`. */
  headerTitle?: string
  description: string
  icon: LucideIcon
  order: number
  status: PdfSectionStatus
  layout: PdfSectionLayout
}

const DEFAULT: PdfSectionLayout = { width: "default", spacing: "standard" }
const WIDE: PdfSectionLayout = { width: "wide", spacing: "standard" }
const FULL: PdfSectionLayout = { width: "full", spacing: "compact" }

/**
 * Status evidence (Task 12 QA): Overview and Workspace have a working frontend (local file intake, preview and
 * settings shells) but no conversion engine or server upload, so they are "ui-ready", never "available". Every
 * other route renders the shared header and an honest "planned" body. Guidelines and Profiles & Presets have no
 * PDF route.
 */
export const PDF_SECTIONS: readonly PdfSection[] = [
  { id: "overview", slug: "", label: "Overview", breadcrumbLabel: "Overview", headerTitle: "PDF", description: "Professional Document Conversion & Processing", icon: LayoutDashboard, order: 1, status: "ui-ready", layout: DEFAULT },
  { id: "workspace", slug: "workspace", label: "Workspace", breadcrumbLabel: "Workspace", description: "Configure and process your documents", icon: SquarePen, order: 2, status: "ui-ready", layout: FULL },
  { id: "guidelines", slug: "guidelines", label: "Guidelines", breadcrumbLabel: "Guidelines", description: "Optional company-specific instructions", icon: BookOpen, order: 3, status: "planned", layout: DEFAULT },
  { id: "output-settings", slug: "output-settings", label: "Output Settings", breadcrumbLabel: "Output Settings", description: "Output format, quality and delivery options", icon: SlidersHorizontal, order: 4, status: "planned", layout: DEFAULT },
  { id: "page-layout", slug: "page-layout", label: "Page Layout", breadcrumbLabel: "Page Layout", description: "Page size, margins and layout rules", icon: LayoutTemplate, order: 5, status: "planned", layout: FULL },
  { id: "content-extraction", slug: "content-extraction", label: "Content Extraction", breadcrumbLabel: "Content Extraction", description: "Extract text, images and structure from documents", icon: ScanText, order: 6, status: "planned", layout: FULL },
  { id: "compliance-profiles", slug: "compliance-profiles", label: "Compliance Profiles", breadcrumbLabel: "Compliance Profiles", description: "PDF/A, PDF/UA and accessibility profiles", icon: ShieldCheck, order: 7, status: "planned", layout: DEFAULT },
  // Slug kept as "preflight-and-validation" so the existing URL does not change.
  { id: "preflight", slug: "preflight-and-validation", label: "Preflight", breadcrumbLabel: "Preflight", description: "Document quality and validation", icon: ClipboardCheck, order: 8, status: "planned", layout: WIDE },
  { id: "batch-processing", slug: "batch-processing", label: "Batch Processing", breadcrumbLabel: "Batch Processing", description: "Process multiple documents together", icon: Layers, order: 9, status: "planned", layout: WIDE },
  { id: "output-preview", slug: "output-preview", label: "Output Preview", breadcrumbLabel: "Output Preview", description: "Review converted output before delivery", icon: Eye, order: 10, status: "planned", layout: FULL },
  // Reserved slug matches the shared Conversion "profiles-presets" page (Task 2 §4.0).
  { id: "profiles-presets", slug: "profiles-presets", label: "Profiles & Presets", breadcrumbLabel: "Profiles & Presets", description: "Reusable conversion profiles and presets", icon: FileOutput, order: 11, status: "planned", layout: WIDE },
  { id: "history", slug: "history", label: "History", breadcrumbLabel: "History", description: "Audit trail of completed PDF conversions", icon: History, order: 12, status: "planned", layout: WIDE },
]

export function getPdfSection(slug: string): PdfSection | undefined {
  return PDF_SECTIONS.find((section) => section.slug === slug)
}

/** True only when the section's route exists in the registry and it is not marked unavailable. */
export function isPdfSectionNavigable(section: PdfSection, module: ConversionModule): boolean {
  if (section.status === "unavailable") return false
  return section.slug === "" || module.pages.some((page) => page.slug === section.slug)
}

export function pdfSectionHref(module: ConversionModule, section: PdfSection): string {
  return conversionHref(module.slug, section.slug || undefined)
}
