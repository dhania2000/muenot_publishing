/**
 * @file components/business-line/business-line-landing.tsx
 * @module Business Lines
 * @kind React server component + server guard
 * @summary Shared access guard and minimal landing page for the Publishing,
 *   EdTech, BPO and Technology business-line routes.
 * @exports guardBusinessLine, BusinessLineLanding
 * @usedBy app/(workspace)/modules/{publishing,edtech,bpo,technology}/**
 * @see docs/CODEBASE-GUIDE.md for module ownership, conventions and where to add new code.
 */
import { notFound, redirect } from "next/navigation"
import { BookOpen, Code2, GraduationCap, Headset, type LucideIcon } from "lucide-react"
import { getSession } from "@/lib/auth"
import { userHasFeature } from "@/lib/permissions"
import { assertModuleEnabled } from "@/lib/module-access"
import { BUSINESS_LINE_MODULES } from "@/lib/workspace-nav"
import { PageHeader } from "@/components/enterprise/page-header"

export type BusinessLineSlug = "publishing" | "edtech" | "bpo" | "technology"

// Mirrors the sidebar icons registered in BUSINESS_LINE_MODULES.
const BUSINESS_LINE_ICONS: Record<BusinessLineSlug, LucideIcon> = {
  publishing: BookOpen,
  edtech: GraduationCap,
  bpo: Headset,
  technology: Code2,
}

/**
 * Server guard for business-line pages, reusing the Task 2 checks in the same
 * order as other workspace modules: sign-in → tenant toggle + plan (404) →
 * role feature permission (back to /modules). `feature` defaults to the
 * module's sidebar feature so page access always matches nav visibility.
 */
export async function guardBusinessLine(slug: BusinessLineSlug, feature?: string) {
  const entry = BUSINESS_LINE_MODULES.find((m) => m.slug === slug)
  if (!entry) notFound()

  const session = await getSession()
  if (!session) redirect("/login")

  await assertModuleEnabled(slug)

  if (!(await userHasFeature(session.userId, session.role, feature ?? entry.feature))) redirect("/modules")

  return { entry, session, Icon: BUSINESS_LINE_ICONS[slug] }
}

export async function BusinessLineLanding({ slug }: { slug: BusinessLineSlug }) {
  const { entry, Icon } = await guardBusinessLine(slug)

  return (
    <div className="flex flex-col gap-6 p-6 md:p-8">
      <PageHeader
        title={entry.label}
        icon={Icon}
        breadcrumbs={[{ label: "Modules", href: "/modules" }, { label: entry.label }]}
      />
      <div className="rounded-lg border border-dashed bg-card p-12 text-center text-sm text-muted-foreground">
        Module workspace is being configured.
      </div>
    </div>
  )
}
