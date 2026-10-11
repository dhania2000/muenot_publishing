/**
 * @file components/ui/spinner.tsx
 * @module UI primitives (shadcn/ui)
 * @kind React server component
 * @summary UI primitives (shadcn/ui) UI: Spinner.
 * @exports Spinner
 * @usedBy components/billing/activation/checkout-flow.tsx, components/billing/billing-run/billing-cycle-card.tsx, components/billing/billing-run/billing-overview.tsx, components/billing/coupons/coupon-form-sheet.tsx, components/billing/coupons/coupon-sheets.tsx (+64 more)
 * @see docs/CODEBASE-GUIDE.md for module ownership, conventions and where to add new code.
 */
import { Loader2Icon } from "lucide-react"

import { cn } from "@/lib/utils"

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader2Icon
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  )
}

export { Spinner }
