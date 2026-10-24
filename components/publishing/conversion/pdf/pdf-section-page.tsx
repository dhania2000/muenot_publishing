/**
 * @file components/publishing/conversion/pdf/pdf-section-page.tsx
 * @module Publishing › Conversion › PDF
 * @kind React server component
 * @summary Single page shell for the PDF overview and every internal section, so routes never duplicate header/tabs/layout wiring.
 * @exports PdfSectionPage
 * @see PDF_PHASE1_TASK2_UI_ARCHITECTURE.md §6, §8
 */
import type { LucideIcon } from "lucide-react"
import { PageHeader } from "@/components/enterprise/page-header"
import { PdfSectionNavigation, type PdfNavItem } from "@/components/publishing/conversion/pdf/pdf-section-navigation"
import { isPdfSectionNavigable, PDF_SECTIONS, pdfSectionHref } from "@/components/publishing/conversion/pdf/pdf-sections"
import { PdfFeedbackState } from "@/components/publishing/conversion/pdf/pdf-feedback-state"
import { PdfHeaderActions } from "@/components/publishing/conversion/pdf/pdf-header-actions"
import { getPdfHeader } from "@/components/publishing/conversion/pdf/pdf-header-config"
import { getPdfSectionLayout, PdfModuleLayout } from "@/components/publishing/conversion/pdf/pdf-module-layout"
import type { ConversionModule, ConversionPage } from "@/lib/conversion-modules"

type PdfSectionPageProps = {
  module: ConversionModule
  /** Omit for the Overview. */
  page?: ConversionPage
  /** Business-line icon shown in the page header. */
  icon: LucideIcon
  status?: React.ReactNode
  aside?: React.ReactNode
  asideLabel?: string
  toolbar?: React.ReactNode
  /** Section body. Defaults to an honest "not built yet" state; never a simulated result. */
  children?: React.ReactNode
}

/** Serializable nav items for the client navigation; only routed sections get an href. */
export function getPdfNavItems(module: ConversionModule, activeSlug: string): PdfNavItem[] {
  return [...PDF_SECTIONS]
    .sort((a, b) => a.order - b.order)
    .map((section) => {
      const navigable = isPdfSectionNavigable(section, module)
      return {
        id: section.id,
        label: section.label,
        href: navigable ? pdfSectionHref(module, section) : null,
        active: navigable && section.slug === activeSlug,
      }
    })
}

export function PdfSectionPage({ module, page, icon, status, aside, asideLabel, toolbar, children }: PdfSectionPageProps) {
  const layout = getPdfSectionLayout(page?.slug ?? "")
  const pdfHeader = getPdfHeader(module, page)
  const unavailableDescription = page
    ? `${module.label} ${page.label} is planned. Its tools will appear here once they are built.`
    : `${module.label} is set up. Its tools will appear here once they are built.`

  return (
    <PdfModuleLayout
      width={layout.width}
      spacing={layout.spacing}
      header={
        <PageHeader
          title={pdfHeader.title}
          description={pdfHeader.subtitle}
          icon={icon}
          breadcrumbs={pdfHeader.breadcrumbs}
          actions={<PdfHeaderActions actions={pdfHeader.actions} />}
        />
      }
      navigation={<PdfSectionNavigation items={getPdfNavItems(module, page?.slug ?? "")} />}
      status={status}
      aside={aside}
      asideLabel={asideLabel}
      toolbar={toolbar}
    >
      {children ?? <PdfFeedbackState kind="unavailable" icon={module.icon} description={unavailableDescription} />}
    </PdfModuleLayout>
  )
}
