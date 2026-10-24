/**
 * @file components/publishing/conversion/pdf/pdf-header-actions.tsx
 * @module Publishing › Conversion › PDF
 * @kind React server component
 * @summary Renders configured PDF header actions with the shared Button; unavailable actions are disabled and explained.
 * @exports PdfHeaderActions
 */
import Link from "next/link"
import { Layers, Upload, BookOpen, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { PdfHeaderAction } from "@/components/publishing/conversion/pdf/pdf-header-config"

const ICONS: Record<string, LucideIcon> = { upload: Upload, "batch-processing": Layers, guidelines: BookOpen }

export function PdfHeaderActions({ actions }: { actions: PdfHeaderAction[] }) {
  if (!actions.length) return null
  return (
    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
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
        const hintId = `pdf-action-${action.id}-hint`
        return (
          <div key={action.id} className="flex flex-col items-start gap-1 sm:items-end">
            <Button variant={variant} size="sm" className="min-h-9" disabled aria-describedby={hintId}>
              {content}
            </Button>
            <p id={hintId} className="text-xs text-muted-foreground">
              {action.reason}
            </p>
          </div>
        )
      })}
    </div>
  )
}
