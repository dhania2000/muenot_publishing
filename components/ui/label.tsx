"use client"

/**
 * @file components/ui/label.tsx
 * @module UI primitives (shadcn/ui)
 * @kind React client component
 * @summary UI primitives (shadcn/ui) UI: Label.
 * @exports Label
 * @usedBy app/admin/custom-fields/field-editor-dialog.tsx, app/admin/custom-forms/form-builder-dialog.tsx, app/admin/custom-modules/module-builder-dialog.tsx, app/admin/custom-modules/module-merge-dialog.tsx, app/admin/custom-modules/module-records-dialog.tsx (+439 more)
 * @see docs/CODEBASE-GUIDE.md for module ownership, conventions and where to add new code.
 */
import * as React from "react"

import { cn } from "@/lib/utils"

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Label }
