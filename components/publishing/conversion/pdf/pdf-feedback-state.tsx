/**
 * @file components/publishing/conversion/pdf/pdf-feedback-state.tsx
 * @module Publishing › Conversion › PDF
 * @kind React server component
 * @summary Thin PDF wrapper over the shared Empty, Skeleton and ErrorState components, with the standard
 *   PDF empty/loading/error presets (Task 8.11).
 * @exports PdfFeedbackState, PdfFeedbackKind, PDF_FEEDBACK_PRESETS
 */
import {
  Ban,
  BookOpenCheck,
  Clock,
  Construction,
  FileOutput,
  FileQuestion,
  FileText,
  FolderOpen,
  History,
  Inbox,
  ListChecks,
  SlidersHorizontal,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { ErrorState } from "@/components/enterprise/data-state"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

export type PdfFeedbackKind =
  // Original kinds (Tasks 6–7)
  | "no-document"
  | "no-data"
  | "unavailable"
  | "pending"
  | "loading"
  | "error"
  // Standard presets (Task 8)
  | "no-files"
  | "no-output"
  | "no-job"
  | "no-history"
  | "no-profiles"
  | "no-guidelines"
  | "unsupported"
  | "development-pending"
  | "network-failure"

type Preset = { icon: LucideIcon; title: string; description?: string }

export const PDF_FEEDBACK_PRESETS: Record<Exclude<PdfFeedbackKind, "loading" | "error" | "network-failure">, Preset> = {
  "no-document": { icon: FileQuestion, title: "No document selected", description: "Choose a file in Source Files." },
  "no-data": { icon: Inbox, title: "Nothing here yet" },
  unavailable: { icon: FileText, title: "Coming soon" },
  pending: { icon: Clock, title: "Processing pending" },
  "no-files": { icon: FolderOpen, title: "No files added", description: "Add a document to begin." },
  "no-output": { icon: FileOutput, title: "No converted output", description: "Output appears here after a document is processed." },
  "no-job": { icon: ListChecks, title: "No processing job", description: "Stage, progress and messages appear here once a job runs." },
  "no-history": { icon: History, title: "No conversion history", description: "Finished and failed jobs will be listed here." },
  "no-profiles": { icon: SlidersHorizontal, title: "No saved profiles", description: "The Standard Profile is used until a profile is saved." },
  "no-guidelines": {
    icon: BookOpenCheck,
    title: "No guidelines provided",
    description: "Company guidelines are optional. Standard settings will be used.",
  },
  unsupported: { icon: Ban, title: "Not supported", description: "This feature is not supported for the selected format." },
  "development-pending": { icon: Construction, title: "In development", description: "This feature is planned for a later phase." },
}

type PdfFeedbackStateProps = {
  kind: PdfFeedbackKind
  title?: string
  description?: string
  icon?: LucideIcon
  /** Only pass an action that is wired to working functionality. */
  action?: React.ReactNode
  /** Client callers only: shows a retry button on error states. */
  onRetry?: () => void
  /** Compact variant for narrow panels and lists. */
  size?: "default" | "compact"
  className?: string
}

/**
 * Feedback states never imply work is running: "pending" is a static message with no progress,
 * and "unavailable" / "development-pending" plainly state that the feature is not built.
 * "no-guidelines" is informational, never an error, because guidelines are optional.
 */
export function PdfFeedbackState({ kind, title, description, icon, action, onRetry, size = "default", className }: PdfFeedbackStateProps) {
  if (kind === "loading") {
    return (
      <div role="status" aria-label={title ?? "Loading"} className={cn("flex flex-col gap-3", className)}>
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className={size === "compact" ? "h-10 w-full" : "h-24 w-full"} />
        {size === "default" && <Skeleton className="h-24 w-full" />}
      </div>
    )
  }

  if (kind === "error" || kind === "network-failure") {
    const fallbackTitle = kind === "network-failure" ? "Connection or processing failure" : undefined
    const fallbackDescription =
      kind === "network-failure" ? "The request could not be completed. Check your connection and try again." : undefined
    return (
      <div className={cn("rounded-lg border", className)} data-feedback-kind={kind}>
        <ErrorState title={title ?? fallbackTitle} message={description ?? fallbackDescription} onRetry={onRetry} />
      </div>
    )
  }

  const preset = PDF_FEEDBACK_PRESETS[kind]
  const Icon = icon ?? preset.icon
  const resolvedTitle = title ?? preset.title
  const resolvedDescription = description ?? (title ? undefined : preset.description)

  if (size === "compact") {
    return (
      <div
        data-feedback-kind={kind}
        className={cn("flex flex-col items-center gap-2 rounded-md border border-dashed px-3 py-6 text-center", className)}
      >
        <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm font-medium text-foreground">{resolvedTitle}</p>
        {resolvedDescription && <p className="text-xs leading-relaxed text-muted-foreground">{resolvedDescription}</p>}
        {action}
      </div>
    )
  }

  return (
    <Empty className={cn("border border-dashed", className)} data-feedback-kind={kind}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{resolvedTitle}</EmptyTitle>
        {resolvedDescription && <EmptyDescription>{resolvedDescription}</EmptyDescription>}
      </EmptyHeader>
      {action}
    </Empty>
  )
}
