/**
 * @file components/publishing/conversion/pdf/pdf-capability-status.tsx
 * @module Publishing › Conversion › PDF
 * @kind React server component
 * @summary Subtle status indicators: icon + text label, never color alone. `PdfStatusIndicator` is the single
 *   shared indicator for every PDF status model (capability, processing, validation, guidelines).
 * @exports PdfCapabilityStatusIndicator, PdfStatusIndicator, PDF_CAPABILITY_STATUS_ICONS, PDF_TONE_ICONS, PDF_TONE_TEXT
 */
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Circle,
  CircleDashed,
  CircleHelp,
  Clock,
  Info,
  LayoutTemplate,
  LoaderCircle,
  XCircle,
  type LucideIcon,
} from "lucide-react"
import { PDF_CAPABILITY_STATUS_META, type PdfCapabilityStatus } from "@/components/publishing/conversion/pdf/pdf-capabilities"
import type { PdfStatusMeta, PdfStatusTone } from "@/components/publishing/conversion/pdf/pdf-status-model"
import { cn } from "@/lib/utils"

export const PDF_TONE_ICONS: Record<PdfStatusTone, LucideIcon> = {
  neutral: Circle,
  info: Info,
  progress: LoaderCircle,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
}

/** Restrained palette: only success/progress (primary) and danger (destructive) carry color. */
export const PDF_TONE_TEXT: Record<PdfStatusTone, string> = {
  neutral: "text-muted-foreground",
  info: "text-foreground",
  progress: "text-primary",
  success: "text-primary",
  warning: "text-foreground",
  danger: "text-destructive",
}

type PdfStatusIndicatorProps = {
  label: string
  tone: PdfStatusTone
  icon?: LucideIcon
  /** Adds a bordered pill; use in dense tables and card headers. */
  bordered?: boolean
  className?: string
}

export function PdfStatusIndicator({ label, tone, icon, bordered, className }: PdfStatusIndicatorProps) {
  const Icon = icon ?? PDF_TONE_ICONS[tone]
  return (
    <span
      data-tone={tone}
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap",
        PDF_TONE_TEXT[tone],
        bordered && "rounded-full border px-2 py-0.5",
        className,
      )}
    >
      <Icon className={cn("size-3.5 shrink-0", tone === "progress" && "motion-safe:animate-spin")} aria-hidden="true" />
      {label}
    </span>
  )
}

/** Convenience for any `Record<Status, PdfStatusMeta>` model. */
export function PdfStatusFromMeta({ meta, ...rest }: { meta: PdfStatusMeta } & Omit<PdfStatusIndicatorProps, "label" | "tone">) {
  return <PdfStatusIndicator label={meta.label} tone={meta.tone} {...rest} />
}

export const PDF_CAPABILITY_STATUS_ICONS: Record<PdfCapabilityStatus, LucideIcon> = {
  available: CheckCircle2,
  partial: CircleDashed,
  "ui-ready": LayoutTemplate,
  unverified: CircleHelp,
  planned: Clock,
  unsupported: Ban,
}

const CAPABILITY_TONE: Record<PdfCapabilityStatus, PdfStatusTone> = {
  available: "success",
  partial: "info",
  "ui-ready": "info",
  unverified: "neutral",
  planned: "neutral",
  unsupported: "neutral",
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
  const { label } = PDF_CAPABILITY_STATUS_META[status]
  return (
    <PdfStatusIndicator
      label={count !== undefined ? `${count} ${label}` : label}
      tone={CAPABILITY_TONE[status]}
      icon={PDF_CAPABILITY_STATUS_ICONS[status]}
      className={className}
    />
  )
}
