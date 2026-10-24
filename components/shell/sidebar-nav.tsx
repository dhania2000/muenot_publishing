"use client"

import Link from "next/link"
import { useState } from "react"
import { usePathname } from "next/navigation"
import { ChevronDown, FileType, ImageIcon, Users, type LucideIcon } from "lucide-react"
import { NAV_GROUPS, type NavIcon } from "@/lib/navigation"
import { SidebarMenuPanel, SidebarMenuToggle } from "@/components/shell/sidebar-menu"
import { cn } from "@/lib/utils"

const ICONS: Record<NavIcon, LucideIcon> = {
  "alt-text": ImageIcon,
  "conversion-name": FileType,
  users: Users,
}

export function SidebarNav({ isAdmin, pendingCount }: { isAdmin: boolean; pendingCount: number }) {
  const pathname = usePathname()
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({})
  const [openMenus, setOpenMenus] = useState<Record<string, boolean>>({})
  const groups = NAV_GROUPS.filter((group) => !group.adminOnly || isAdmin)
  const mobileMenus = groups.flatMap((group) => group.menus ?? []).filter((menu) => openMenus[menu.id])

  return (
    <>
    <nav aria-label="Primary" className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-1 md:flex-col md:overflow-y-auto md:pb-0">
      {groups.map((group) => (
        <div key={group.label} role="group" aria-label={group.label} className="flex gap-1 md:flex-col">
          <p className="hidden px-2 pb-1 pt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground md:block">
            {group.label}
          </p>
          {group.items.map(({ href, label, icon, children }) => {
            const Icon = ICONS[icon]
            const inSection = pathname === href || pathname.startsWith(`${href}/`)
            const active = children?.length ? pathname === href : inSection
            const badge = href === "/admin/users" && pendingCount > 0 ? pendingCount : 0
            return (
              <div key={href} className="flex gap-1 md:flex-col">
              {children?.length ? (
                <button
                  type="button"
                  aria-expanded={openSections[href] ?? inSection}
                  aria-controls={`nav-children-${icon}`}
                  onClick={() =>
                    setOpenSections((prev) => ({ ...prev, [href]: !(prev[href] ?? inSection) }))
                  }
                  className={cn(
                    "hidden w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:flex",
                    inSection
                      ? "font-medium text-sidebar-accent-foreground hover:bg-sidebar-accent"
                      : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  )}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {label}
                  <ChevronDown
                    className={cn(
                      "ml-auto size-4 text-muted-foreground transition-transform",
                      (openSections[href] ?? inSection) && "rotate-180",
                    )}
                    aria-hidden="true"
                  />
                </button>
              ) : null}
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  children?.length && "md:hidden",
                  active
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
                {label}
                {badge ? (
                  <span className="ml-auto rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground">
                    {badge}
                    <span className="sr-only"> pending approval</span>
                  </span>
                ) : null}
              </Link>
              {children?.length ? (
                <ul
                  id={`nav-children-${icon}`}
                  aria-label={`${label} modules`}
                  className={cn(
                    "ml-4 hidden flex-col gap-0.5 border-l border-sidebar-border pl-2",
                    (openSections[href] ?? inSection) && "md:flex",
                  )}
                >
                  {children.map((child, index) => {
                    const childActive = pathname === child.href || pathname.startsWith(`${child.href}/`)
                    const startsSection = child.section && child.section !== children[index - 1]?.section
                    return (
                      <li key={child.href}>
                        {startsSection ? (
                          <p
                            aria-hidden="true"
                            className="px-2 pb-0.5 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80"
                          >
                            {child.section}
                          </p>
                        ) : null}
                        <Link
                          href={child.href}
                          aria-current={childActive ? "page" : undefined}
                          className={cn(
                            "block rounded-md px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            childActive
                              ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                              : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                          )}
                        >
                          {child.label}
                          {child.section ? <span className="sr-only">{`, ${child.section}`}</span> : null}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              ) : null}
              </div>
            )
          })}
          {group.menus?.map((menu) => {
            const open = openMenus[menu.id] ?? false
            return (
              <div key={menu.id} className="flex gap-1 md:flex-col">
                <SidebarMenuToggle
                  menu={menu}
                  open={open}
                  onToggle={() => setOpenMenus((prev) => ({ ...prev, [menu.id]: !open }))}
                />
                <SidebarMenuPanel
                  menu={menu}
                  id={`nav-menu-${menu.id}`}
                  className={cn("ml-4 hidden border-l border-sidebar-border pl-2", open && "md:flex")}
                />
              </div>
            )
          })}
        </div>
      ))}
    </nav>
    {mobileMenus.map((menu) => (
      <SidebarMenuPanel
        key={menu.id}
        menu={menu}
        className="max-h-[60dvh] overflow-y-auto border-t border-sidebar-border px-2 py-2 md:hidden"
      />
    ))}
    </>
  )
}
