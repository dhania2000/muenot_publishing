"use client"

/**
 * @file components/publishing/alt-text/alt-text-results-panel.tsx
 * @module Publishing
 * @kind React client component
 * @summary AI results card: classification, editable short alt / detailed
 *   description, extracted text and review warnings. Generation, saving and
 *   export are wired in later tasks; until then results stay empty.
 */
import { AlertCircle, AlignLeft, Download, FileText, RefreshCw, Save, ScanText, ShieldCheck, Sparkles, Tag } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Separator } from "@/components/ui/separator"
import type { ExportFormat } from "@/lib/alt-text/export"
import { Spinner } from "@/components/ui/spinner"
import {
  CLASSIFICATION_LABELS,
  GENERATION_PURPOSES,
  LANGUAGES,
  type AltTextResult,
  type GenerationPurpose,
  type LanguageCode,
} from "@/lib/alt-text/core"
import { ClassificationSummary, EditableField, ExtractedText, ReviewWarnings } from "./alt-text-result-sections"

export type GenerationStatus = "idle" | "generating"

/** A parsed AI result plus the settings it was generated with (not the live form). */
export type GeneratedOutput = {
  result: AltTextResult
  language: LanguageCode
  purpose: GenerationPurpose
}

/** Latest server-confirmed editable content for the asset. */
export type SavedContent = { shortAlt: string | null; longDescription: string | null; version: number }

export type GenerationUsage = { model: string; creditsCharged: number | null; creditsReserved: number }

export type ResultsPanelActions = {
  /** Why Generate is blocked (e.g. uploading, scan pending); null when allowed. */
  generateBlockedReason: string | null
  onGenerate: () => void
  onRegenerate: () => void
  onSave: () => void
  onExport: (format: ExportFormat) => void
  onDraftChange: (field: "shortAlt" | "longDescription", draft: string, dirty: boolean) => void
  saving: boolean
  exporting: boolean
  dirty: boolean
  saveError: { title: string; message: string } | null
  usage: GenerationUsage | null
  saved: SavedContent | null
  canSave: boolean
  canExport: boolean
}

const EXPORT_OPTIONS: { format: ExportFormat; label: string }[] = [
  { format: "txt", label: "Plain text (.txt)" },
  { format: "csv", label: "Spreadsheet (.csv)" },
  { format: "json", label: "JSON (.json)" },
]

const UNCERTAIN_CLASSIFICATION = /classification was uncertain/i

function shortAltGuidance(length: number) {
  if (length > 250) return "Long for alt text. Consider moving secondary detail to the detailed description."
  if (length > 150) return "Guidance: most alt text is under ~150 characters, but keep essential content."
  return null
}

function ResultSection({ id, title, icon: Icon, children }: { id: string; title: string; icon: LucideIcon; children: ReactNode }) {
  return (
    <section aria-labelledby={`alt-result-${id}`} className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
        <h3 id={`alt-result-${id}`} className="text-sm font-semibold text-foreground">
          {title}
        </h3>
      </div>
      {children}
    </section>
  )
}

export function AltTextResultsPanel({
  imageSelected,
  status,
  error,
  output,
  actions,
}: {
  imageSelected: boolean
  status: GenerationStatus
  error: string | null
  output: GeneratedOutput | null
  actions: ResultsPanelActions
}) {
  const { generateBlockedReason, saving, exporting, dirty, saved, usage, saveError } = actions
  const generating = status === "generating"
  const busy = generating || saving || exporting
  const result = output?.result ?? null
  const lang = output?.language ?? "en"
  const decorative = result?.classification === "decorative" || output?.purpose === "decorative"

  const statusLabel = generating
    ? "Generating"
    : saving
      ? "Saving"
      : exporting
        ? "Exporting"
        : error
          ? "Failed"
          : result
            ? dirty
              ? "Unsaved changes"
              : "Ready for review"
            : !imageSelected
              ? "Awaiting image"
              : (generateBlockedReason ?? "Ready to generate")

  const awaiting = "Awaiting generation"
  const classificationItems = [
    {
      label: "Detected Image Type",
      value: result ? CLASSIFICATION_LABELS[result.classification] : awaiting,
      muted: !result,
      note: result?.warnings.some((w) => UNCERTAIN_CLASSIFICATION.test(w)) ? "Unverified" : undefined,
    },
    { label: "Image Purpose", value: output ? GENERATION_PURPOSES[output.purpose].label : awaiting, muted: !output },
    { label: "Output Language", value: output ? LANGUAGES[output.language] : awaiting, muted: !output },
    { label: "Generation Status", value: statusLabel, muted: !result && !generating },
  ]

  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <CardTitle className="text-base">AI Results</CardTitle>
          <CardDescription>Review and edit generated descriptions before publishing.</CardDescription>
        </div>
        <Badge variant={error ? "destructive" : imageSelected ? "default" : "secondary"} className="shrink-0">
          {statusLabel}
        </Badge>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {error && (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertTitle>Generation failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {saveError && (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertTitle>{saveError.title}</AlertTitle>
            <AlertDescription>{saveError.message}</AlertDescription>
          </Alert>
        )}

        {usage && (
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
            <div className="flex gap-1.5">
              <dt>Model</dt>
              <dd className="font-mono text-foreground">{usage.model}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt>{usage.creditsCharged === null ? "Credits reserved" : "Credits used"}</dt>
              <dd className="tabular-nums text-foreground">{usage.creditsCharged ?? usage.creditsReserved}</dd>
            </div>
            {saved && (
              <div className="flex gap-1.5">
                <dt>Saved version</dt>
                <dd className="tabular-nums text-foreground">v{saved.version}</dd>
              </div>
            )}
          </dl>
        )}

        {!result && (
          <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <Sparkles className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{generating ? "Analyzing image…" : "No results yet"}</p>
                <p className="text-xs text-muted-foreground">
                  {imageSelected ? "Adjust the settings, then generate alt text." : "Add an image and settings to generate alt text."}
                </p>
              </div>
            </div>
            <Button
              disabled={!imageSelected || generating || generateBlockedReason !== null}
              aria-disabled={!imageSelected || generating || generateBlockedReason !== null}
              onClick={actions.onGenerate}
              className="w-full sm:w-auto"
            >
              {generating ? <Spinner /> : <Sparkles aria-hidden="true" />}
              {generating ? "Generating" : "Generate"}
            </Button>
          </div>
        )}

        <div className="flex flex-col divide-y rounded-lg border" aria-busy={generating}>
          <ResultSection id="classification" title="Image Classification" icon={Tag}>
            <ClassificationSummary items={classificationItems} />
          </ResultSection>

          <ResultSection id="short" title="Short Alt Text" icon={AlignLeft}>
            <EditableField
              id="alt-short-text"
              label="Short Alt Text"
              value={result ? (saved?.shortAlt ?? result.shortAlt) : null}
              lang={lang}
              rows={3}
              disabled={busy}
              onDraftChange={(d, isDirty) => actions.onDraftChange("shortAlt", d, isDirty)}
              intentionallyEmpty={decorative}
              emptyAiMessage="The AI did not return short alt text — write one manually."
              guidance={shortAltGuidance}
            />
          </ResultSection>

          <ResultSection id="detailed" title="Detailed Description" icon={FileText}>
            <EditableField
              id="alt-detailed-description"
              label="Detailed Description"
              value={result ? (saved?.longDescription ?? result.longDescription) : null}
              lang={lang}
              rows={6}
              disabled={busy}
              onDraftChange={(d, isDirty) => actions.onDraftChange("longDescription", d, isDirty)}
              collapsible
              emptyAiMessage={
                decorative ? "Not needed for a decorative image." : "No detailed description was returned."
              }
            />
          </ResultSection>

          <ResultSection id="text" title="Extracted Visible Text" icon={ScanText}>
            <ExtractedText text={result ? result.extractedText : null} lang={lang} />
          </ResultSection>

          <ResultSection id="review" title="Accessibility Review Warnings" icon={ShieldCheck}>
            <ReviewWarnings warnings={result ? result.warnings : null} />
          </ResultSection>
        </div>
      </CardContent>

      <Separator />

      <CardFooter className="flex flex-wrap gap-2 pt-6">
        <Button
          variant="outline"
          size="sm"
          onClick={actions.onRegenerate}
          disabled={!result || busy || generateBlockedReason !== null}
          className="flex-1 sm:flex-none"
        >
          {generating ? <Spinner /> : <RefreshCw aria-hidden="true" />}
          Regenerate
        </Button>
        <Button size="sm" onClick={actions.onSave} disabled={!actions.canSave || !dirty || busy} className="flex-1 sm:flex-none">
          {saving ? <Spinner /> : <Save aria-hidden="true" />}
          {saving ? "Saving" : "Save Changes"}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={!actions.canExport || busy} className="flex-1 sm:flex-none">
              {exporting ? <Spinner /> : <Download aria-hidden="true" />}
              {exporting ? "Exporting" : "Export"}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Export saved version</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {EXPORT_OPTIONS.map(({ format, label }) => (
              <DropdownMenuItem key={format} onSelect={() => actions.onExport(format)}>
                {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {dirty && <p className="w-full text-xs text-amber-700">You have unsaved edits. Exports contain the last saved version.</p>}
      </CardFooter>
    </Card>
  )
}
