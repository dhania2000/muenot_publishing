"use client"

/**
 * @file components/publishing/conversion/pdf/pdf-content.tsx
 * @module Publishing › Conversion › PDF
 * @kind React client component
 * @summary Content composition primitives used inside PdfModuleLayout: section (with loading/empty/error states),
 *   panel (icon, actions, footer, optional collapse), panel header, info card, split and three-panel grid.
 * @exports PdfSection, PdfPanel, PdfPanelHeader, PdfInfoCard, PdfSplitContent, PdfThreePanelContent
 * @see PDF_PHASE1_TASK2_UI_ARCHITECTURE.md §6.3, §7
 */
import { useId, useState } from "react"
import { ChevronDown, type LucideIcon } from "lucide-react"
import { PdfFeedbackState, type PdfFeedbackKind } from "@/components/publishing/conversion/pdf/pdf-feedback-state"
import { cn } from "@/lib/utils"

export type PdfContentState =
  | { kind: "ready" }
  | { kind: "loading"; label?: string }
  | { kind: "empty"; feedback?: PdfFeedbackKind; title?: string; description?: string; action?: React.ReactNode }
  | { kind: "error"; title?: string; description?: string; onRetry?: () => void }

type PdfSectionProps = {
  title?: string
  description?: string
  actions?: React.ReactNode
  id?: string
  /** Replaces children with a standard loading, empty or error state. Defaults to ready. */
  state?: PdfContentState
  className?: string
  children?: React.ReactNode
}

function StateContent({ state }: { state: Exclude<PdfContentState, { kind: "ready" }> }) {
  if (state.kind === "loading") return <PdfFeedbackState kind="loading" title={state.label} />
  if (state.kind === "error") {
    return <PdfFeedbackState kind="error" title={state.title} description={state.description} onRetry={state.onRetry} />
  }
  return (
    <PdfFeedbackState kind={state.feedback ?? "no-data"} title={state.title} description={state.description} action={state.action} />
  )
}

/** Standard content block for dashboards, reports, forms and settings. */
export function PdfSection({ title, description, actions, id, state, className, children }: PdfSectionProps) {
  const headingId = title && id ? `${id}-heading` : undefined
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      aria-busy={state?.kind === "loading" || undefined}
      className={cn("flex min-w-0 flex-col gap-3", className)}
    >
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
      {state && state.kind !== "ready" ? <StateContent state={state} /> : children}
    </section>
  )
}

/** Standard panel header row: icon + title, optional status/actions on the right. Used by every PDF panel. */
export function PdfPanelHeader({
  title,
  icon: Icon,
  headingId,
  headingLevel = 2,
  meta,
  children,
  className,
}: {
  title: string
  icon?: LucideIcon
  headingId?: string
  headingLevel?: 2 | 3
  /** Inline content next to the title, e.g. a count badge. */
  meta?: React.ReactNode
  children?: React.ReactNode
  className?: string
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3"
  return (
    <header className={cn("flex min-h-11 min-w-0 shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-card px-3 py-2", className)}>
      {/* basis-40 lets the controls wrap below the title on narrow panels instead of squeezing it to "Do…". */}
      <div className="flex min-w-0 basis-40 grow items-center gap-2">
        <Heading id={headingId} className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
          {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
          <span className="truncate">{title}</span>
        </Heading>
        {meta}
      </div>
      {children && <div className="flex max-w-full shrink-0 flex-wrap items-center gap-1">{children}</div>}
    </header>
  )
}

type PdfPanelProps = {
  title?: string
  icon?: LucideIcon
  actions?: React.ReactNode
  footer?: React.ReactNode
  label?: string
  /** Adds a header toggle that hides the body. Requires a title. */
  collapsible?: boolean
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  state?: PdfContentState
  className?: string
  bodyClassName?: string
  children?: React.ReactNode
}

/** Bordered surface with an optional sticky header and footer; body scrolls independently when height is constrained. */
export function PdfPanel({
  title,
  icon: Icon,
  actions,
  footer,
  label,
  collapsible,
  defaultOpen = true,
  open: openProp,
  onOpenChange,
  state,
  className,
  bodyClassName,
  children,
}: PdfPanelProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const open = openProp ?? uncontrolledOpen
  const bodyId = useId()
  const toggle = () => {
    setUncontrolledOpen(!open)
    onOpenChange?.(!open)
  }
  const canCollapse = collapsible && title

  return (
    <section
      aria-label={label ?? title}
      aria-busy={state?.kind === "loading" || undefined}
      data-state={canCollapse ? (open ? "open" : "closed") : undefined}
      className={cn("flex min-h-0 min-w-0 flex-col rounded-lg border bg-card text-card-foreground", className)}
    >
      {(title || actions) && (
        <header
          className={cn(
            "sticky top-0 z-[1] flex min-w-0 items-center justify-between gap-2 rounded-t-lg bg-card px-4 py-2.5",
            (!canCollapse || open) && "border-b",
          )}
        >
          {title &&
            (canCollapse ? (
              <h3 className="min-w-0 text-sm font-medium">
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={bodyId}
                  onClick={toggle}
                  className="flex min-w-0 items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ChevronDown
                    className={cn("size-4 shrink-0 text-muted-foreground transition-transform", !open && "-rotate-90")}
                    aria-hidden="true"
                  />
                  {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                  <span className="truncate">{title}</span>
                </button>
              </h3>
            ) : (
              <h3 className="flex min-w-0 items-center gap-2 text-sm font-medium">
                {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                <span className="truncate">{title}</span>
              </h3>
            ))}
          {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
        </header>
      )}
      <div id={bodyId} hidden={canCollapse ? !open : undefined} className={cn("min-h-0 min-w-0 flex-1 overflow-y-auto p-4", bodyClassName)}>
        {state && state.kind !== "ready" ? <StateContent state={state} /> : children}
      </div>
      {footer && (!canCollapse || open) && (
        <footer className="flex min-w-0 flex-wrap items-center justify-end gap-2 border-t px-4 py-2.5">{footer}</footer>
      )}
    </section>
  )
}

export type PdfInfoCardMeta = { label: string; value: React.ReactNode }

/** Compact summary card: icon, title, status, short description, metadata and one optional action. */
export function PdfInfoCard({
  title,
  description,
  icon: Icon,
  status,
  meta = [],
  action,
  className,
}: {
  title: string
  description?: string
  icon?: LucideIcon
  status?: React.ReactNode
  meta?: PdfInfoCardMeta[]
  action?: React.ReactNode
  className?: string
}) {
  return (
    <article className={cn("flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-4 text-card-foreground", className)}>
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted/40" aria-hidden="true">
            <Icon className="size-4 text-muted-foreground" />
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <h3 className="truncate text-sm font-medium">{title}</h3>
            {status}
          </div>
          {description && <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>}
        </div>
      </div>
      {meta.length > 0 && (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
          {meta.map((m) => (
            <div key={m.label} className="contents">
              <dt className="text-muted-foreground">{m.label}</dt>
              <dd className="min-w-0 truncate">{m.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
    </article>
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
 * Column templates keyed to the panel container's own width (not the viewport), so the app sidebar is accounted for.
 * ≥ 56rem: compact side panels (laptop). ≥ 72rem: full side panels (desktop). A collapsed side panel shrinks to a
 * 48px rail; the preview always keeps the remaining width.
 */
const THREE_PANEL_COLUMNS = {
  "open-open":
    "@4xl/pdf-panels:grid-cols-[minmax(200px,240px)_minmax(0,1fr)_minmax(240px,280px)] @6xl/pdf-panels:grid-cols-[minmax(240px,280px)_minmax(0,1fr)_minmax(280px,320px)]",
  "closed-open":
    "@4xl/pdf-panels:grid-cols-[48px_minmax(0,1fr)_minmax(240px,280px)] @6xl/pdf-panels:grid-cols-[48px_minmax(0,1fr)_minmax(280px,320px)]",
  "open-closed":
    "@4xl/pdf-panels:grid-cols-[minmax(200px,240px)_minmax(0,1fr)_48px] @6xl/pdf-panels:grid-cols-[minmax(240px,280px)_minmax(0,1fr)_48px]",
  "closed-closed": "@4xl/pdf-panels:grid-cols-[48px_minmax(0,1fr)_48px]",
} as const

/**
 * Three-panel composition: source · preview · settings.
 * Wrapped in the `pdf-panels` container: descendants (slot classes, collapse rails) can use `@4xl/pdf-panels:` variants
 * to match the column switch exactly. Stacks in source → preview → settings order below 56rem.
 * Height is left to the caller so document previews are not constrained here.
 */
export function PdfThreePanelContent({
  source,
  preview,
  settings,
  sourceCollapsed = false,
  settingsCollapsed = false,
  slotClassNames,
  className,
  ...rest
}: {
  source: React.ReactNode
  preview: React.ReactNode
  settings: React.ReactNode
  sourceCollapsed?: boolean
  settingsCollapsed?: boolean
  slotClassNames?: { source?: string; preview?: string; settings?: string }
  className?: string
} & Omit<React.ComponentProps<"div">, "children">) {
  const columns = THREE_PANEL_COLUMNS[`${sourceCollapsed ? "closed" : "open"}-${settingsCollapsed ? "closed" : "open"}`]
  return (
    <div className="@container/pdf-panels min-w-0">
      <div className={cn("grid min-w-0 gap-4", columns, className)} {...rest}>
        <div data-slot="pdf-source" className={cn("flex min-h-0 min-w-0 flex-col", slotClassNames?.source)}>
          {source}
        </div>
        <div data-slot="pdf-preview" className={cn("flex min-h-0 min-w-0 flex-col", slotClassNames?.preview)}>
          {preview}
        </div>
        <div data-slot="pdf-settings" className={cn("flex min-h-0 min-w-0 flex-col", slotClassNames?.settings)}>
          {settings}
        </div>
      </div>
    </div>
  )
}
