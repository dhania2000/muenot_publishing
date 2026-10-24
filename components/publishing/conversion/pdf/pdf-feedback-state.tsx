/**
 * @file components/publishing/conversion/pdf/pdf-feedback-state.tsx
 * @module Publishing › Conversion › PDF
 * @kind React server component
 * @summary Thin PDF wrapper over the shared Empty, Skeleton and ErrorState components.
 * @exports PdfFeedbackState, PdfFeedbackKind
 */
import { Clock, FileQuestion, FileText, Inbox } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { ErrorState } from "@/components/enterprise/data-state"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"

export type PdfFeedbackKind = "no-document" | "no-data" | "unavailable" | "pending" | "loading" | "error"

const DEFAULTS: Record<Exclude<PdfFeedbackKind, "loading" | "error">, { icon: LucideIcon; title: string }> = {
  "no-document": { icon: FileQuestion, title: "No document selected" },
  "no-data": { icon: Inbox, title: "Nothing here yet" },
  unavailable: { icon: FileText, title: "Coming soon" },
  pending: { icon: Clock, title: "Processing pending" },
}

type PdfFeedbackStateProps = {
  kind: PdfFeedbackKind
  title?: string
  description?: string
  icon?: LucideIcon
  action?: React.ReactNode
}

/**
 * Feedback states never imply work is running: "pending" is a static message with no progress,
 * and "unavailable" states plainly that the feature is not built.
 */
export function PdfFeedbackState({ kind, title, description, icon, action }: PdfFeedbackStateProps) {
  if (kind === "loading") {
    return (
      <div role="status" aria-label={title ?? "Loading"} className="flex flex-col gap-3">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  if (kind === "error") {
    return (
      <div className="rounded-lg border">
        <ErrorState title={title} message={description} />
      </div>
    )
  }

  const { icon: DefaultIcon, title: defaultTitle } = DEFAULTS[kind]
  const Icon = icon ?? DefaultIcon
  return (
    <Empty className="border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{title ?? defaultTitle}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {action}
    </Empty>
  )
}
