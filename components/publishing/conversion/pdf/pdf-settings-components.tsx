"use client"

/**
 * @file components/publishing/conversion/pdf/pdf-settings-components.tsx
 * @module Publishing › Conversion › PDF
 * @kind React client component
 * @summary Reusable configuration UI: collapsible settings group, labelled config field with help tooltip,
 *   format selector, profile selector and a read-only settings summary (Task 8.5).
 * @exports PdfSettingsGroup, PdfConfigField, PdfFormatSelector, PdfProfileSelector, PdfSettingsSummary,
 *   PdfPlannedSettingRow, PdfFormatOption
 */
import { useId } from "react"
import { ChevronDown, CircleHelp } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { PdfCapabilityStatusIndicator } from "@/components/publishing/conversion/pdf/pdf-capability-status"
import { PDF_CAPABILITY_STATUS_META, type PdfCapabilityStatus } from "@/components/publishing/conversion/pdf/pdf-capabilities"
import {
  PDF_DEFAULT_PROFILES,
  PDF_PROFILE_KIND_LABEL,
  type PdfProfileKind,
  type PdfProfileOption,
} from "@/components/publishing/conversion/pdf/pdf-status-model"
import { PDF_GUIDELINE_STATES, type PdfGuidelineState } from "@/components/publishing/conversion/pdf/pdf-workspace-config"
import { cn } from "@/lib/utils"

// ─── Group ──────────────────────────────────────────────────────────────────

export function PdfSettingsGroup({
  id,
  label,
  description,
  optional,
  open,
  onToggle,
  onReset,
  children,
}: {
  /** Anchor id so other regions can move focus to this group. */
  id?: string
  label: string
  description?: string
  optional?: boolean
  open: boolean
  onToggle: () => void
  /** Group-level reset; only shown when supplied. */
  onReset?: () => void
  children: React.ReactNode
}) {
  const contentId = useId()
  return (
    <div
      id={id}
      tabIndex={id ? -1 : undefined}
      className="border-b outline-none last:border-b-0 focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50"
    >
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={onToggle}
          className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm font-medium text-foreground outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50"
        >
          <span className="flex items-center gap-2">
            {label}
            {optional && <Badge variant="outline">Optional</Badge>}
          </span>
          <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden="true" />
        </button>
      </h3>
      <div id={contentId} hidden={!open} className="flex flex-col gap-3 px-3 pb-3">
        {description && <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>}
        {children}
        {onReset && (
          <Button variant="ghost" size="xs" onClick={onReset} className="self-end">
            Reset {label}
          </Button>
        )}
      </div>
    </div>
  )
}

/** A setting that is listed so users know it is coming, with a "Planned" status instead of a fake control. */
export function PdfPlannedSettingRow({ label, status = "planned" }: { label: string; status?: PdfCapabilityStatus }) {
  return (
    <li className="flex items-center justify-between gap-2 py-1.5 text-sm">
      <span className="text-foreground">{label}</span>
      <PdfCapabilityStatusIndicator status={status} />
    </li>
  )
}

// ─── Field ──────────────────────────────────────────────────────────────────

/**
 * Label, optional help tooltip, description, validation message and required indicator for any control.
 * `children` receives the generated control id so the label is always associated.
 */
export function PdfConfigField({
  label,
  description,
  help,
  required,
  error,
  disabledReason,
  children,
  className,
}: {
  label: string
  description?: string
  help?: string
  required?: boolean
  error?: string | null
  /** Shown instead of the description when the control is disabled. */
  disabledReason?: string
  children: (ids: { controlId: string; describedBy: string | undefined; invalid: boolean }) => React.ReactNode
  className?: string
}) {
  const controlId = useId()
  const descriptionId = useId()
  const errorId = useId()
  const note = disabledReason ?? description
  const describedBy = [note && descriptionId, error && errorId].filter(Boolean).join(" ") || undefined
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center gap-1">
        <Label htmlFor={controlId} className="text-xs text-muted-foreground">
          {label}
          {required && (
            <>
              <span aria-hidden="true" className="text-destructive">
                *
              </span>
              <span className="sr-only">(required)</span>
            </>
          )}
        </Label>
        {help && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={`About ${label}`}
                className="inline-flex size-5 items-center justify-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <CircleHelp className="size-3.5" aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{help}</TooltipContent>
          </Tooltip>
        )}
      </div>
      {children({ controlId, describedBy, invalid: !!error })}
      {note && (
        <p id={descriptionId} className="text-xs text-muted-foreground">
          {note}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

// ─── Format selector ────────────────────────────────────────────────────────

export type PdfFormatOption = {
  format: string
  status: PdfCapabilityStatus
  /** Incompatible with the current source; rendered disabled. */
  incompatible?: boolean
}

export function PdfFormatSelector({
  label = "Target Format",
  options,
  value,
  onChange,
  help,
  placeholder = "Select a format",
}: {
  label?: string
  options: readonly PdfFormatOption[]
  value: string
  onChange: (format: string) => void
  help?: string
  placeholder?: string
}) {
  const selected = options.find((o) => o.format === value)
  return (
    <PdfConfigField label={label} help={help}>
      {({ controlId, describedBy }) => (
        <>
          <Select value={value} onValueChange={(v) => onChange(v as string)}>
            <SelectTrigger id={controlId} aria-describedby={describedBy} className="w-full">
              <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.format} value={option.format} disabled={option.incompatible}>
                  {option.format}
                  <span className="text-xs text-muted-foreground">
                    {option.incompatible ? "Incompatible" : PDF_CAPABILITY_STATUS_META[option.status].label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selected && selected.status !== "available" && (
            <Alert>
              <AlertDescription className="text-xs">
                {selected.format} output is {PDF_CAPABILITY_STATUS_META[selected.status].label.toLowerCase()} and cannot be produced yet.
              </AlertDescription>
            </Alert>
          )}
        </>
      )}
    </PdfConfigField>
  )
}

// ─── Profile selector ───────────────────────────────────────────────────────

const PROFILE_KIND_ORDER: PdfProfileKind[] = ["standard", "last-used", "company", "custom"]

/**
 * Standard, last-used, company and custom profiles, grouped by kind. Only Standard exists today, so the
 * selector shows one option plus a note about what is planned.
 */
export function PdfProfileSelector({
  label = "Conversion Profile",
  profiles = PDF_DEFAULT_PROFILES,
  value,
  onChange,
  note = "Saved presets and company profiles are planned.",
}: {
  label?: string
  profiles?: readonly PdfProfileOption[]
  value: string
  onChange?: (profileId: string) => void
  note?: string
}) {
  const selected = profiles.find((p) => p.id === value)
  const groups = PROFILE_KIND_ORDER.map((kind) => ({ kind, items: profiles.filter((p) => p.kind === kind) })).filter(
    (g) => g.items.length > 0,
  )
  return (
    <PdfConfigField label={label} description={note}>
      {({ controlId, describedBy }) => (
        <Select value={value} onValueChange={(v) => onChange?.(v as string)}>
          <SelectTrigger id={controlId} aria-describedby={describedBy} className="w-full">
            <SelectValue>{selected?.label ?? "Select a profile"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {groups.map((group) =>
              groups.length > 1 ? (
                <SelectGroup key={group.kind}>
                  <SelectLabel>{PDF_PROFILE_KIND_LABEL[group.kind]}</SelectLabel>
                  {group.items.map((p) => (
                    <SelectItem key={p.id} value={p.id} disabled={p.disabled}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ) : (
                group.items.map((p) => (
                  <SelectItem key={p.id} value={p.id} disabled={p.disabled}>
                    {p.label}
                  </SelectItem>
                ))
              ),
            )}
          </SelectContent>
        </Select>
      )}
    </PdfConfigField>
  )
}

// ─── Summary ────────────────────────────────────────────────────────────────

/** Read-only recap of the active configuration, for review screens and export confirmation. */
export function PdfSettingsSummary({
  inputFormat,
  outputFormat,
  profileLabel,
  guidelineState = "not-provided",
  options = [],
  className,
}: {
  inputFormat?: string
  outputFormat?: string
  profileLabel: string
  guidelineState?: PdfGuidelineState
  /** Human-readable labels of options that differ from the profile defaults. */
  options?: readonly string[]
  className?: string
}) {
  const rows: [string, string][] = [
    ["Input format", inputFormat ?? "Not selected"],
    ["Output format", outputFormat ?? "Not selected"],
    ["Profile", profileLabel],
    ["Guidelines", PDF_GUIDELINE_STATES[guidelineState].label],
  ]
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
        {rows.map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="text-muted-foreground">{term}</dt>
            <dd className="truncate text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
      {options.length > 0 ? (
        <ul aria-label="Changed options" className="flex flex-wrap gap-1">
          {options.map((o) => (
            <li key={o}>
              <Badge variant="secondary">{o}</Badge>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">No options changed from the profile defaults.</p>
      )}
    </div>
  )
}
