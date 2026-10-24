/**
 * @file app/(workspace)/modules/publishing/conversion-name/page.tsx
 * @module Publishing
 * @kind Page (server component)
 * @summary Conversion Dashboard at /modules/publishing/conversion-name.
 *   Lists all conversion services grouped by category.
 */
import type { Metadata } from "next"
import { guardBusinessLine } from "@/components/business-line/business-line-landing"
import { PageHeader } from "@/components/enterprise/page-header"
import {
  ConversionServiceGrid,
  ConversionSharedTabs,
  PUBLISHING_CRUMBS,
} from "@/components/publishing/conversion/conversion-nav"

export const metadata: Metadata = {
  title: "Conversion",
  description: "Convert publishing content across document, digital, learning, media and data formats.",
}

export default async function ConversionNamePage() {
  const { Icon } = await guardBusinessLine("publishing")

  return (
    <div className="flex min-w-0 flex-col gap-6 p-4 sm:p-6 md:p-8">
      <PageHeader
        title="Conversion"
        description="Convert publishing content across document, digital, learning, media and data formats."
        icon={Icon}
        breadcrumbs={[...PUBLISHING_CRUMBS, { label: "Conversion" }]}
      />
      <ConversionSharedTabs activeSlug="" />
      <ConversionServiceGrid />
    </div>
  )
}
