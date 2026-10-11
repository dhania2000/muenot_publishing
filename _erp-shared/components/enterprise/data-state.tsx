"use client"

/**
 * @file components/enterprise/data-state.tsx
 * @module Enterprise Features
 * @kind React client component
 * @summary Enterprise Features UI: ErrorState, EmptyState.
 * @exports ErrorState, EmptyState
 * @usedBy components/sales/sales-dashboard-client.tsx, components/saved-views/data-table.tsx
 * @see docs/CODEBASE-GUIDE.md for module ownership, conventions and where to add new code.
 */
import { AlertTriangle, Inbox, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"

/** Error panel announced to assistive tech, with a retry action. */
export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
}: {
  title?: string
  message?: string
  onRetry?: () => void
}) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <AlertTriangle className="size-6 text-destructive" aria-hidden="true" />
      <div>
        <p className="text-sm font-medium">{title}</p>
        {message && <p className="mt-1 text-sm text-muted-foreground">{message}</p>}
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCcw className="size-4" aria-hidden="true" /> Try again
        </Button>
      )}
    </div>
  )
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <Inbox className="size-6 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
    </div>
  )
}
