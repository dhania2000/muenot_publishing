"use client"

/**
 * @file components/publishing/alt-text/alt-text-result-sections.tsx
 * @module Publishing
 * @kind React client components
 * @summary Sections of the AI Results panel: classification summary, editable
 *   short alt / detailed description, read-only extracted text and review warnings.
 *   Editors' changes are never overwritten by a later AI response.
 */
import { useEffect, useEffectEvent, useRef, useState } from "react"
import type { LucideIcon } from "lucide-react"
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  Copy,
  Hash,
  Layers,
  RotateCcw,
  SearchX,
  Shuffle,
  Tags,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

export function useCopy() {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }
  return { copied, copy }
}

export function CopyButton({ text, label, disabled }: { text: string; label: string; disabled?: boolean }) {
  const { copied, copy } = useCopy()
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      disabled={disabled}
      onClick={() => copy(text)}
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
    >
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
    </Button>
  )
}

/* ---------- Section A: classification summary ---------- */

export function ClassificationSummary({ items }: { items: { label: string; value: string; muted?: boolean; note?: string }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
      {items.map(({ label, value, muted, note }) => (
        <div key={label} className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className={cn("truncate text-sm font-medium", muted ? "italic text-muted-foreground" : "text-foreground")} title={value}>
            {value}
          </dd>
          {note && <dd className="text-xs text-amber-700 dark:text-amber-400">{note}</dd>}
        </div>
      ))}
    </dl>
  )
}

/* ---------- Sections B & C: editable fields ---------- */

type EditableFieldProps = {
  id: string
  label: string
  /** Latest AI value; null when nothing has been generated. */
  value: string | null
  lang: string
  rows: number
  emptyAiMessage: string
  intentionallyEmpty?: boolean
  guidance?: (length: number) => string | null
  collapsible?: boolean
  disabled?: boolean
  /** Reports the local draft so the parent can save it and track unsaved changes. */
  onDraftChange?: (draft: string, dirty: boolean) => void
}

const COLLAPSE_THRESHOLD = 900

export function EditableField({
  id,
  label,
  value,
  lang,
  rows,
  emptyAiMessage,
  intentionallyEmpty,
  guidance,
  collapsible,
  disabled,
  onDraftChange,
}: EditableFieldProps) {
  const [source, setSource] = useState(value)
  const [baseline, setBaseline] = useState(value ?? "")
  const [draft, setDraft] = useState(value ?? "")
  const [pendingAi, setPendingAi] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  const dirty = draft !== baseline
  const reportDraft = useEffectEvent((d: string, isDirty: boolean) => onDraftChange?.(d, isDirty))
  useEffect(() => reportDraft(draft, dirty), [draft, dirty])

  if (value !== source) {
    setSource(value)
    // A saved value equal to the draft (server confirmation) becomes the new baseline.
    if (value === null || !dirty || value === draft) {
      setBaseline(value ?? "")
      setDraft(value ?? "")
      setPendingAi(null)
    } else {
      setPendingAi(value)
    }
  }

  const awaiting = value === null
  const hint = guidance?.(draft.length) ?? null
  const isLong = collapsible && draft.length > COLLAPSE_THRESHOLD
  const counterId = `${id}-counter`
  const statusId = `${id}-status`

  let status: { text: string; tone: "muted" | "warn" | "ok" } | null = null
  if (!awaiting && !draft) {
    status = intentionallyEmpty
      ? { text: 'Intentionally empty (alt="") — image is decorative', tone: "ok" }
      : baseline
        ? { text: "Field cleared — add text before publishing", tone: "warn" }
        : { text: emptyAiMessage, tone: "warn" }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
            {label}
          </label>
          {dirty && (
            <Badge variant="outline" className="h-5 gap-1 border-amber-500/50 text-amber-700 dark:text-amber-400">
              <span className="size-1.5 rounded-full bg-amber-500" aria-hidden="true" />
              Unsaved changes
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {dirty && (
            <Button type="button" variant="ghost" size="xs" onClick={() => setDraft(baseline)}>
              <RotateCcw aria-hidden="true" />
              Revert
            </Button>
          )}
          <CopyButton text={draft} label={label} disabled={!draft} />
        </div>
      </div>

      {pendingAi !== null && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <span>A newer AI version is available. Your edits were kept.</span>
          <div className="flex gap-1">
            <Button type="button" variant="ghost" size="xs" onClick={() => setPendingAi(null)}>
              Keep mine
            </Button>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => {
                setBaseline(pendingAi)
                setDraft(pendingAi)
                setPendingAi(null)
              }}
            >
              Use AI version
            </Button>
          </div>
        </div>
      )}

      <Textarea
        id={id}
        lang={lang}
        dir="auto"
        rows={rows}
        value={draft}
        disabled={awaiting || disabled}
        placeholder={awaiting ? "Awaiting generation" : intentionallyEmpty ? "Left empty for decorative image" : `Write ${label.toLowerCase()}…`}
        onChange={(e) => setDraft(e.target.value)}
        aria-describedby={[counterId, status ? statusId : null].filter(Boolean).join(" ")}
        className={cn(
          "resize-y leading-relaxed whitespace-pre-wrap",
          dirty && "border-amber-500/60 bg-amber-50/40 dark:bg-amber-950/10",
          isLong && !expanded && "max-h-56 overflow-y-auto",
        )}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex min-w-0 flex-col gap-0.5">
          {status && (
            <p
              id={statusId}
              className={cn(
                status.tone === "warn" && "text-amber-700 dark:text-amber-400",
                status.tone === "ok" && "text-emerald-700 dark:text-emerald-400",
                status.tone === "muted" && "text-muted-foreground",
              )}
            >
              {status.text}
            </p>
          )}
          {hint && <p className="text-muted-foreground">{hint}</p>}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {isLong && (
            <Button type="button" variant="ghost" size="xs" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} aria-controls={id}>
              {expanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
              {expanded ? "Collapse" : "Expand"}
            </Button>
          )}
          <span id={counterId} className="tabular-nums text-muted-foreground">
            {[...draft].length.toLocaleString()} characters
          </span>
        </div>
      </div>
    </div>
  )
}

/* ---------- Section D: extracted text ---------- */

export function ExtractedText({ text, lang }: { text: string | null; lang: string }) {
  if (text === null) return <p className="text-xs italic text-muted-foreground">Awaiting generation</p>
  if (!text) return <p className="text-sm text-muted-foreground">No visible text was detected in this image.</p>
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end">
        <CopyButton text={text} label="extracted text" />
      </div>
      <pre
        lang={lang}
        dir="auto"
        tabIndex={0}
        aria-label="Extracted visible text"
        className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-3 font-sans text-sm leading-relaxed text-foreground"
      >
        {text}
      </pre>
    </div>
  )
}

/* ---------- Section E: review warnings ---------- */

type WarningCategory = { label: string; icon: LucideIcon; match: RegExp }

const WARNING_CATEGORIES: WarningCategory[] = [
  { label: "Unreadable labels", icon: Tags, match: /label|legend|illegible|unreadable|blurr|legib/i },
  { label: "Uncertain values", icon: Hash, match: /value|number|numeric|figure|measure|digit|uncertain/i },
  { label: "Manual review", icon: Layers, match: /complex|manual|long description|verify|review/i },
  { label: "Context mismatch", icon: Shuffle, match: /mismatch|context|inconsistent|contradict/i },
  { label: "Missing information", icon: SearchX, match: /missing|no short|not generated|absent|omit/i },
]

function categorize(warning: string) {
  return WARNING_CATEGORIES.find((c) => c.match.test(warning)) ?? { label: "Review", icon: AlertTriangle }
}

export function ReviewWarnings({ warnings }: { warnings: string[] | null }) {
  if (warnings === null) return <p className="text-xs italic text-muted-foreground">Awaiting generation</p>
  if (warnings.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
        <CircleCheck className="size-4" aria-hidden="true" />
        No accessibility warnings. Still review the text before publishing.
      </p>
    )
  }
  return (
    <ul className="flex flex-col gap-2">
      {warnings.map((warning, i) => {
        const { label, icon: Icon } = categorize(warning)
        return (
          <li
            key={`${i}-${warning}`}
            className="flex items-start gap-3 rounded-md border border-amber-500/30 bg-amber-50/50 p-3 dark:bg-amber-950/10"
          >
            <Icon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-xs font-medium text-amber-800 dark:text-amber-300">{label}</span>
              <span className="text-sm text-foreground">{warning}</span>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
