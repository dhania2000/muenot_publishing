/**
 * @file components/publishing/conversion/pdf/pdf-header-actions.tsx
 * @module Publishing › Conversion › PDF
 * @kind React server component
 * @summary Renders the PDF header action hierarchy: one primary link plus a "More actions" menu.
 * @exports PdfHeaderActions
 *
 * The primary action is a real link (it navigates) and is described by a visible hint. Secondary
 * actions are grouped in an accessible overflow menu at every width so the header never grows a
 * row of competing buttons; each item shows its availability label inline.
 */
import Link from "next/link"
import { SquarePen } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { PdfHeaderAction } from "@/components/publishing/conversion/pdf/pdf-header-config"
import { PdfHeaderMoreMenu } from "@/components/publishing/conversion/pdf/pdf-header-more-menu"

export function PdfHeaderActions({ actions }: { actions: PdfHeaderAction[] }) {
  if (!actions.length) return null
  const primary = actions.find((action) => action.variant === "primary" && action.status === "link")
  const secondary = actions.filter((action) => action !== primary)
  const hintId = primary ? `pdf-action-${primary.id}-hint` : undefined

  return (
    <div className="flex w-full min-w-0 flex-col gap-1.5 sm:w-auto sm:max-w-sm sm:items-end">
      <div className="flex min-w-0 items-center gap-2">
        {primary && primary.status === "link" && (
          <Button asChild size="sm" className="min-h-9 flex-1 sm:flex-none">
            <Link href={primary.href} aria-describedby={hintId}>
              <SquarePen aria-hidden="true" />
              {primary.label}
            </Link>
          </Button>
        )}
        {secondary.length > 0 && <PdfHeaderMoreMenu actions={secondary} />}
      </div>
      {primary && (
        <p id={hintId} className="text-pretty text-xs text-muted-foreground sm:text-right">
          {primary.description}
        </p>
      )}
    </div>
  )
}
