"use client"

/**
 * @file components/publishing/alt-text/accessibility-settings-fields.tsx
 * @module Publishing · Alt Text
 * @kind React client components
 * @summary Schema-driven controls, capability badges and policy lists for Accessibility Settings.
 *   Controls only reflect backend capability states; the PATCH route enforces them independently.
 */
import { Lock } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  CAPABILITY_STATUSES,
  requiredCapabilities,
  type AccessibilityField,
  type CapabilityId,
  type CapabilityState,
  type CapabilityStatus,
  type FieldValue,
} from "@/lib/alt-text/accessibility-settings"
import { cn } from "@/lib/utils"

type Capabilities = Record<CapabilityId, CapabilityState>

const TONE: Record<(typeof CAPABILITY_STATUSES)[CapabilityStatus]["tone"], string> = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  muted: "border-border bg-muted text-muted-foreground",
}

export function CapabilityBadge({ status }: { status: CapabilityStatus }) {
  const meta = CAPABILITY_STATUSES[status]
  return (
    <Badge variant="outline" className={cn("shrink-0 font-medium", TONE[meta.tone])}>
      {meta.label}
    </Badge>
  )
}

export function CapabilityList({ ids, capabilities }: { ids: readonly CapabilityId[]; capabilities: Capabilities }) {
  return (
    <ul className="flex flex-col divide-y rounded-lg border" aria-label="Capability status">
      {ids.map((id) => {
        const c = capabilities[id]
        return (
          <li key={id} className="flex flex-col gap-1 px-3 py-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-medium">{c.label}</span>
              {c.reason ? <span className="text-xs leading-relaxed text-muted-foreground">{c.reason}</span> : null}
            </div>
            <CapabilityBadge status={c.status} />
          </li>
        )
      })}
    </ul>
  )
}

export function LockedPolicyList({ items }: { items: { id: string; label: string; source?: string }[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((p) => (
        <li key={p.id} className="flex items-start gap-2 text-sm leading-relaxed">
          <Lock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>
            {p.label}
            {p.source ? <span className="ml-1 text-xs text-muted-foreground">({p.source})</span> : null}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** First unavailable capability for a candidate value, or null when the value is allowed. */
function blockingCapability(field: AccessibilityField, value: FieldValue, capabilities: Capabilities): CapabilityState | null {
  const id = requiredCapabilities(field, value).find((c) => capabilities[c].status !== "available")
  return id ? capabilities[id] : null
}

export function SettingsFieldControl({
  id,
  field,
  value,
  onChange,
  capabilities,
  readOnly,
  error,
  changed,
}: {
  id: string
  field: AccessibilityField
  value: FieldValue
  onChange: (value: FieldValue) => void
  capabilities: Capabilities
  readOnly: boolean
  error?: string
  changed: boolean
}) {
  const helpId = field.help ? `${id}-help` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [helpId, errorId].filter(Boolean).join(" ") || undefined

  if (field.kind === "flag") {
    const blocked = blockingCapability(field, true, capabilities)
    // A value that is already on stays switchable off even if its capability later disappears.
    const disabled = readOnly || (!!blocked && value !== true)
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-start justify-between gap-3">
          <label htmlFor={id} className={cn("flex min-w-0 items-start gap-2.5 text-sm", disabled ? "cursor-not-allowed text-muted-foreground" : "cursor-pointer")}>
            <input
              id={id}
              type="checkbox"
              className="mt-0.5 size-4 shrink-0 accent-primary"
              checked={value === true}
              disabled={disabled}
              aria-describedby={describedBy}
              onChange={(e) => onChange(e.target.checked)}
            />
            <span className="leading-snug">
              {field.label}
              {changed ? <span className="sr-only"> (unsaved change)</span> : null}
            </span>
          </label>
          {blocked ? <CapabilityBadge status={blocked.status} /> : null}
        </div>
        {field.help ? (
          <p id={helpId} className="pl-6.5 text-xs leading-relaxed text-muted-foreground">
            {field.help}
          </p>
        ) : null}
        {error ? <FieldErrorText id={errorId!} message={error} /> : null}
      </div>
    )
  }

  if (field.kind === "choice") {
    const options = Object.entries(field.options)
    return (
      <div className="flex min-w-0 flex-col gap-2">
        <Label htmlFor={id}>{field.label}</Label>
        <Select value={value as string} onValueChange={(v) => onChange(v as string)} disabled={readOnly}>
          <SelectTrigger id={id} className="w-full" aria-describedby={describedBy} aria-invalid={error ? true : undefined}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map(([optionValue, optionLabel]) => {
              const blocked = blockingCapability(field, optionValue, capabilities)
              return (
                <SelectItem key={optionValue} value={optionValue} disabled={!!blocked && optionValue !== value}>
                  {optionLabel}
                  {blocked ? ` — ${CAPABILITY_STATUSES[blocked.status].label}` : ""}
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
        {field.help ? (
          <p id={helpId} className="text-xs leading-relaxed text-muted-foreground">
            {field.help}
          </p>
        ) : null}
        {error ? <FieldErrorText id={errorId!} message={error} /> : null}
      </div>
    )
  }

  const selected = value as string[]
  const toggle = (option: string, on: boolean) => onChange(on ? [...selected, option] : selected.filter((v) => v !== option))
  return (
    <fieldset className="flex min-w-0 flex-col gap-2" aria-describedby={describedBy}>
      <legend className="mb-1 text-sm font-medium">{field.label}</legend>
      {field.help ? (
        <p id={helpId} className="text-xs leading-relaxed text-muted-foreground">
          {field.help}
        </p>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2">
        {Object.entries(field.options).map(([option, label]) => {
          const blocked = blockingCapability(field, [option], capabilities)
          const checked = selected.includes(option)
          const disabled = readOnly || (!!blocked && !checked)
          const optionId = `${id}-${option}`
          return (
            <div key={option} className={cn("flex items-start justify-between gap-2 rounded-md border px-3 py-2", disabled && "bg-muted/40")}>
              <label htmlFor={optionId} className={cn("flex min-w-0 items-start gap-2.5 text-sm", disabled ? "cursor-not-allowed text-muted-foreground" : "cursor-pointer")}>
                <input
                  id={optionId}
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                  checked={checked}
                  disabled={disabled}
                  onChange={(e) => toggle(option, e.target.checked)}
                />
                <span className="leading-snug">{label}</span>
              </label>
              {blocked ? <CapabilityBadge status={blocked.status} /> : null}
            </div>
          )
        })}
      </div>
      {error ? <FieldErrorText id={errorId!} message={error} /> : null}
    </fieldset>
  )
}

export function FieldErrorText({ id, message }: { id: string; message: string }) {
  return (
    <p id={id} role="alert" className="text-xs font-medium text-destructive">
      {message}
    </p>
  )
}
