"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { FileType, ImageIcon, Users, type LucideIcon } from "lucide-react"
import { NAV_GROUPS, type NavIcon } from "@/lib/navigation"
import { cn } from "@/lib/utils"

const ICONS: Record<NavIcon, LucideIcon> = {
  "alt-text": ImageIcon,
  "conversion-name": FileType,
  users: Users,
}

export function SidebarNav({ isAdmin, pendingCount }: { isAdmin: boolean; pendingCount: number }) {
  const pathname = usePathname()
  const groups = NAV_GROUPS.filter((group) => !group.adminOnly || isAdmin)

  return (
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
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
                  aria-label={`${label} modules`}
                  className="ml-4 hidden flex-col gap-0.5 border-l border-sidebar-border pl-2 md:flex"
                >
                  {children.map((child) => {
                    const childActive = pathname === child.href || pathname.startsWith(`${child.href}/`)
                    return (
                      <li key={child.href}>
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
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              ) : null}
              </div>
            )
          })}
        </div>
      ))}
    </nav>
  )
}
