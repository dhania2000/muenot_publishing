"use client"

/**
 * @file components/ui/tooltip.tsx
 * @module UI primitives (shadcn/ui)
 * @kind React client component
 * @summary UI primitives (shadcn/ui) UI: Tooltip, TooltipContent, TooltipProvider, TooltipTrigger.
 * @exports Tooltip, TooltipContent, TooltipProvider, TooltipTrigger
 * @usedBy components/admin/access-governance/shared.tsx, components/admin/access-ui.tsx, components/admin/data-permissions/scope-badges.tsx, components/admin/maker-checker/operations-panel.tsx, components/admin/user-lifecycle/status-badges.tsx (+59 more)
 * @see docs/CODEBASE-GUIDE.md for module ownership, conventions and where to add new code.
 */
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"

import { cn } from "@/lib/utils"
import { asChildProps } from "@/components/ui/as-child"

function TooltipProvider({ delay = 150, ...props }: TooltipPrimitive.Provider.Props) {
  return <TooltipPrimitive.Provider delay={delay} {...props} />
}

function Tooltip(props: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root {...props} />
}

function TooltipTrigger({ asChild, children, ...props }: TooltipPrimitive.Trigger.Props & { asChild?: boolean }) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} {...asChildProps(asChild, children)} />
}

function TooltipContent({
  className,
  side = "top",
  sideOffset = 6,
  align = "center",
  children,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<TooltipPrimitive.Positioner.Props, "side" | "sideOffset" | "align">) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner side={side} sideOffset={sideOffset} align={align} className="isolate z-50">
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "max-w-64 origin-(--transform-origin) rounded-md bg-foreground px-2.5 py-1.5 text-xs leading-relaxed text-background shadow-sm transition-[transform,opacity] duration-150 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
            className,
          )}
          {...props}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
