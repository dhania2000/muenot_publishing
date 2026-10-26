"use client"

/**
 * @file components/publishing/alt-text/workbench.tsx
 * @module Publishing · Alt Text
 * @kind React client components
 * @summary Shared workspace shell for every Alt Text tab: a viewport-fitted root, a compact
 *   contextual toolbar, a scroll region that owns overflow on desktop, segmented step
 *   navigation and a standard-width drawer. On narrow screens everything falls back to
 *   natural page scrolling.
 */
import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

export function Workbench({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("flex min-w-0 flex-col gap-3 lg:h-full lg:min-h-0", className)}>{children}</div>
}

export function WorkbenchToolbar({
  label,
  title,
  meta,
  children,
  className,
}: {
  label: string
  title?: ReactNode
  meta?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <div
      role="toolbar"
      aria-label={label}
      className={cn("flex min-w-0 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-card px-3 py-2 shadow-xs", className)}
    >
      {title || meta ? (
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {title ? <div className="min-w-0 truncate text-sm font-semibold text-foreground">{title}</div> : null}
          {meta}
        </div>
      ) : (
        <div className="flex-1" />
      )}
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  )
}

export function ToolbarDivider() {
  return <span aria-hidden="true" className="hidden h-5 w-px bg-border sm:block" />
}

/** The only region that scrolls on desktop; keeps a single scrollbar per pane. */
export function WorkbenchScroll({ className, children, label }: { className?: string; children: ReactNode; label?: string }) {
  return (
    <div
      className={cn("min-h-0 min-w-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain", className)}
      {...(label ? { role: "region", "aria-label": label, tabIndex: 0 } : {})}
    >
      {children}
    </div>
  )
}

export type StepItem<T extends string> = { id: T; label: string; icon?: LucideIcon; hint?: string; disabled?: boolean }

export function StepNav<T extends string>({
  label,
  steps,
  value,
  onChange,
}: {
  label: string
  steps: StepItem<T>[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <nav aria-label={label} className="min-w-0 shrink-0 overflow-x-auto">
      <ol className="flex w-max min-w-full items-center gap-1 rounded-lg border bg-card p-1">
        {steps.map((step, index) => {
          const active = step.id === value
          const Icon = step.icon
          return (
            <li key={step.id} className="flex-1">
              <button
                type="button"
                disabled={step.disabled}
                aria-current={active ? "step" : undefined}
                onClick={() => onChange(step.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
                  active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums",
                    active ? "bg-primary-foreground/15" : "bg-muted ring-1 ring-border",
                  )}
                  aria-hidden="true"
                >
                  {Icon ? <Icon className="size-3" /> : index + 1}
                </span>
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="font-medium">{step.label}</span>
                  {step.hint ? <span className={cn("text-[11px]", active ? "text-primary-foreground/75" : "text-muted-foreground")}>{step.hint}</span> : null}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

const DRAWER_WIDTH = { md: "sm:max-w-md", lg: "sm:max-w-xl", xl: "sm:max-w-3xl", full: "sm:max-w-[96vw]" } as const

/**
 * Standard right-side drawer. Children stay mounted only while open; callers keep the
 * underlying state in their own component so closing never loses work.
 */
export function WorkbenchDrawer({
  open,
  onOpenChange,
  title,
  description,
  size = "lg",
  footer,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: ReactNode
  size?: keyof typeof DRAWER_WIDTH
  footer?: ReactNode
  children: ReactNode
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className={cn("flex w-full flex-col gap-0 p-0", DRAWER_WIDTH[size])}>
        <SheetHeader className="border-b px-5 py-4 pr-12">
          <SheetTitle>{title}</SheetTitle>
          {description ? <SheetDescription>{description}</SheetDescription> : null}
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <SheetFooter className="border-t px-5 py-3">{footer}</SheetFooter> : null}
      </SheetContent>
    </Sheet>
  )
}

export function KpiStrip({ items, className }: { items: { label: string; value: ReactNode; tone?: "default" | "danger" | "success" }[]; className?: string }) {
  return (
    <dl className={cn("flex min-w-0 flex-wrap items-center gap-x-5 gap-y-1", className)}>
      {items.map((item) => (
        <div key={item.label} className="flex items-baseline gap-1.5">
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd
            className={cn(
              "text-sm font-semibold tabular-nums",
              item.tone === "danger" ? "text-destructive" : item.tone === "success" ? "text-emerald-700" : "text-foreground",
            )}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
