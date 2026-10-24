import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { guardBusinessLine } from "@/components/business-line/business-line-landing"
import { PageHeader } from "@/components/enterprise/page-header"
import {
  CONVERSION_CRUMB,
  ConversionModuleTabs,
  PlannedPage,
  PUBLISHING_CRUMBS,
} from "@/components/publishing/conversion/conversion-nav"
import { PdfSectionPage } from "@/components/publishing/conversion/pdf/pdf-section-page"
import { CONVERSION_MODULES, conversionHref, getConversionModule, getConversionPage } from "@/lib/conversion-modules"

type Params = { submodule: string; page: string }

export function generateStaticParams(): Params[] {
  return CONVERSION_MODULES.flatMap(({ slug, pages }) => pages.map((page) => ({ submodule: slug, page: page.slug })))
}

async function resolve(params: Promise<Params>) {
  const { submodule, page } = await params
  const conversionModule = getConversionModule(submodule)
  const conversionPage = conversionModule ? getConversionPage(conversionModule, page) : undefined
  return conversionModule && conversionPage ? { conversionModule, conversionPage } : null
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const resolved = await resolve(params)
  if (!resolved) return {}
  const { conversionModule, conversionPage } = resolved
  return {
    title: `${conversionPage.label} · ${conversionModule.label}`,
    description: `${conversionPage.label} for ${conversionModule.label} conversion. ${conversionModule.description}`,
  }
}

export default async function ConversionInternalPage({ params }: { params: Promise<Params> }) {
  const resolved = await resolve(params)
  if (!resolved) notFound()
  const { conversionModule, conversionPage } = resolved

  const { Icon } = await guardBusinessLine("publishing")

  if (conversionModule.slug === "pdf") {
    return <PdfSectionPage module={conversionModule} page={conversionPage} icon={Icon} />
  }

  return (
    <div className="flex min-w-0 flex-col gap-6 p-4 sm:p-6 md:p-8">
      <PageHeader
        title={conversionPage.label}
        description={conversionModule.description}
        icon={Icon}
        breadcrumbs={[
          ...PUBLISHING_CRUMBS,
          CONVERSION_CRUMB,
          { label: conversionModule.label, href: conversionHref(conversionModule.slug) },
          { label: conversionPage.label },
        ]}
      />
      <ConversionModuleTabs module={conversionModule} activePage={conversionPage.slug} />
      <PlannedPage
        icon={conversionModule.icon}
        title="Coming soon"
        description={`${conversionModule.label} ${conversionPage.label} is planned. Its tools will appear here once they are built.`}
      />
    </div>
  )
}
