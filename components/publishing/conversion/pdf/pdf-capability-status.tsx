/**
 * @file components/publishing/conversion/pdf/pdf-capability-status.tsx
 * @module Publishing › Conversion › PDF
 * @kind React server component
 * @summary Subtle capability status indicator: icon + text label, never color alone.
 * @exports PdfCapabilityStatusIndicator, PDF_CAPABILITY_STATUS_ICONS
 */
import { Ban, CheckCircle2, CircleDashed, CircleHelp, Clock, LayoutTemplate, type LucideIcon } from "lucide-react"
import { PDF_CAPABILITY_STATUS_META, type PdfCapabilityStatus } from "@/components/publishing/conversion/pdf/pdf-capabilities"
import { cn } from "@/lib/utils"

export const PDF_CAPABILITY_STATUS_ICONS: Record<PdfCapabilityStatus, LucideIcon> = {
  available: CheckCircle2,
  partial: CircleDashed,
  "ui-ready": LayoutTemplate,
  unverified: CircleHelp,
  planned: Clock,
  unsupported: Ban,
}

const TONE: Record<PdfCapabilityStatus, string> = {
  available: "text-primary",
  partial: "text-foreground",
  "ui-ready": "text-foreground",
  unverified: "text-muted-foreground",
  planned: "text-muted-foreground",
  unsupported: "text-muted-foreground",
}

export function PdfCapabilityStatusIndicator({
  status,
  count,
  className,
}: {
  status: PdfCapabilityStatus
  count?: number
  className?: string
}) {
  const Icon = PDF_CAPABILITY_STATUS_ICONS[status]
  const { label } = PDF_CAPABILITY_STATUS_META[status]
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", TONE[status], className)}>
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      {count !== undefined ? `${count} ${label}` : label}
    </span>
  )
}
