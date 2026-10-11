/**
 * @file app/(workspace)/modules/publishing/conversion-name/page.tsx
 * @module Publishing
 * @kind Page (server component)
 * @summary Conversion Name workspace at /modules/publishing/conversion-name.
 *   Placeholder until the module's features are defined.
 */
import type { Metadata } from "next"
import { FileType } from "lucide-react"
import { guardBusinessLine } from "@/components/business-line/business-line-landing"
import { PageHeader } from "@/components/enterprise/page-header"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"

export const metadata: Metadata = {
  title: "Conversion Name",
  description: "Manage conversion names for publishing workflows.",
}

export default async function ConversionNamePage() {
  const { Icon } = await guardBusinessLine("publishing")

  return (
    <div className="flex min-w-0 flex-col gap-6 p-4 sm:p-6 md:p-8">
      <PageHeader
        title="Conversion Name"
        description="Manage conversion names for publishing workflows."
        icon={Icon}
        breadcrumbs={[
          { label: "Modules", href: "/modules" },
          { label: "Publishing", href: "/modules/publishing" },
          { label: "Conversion Name" },
        ]}
      />
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileType aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>Coming soon</EmptyTitle>
          <EmptyDescription>
            The Conversion Name module is set up. Its tools will appear here once they are built.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  )
}
