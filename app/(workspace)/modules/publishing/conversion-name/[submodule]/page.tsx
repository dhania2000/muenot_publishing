import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { guardBusinessLine } from "@/components/business-line/business-line-landing"
import { PageHeader } from "@/components/enterprise/page-header"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { CONVERSION_BASE_PATH, CONVERSION_MODULES, getConversionModule } from "@/lib/conversion-modules"

type Params = { submodule: string }

export function generateStaticParams(): Params[] {
  return CONVERSION_MODULES.map(({ slug }) => ({ submodule: slug }))
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const conversionModule = getConversionModule((await params).submodule)
  if (!conversionModule) return {}
  return { title: conversionModule.label, description: conversionModule.description }
}

export default async function ConversionSubmodulePage({ params }: { params: Promise<Params> }) {
  const conversionModule = getConversionModule((await params).submodule)
  if (!conversionModule) notFound()

  const { Icon } = await guardBusinessLine("publishing")
  const ModuleIcon = conversionModule.icon

  return (
    <div className="flex min-w-0 flex-col gap-6 p-4 sm:p-6 md:p-8">
      <PageHeader
        title={conversionModule.label}
        description={conversionModule.description}
        icon={Icon}
        breadcrumbs={[
          { label: "Modules", href: "/modules" },
          { label: "Publishing", href: "/modules/publishing" },
          { label: "Conversion", href: CONVERSION_BASE_PATH },
          { label: conversionModule.label },
        ]}
      />
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ModuleIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>Coming soon</EmptyTitle>
          <EmptyDescription>
            {conversionModule.label} is set up. Its tools will appear here once they are built.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  )
}
