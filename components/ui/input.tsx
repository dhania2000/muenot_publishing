/**
 * @file components/ui/input.tsx
 * @module UI primitives (shadcn/ui)
 * @kind React server component
 * @summary UI primitives (shadcn/ui) UI: Input.
 * @exports Input
 * @usedBy app/admin/custom-fields/field-editor-dialog.tsx, app/admin/custom-forms/form-builder-dialog.tsx, app/admin/custom-modules/module-builder-dialog.tsx, app/admin/custom-modules/module-records-dialog.tsx, app/admin/executive-dashboard/_components/filter-toolbar.tsx (+760 more)
 * @see docs/CODEBASE-GUIDE.md for module ownership, conventions and where to add new code.
 */
import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-input bg-card px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-placeholder-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
