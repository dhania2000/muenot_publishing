"use client"

/**
 * @file components/publishing/conversion/pdf/pdf-preview-components.tsx
 * @module Publishing › Conversion › PDF
 * @kind React client component
 * @summary Generic toolbar (grouped actions, tooltips, arrow-key navigation, small-screen overflow) plus the
 *   preview toolbar, preview mode selector, preview container states and page thumbnail (Tasks 8.4, 8.7).
 * @exports PdfToolbar, PdfPreviewToolbar, PdfPreviewModeSelector, PdfPreviewContainer, PdfPageThumbnail,
 *   PdfToolbarAction, PdfViewerControls, PdfPreviewMode, PdfPreviewState, PDF_PREVIEW_MODES
 *
 * Viewer controls are disabled until a caller passes a working handler. Page numbers and zoom are only shown
 * when the caller knows them; nothing is estimated.
 */
import { useId } from "react"
import {
  ChevronLeft,
  ChevronRight,
  Columns2,
  Maximize,
  Minus,
  MoreHorizontal,
  MoveHorizontal,
  Plus,
  RotateCw,
  Scan,
  Search,
  type LucideIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { PdfFeedbackState } from "@/components/publishing/conversion/pdf/pdf-feedback-state"
import { cn } from "@/lib/utils"

// ─── Generic toolbar ────────────────────────────────────────────────────────

export type PdfToolbarAction = {
  id: string
  label: string
  icon: LucideIcon
  /** Omit to render the control disabled. */
  onClick?: () => void
  disabled?: boolean
  /** Toggle controls (e.g. fullscreen) report their state. */
  pressed?: boolean
  /** Moves into the "More" menu below the sm breakpoint. */
  overflow?: boolean
}

export type PdfToolbarGroup = { id: string; actions: readonly PdfToolbarAction[] }

function focusSibling(container: HTMLElement, current: Element | null, step: 1 | -1 | "first" | "last") {
  const items = Array.from(container.querySelectorAll<HTMLButtonElement>("button:not([disabled])")).filter(
    (el) => el.offsetParent !== null,
  )
  if (items.length === 0) return
  const index = items.indexOf(current as HTMLButtonElement)
  const next =
    step === "first" ? 0 : step === "last" ? items.length - 1 : (index + step + items.length) % items.length
  items[next]?.focus()
}

function ToolbarButton({ action, className }: { action: PdfToolbarAction; className?: string }) {
  const Icon = action.icon
  const disabled = action.disabled || !action.onClick
  const button = (
    <Button
      variant="ghost"
      size="icon-sm"
      disabled={disabled}
      aria-label={action.label}
      aria-pressed={action.pressed}
      title={disabled ? action.label : undefined}
      onClick={action.onClick}
      className={className}
    >
      <Icon aria-hidden="true" />
    </Button>
  )
  // Disabled buttons cannot receive hover or focus, so they rely on aria-label + title instead of a tooltip.
  if (disabled) return button
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{action.label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Accessible toolbar: role="toolbar", groups separated visually, Arrow/Home/End move focus between enabled
 * controls. Actions flagged `overflow` collapse into a "More" menu on small screens.
 */
export function PdfToolbar({
  label,
  groups,
  describedBy,
  start,
  end,
  className,
}: {
  label: string
  groups: readonly PdfToolbarGroup[]
  describedBy?: string
  /** Non-button content placed before the first group (e.g. a page indicator). */
  start?: React.ReactNode
  /** Content pinned to the trailing edge (e.g. a hint). */
  end?: React.ReactNode
  className?: string
}) {
  const overflowActions = groups.flatMap((g) => g.actions.filter((a) => a.overflow))
  return (
    <div
      role="toolbar"
      aria-label={label}
      aria-describedby={describedBy}
      onKeyDown={(e) => {
        const map = { ArrowRight: 1, ArrowLeft: -1, Home: "first", End: "last" } as const
        const step = map[e.key as keyof typeof map]
        if (step === undefined) return
        e.preventDefault()
        focusSibling(e.currentTarget, document.activeElement, step)
      }}
      className={cn("flex min-w-0 flex-wrap items-center gap-1 border-b bg-muted/30 px-2 py-1.5", className)}
    >
      {start}
      {groups.map((group, i) => (
        <div key={group.id} role="group" className="flex items-center gap-1">
          {i > 0 && <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />}
          {group.actions.map((action) => (
            <ToolbarButton key={action.id} action={action} className={action.overflow ? "hidden sm:inline-flex" : undefined} />
          ))}
        </div>
      ))}
      {overflowActions.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="More viewer controls" className="sm:hidden">
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {overflowActions.map((action) => (
              <DropdownMenuItem key={action.id} disabled={action.disabled || !action.onClick} onSelect={() => action.onClick?.()}>
                <action.icon aria-hidden="true" />
                {action.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {end && <div className="ml-auto min-w-0">{end}</div>}
    </div>
  )
}

// ─── Preview toolbar ────────────────────────────────────────────────────────

/** Handlers for a real viewer. Each control is enabled only when its handler exists. */
export type PdfViewerControls = {
  page?: number
  pageCount?: number
  /** Zoom as a percentage, only when the viewer reports it. */
  zoomPercent?: number
  fullscreen?: boolean
  onPreviousPage?: () => void
  onNextPage?: () => void
  onZoomOut?: () => void
  onZoomIn?: () => void
  onFitWidth?: () => void
  onFitPage?: () => void
  onRotate?: () => void
  onSearch?: () => void
  onToggleFullscreen?: () => void
}

export function PdfPreviewToolbar({
  controls = {},
  unavailableHint = "Viewer controls arrive with document rendering.",
}: {
  controls?: PdfViewerControls
  /** Shown when no viewer is connected. */
  unavailableHint?: string
}) {
  const hintId = useId()
  const c = controls
  const atFirst = c.page !== undefined && c.page <= 1
  const atLast = c.page !== undefined && c.pageCount !== undefined && c.page >= c.pageCount
  const connected = Object.keys(c).some((key) => key.startsWith("on"))
  const pageKnown = c.page !== undefined && c.pageCount !== undefined

  const groups: PdfToolbarGroup[] = [
    {
      id: "zoom",
      actions: [
        { id: "zoom-out", label: "Zoom out", icon: Minus, onClick: c.onZoomOut },
        { id: "zoom-in", label: "Zoom in", icon: Plus, onClick: c.onZoomIn },
        { id: "fit-width", label: "Fit width", icon: MoveHorizontal, onClick: c.onFitWidth, overflow: true },
        { id: "fit-page", label: "Fit page", icon: Scan, onClick: c.onFitPage, overflow: true },
      ],
    },
    {
      id: "view",
      actions: [
        { id: "rotate", label: "Rotate view", icon: RotateCw, onClick: c.onRotate, overflow: true },
        { id: "search", label: "Search document", icon: Search, onClick: c.onSearch, overflow: true },
        { id: "fullscreen", label: "Fullscreen", icon: Maximize, onClick: c.onToggleFullscreen, pressed: c.onToggleFullscreen ? !!c.fullscreen : undefined },
      ],
    },
  ]

  return (
    <PdfToolbar
      label="Viewer controls"
      describedBy={connected ? undefined : hintId}
      start={
        <div role="group" aria-label="Page navigation" className="flex items-center gap-1">
          <ToolbarButton action={{ id: "prev", label: "Previous page", icon: ChevronLeft, onClick: c.onPreviousPage, disabled: atFirst }} />
          <ToolbarButton action={{ id: "next", label: "Next page", icon: ChevronRight, onClick: c.onNextPage, disabled: atLast }} />
          <span
            className="px-1 text-xs tabular-nums text-muted-foreground"
            aria-live="polite"
            aria-label={pageKnown ? `Page ${c.page} of ${c.pageCount}` : "Page number unavailable"}
          >
            {pageKnown ? `${c.page} / ${c.pageCount}` : "– / –"}
          </span>
          {c.zoomPercent !== undefined && (
            <span className="px-1 text-xs tabular-nums text-muted-foreground">{`${Math.round(c.zoomPercent)}%`}</span>
          )}
          <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
        </div>
      }
      groups={groups}
      end={
        !connected && (
          <span id={hintId} className="text-xs text-muted-foreground">
            {unavailableHint}
          </span>
        )
      }
    />
  )
}

// ─── Mode selector ──────────────────────────────────────────────────────────

export type PdfPreviewMode = "original" | "output" | "compare"

export const PDF_PREVIEW_MODES: readonly { value: PdfPreviewMode; label: string; icon?: LucideIcon }[] = [
  { value: "original", label: "Original" },
  { value: "output", label: "Converted" },
  { value: "compare", label: "Compare", icon: Columns2 },
]

/** Must be rendered inside a `<Tabs>` root that owns the selected mode. */
export function PdfPreviewModeSelector({ disabledModes = [] }: { disabledModes?: readonly PdfPreviewMode[] }) {
  return (
    <TabsList aria-label="Preview mode">
      {PDF_PREVIEW_MODES.map(({ value, label, icon: Icon }) => (
        <TabsTrigger key={value} value={value} disabled={disabledModes.includes(value)}>
          {Icon && <Icon aria-hidden="true" className="hidden sm:block" />}
          {label}
        </TabsTrigger>
      ))}
    </TabsList>
  )
}

// ─── Container states ───────────────────────────────────────────────────────

export type PdfPreviewState = "ready" | "no-document" | "no-output" | "loading" | "error" | "unsupported" | "unavailable"

/**
 * One container for source, converted and side-by-side previews. Children only render in the "ready" state;
 * every other state shows a standard message.
 */
export function PdfPreviewContainer({
  state,
  title,
  description,
  icon,
  onRetry,
  layout = "single",
  children,
  className,
}: {
  state: PdfPreviewState
  title?: string
  description?: string
  icon?: LucideIcon
  onRetry?: () => void
  /** "compare" lays children out side by side from lg. */
  layout?: "single" | "compare"
  children?: React.ReactNode
  className?: string
}) {
  if (state !== "ready") {
    const kind =
      state === "no-output" ? "no-output" : state === "unavailable" ? "unavailable" : state
    return (
      <div className={cn("h-full", className)} data-preview-state={state}>
        <PdfFeedbackState kind={kind} title={title} description={description} icon={icon} onRetry={onRetry} />
      </div>
    )
  }
  return (
    <div
      data-preview-state="ready"
      className={cn(layout === "compare" ? "grid h-full min-w-0 gap-4 lg:grid-cols-2" : "h-full min-w-0", className)}
    >
      {children}
    </div>
  )
}

// ─── Page thumbnail ─────────────────────────────────────────────────────────

/** A page thumbnail is only drawn from a real rendered image; otherwise the page number is shown plainly. */
export function PdfPageThumbnail({
  pageNumber,
  imageSrc,
  selected = false,
  error = false,
  onSelect,
}: {
  pageNumber: number
  imageSrc?: string
  selected?: boolean
  error?: boolean
  onSelect?: () => void
}) {
  const label = `Page ${pageNumber}${error ? ", failed to render" : ""}`
  return (
    <button
      type="button"
      aria-label={label}
      aria-current={selected ? "page" : undefined}
      disabled={!onSelect}
      onClick={onSelect}
      className={cn(
        "flex w-20 flex-col items-center gap-1 rounded-md p-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        selected && "bg-primary/5",
      )}
    >
      <span
        className={cn(
          "flex aspect-[3/4] w-full items-center justify-center overflow-hidden rounded-sm border bg-card",
          selected ? "border-primary ring-1 ring-primary" : "border-border",
          error && "border-destructive/50",
        )}
      >
        {imageSrc && !error ? (
          // eslint-disable-next-line @next/next/no-img-element -- rendered page images are blob/data URLs, not optimizable assets
          <img src={imageSrc} alt="" className="size-full object-contain" />
        ) : (
          <span className={cn("text-xs", error ? "text-destructive" : "text-muted-foreground")}>{error ? "Error" : pageNumber}</span>
        )}
      </span>
      <span className="text-xs tabular-nums text-muted-foreground">{pageNumber}</span>
    </button>
  )
}
