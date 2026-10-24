"use client"

/**
 * @file components/publishing/conversion/pdf/pdf-header-more-menu.tsx
 * @module Publishing › Conversion › PDF
 * @kind React client component
 * @summary Accessible "More actions" overflow menu for secondary PDF header actions.
 * @exports PdfHeaderMoreMenu
 *
 * Linked items navigate with next/link. Unavailable items are disabled and show their reason as
 * visible text inside the item, so the explanation never depends on hover.
 */
import Link from "next/link"
import { BookOpen, ChevronDown, Layers, MoreHorizontal, Upload, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  availabilityLabel,
  type PdfHeaderAction,
  type PdfHeaderActionId,
} from "@/components/publishing/conversion/pdf/pdf-header-config"

const ICONS: Partial<Record<PdfHeaderActionId, LucideIcon>> = {
  upload: Upload,
  "batch-processing": Layers,
  guidelines: BookOpen,
}

function ItemBody({ action }: { action: PdfHeaderAction }) {
  const Icon = ICONS[action.id]
  return (
    <span className="flex min-w-0 flex-1 items-start gap-2">
      {Icon && <Icon aria-hidden="true" className="mt-0.5" />}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center justify-between gap-3">
          <span className="font-medium">{action.label}</span>
          {action.availability !== "available" && (
            <span className="shrink-0 text-xs text-muted-foreground">{availabilityLabel(action.availability)}</span>
          )}
        </span>
        <span className="text-pretty text-xs text-muted-foreground">
          {action.status === "unavailable" ? action.reason : action.description}
        </span>
      </span>
    </span>
  )
}

export function PdfHeaderMoreMenu({ actions }: { actions: PdfHeaderAction[] }) {
  const links = actions.filter((a) => a.status === "link")
  const unavailable = actions.filter((a) => a.status === "unavailable")

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="min-h-9 min-w-9" aria-label="More PDF actions">
          <MoreHorizontal aria-hidden="true" className="sm:hidden" />
          <span className="hidden sm:inline">More actions</span>
          <ChevronDown aria-hidden="true" className="hidden sm:inline" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {links.map((action) =>
          action.status === "link" ? (
            <DropdownMenuItem key={action.id} asChild className="min-h-11 py-2">
              <Link href={action.href}>
                <ItemBody action={action} />
              </Link>
            </DropdownMenuItem>
          ) : null,
        )}
        {links.length > 0 && unavailable.length > 0 && <DropdownMenuSeparator />}
        {unavailable.length > 0 && <DropdownMenuLabel>Not available yet</DropdownMenuLabel>}
        {unavailable.map((action) => (
          <DropdownMenuItem key={action.id} disabled className="min-h-11 py-2 data-disabled:opacity-100">
            <ItemBody action={action} />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
