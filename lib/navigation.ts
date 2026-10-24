export type NavIcon = "alt-text" | "conversion-name" | "users"

export type NavItem = {
  href: string
  label: string
  icon: NavIcon
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
      { href: "/modules/publishing/conversion-name", label: "Conversion", icon: "conversion-name" },
    ],
  },
  {
    label: "Admin",
    adminOnly: true,
    items: [{ href: "/admin/users", label: "Users", icon: "users" }],
  },
]
