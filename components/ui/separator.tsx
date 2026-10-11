"use client"

/**
 * @file components/ui/separator.tsx
 * @module UI primitives (shadcn/ui)
 * @kind React client component
 * @summary UI primitives (shadcn/ui) UI: Separator.
 * @exports Separator
 * @usedBy app/admin/reference-numbers/reference-client.tsx, app/esign/sign/[token]/sign-client.tsx, components/admin/localization-client.tsx, components/admin/maker-checker/change-detail-sheet.tsx, components/admin/maker-checker/operation-detail-sheet.tsx (+53 more)
 * @see docs/CODEBASE-GUIDE.md for module ownership, conventions and where to add new code.
 */
import { Separator as SeparatorPrimitive } from "@base-ui/react/separator"

import { cn } from "@/lib/utils"

function Separator({
  className,
  orientation = "horizontal",
  ...props
}: SeparatorPrimitive.Props) {
  return (
    <SeparatorPrimitive
      data-slot="separator"
      orientation={orientation}
      className={cn(
        "shrink-0 bg-border data-horizontal:h-px data-horizontal:w-full data-vertical:w-px data-vertical:self-stretch",
        className
      )}
      {...props}
    />
  )
}

export { Separator }
