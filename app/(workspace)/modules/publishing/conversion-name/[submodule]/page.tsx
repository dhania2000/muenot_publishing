import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { FileType } from "lucide-react"
import { guardBusinessLine } from "@/components/business-line/business-line-landing"
import { PageHeader } from "@/components/enterprise/page-header"
import {
  CONVERSION_CRUMB,
  ConversionModuleTabs,
  ConversionServiceGrid,
  ConversionSharedTabs,
  PlannedPage,
  PUBLISHING_CRUMBS,
} from "@/components/publishing/conversion/conversion-nav"
import { PdfOverview } from "@/components/publishing/conversion/pdf/pdf-overview"
import { PdfSectionPage } from "@/components/publishing/conversion/pdf/pdf-section-page"
import { CONVERSION_MODULES, CONVERSION_SHARED_PAGES, getConversionModule, getSharedPage } from "@/lib/conversion-modules"

type Params = { submodule: string }

export function generateStaticParams(): Params[] {
  return [
    ...CONVERSION_MODULES.map(({ slug }) => ({ submodule: slug })),
    ...CONVERSION_SHARED_PAGES.filter(({ slug }) => slug).map(({ slug }) => ({ submodule: slug })),
  ]
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { submodule } = await params
  const conversionModule = getConversionModule(submodule)
  if (conversionModule) return { title: `${conversionModule.label} · Conversion`, description: conversionModule.description }
  const shared = getSharedPage(submodule)
  if (shared) return { title: `${shared.label} · Conversion`, description: shared.description }
  return {}
}

export default async function ConversionSubmodulePage({ params }: { params: Promise<Params> }) {
  const { submodule } = await params
  const conversionModule = getConversionModule(submodule)
  const shared = conversionModule ? undefined : getSharedPage(submodule)
  if (!conversionModule && !shared) notFound()

  const { Icon } = await guardBusinessLine("publishing")

  if (shared) {
    return (
      <div className="flex min-w-0 flex-col gap-6 p-4 sm:p-6 md:p-8">
        <PageHeader
          title={shared.label}
          description={shared.description}
          icon={Icon}
          breadcrumbs={[...PUBLISHING_CRUMBS, CONVERSION_CRUMB, { label: shared.label }]}
        />
        <ConversionSharedTabs activeSlug={shared.slug} />
        {shared.slug === "services" ? (
          <ConversionServiceGrid />
        ) : (
          <PlannedPage
            icon={FileType}
            title="Coming soon"
            description={`${shared.label} is set up. Its tools will appear here once they are built.`}
          />
        )}
      </div>
    )
  }

  const service = conversionModule!

  if (service.slug === "pdf") {
    return (
      <PdfSectionPage module={service} icon={Icon}>
        <PdfOverview module={service} />
      </PdfSectionPage>
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-6 p-4 sm:p-6 md:p-8">
      <PageHeader
        title={service.label}
        description={service.description}
        icon={Icon}
        breadcrumbs={[...PUBLISHING_CRUMBS, CONVERSION_CRUMB, { label: service.label }]}
      />
      <ConversionModuleTabs module={service} activePage="" />
      <PlannedPage
        icon={service.icon}
        title="Coming soon"
        description={`${service.label} is set up. Its tools will appear here once they are built.`}
      />
    </div>
  )
}
