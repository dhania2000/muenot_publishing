/**
 * @file app/(workspace)/modules/publishing/alt-text/page.tsx
 * @module Publishing
 * @kind Page (server component)
 * @summary AI Alt Text Writer workspace at /modules/publishing/alt-text.
 *   Upload, generation and history persistence are implemented in later tasks.
 */
import type { Metadata } from "next"
import { guardBusinessLine } from "@/components/business-line/business-line-landing"
import { PageHeader } from "@/components/enterprise/page-header"
import { AltTextWorkspace } from "@/components/publishing/alt-text/alt-text-workspace"

export const metadata: Metadata = {
  title: "AI Alt Text Writer",
  description: "Generate accurate, accessible image descriptions using artificial intelligence.",
}

export default async function AltTextPage() {
  const { Icon } = await guardBusinessLine("publishing", "publishing.view_alt_text")

  return (
    <div className="flex min-w-0 flex-col gap-6 p-4 sm:p-6 md:p-8">
      <PageHeader
        title="AI Alt Text Writer"
        description="Generate accurate, accessible image descriptions using artificial intelligence."
        icon={Icon}
        breadcrumbs={[
          { label: "Modules", href: "/modules" },
          { label: "Publishing", href: "/modules/publishing" },
          { label: "Alt Text" },
        ]}
      />
      <AltTextWorkspace />
    </div>
  )
}
