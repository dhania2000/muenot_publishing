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
import { CONVERSION_CRUMB, ConversionModuleTabs, PUBLISHING_CRUMBS } from "@/components/publishing/conversion/conversion-nav"
import { PdfFeedbackState } from "@/components/publishing/conversion/pdf/pdf-feedback-state"
import { getPdfSectionLayout, PdfModuleLayout } from "@/components/publishing/conversion/pdf/pdf-module-layout"
import { conversionHref, type ConversionModule, type ConversionPage } from "@/lib/conversion-modules"

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

export function PdfSectionPage({ module, page, icon, status, aside, asideLabel, toolbar, children }: PdfSectionPageProps) {
  const layout = getPdfSectionLayout(page?.slug ?? "")
  const title = page?.label ?? module.label
  const breadcrumbs = page
    ? [...PUBLISHING_CRUMBS, CONVERSION_CRUMB, { label: module.label, href: conversionHref(module.slug) }, { label: page.label }]
    : [...PUBLISHING_CRUMBS, CONVERSION_CRUMB, { label: module.label }]
  const unavailableDescription = page
    ? `${module.label} ${page.label} is planned. Its tools will appear here once they are built.`
    : `${module.label} is set up. Its tools will appear here once they are built.`

  return (
    <PdfModuleLayout
      width={layout.width}
      spacing={layout.spacing}
      header={<PageHeader title={title} description={module.description} icon={icon} breadcrumbs={breadcrumbs} />}
      navigation={<ConversionModuleTabs module={module} activePage={page?.slug ?? ""} />}
      status={status}
      aside={aside}
      asideLabel={asideLabel}
      toolbar={toolbar}
    >
      {children ?? <PdfFeedbackState kind="unavailable" icon={module.icon} description={unavailableDescription} />}
    </PdfModuleLayout>
  )
}
