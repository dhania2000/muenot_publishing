/**
 * @file components/ui/skeleton.tsx
 * @module UI primitives (shadcn/ui)
 * @kind React server component
 * @summary UI primitives (shadcn/ui) UI: Skeleton.
 * @exports Skeleton
 * @usedBy app/(workspace)/modules/operations/calendar/page.tsx, app/admin/custom-fields/custom-fields-client.tsx, app/admin/custom-forms/custom-forms-client.tsx, app/admin/custom-forms/submissions-dialog.tsx, app/admin/custom-modules/custom-modules-client.tsx (+465 more)
 * @see docs/CODEBASE-GUIDE.md for module ownership, conventions and where to add new code.
 */
import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("bg-accent animate-pulse rounded-md", className)}
      {...props}
    />
  )
}

export { Skeleton }
