/**
 * @file components/publishing/conversion/pdf/pdf-content.tsx
 * @module Publishing › Conversion › PDF
 * @kind React server component
 * @summary Content composition primitives used inside PdfModuleLayout: section, panel, split and three-panel grid.
 * @exports PdfSection, PdfPanel, PdfSplitContent, PdfThreePanelContent
 * @see PDF_PHASE1_TASK2_UI_ARCHITECTURE.md §6.3, §7
 */
import { cn } from "@/lib/utils"

type PdfSectionProps = {
  title?: string
  description?: string
  actions?: React.ReactNode
  id?: string
  className?: string
  children: React.ReactNode
}

/** Standard content block for dashboards, reports, forms and settings. */
export function PdfSection({ title, description, actions, id, className, children }: PdfSectionProps) {
  const headingId = title && id ? `${id}-heading` : undefined
  return (
    <section id={id} aria-labelledby={headingId} className={cn("flex min-w-0 flex-col gap-3", className)}>
      {(title || actions) && (
        <div className="flex min-w-0 flex-wrap items-end justify-between gap-2">
          <div className="min-w-0">
            {title && (
              <h2 id={headingId} className="text-base font-semibold text-foreground">
                {title}
              </h2>
            )}
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

type PdfPanelProps = {
  title?: string
  actions?: React.ReactNode
  label?: string
  className?: string
  bodyClassName?: string
  children: React.ReactNode
}

/** Bordered surface with an optional sticky header; body scrolls independently when height is constrained. */
export function PdfPanel({ title, actions, label, className, bodyClassName, children }: PdfPanelProps) {
  return (
    <section
      aria-label={label ?? title}
      className={cn("flex min-h-0 min-w-0 flex-col rounded-lg border bg-card text-card-foreground", className)}
    >
      {(title || actions) && (
        <header className="sticky top-0 z-[1] flex min-w-0 items-center justify-between gap-2 border-b bg-card px-4 py-2.5">
          {title && <h3 className="truncate text-sm font-medium">{title}</h3>}
          {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
        </header>
      )}
      <div className={cn("min-h-0 min-w-0 flex-1 overflow-y-auto p-4", bodyClassName)}>{children}</div>
    </section>
  )
}

type SplitRatio = "even" | "primary" | "secondary"

const SPLIT_CLASS: Record<SplitRatio, string> = {
  even: "lg:grid-cols-2",
  primary: "lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]",
  secondary: "lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]",
}

/** Two columns from lg up (e.g. settings + preview); stacks below lg. */
export function PdfSplitContent({
  primary,
  secondary,
  ratio = "even",
  className,
}: {
  primary: React.ReactNode
  secondary: React.ReactNode
  ratio?: SplitRatio
  className?: string
}) {
  return (
    <div className={cn("grid min-w-0 gap-6", SPLIT_CLASS[ratio], className)}>
      <div className="flex min-w-0 flex-col gap-4">{primary}</div>
      <div className="flex min-w-0 flex-col gap-4">{secondary}</div>
    </div>
  )
}

/**
 * Three-panel composition for the future Workspace (Task 7): source · preview · settings.
 * Fixed default widths from xl; stacks in source → preview → settings order below xl.
 * Height is left to the caller so document previews are not constrained here.
 */
export function PdfThreePanelContent({
  source,
  preview,
  settings,
  className,
}: {
  source: React.ReactNode
  preview: React.ReactNode
  settings: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "grid min-w-0 gap-4 xl:grid-cols-[minmax(240px,280px)_minmax(0,1fr)_minmax(280px,320px)]",
        className,
      )}
    >
      <div data-slot="pdf-source" className="flex min-h-0 min-w-0 flex-col">
        {source}
      </div>
      <div data-slot="pdf-preview" className="flex min-h-0 min-w-0 flex-col">
        {preview}
      </div>
      <div data-slot="pdf-settings" className="flex min-h-0 min-w-0 flex-col">
        {settings}
      </div>
    </div>
  )
}
