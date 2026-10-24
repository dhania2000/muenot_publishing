/**
 * @file components/publishing/conversion/pdf/pdf-overview-panels.tsx
 * @module Publishing › Conversion › PDF
 * @kind React server component
 * @summary Overview information panels: guidelines summary, saved profiles, processing information, recent activity, help.
 * @exports PdfGuidelinesSummary, PdfSavedProfilesPanel, PdfProcessingInfoPanel, PdfRecentActivityPanel, PdfHelpGuidance
 *
 * Every panel renders only real data. No guideline, profile, job or history store exists yet, so
 * the Overview passes none and each panel shows an accurate empty state.
 */
import Link from "next/link"
import { ArrowRight, FileClock, History, SlidersHorizontal } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { PdfPanel } from "@/components/publishing/conversion/pdf/pdf-content"
import { PdfStatusFromMeta } from "@/components/publishing/conversion/pdf/pdf-capability-status"
import { PdfFeedbackState } from "@/components/publishing/conversion/pdf/pdf-feedback-state"
import { OPTIONAL_GUIDELINES_MESSAGE } from "@/components/publishing/conversion/pdf/pdf-guidelines-components"
import { GUIDELINE_DOCUMENT_STATUS_META, hasGuidelines, type GuidelineContext } from "@/lib/guidelines/guideline-contracts"

function MutedNote({ children }: { children: React.ReactNode }) {
  return <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>
}

/**
 * Scenario A (no context) shows a neutral "Not Provided" state. Scenario B renders the supplied profile and
 * documents from the shared guideline contracts; review status is reported, compliance is never claimed here.
 */
export function PdfGuidelinesSummary({ context = null }: { context?: GuidelineContext | null }) {
  const provided = hasGuidelines(context)
  return (
    <PdfPanel title="Client Guidelines" actions={<Badge variant="outline">Optional</Badge>} className="h-full">
      {!provided ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">Guidelines: Not Provided</p>
            <p className="text-sm leading-relaxed text-muted-foreground">{OPTIONAL_GUIDELINES_MESSAGE.overview}</p>
          </div>
          <ul className="flex flex-col gap-1.5 text-sm">
            <li>Continue without guidelines</li>
            <li>Use the standard default settings</li>
            <li>Add guidelines later, when a client provides them</li>
          </ul>
          <MutedNote>Guideline upload is planned. Missing guidelines never block conversion work.</MutedNote>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {context.profile && (
            <div className="flex flex-col gap-1">
              <p className="truncate text-sm font-medium">{context.profile.name}</p>
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
                {context.profile.companyLabel && (
                  <>
                    <dt className="text-muted-foreground">Company</dt>
                    <dd className="truncate">{context.profile.companyLabel}</dd>
                  </>
                )}
                <dt className="text-muted-foreground">Version</dt>
                <dd>{context.profile.version?.versionId ?? context.versionRef?.versionId ?? "Not recorded"}</dd>
                {context.profile.applicableFormats?.length ? (
                  <>
                    <dt className="text-muted-foreground">Formats</dt>
                    <dd className="truncate">{context.profile.applicableFormats.join(", ")}</dd>
                  </>
                ) : null}
                <dt className="text-muted-foreground">Review</dt>
                <dd>{GUIDELINE_DOCUMENT_STATUS_META[context.profile.reviewStatus].label}</dd>
              </dl>
            </div>
          )}
          {context.documents.length > 0 && (
            <ul className="flex flex-col divide-y" aria-label="Guideline documents">
              {context.documents.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 first:pt-0 last:pb-0">
                  <span className="min-w-0 truncate text-sm">
                    {d.title}
                    {d.version ? <span className="text-muted-foreground"> · v{d.version}</span> : null}
                  </span>
                  <PdfStatusFromMeta meta={GUIDELINE_DOCUMENT_STATUS_META[d.status]} />
                </li>
              ))}
            </ul>
          )}
          <MutedNote>Requirements are applied and verified separately; uploading a document does not apply it.</MutedNote>
        </div>
      )}
    </PdfPanel>
  )
}

export function PdfSavedProfilesPanel() {
  return (
    <PdfPanel title="Saved Profiles" className="h-full">
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-3 rounded-md border bg-muted/40 p-3">
          <SlidersHorizontal className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-sm font-medium">Standard settings</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Built-in default. Applies whenever no guidelines or custom profile are selected.
            </p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">No saved profiles yet.</p>
        <MutedNote>Document, publishing, accessibility and company profiles arrive with Profiles &amp; Presets.</MutedNote>
      </div>
    </PdfPanel>
  )
}

export function PdfProcessingInfoPanel() {
  return (
    <PdfPanel title="Processing Information" className="h-full">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <FileClock className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium">No active document</p>
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">
          The active file, operation, validation and output status will appear here once Workspace processing is
          available.
        </p>
      </div>
    </PdfPanel>
  )
}

export function PdfRecentActivityPanel({ historyHref }: { historyHref: string | null }) {
  return (
    <PdfFeedbackState
      kind="no-data"
      icon={History}
      title="No recent PDF activity available."
      description="Completed conversions will be listed here with source format, target format, date and output availability."
      action={
        historyHref ? (
          <Button asChild variant="outline" size="sm" className="min-h-9">
            <Link href={historyHref}>
              View History
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        ) : undefined
      }
    />
  )
}

const HELP_TOPICS: { title: string; body: React.ReactNode }[] = [
  {
    title: "Supported file types",
    body: "Formats listed above are the registered targets for this module. Only capabilities marked Available can be run.",
  },
  {
    title: "Conversion limitations",
    body: "Converting between formats can change layout, fonts or reading order. Results are validated, never assumed lossless.",
  },
  {
    title: "Output format guidance",
    body: "Choose DOCX for editing, JATS or XML for structured publishing, ePub for reflowable reading, and PDF for fixed layout.",
  },
  {
    title: "Layout preservation",
    body: "Complex tables, multi-column pages and floating figures may need manual review after conversion.",
  },
  {
    title: "OCR requirements",
    body: "Scanned pages need OCR before text can be extracted. Clear, upright scans at 300 DPI or higher give the best results.",
  },
  {
    title: "Client guidelines",
    body: "Guidelines are optional. When supplied, their requirements are applied and reported; without them, standard settings apply.",
  },
  {
    title: "File security",
    body: "Files with active content such as scripts or embedded executables are rejected by validation rather than processed.",
  },
  {
    title: "PDF image accessibility",
    body: (
      <>
        Alt text for images inside PDFs is handled by the{" "}
        <Link href="/modules/publishing/alt-text" className="font-medium text-primary underline-offset-4 hover:underline">
          Alt Text service
        </Link>
        .
      </>
    ),
  },
]

export function PdfHelpGuidance() {
  return (
    <dl className="grid gap-x-6 gap-y-4 rounded-lg border bg-card p-4 text-card-foreground sm:grid-cols-2 sm:p-5 xl:grid-cols-4">
      {HELP_TOPICS.map((topic) => (
        <div key={topic.title} className="flex min-w-0 flex-col gap-1">
          <dt className="text-sm font-medium">{topic.title}</dt>
          <dd className="text-sm leading-relaxed text-muted-foreground">{topic.body}</dd>
        </div>
      ))}
    </dl>
  )
}
