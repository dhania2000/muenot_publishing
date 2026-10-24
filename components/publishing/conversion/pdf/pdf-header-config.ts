/**
 * @file components/publishing/conversion/pdf/pdf-header-config.ts
 * @module Publishing › Conversion › PDF
 * @kind Pure configuration
 * @summary Configuration-driven header copy, breadcrumbs and contextual actions for every PDF section.
 * @exports PDF_SECTION_HEADERS, getPdfHeader, PdfHeader, PdfHeaderAction
 * @see PDF_PHASE1_TASK2_UI_ARCHITECTURE.md
 *
 * Actions only resolve to a link when their destination is a registered PDF page, so the
 * header never points at a missing route. Guidelines is always optional: it is never marked
 * as required and is hidden until a Guidelines page exists.
 */
import type { Crumb } from "@/components/enterprise/page-header"
import { CONVERSION_CRUMB, PUBLISHING_CRUMBS } from "@/components/publishing/conversion/conversion-nav"
import { conversionHref, type ConversionModule, type ConversionPage } from "@/lib/conversion-modules"

type SectionCopy = { title?: string; subtitle: string }

/** Keyed by page slug; "" is the Overview. Unknown slugs fall back to the page label + module description. */
export const PDF_SECTION_HEADERS: Record<string, SectionCopy> = {
  "": { title: "PDF", subtitle: "Professional Document Conversion & Processing" },
  workspace: { subtitle: "Configure and process your documents" },
  guidelines: { subtitle: "Optional company-specific instructions" },
  "output-settings": { subtitle: "Output format, quality and delivery options" },
  "page-layout": { subtitle: "Page size, margins and layout rules" },
  "content-extraction": { subtitle: "Extract text, images and structure from documents" },
  "compliance-profiles": { subtitle: "PDF/A, PDF/UA and accessibility profiles" },
  "preflight-and-validation": { title: "Preflight", subtitle: "Document quality and validation" },
  "batch-processing": { subtitle: "Process multiple documents together" },
  "output-preview": { subtitle: "Review converted output before delivery" },
  "profiles-and-presets": { subtitle: "Reusable conversion profiles and presets" },
  history: { subtitle: "Audit trail of completed PDF conversions" },
}

export type PdfHeaderAction =
  | { id: string; label: string; variant: "primary" | "secondary"; status: "link"; href: string }
  | { id: string; label: string; variant: "primary" | "secondary"; status: "unavailable"; reason: string }

export type PdfHeader = {
  title: string
  subtitle: string
  breadcrumbs: Crumb[]
  actions: PdfHeaderAction[]
}

/** Publishing › Conversion › PDF — the "Modules" root is omitted for the PDF trail by design. */
const PDF_ROOT_CRUMBS: Crumb[] = [...PUBLISHING_CRUMBS.filter((c) => c.label === "Publishing"), CONVERSION_CRUMB]

function linkIfRegistered(module: ConversionModule, currentSlug: string, slug: string, label: string): PdfHeaderAction | null {
  if (slug === currentSlug || !module.pages.some((p) => p.slug === slug)) return null
  return { id: slug, label, variant: "secondary", status: "link", href: conversionHref(module.slug, slug) }
}

export function getPdfHeader(module: ConversionModule, page?: ConversionPage): PdfHeader {
  const slug = page?.slug ?? ""
  const copy = PDF_SECTION_HEADERS[slug]
  const title = copy?.title ?? page?.label ?? module.label
  const subtitle = copy?.subtitle ?? module.description

  const breadcrumbs: Crumb[] = page
    ? [...PDF_ROOT_CRUMBS, { label: module.label, href: conversionHref(module.slug) }, { label: copy?.title ?? page.label }]
    : [...PDF_ROOT_CRUMBS, { label: module.label }]

  // No PDF uploader exists yet (Phase 3). Show an honest unavailable state instead of a fake workflow.
  const upload: PdfHeaderAction = {
    id: "upload",
    label: "Upload Files",
    variant: "primary",
    status: "unavailable",
    reason: "Upload becomes available with the PDF Workspace.",
  }

  const secondary = [
    linkIfRegistered(module, slug, "batch-processing", "Batch Processing"),
    linkIfRegistered(module, slug, "guidelines", "Guidelines (optional)"),
  ].filter((a): a is PdfHeaderAction => a !== null)

  return { title, subtitle, breadcrumbs, actions: [...secondary, upload] }
}
