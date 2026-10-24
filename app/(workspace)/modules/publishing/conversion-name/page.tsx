/**
 * @file app/(workspace)/modules/publishing/conversion-name/page.tsx
 * @module Publishing
 * @kind Page (server component)
 * @summary Conversion Name workspace at /modules/publishing/conversion-name.
 *   Placeholder until the module's features are defined.
 */
import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { guardBusinessLine } from "@/components/business-line/business-line-landing"
import { PageHeader } from "@/components/enterprise/page-header"
import { CONVERSION_MODULES, conversionHref } from "@/lib/conversion-modules"

export const metadata: Metadata = {
  title: "Conversion",
  description: "Manage conversion names for publishing workflows.",
}

export default async function ConversionNamePage() {
  const { Icon } = await guardBusinessLine("publishing")

  return (
    <div className="flex min-w-0 flex-col gap-6 p-4 sm:p-6 md:p-8">
      <PageHeader
        title="Conversion"
        description="Manage conversion names for publishing workflows."
        icon={Icon}
        breadcrumbs={[
          { label: "Modules", href: "/modules" },
          { label: "Publishing", href: "/modules/publishing" },
          { label: "Conversion" },
        ]}
      />
      <ul aria-label="Conversion modules" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {CONVERSION_MODULES.map(({ slug, label, description, icon: ModuleIcon }) => (
          <li key={slug}>
            <Link
              href={conversionHref(slug)}
              className="group flex h-full flex-col gap-3 rounded-lg border bg-card p-5 text-card-foreground transition-colors hover:border-primary/40 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex size-10 items-center justify-center rounded-md bg-muted text-foreground">
                <ModuleIcon className="size-5" aria-hidden="true" />
              </span>
              <span className="flex flex-col gap-1">
                <span className="font-medium">{label}</span>
                <span className="text-sm leading-relaxed text-muted-foreground">{description}</span>
              </span>
              <span className="mt-auto flex items-center gap-1 text-sm font-medium text-primary">
                Open
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
