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
import { getPdfSection } from "@/components/publishing/conversion/pdf/pdf-sections"
import { conversionHref, type ConversionModule, type ConversionPage } from "@/lib/conversion-modules"

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
  const section = getPdfSection(slug)
  const title = section?.headerTitle ?? section?.label ?? page?.label ?? module.label
  const subtitle = section?.description ?? module.description

  const breadcrumbs: Crumb[] = page
    ? [
        ...PDF_ROOT_CRUMBS,
        { label: module.label, href: conversionHref(module.slug) },
        { label: section?.breadcrumbLabel ?? page.label },
      ]
    : [...PDF_ROOT_CRUMBS, { label: module.label }]

  // No PDF uploader exists yet (Phase 3). Show an honest unavailable state instead of a fake workflow.
  const upload: PdfHeaderAction = {
    id: "upload",
    label: "Upload Files",
    variant: "primary",
    status: "unavailable",
    reason:
      slug === "workspace"
        ? "Server upload is planned. Files added in Source Files stay in this browser."
        : "Server upload is planned. Add files locally in the Workspace.",
  }

  const secondary = [
    linkIfRegistered(module, slug, "batch-processing", "Batch Processing"),
    linkIfRegistered(module, slug, "guidelines", "Guidelines (optional)"),
  ].filter((a): a is PdfHeaderAction => a !== null)

  return { title, subtitle, breadcrumbs, actions: [...secondary, upload] }
}
