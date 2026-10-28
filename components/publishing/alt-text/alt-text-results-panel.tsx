"use client"

/**
 * @file components/publishing/alt-text/alt-text-results-panel.tsx
 * @module Publishing
 * @kind React client components
 * @summary AI Results workspace for the Generate tab. One result view is visible at a time
 *   (Short Alt Text | Detailed Description | Extracted Text | Review); all views stay mounted
 *   so in-progress edits survive switching. Primary actions (Generate/Regenerate, Save, Export)
 *   live in GenerateActions, rendered by the workspace toolbar.
 */
import { useState } from "react"
import { GenerationEvidenceSummary } from "./generation-evidence-summary"
import { AlertCircle, AlignLeft, Download, FileText, ImageUp, RefreshCw, Save, ScanText, ShieldCheck, Sparkles } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
import { cn } from "@/lib/utils"
import { ClassificationSummary, EditableField, ExtractedText, ReviewWarnings } from "./alt-text-result-sections"

export type GenerationStatus = "idle" | "generating"

/** A parsed AI result plus the settings it was generated with (not the live form). */
export type GeneratedOutput = {
  candidate?: boolean
  result: AltTextResult
  language: LanguageCode
  purpose: GenerationPurpose
}

/** Latest server-confirmed editable content for the asset. */
export type SavedContent = { shortAlt: string | null; longDescription: string | null; version: number }

export type GenerationUsage = { model: string; creditsCharged: number | null; creditsReserved: number }

export type ResultsPanelActions = {
  onUseCandidate?: () => void
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

type ResultView = "short" | "detailed" | "text" | "review"
const VIEWS: { id: ResultView; label: string; icon: LucideIcon }[] = [
  { id: "short", label: "Short Alt Text", icon: AlignLeft },
  { id: "detailed", label: "Detailed Description", icon: FileText },
  { id: "text", label: "Extracted Text", icon: ScanText },
  { id: "review", label: "Review", icon: ShieldCheck },
]

function shortAltGuidance(length: number) {
  if (length > 250) return "Long for alt text. Consider moving secondary detail to the detailed description."
  if (length > 150) return "Guidance: most alt text is under ~150 characters, but keep essential content."
  return null
}

/** Generate / Regenerate, Save Changes and Export — rendered once, in the workspace toolbar. */
export function GenerateActions({
  imageSelected,
  hasResult,
  status,
  actions,
}: {
  imageSelected: boolean
  hasResult: boolean
  status: GenerationStatus
  actions: ResultsPanelActions
}) {
  const { generateBlockedReason, saving, exporting, dirty } = actions
  const generating = status === "generating"
  const busy = generating || saving || exporting
  const generateDisabled = !imageSelected || busy || generateBlockedReason !== null

  return (
    <>
      <Button
        size="sm"
        variant={hasResult ? "outline" : "default"}
        onClick={hasResult ? actions.onRegenerate : actions.onGenerate}
        disabled={generateDisabled}
        title={generateBlockedReason ?? undefined}
      >
        {generating ? <Spinner /> : hasResult ? <RefreshCw aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
        {generating ? "Generating…" : hasResult ? "Regenerate" : "Generate"}
      </Button>
      <Button size="sm" onClick={actions.onSave} disabled={!actions.canSave || !dirty || busy}>
        {saving ? <Spinner /> : <Save aria-hidden="true" />}
        {saving ? "Saving…" : "Save Changes"}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={!actions.canExport || busy}>
            {exporting ? <Spinner /> : <Download aria-hidden="true" />}
            {exporting ? "Exporting…" : "Export"}
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
    </>
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
  const [view, setView] = useState<ResultView>("short")
  const { generateBlockedReason, saving, exporting, dirty, saved, usage, saveError } = actions
  const generating = status === "generating"
  const busy = generating || saving || exporting
  const result = output?.result ?? null
  const lang = output?.language ?? "en"
  const decorative = result?.classification === "decorative" || output?.purpose === "decorative"
  const warningCount = result?.warnings.length ?? 0

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

  const classificationItems = result
    ? [
        {
          label: "Detected Image Type",
          value: CLASSIFICATION_LABELS[result.classification],
          note: result.warnings.some((w) => UNCERTAIN_CLASSIFICATION.test(w)) ? "Unverified" : undefined,
        },
        { label: "Image Purpose", value: output ? GENERATION_PURPOSES[output.purpose].label : "—" },
        { label: "Output Language", value: output ? LANGUAGES[output.language] : "—" },
        { label: "Generation Status", value: statusLabel },
      ]
    : []

  return (
    <section aria-label="AI results" className="flex min-w-0 flex-col rounded-lg border bg-card lg:h-full lg:min-h-0">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-2 py-1.5">
        <div role="tablist" aria-label="Result views" className="flex min-w-0 flex-wrap items-center gap-0.5">
          {VIEWS.map(({ id, label, icon: Icon }) => {
            const active = view === id
            return (
              <button
                key={id}
                id={`alt-view-tab-${id}`}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={`alt-view-${id}`}
                disabled={!result}
                onClick={() => setView(id)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
                  active && result ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">{label}</span>
                <span className="sm:hidden">{label.split(" ")[0]}</span>
                {id === "review" && warningCount > 0 ? (
                  <Badge variant="outline" className="h-4 border-amber-500/50 px-1 text-[10px] tabular-nums text-amber-700">
                    {warningCount}
                    <span className="sr-only"> warnings</span>
                  </Badge>
                ) : null}
              </button>
            )
          })}
        </div>
        <Badge variant={error ? "destructive" : result ? "default" : "secondary"} className="shrink-0" aria-live="polite">
          {statusLabel}
        </Badge>
      </div>

      {(error || saveError) && (
        <div className="flex shrink-0 flex-col gap-2 border-b p-3">
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
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-4" aria-busy={generating}>
        {!result ? (
          <div className="flex h-full min-h-48 flex-col items-center justify-center gap-2 text-center">
            {generating ? (
              <>
                <Spinner className="size-5" />
                <p className="text-sm font-medium text-foreground">Analyzing image…</p>
                <p className="text-xs text-muted-foreground">Results appear here when generation finishes.</p>
              </>
            ) : imageSelected ? (
              <>
                <Sparkles className="size-5 text-primary" aria-hidden="true" />
                <p className="text-sm font-medium text-foreground">Ready to generate</p>
                <p className="max-w-xs text-xs text-muted-foreground">
                  Check the configuration in the toolbar, then choose Generate.
                </p>
              </>
            ) : (
              <>
                <ImageUp className="size-5 text-muted-foreground" aria-hidden="true" />
                <p className="text-sm font-medium text-foreground">Upload an image to begin.</p>
                <p className="max-w-xs text-xs text-muted-foreground">Short alt text, a detailed description and extracted text will appear here.</p>
              </>
            )}
          </div>
        ) : (
          <>
            {output?.candidate && <Alert><AlertCircle aria-hidden="true" /><AlertTitle>Review candidate · approved text preserved</AlertTitle><AlertDescription><p>The new description is saved in History. Review it, then save it as a new review version when ready. Exports continue to use the current saved text.</p><Button type="button" className="mt-2" variant="outline" size="sm" disabled={busy || !actions.canSave || !actions.onUseCandidate} onClick={actions.onUseCandidate}>Save candidate for review</Button></AlertDescription></Alert>}
            <div role="tabpanel" id="alt-view-short" aria-labelledby="alt-view-tab-short" hidden={view !== "short"}>
              <EditableField
                id="alt-short-text"
                label="Short Alt Text"
                value={saved?.shortAlt ?? result.shortAlt}
                lang={lang}
                rows={4}
                disabled={busy}
                onDraftChange={(d, isDirty) => actions.onDraftChange("shortAlt", d, isDirty)}
                intentionallyEmpty={decorative}
                emptyAiMessage="The AI did not return short alt text — write one manually."
                guidance={shortAltGuidance}
              />
            </div>
            <div role="tabpanel" id="alt-view-detailed" aria-labelledby="alt-view-tab-detailed" hidden={view !== "detailed"}>
              <EditableField
                id="alt-detailed-description"
                label="Detailed Description"
                value={saved?.longDescription ?? result.longDescription}
                lang={lang}
                rows={14}
                disabled={busy}
                onDraftChange={(d, isDirty) => actions.onDraftChange("longDescription", d, isDirty)}
                emptyAiMessage={decorative ? "Not needed for a decorative image." : "No detailed description was returned."}
              />
            </div>
            <div role="tabpanel" id="alt-view-text" aria-labelledby="alt-view-tab-text" hidden={view !== "text"}>
              <ExtractedText text={result.extractedText} lang={lang} />
            </div>
            <div role="tabpanel" id="alt-view-review" aria-labelledby="alt-view-tab-review" hidden={view !== "review"} className="flex flex-col gap-5">
              <GenerationEvidenceSummary value={result.generationEvidence} />
              <ClassificationSummary items={classificationItems} />
              <div className="flex flex-col gap-2">
                <h3 className="text-xs font-medium text-muted-foreground">Accessibility warnings</h3>
                <ReviewWarnings warnings={result.warnings} />
              </div>
              {(usage || saved) && (
                <dl className="flex flex-wrap gap-x-6 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
                  {usage && (
                    <>
                      <div className="flex gap-1.5">
                        <dt>Model</dt>
                        <dd className="font-mono text-foreground">{usage.model}</dd>
                      </div>
                      <div className="flex gap-1.5">
                        <dt>{usage.creditsCharged === null ? "Credits reserved" : "Credits used"}</dt>
                        <dd className="tabular-nums text-foreground">{usage.creditsCharged ?? usage.creditsReserved}</dd>
                      </div>
                    </>
                  )}
                  {saved && (
                    <div className="flex gap-1.5">
                      <dt>Saved version</dt>
                      <dd className="tabular-nums text-foreground">v{saved.version}</dd>
                    </div>
                  )}
                </dl>
              )}
            </div>
          </>
        )}
      </div>

      {dirty && (
        <p className="shrink-0 border-t px-4 py-2 text-xs text-amber-700" role="status">
          You have unsaved edits. Exports contain the last saved version.
        </p>
      )}
    </section>
  )
}
