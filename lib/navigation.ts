import { CONVERSION_CATEGORIES, CONVERSION_MODULES, conversionHref } from "@/lib/conversion-modules"

export type NavIcon = "alt-text" | "conversion-name" | "users"

export type NavChild = {
  href: string
  label: string
  /** Optional sub-heading; consecutive children sharing a section render under one heading. */
  section?: string
}

export type NavItem = {
  href: string
  label: string
  icon: NavIcon
  children?: NavChild[]
}

export type NavGroup = {
  label: string
  items: NavItem[]
  adminOnly?: boolean
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Publishing",
    items: [
      { href: "/modules/publishing/alt-text", label: "Alt Text", icon: "alt-text" },
      {
        href: "/modules/publishing/conversion-name",
        label: "Conversion",
        icon: "conversion-name",
        children: CONVERSION_CATEGORIES.flatMap((category) =>
          CONVERSION_MODULES.filter((module) => module.category === category.id).map(({ slug, label }) => ({
            href: conversionHref(slug),
            label,
            section: category.label,
          })),
        ),
      },
    ],
  },
  {
    label: "Admin",
    adminOnly: true,
    items: [{ href: "/admin/users", label: "Users", icon: "users" }],
  },
]
