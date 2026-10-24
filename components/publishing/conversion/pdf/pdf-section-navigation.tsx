"use client"

/**
 * @file components/publishing/conversion/pdf/pdf-section-navigation.tsx
 * @module Publishing › Conversion › PDF
 * @kind React client component
 * @summary Route-based internal navigation for the 12 PDF sections with width-aware "More" overflow and a compact mobile selector.
 * @exports PdfSectionNavigation, PdfNavItem
 *
 * Sections change routes, so items are links with `aria-current="page"` (not a tablist). Sections
 * without a route render as non-interactive, `aria-disabled` items labelled "Planned".
 */
import { useCallback, useLayoutEffect, useRef, useState } from "react"
import Link from "next/link"
import { Check, ChevronDown, MoreHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

export type PdfNavItem = { id: string; label: string; href: string | null; active: boolean }

const PLANNED_HINT = "Planned, not yet available"

const itemClass = (active: boolean, disabled: boolean) =>
  cn(
    "relative inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap px-3 text-sm outline-none",
    "after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:rounded-full",
    "focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
    active && "font-medium text-foreground after:bg-primary",
    !active && !disabled && "text-muted-foreground transition-colors hover:text-foreground hover:after:bg-border",
    disabled && "cursor-not-allowed text-muted-foreground",
  )

function PlannedTag() {
  return (
    <span aria-hidden="true" className="text-[11px] font-normal uppercase tracking-wide text-muted-foreground">
      Planned
    </span>
  )
}

function SectionItem({ item }: { item: PdfNavItem }) {
  if (!item.href) {
    return (
      <span role="link" aria-disabled="true" className={itemClass(false, true)}>
        {item.label}
        <PlannedTag />
        <span className="sr-only">{`(${PLANNED_HINT})`}</span>
      </span>
    )
  }
  return (
    <Link href={item.href} aria-current={item.active ? "page" : undefined} className={itemClass(item.active, false)}>
      {item.label}
    </Link>
  )
}

function SectionMenuItems({ items }: { items: PdfNavItem[] }) {
  return items.map((item) =>
    item.href ? (
      <DropdownMenuItem key={item.id} asChild className="min-h-10 justify-between gap-4">
        <Link href={item.href} aria-current={item.active ? "page" : undefined}>
          <span className={cn(item.active && "font-medium")}>{item.label}</span>
          {item.active && <Check aria-hidden="true" />}
        </Link>
      </DropdownMenuItem>
    ) : (
      <DropdownMenuItem key={item.id} disabled className="min-h-10 justify-between gap-4">
        <span>{item.label}</span>
        <PlannedTag />
        <span className="sr-only">{`(${PLANNED_HINT})`}</span>
      </DropdownMenuItem>
    ),
  )
}

/**
 * Returns the item ids that fit in `available` px, in display order. The active item is always kept
 * visible by replacing the last fitting item when necessary.
 */
export function fitPdfNavItems(items: PdfNavItem[], widths: number[], available: number, moreWidth: number): Set<string> {
  const total = widths.reduce((sum, w) => sum + w, 0)
  if (total <= available) return new Set(items.map((i) => i.id))

  const budget = available - moreWidth
  const activeIndex = items.findIndex((i) => i.active)
  const reserved = activeIndex >= 0 ? widths[activeIndex] : 0
  const visible = new Set<string>()
  let used = reserved
  for (let i = 0; i < items.length; i++) {
    if (i === activeIndex) continue
    if (used + widths[i] > budget) break
    used += widths[i]
    visible.add(items[i].id)
  }
  if (activeIndex >= 0 && used <= budget) visible.add(items[activeIndex].id)
  return visible
}

export function PdfSectionNavigation({ items, label = "PDF sections" }: { items: PdfNavItem[]; label?: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const moreMeasureRef = useRef<HTMLSpanElement>(null)
  const [visibleIds, setVisibleIds] = useState<Set<string> | null>(null)

  const recompute = useCallback(() => {
    const container = containerRef.current
    const measure = measureRef.current
    if (!container || !measure) return
    const widths = Array.from(measure.children, (el) => (el as HTMLElement).offsetWidth)
    const moreWidth = moreMeasureRef.current?.offsetWidth ?? 88
    const next = fitPdfNavItems(items, widths, container.clientWidth, moreWidth)
    setVisibleIds((prev) => (prev && prev.size === next.size && [...next].every((id) => prev.has(id)) ? prev : next))
  }, [items])

  useLayoutEffect(() => {
    recompute()
    const container = containerRef.current
    if (!container || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(recompute)
    observer.observe(container)
    return () => observer.disconnect()
  }, [recompute])

  const visible = visibleIds ? items.filter((i) => visibleIds.has(i.id)) : items
  const overflow = visibleIds ? items.filter((i) => !visibleIds.has(i.id)) : []
  const active = items.find((i) => i.active)

  return (
    <nav aria-label={label} className="min-w-0">
      {/* Below sm: one compact selector instead of a scrolling strip. */}
      <div className="sm:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="h-11 w-full justify-between">
              <span className="flex min-w-0 items-center gap-2">
                <span className="text-muted-foreground">Section</span>
                <span className="truncate font-medium">{active?.label ?? "Choose a section"}</span>
              </span>
              <ChevronDown aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-[min(70vh,var(--available-height))]">
            <DropdownMenuLabel>PDF sections</DropdownMenuLabel>
            <SectionMenuItems items={items} />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div ref={containerRef} className="relative hidden min-w-0 overflow-hidden border-b sm:block">
        <ul className="flex min-w-0 items-center">
          {visible.map((item) => (
            <li key={item.id} className="flex">
              <SectionItem item={item} />
            </li>
          ))}
          {overflow.length > 0 && (
            <li className="ml-auto flex shrink-0 border-l pl-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className={itemClass(false, false)}>
                    <MoreHorizontal aria-hidden="true" className="size-4" />
                    More
                    <span className="sr-only">{`, ${overflow.length} more sections`}</span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <SectionMenuItems items={overflow} />
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          )}
        </ul>

        {/* Off-screen measuring copy: same styles as live items, never focusable or announced. */}
        <div
          ref={measureRef}
          aria-hidden="true"
          inert
          className="pointer-events-none invisible absolute left-0 top-0 flex h-0 overflow-hidden"
        >
          {items.map((item) => (
            <span key={item.id} className={cn(itemClass(false, !item.href), "font-medium")}>
              {item.label}
              {!item.href && <PlannedTag />}
            </span>
          ))}
        </div>
        <span
          ref={moreMeasureRef}
          aria-hidden="true"
          className={cn(itemClass(false, false), "pointer-events-none invisible absolute left-0 top-0 ml-1 border-l pl-4")}
        >
          <MoreHorizontal className="size-4" />
          More
        </span>
      </div>
    </nav>
  )
}
