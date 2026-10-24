"use client"

/**
 * @file components/publishing/alt-text/image-classification-panel.tsx
 * @module Publishing · Alt Text
 * @kind React client component
 * @summary Phase 3 Task 3 — shows an asset's image category, complexity, evidence and routing
 *   recommendation, and lets permitted editors save or clear a manual correction (asset-level, or
 *   for one document occurrence when `occurrenceId` is given). Alt text versions are not touched.
 */
import { useState } from "react"
import useSWR from "swr"
import { toast } from "sonner"
import { AlertCircle, Pencil, RotateCcw, Save, Tags, X } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { ErrorState } from "@/components/enterprise/data-state"
import {
  CERTAINTY_LEVELS,
  CLASSIFICATION_METHODS,
  CLASSIFICATION_STATUSES,
  COMPLEXITY_LEVELS,
  CONTENT_HINTS,
  IMAGE_CATEGORIES,
  IMAGE_CATEGORY_IDS,
  MAX_OVERRIDE_NOTE,
  MAX_SECONDARY_CATEGORIES,
  type ClassificationView,
  type ComplexityLevel,
  type ImageCategory,
} from "@/lib/alt-text/classification"
import {
  AltTextApiError,
  altTextFetcher,
  assetClassificationUrl,
  clearClassificationCorrection,
  saveClassificationCorrection,
  type ApiError,
  type ClassificationResponse,
} from "@/lib/alt-text/client"
import { formatDateTime } from "./alt-text-history"

const SOURCE_LABELS: Record<ClassificationView["source"], string> = {
  occurrence_override: "Corrected for this occurrence",
  asset_override: "Corrected by an editor",
  automated: "AI classification",
  none: "Not classified",
}

const STATUS_VARIANT: Partial<Record<ClassificationView["status"], "secondary" | "outline" | "destructive">> = {
  completed: "secondary",
  needs_review: "outline",
  failed: "destructive",
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  )
}

function CorrectionForm({
  view,
  assetId,
  occurrenceId,
  onDone,
  onCancel,
}: {
  view: ClassificationView
  assetId: number
  occurrenceId: number | null
  onDone: (r: ClassificationResponse) => void
  onCancel: () => void
}) {
  const initial = view.result
  const [primary, setPrimary] = useState<ImageCategory>(initial?.primaryCategory ?? "unknown")
  const [secondary, setSecondary] = useState<ImageCategory[]>(initial?.secondaryCategories ?? [])
  const [complexity, setComplexity] = useState<ComplexityLevel>(initial?.complexityLevel ?? "unknown")
  const [note, setNote] = useState(view.manual?.note ?? "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)

  const toggleSecondary = (c: ImageCategory) =>
    setSecondary((s) => (s.includes(c) ? s.filter((x) => x !== c) : s.length >= MAX_SECONDARY_CATEGORIES ? s : [...s, c]))

  const submit = async () => {
    setSaving(true)
    setError(null)
    const r = await saveClassificationCorrection(assetId, {
      primaryCategory: primary,
      secondaryCategories: secondary.filter((c) => c !== primary),
      complexityLevel: complexity,
      note: note.trim() || null,
      ...(occurrenceId ? { occurrenceId } : {}),
    })
    setSaving(false)
    if (!r.ok) return setError(r.error)
    toast.success("Classification correction saved")
    onDone(r.data)
  }

  return (
    <div className="flex flex-col gap-4 rounded-md border bg-muted/20 p-3">
      {error && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>Could not save correction</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`cls-primary-${assetId}`}>Primary category</Label>
          <Select value={primary} onValueChange={(v) => setPrimary(v as ImageCategory)} disabled={saving}>
            <SelectTrigger id={`cls-primary-${assetId}`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {IMAGE_CATEGORY_IDS.map((c) => (
                <SelectItem key={c} value={c}>
                  {IMAGE_CATEGORIES[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`cls-complexity-${assetId}`}>Complexity</Label>
          <Select value={complexity} onValueChange={(v) => setComplexity(v as ComplexityLevel)} disabled={saving}>
            <SelectTrigger id={`cls-complexity-${assetId}`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(COMPLEXITY_LEVELS) as ComplexityLevel[]).map((c) => (
                <SelectItem key={c} value={c}>
                  {COMPLEXITY_LEVELS[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">
          Secondary categories <span className="font-normal text-muted-foreground">(up to {MAX_SECONDARY_CATEGORIES})</span>
        </legend>
        <div className="flex flex-wrap gap-1.5">
          {IMAGE_CATEGORY_IDS.filter((c) => c !== primary && c !== "unknown").map((c) => {
            const on = secondary.includes(c)
            return (
              <Button
                key={c}
                type="button"
                size="sm"
                variant={on ? "default" : "outline"}
                className="h-7 px-2 text-xs"
                aria-pressed={on}
                disabled={saving || (!on && secondary.filter((x) => x !== primary).length >= MAX_SECONDARY_CATEGORIES)}
                onClick={() => toggleSecondary(c)}
              >
                {IMAGE_CATEGORIES[c]}
              </Button>
            )
          })}
        </div>
      </fieldset>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`cls-note-${assetId}`}>Reason for correction (optional)</Label>
        <Textarea id={`cls-note-${assetId}`} rows={2} value={note} maxLength={MAX_OVERRIDE_NOTE} onChange={(e) => setNote(e.target.value)} disabled={saving} />
        <p className="text-xs tabular-nums text-muted-foreground">
          {note.length}/{MAX_OVERRIDE_NOTE}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void submit()} disabled={saving}>
          {saving ? <Spinner /> : <Save aria-hidden="true" />}
          {saving ? "Saving" : "Save correction"}
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel} disabled={saving}>
          <X aria-hidden="true" /> Cancel
        </Button>
      </div>
    </div>
  )
}

export function ImageClassificationPanel({ assetId, occurrenceId = null }: { assetId: number; occurrenceId?: number | null }) {
  const key = assetClassificationUrl(assetId, occurrenceId)
  const { data, error, isLoading, mutate } = useSWR<ClassificationResponse, AltTextApiError>(key, altTextFetcher, { revalidateOnFocus: false })
  const [editing, setEditing] = useState(false)
  const [clearing, setClearing] = useState(false)

  if (error) return <ErrorState title="Could not load classification" message={error.apiError.message} onRetry={() => mutate()} />
  if (isLoading || !data) return <Skeleton className="h-28 w-full" />

  const view = data.classification
  const result = view.result
  const automated = view.automated

  const clear = async () => {
    setClearing(true)
    const r = await clearClassificationCorrection(assetId, occurrenceId)
    setClearing(false)
    if (!r.ok) return void toast.error(r.error.message)
    await mutate(r.data, { revalidate: false })
    toast.success("Correction removed; AI classification restored")
  }

  return (
    <section className="flex flex-col gap-3" aria-labelledby={`cls-h-${assetId}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`cls-h-${assetId}`} className="flex items-center gap-2 text-sm font-semibold">
          <Tags className="size-4 text-muted-foreground" aria-hidden="true" /> Image Classification
        </h3>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={STATUS_VARIANT[view.status] ?? "outline"} className={view.status === "needs_review" ? "border-amber-300 bg-amber-50 text-amber-900" : undefined}>
            {CLASSIFICATION_STATUSES[view.status]}
          </Badge>
          {view.outdated && <Badge variant="outline">Outdated schema</Badge>}
        </div>
      </div>

      {result ? (
        <dl className="grid grid-cols-2 gap-4">
          <Field label="Primary category">{IMAGE_CATEGORIES[result.primaryCategory]}</Field>
          <Field label="Complexity">{COMPLEXITY_LEVELS[result.complexityLevel]}</Field>
          <Field label="Secondary categories">
            {result.secondaryCategories.length ? (
              <span className="flex flex-wrap gap-1">
                {result.secondaryCategories.map((c) => (
                  <Badge key={c} variant="outline" className="font-normal">
                    {IMAGE_CATEGORIES[c]}
                  </Badge>
                ))}
              </span>
            ) : (
              <span className="text-muted-foreground">None</span>
            )}
          </Field>
          <Field label="Source">{SOURCE_LABELS[view.source]}</Field>
          {automated && !view.manual && (
            <>
              <Field label="Evidence">{CERTAINTY_LEVELS[automated.certainty]}</Field>
              <Field label="Method">{CLASSIFICATION_METHODS[automated.method]}</Field>
            </>
          )}
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">
          {view.status === "processing" ? "Classification will be available when generation finishes." : "This image has not been classified yet. Generate alt text to classify it."}
        </p>
      )}

      {automated && !view.manual && automated.evidenceSummary && (
        <p className="rounded-md border bg-muted/20 p-3 text-sm leading-relaxed text-foreground">{automated.evidenceSummary}</p>
      )}
      {automated && !view.manual && automated.contentHints.length > 0 && (
        <ul className="flex flex-wrap gap-1" aria-label="Detected content">
          {automated.contentHints.map((h) => (
            <li key={h}>
              <Badge variant="secondary" className="font-normal">
                {CONTENT_HINTS[h]}
              </Badge>
            </li>
          ))}
        </ul>
      )}

      {view.manual && (
        <p className="text-xs text-muted-foreground">
          {view.manual.scope === "occurrence" ? "Occurrence correction" : "Asset correction"} saved{" "}
          <time dateTime={view.manual.editedAt}>{formatDateTime(view.manual.editedAt)}</time>
          {view.manual.note ? ` — ${view.manual.note}` : ""}
          {automated ? ` · AI suggested ${IMAGE_CATEGORIES[automated.primaryCategory]}` : ""}
        </p>
      )}

      {view.requiresReview && view.reviewReasons.length > 0 && (
        <Alert className="border-amber-200 bg-amber-50 text-amber-900">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>Confirm this classification</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {view.reviewReasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {view.routing && (
        <div className="flex flex-col gap-2 rounded-md border p-3">
          <p className="text-xs font-medium text-muted-foreground">Recommended analysis</p>
          <p className="text-sm text-foreground">{view.routing.summary}</p>
          <ul className="flex flex-col gap-1">
            {view.routing.recommendations.map((rec) => (
              <li key={rec.capability} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{rec.label}</span>
                <Badge variant={rec.enabled ? "secondary" : "outline"} className="font-normal">
                  {rec.enabled ? "Active" : rec.unsupported ? "Not available" : rec.available ? "Not enabled" : "Unverified"}
                </Badge>
                {rec.reason && <span className="text-xs text-muted-foreground">{rec.reason}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {editing ? (
        <CorrectionForm
          view={view}
          assetId={assetId}
          occurrenceId={occurrenceId}
          onCancel={() => setEditing(false)}
          onDone={(r) => {
            void mutate(r, { revalidate: false })
            setEditing(false)
          }}
        />
      ) : (
        view.permissions.canCorrect && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              <Pencil aria-hidden="true" /> Correct category
            </Button>
            {view.manual && (
              <Button size="sm" variant="ghost" onClick={() => void clear()} disabled={clearing}>
                {clearing ? <Spinner /> : <RotateCcw aria-hidden="true" />} Revert to AI
              </Button>
            )}
          </div>
        )
      )}
    </section>
  )
}
