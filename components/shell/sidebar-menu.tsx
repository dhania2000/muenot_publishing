"use client"

import Link from "next/link"
import { useState } from "react"
import { usePathname } from "next/navigation"
import {
  Accessibility,
  ChevronDown,
  ClipboardCheck,
  FileCheck2,
  FilePen,
  Film,
  Handshake,
  Microscope,
  MonitorSmartphone,
  NotebookPen,
  Share2,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react"
import type { NavMenu, NavMenuCategoryIcon } from "@/lib/navigation"
import { cn } from "@/lib/utils"

const MENU_ICONS: Record<NavMenu["icon"], LucideIcon> = {
  "editorial-services": NotebookPen,
  "accessibility-services": Accessibility,
}

const CATEGORY_ICONS: Record<NavMenuCategoryIcon, LucideIcon> = {
  "core-editing": FilePen,
  "specialist-editing": Microscope,
  "editorial-quality": ClipboardCheck,
  "publishing-support": Share2,
  "document-accessibility": FileCheck2,
  "digital-accessibility": MonitorSmartphone,
  "multimedia-accessibility": Film,
  "testing-compliance": ShieldCheck,
  "accessibility-support": Handshake,
}

export function SidebarMenuToggle({
  menu,
  open,
  onToggle,
  className,
}: {
  menu: NavMenu
  open: boolean
  onToggle: () => void
  className?: string
}) {
  const Icon = MENU_ICONS[menu.icon]
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={`nav-menu-${menu.id}`}
      onClick={onToggle}
      className={cn(
        "flex shrink-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:w-full",
        className,
      )}
    >
      <Icon className="size-4" aria-hidden="true" />
      <span className="whitespace-nowrap">{menu.label}</span>
      <ChevronDown
        className={cn("ml-auto size-4 text-muted-foreground transition-transform", open && "rotate-180")}
        aria-hidden="true"
      />
    </button>
  )
}

export function SidebarMenuPanel({ menu, id, className }: { menu: NavMenu; id?: string; className?: string }) {
  const pathname = usePathname()
  const [closed, setClosed] = useState<Record<string, boolean>>({})

  return (
    <ul id={id} aria-label={`${menu.label} categories`} className={cn("flex flex-col gap-0.5", className)}>
      {menu.categories.map((category) => {
        const Icon = CATEGORY_ICONS[category.icon]
        const open = !closed[category.id]
        const listId = `nav-menu-${menu.id}-${category.id}`
        return (
          <li key={category.id}>
            <button
              type="button"
              aria-expanded={open}
              aria-controls={listId}
              onClick={() => setClosed((prev) => ({ ...prev, [category.id]: open }))}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Icon className="size-3.5" aria-hidden="true" />
              {category.label}
              <ChevronDown
                className={cn("ml-auto size-3.5 transition-transform", open && "rotate-180")}
                aria-hidden="true"
              />
            </button>
            <ul
              id={listId}
              aria-label={category.label}
              className={cn("ml-3.5 flex-col gap-0.5 border-l border-sidebar-border pl-2", open ? "flex" : "hidden")}
            >
              {category.entries.map((entry) => {
                if (!entry.href) {
                  return (
                    <li key={entry.label}>
                      <span
                        aria-disabled="true"
                        title="Coming soon"
                        className="block cursor-default rounded-md px-2 py-1 text-sm text-muted-foreground"
                      >
                        {entry.label}
                        <span className="sr-only"> (coming soon)</span>
                      </span>
                    </li>
                  )
                }
                const active = pathname === entry.href || pathname.startsWith(`${entry.href}/`)
                return (
                  <li key={entry.label}>
                    <Link
                      href={entry.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "block rounded-md px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        active
                          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                          : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                      )}
                    >
                      {entry.label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </li>
        )
      })}
    </ul>
  )
}
