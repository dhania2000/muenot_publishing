/**
 * @file components/publishing/conversion/pdf/pdf-header-actions.tsx
 * @module Publishing › Conversion › PDF
 * @kind React server component
 * @summary Renders configured PDF header actions with the shared Button; unavailable actions are disabled and explained.
 * @exports PdfHeaderActions
 *
 * Buttons share one wrapping row and every unavailability reason sits beneath it, so buttons stay
 * baseline-aligned at every width instead of each reason pushing its own button out of line.
 */
import Link from "next/link"
import { Layers, Upload, BookOpen, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { PdfHeaderAction } from "@/components/publishing/conversion/pdf/pdf-header-config"

const ICONS: Record<string, LucideIcon> = { upload: Upload, "batch-processing": Layers, guidelines: BookOpen }

export function PdfHeaderActions({ actions }: { actions: PdfHeaderAction[] }) {
  if (!actions.length) return null
  const unavailable = actions.filter((action) => action.status !== "link")
  return (
    <div className="flex w-full min-w-0 flex-col gap-1.5 sm:w-auto sm:items-end">
      <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
        {actions.map((action) => {
          const Icon = ICONS[action.id]
          const variant = action.variant === "primary" ? "default" : "outline"
          const content = (
            <>
              {Icon && <Icon aria-hidden="true" />}
              {action.label}
            </>
          )
          if (action.status === "link") {
            return (
              <Button key={action.id} asChild variant={variant} size="sm" className="min-h-9">
                <Link href={action.href}>{content}</Link>
              </Button>
            )
          }
          return (
            <Button
              key={action.id}
              variant={variant}
              size="sm"
              className="min-h-9"
              disabled
              aria-describedby={`pdf-action-${action.id}-hint`}
            >
              {content}
            </Button>
          )
        })}
      </div>
      {unavailable.map((action) => (
        <p
          key={action.id}
          id={`pdf-action-${action.id}-hint`}
          className="max-w-prose text-pretty text-xs text-muted-foreground sm:text-right"
        >
          {action.reason}
        </p>
      ))}
    </div>
  )
}
