import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { EpubPlanner } from "@/components/publishing/conversion/epub/epub-planner"
import Link from "next/link"
import {EpubWorkbench} from "@/components/publishing/conversion/epub/epub-workbench"
import { EpubRequirements } from "@/components/publishing/conversion/epub/epub-requirements"
import { guardBusinessLine } from "@/components/business-line/business-line-landing"
import { PageHeader } from "@/components/enterprise/page-header"
import {
  CONVERSION_CRUMB,
  ConversionModuleTabs,
  PlannedPage,
  PUBLISHING_CRUMBS,
} from "@/components/publishing/conversion/conversion-nav"
import { PdfSectionPage } from "@/components/publishing/conversion/pdf/pdf-section-page"
import { PdfWorkspace } from "@/components/publishing/conversion/pdf/pdf-workspace"
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
  const epubSession = conversionModule.slug === "epub" ? await getSession() : null
  if (conversionModule.slug === "epub" && !epubSession) redirect("/login")

  if (conversionModule.slug === "pdf") {
    if (conversionPage.slug === "workspace") {
      const guidelinesHref = conversionModule.pages.some((p) => p.slug === "guidelines")
        ? conversionHref(conversionModule.slug, "guidelines")
        : null
      return (
        <PdfSectionPage module={conversionModule} page={conversionPage} icon={Icon}>
          <PdfWorkspace guidelinesHref={guidelinesHref} />
        </PdfSectionPage>
      )
    }
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
      {conversionModule.slug === "epub" ? conversionPage.slug === "workspace" ? <><Link className="text-sm text-primary underline" href={conversionHref("epub","history")}>Open saved projects and worklist</Link><EpubPlanner key={`${epubSession!.tenantId}:${epubSession!.userId}`} draftScope={`${epubSession!.tenantId}:${epubSession!.userId}`} /></> : <><EpubWorkbench key={`${epubSession!.tenantId}:${epubSession!.userId}`} actorScope={`${epubSession!.tenantId}:${epubSession!.userId}`} initialPanel={({"layout-settings":"settings","css-profiles":"settings",metadata:"settings","media-manager":"overview","accessibility-checks":"reports","epub-validation":"reports","reader-preview":"preview","toc-editor":"preview"} as Record<string,string>)[conversionPage.slug]??"overview"}/>{["layout-settings","accessibility-checks","media-manager","epub-validation"].includes(conversionPage.slug)&&<details className="rounded border p-3"><summary className="cursor-pointer text-sm">Profile requirements and limitations</summary><EpubRequirements page={conversionPage.slug}/></details>}</> : <PlannedPage icon={conversionModule.icon} title="Coming soon" description={`${conversionModule.label} ${conversionPage.label} is planned. Its tools will appear here once they are built.`}/>}
    </div>
  )
}
