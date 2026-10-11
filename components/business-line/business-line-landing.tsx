import { notFound, redirect } from "next/navigation"
import { BookOpen, type LucideIcon } from "lucide-react"
import { getSession } from "@/lib/auth"
import { hasActionGrant } from "@/lib/permission-store"

export type BusinessLineSlug = "publishing"

const BUSINESS_LINES: Record<BusinessLineSlug, { slug: BusinessLineSlug; label: string; feature: string; Icon: LucideIcon }> = {
  publishing: { slug: "publishing", label: "Publishing", feature: "publishing.view", Icon: BookOpen },
}

/** Server guard for business-line pages: sign-in, then feature permission. */
export async function guardBusinessLine(slug: BusinessLineSlug, feature?: string) {
  const entry = BUSINESS_LINES[slug]
  if (!entry) notFound()

  const session = await getSession()
  if (!session) redirect("/login")

  const resolvedFeature = feature ?? entry.feature
  const allowed = await hasActionGrant(session.userId, session.role, resolvedFeature.split(".")[0], resolvedFeature)
  if (!allowed) redirect("/")

  return { entry, session, Icon: entry.Icon }
}
