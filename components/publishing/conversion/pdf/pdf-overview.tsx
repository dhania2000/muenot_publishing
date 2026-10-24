/**
 * @file components/publishing/conversion/pdf/pdf-overview.tsx
 * @module Publishing › Conversion › PDF
 * @kind React server component
 * @summary PDF Overview body: quick start, capability categories, formats, availability and information panels.
 * @exports PdfOverview, PdfQuickStart, PdfCategoryCard, PdfFormatPanel, PdfAvailabilityLegend
 *
 * Rendered as the children of PdfSectionPage, so header, breadcrumbs and navigation stay shared.
 * Links resolve only to registered PDF routes; capability entry actions render only for Available.
 */
import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { PdfSection } from "@/components/publishing/conversion/pdf/pdf-content"
import { PdfCapabilityStatusIndicator } from "@/components/publishing/conversion/pdf/pdf-capability-status"
import {
  capabilitiesByCategory,
  deriveFormatAvailability,
  PDF_CAPABILITIES,
  PDF_CAPABILITY_STATUS_META,
  PDF_CAPABILITY_STATUS_ORDER,
  summarizeStatuses,
  type PdfCapability,
  type PdfCapabilityCategory,
} from "@/components/publishing/conversion/pdf/pdf-capabilities"
import {
  PdfGuidelinesSummary,
  PdfHelpGuidance,
  PdfProcessingInfoPanel,
  PdfRecentActivityPanel,
  PdfSavedProfilesPanel,
} from "@/components/publishing/conversion/pdf/pdf-overview-panels"
import { conversionHref, type ConversionModule } from "@/lib/conversion-modules"

const QUICK_START_STEPS: { label: string; optional?: boolean }[] = [
  { label: "Upload file" },
  { label: "Select format" },
  { label: "Configure settings" },
  { label: "Add guidelines", optional: true },
  { label: "Process" },
  { label: "Validate" },
  { label: "Download" },
]

function registeredHref(module: ConversionModule, slug: string) {
  return module.pages.some((page) => page.slug === slug) ? conversionHref(module.slug, slug) : null
}

export function PdfQuickStart({ workspaceHref }: { workspaceHref: string | null }) {
  return (
    <section aria-labelledby="pdf-quick-start-heading" className="flex flex-col gap-4 rounded-lg border bg-card p-4 text-card-foreground sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id="pdf-quick-start-heading" className="text-base font-semibold">
            Quick Start
          </h2>
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            The PDF workflow below is being built in stages. Conversion processing is not available yet; the Workspace
            shows what is ready.
          </p>
        </div>
        {workspaceHref && (
          <Button asChild size="sm" className="min-h-9 shrink-0 self-start">
            <Link href={workspaceHref}>
              Open Workspace
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        )}
      </div>
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7" aria-label="PDF conversion workflow">
        {QUICK_START_STEPS.map((step, index) => (
          <li key={step.label} className="flex min-w-0 items-center gap-2 rounded-md border bg-background px-2.5 py-2">
            <span
              aria-hidden="true"
              className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums"
            >
              {index + 1}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-sm leading-tight">
                <span className="sr-only">{`Step ${index + 1}: `}</span>
                {step.label}
              </span>
              {step.optional && <span className="text-xs text-muted-foreground">Optional</span>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}

function groupNotes(capabilities: PdfCapability[]) {
  const byNote = new Map<string, string[]>()
  for (const { note, label } of capabilities) {
    if (note) byNote.set(note, [...(byNote.get(note) ?? []), label])
  }
  return [...byNote].map(([note, labels]) => ({ note, labels }))
}

export function PdfCategoryCard({
  category,
  capabilities,
  workspaceHref,
}: {
  category: PdfCapabilityCategory
  capabilities: PdfCapability[]
  workspaceHref: string | null
}) {
  const Icon = category.icon
  const headingId = `pdf-category-${category.id}`
  const outputs = [...new Set(capabilities.flatMap((c) => (category.id === "documents-to-pdf" ? c.inputFormats : c.outputFormats)))]
  const hasAvailable = capabilities.some((c) => c.status === "available")
  const notes = groupNotes(capabilities)

  return (
    <article aria-labelledby={headingId} className="flex h-full min-w-0 flex-col gap-3 rounded-lg border bg-card p-4 text-card-foreground sm:p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 id={headingId} className="text-sm font-semibold">
            {category.label}
          </h3>
          <p className="text-sm leading-relaxed text-muted-foreground">{category.description}</p>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{category.id === "documents-to-pdf" ? "From: " : category.id === "advanced-pdf" ? "Works on: " : "To: "}</span>
        {category.id === "advanced-pdf" ? "PDF" : outputs.join(", ")}
      </p>

      <ul className="flex flex-wrap gap-1.5" aria-label={`${category.label} capabilities`}>
        {capabilities.map((c) => (
          <li key={c.id} className="rounded-md border bg-background px-2 py-0.5 text-xs">
            {c.label}
            {c.status !== "planned" && (
              <span className="text-muted-foreground">{` · ${PDF_CAPABILITY_STATUS_META[c.status].label}`}</span>
            )}
          </li>
        ))}
      </ul>

      {notes.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs leading-relaxed text-muted-foreground">
          {notes.map(({ note, labels }) => (
            <li key={note}>
              <span className="font-medium text-foreground">{labels.join(", ")}:</span> {note}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {summarizeStatuses(capabilities).map(({ status, count }) => (
            <PdfCapabilityStatusIndicator key={status} status={status} count={count} />
          ))}
        </div>
        {hasAvailable && workspaceHref ? (
          <Link href={workspaceHref} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
            Start<span className="sr-only">{` ${category.label}`}</span>
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        ) : (
          <span className="text-xs text-muted-foreground">Not yet available to run</span>
        )}
      </div>
    </article>
  )
}

export function PdfFormatPanel({ direction }: { direction: "input" | "output" }) {
  const formats = deriveFormatAvailability(direction)
  const title = direction === "input" ? "Input formats" : "Output formats"
  const headingId = `pdf-formats-${direction}`
  const groups = PDF_CAPABILITY_STATUS_ORDER.map((status) => ({
    status,
    formats: formats.filter((f) => f.status === status).map((f) => f.format),
  })).filter((g) => g.formats.length > 0)

  return (
    <div role="group" aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-4 text-card-foreground">
      <h3 id={headingId} className="text-sm font-semibold">
        {title}
      </h3>
      {groups.map(({ status, formats: list }) => (
        <div key={status} className="flex flex-col gap-1.5">
          <PdfCapabilityStatusIndicator status={status} />
          <ul className="flex flex-wrap gap-1.5" aria-label={`${title}: ${PDF_CAPABILITY_STATUS_META[status].label}`}>
            {list.map((format) => (
              <li key={format}>
                <Badge variant="outline" className="font-mono">
                  {format}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

export function PdfAvailabilityLegend() {
  const counts = new Map(summarizeStatuses(PDF_CAPABILITIES).map(({ status, count }) => [status, count]))
  return (
    <div role="group" aria-labelledby="pdf-availability-heading" className="flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-4 text-card-foreground">
      <h3 id="pdf-availability-heading" className="text-sm font-semibold">
        Capability availability
      </h3>
      <dl className="flex flex-col gap-2">
        {PDF_CAPABILITY_STATUS_ORDER.map((status) => (
          <div key={status} className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col">
              <dt>
                <PdfCapabilityStatusIndicator status={status} />
              </dt>
              <dd className="text-xs text-muted-foreground">{PDF_CAPABILITY_STATUS_META[status].description}</dd>
            </div>
            <dd className="text-sm font-medium tabular-nums">
              {counts.get(status) ?? 0}
              <span className="sr-only"> capabilities</span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export function PdfOverview({ module }: { module: ConversionModule }) {
  const workspaceHref = registeredHref(module, "workspace")
  const historyHref = registeredHref(module, "history")

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <PdfQuickStart workspaceHref={workspaceHref} />

      <PdfSection
        id="pdf-categories"
        title="Conversion categories"
        description={`${PDF_CAPABILITIES.length} capabilities across five groups. Availability reflects what is implemented today.`}
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {capabilitiesByCategory().map(({ capabilities, ...category }) => (
            <PdfCategoryCard key={category.id} category={category} capabilities={capabilities} workspaceHref={workspaceHref} />
          ))}
        </div>
      </PdfSection>

      <PdfSection id="pdf-formats" title="Supported formats" description="Derived from the registered capabilities above.">
        <div className="grid gap-4 lg:grid-cols-3">
          <PdfFormatPanel direction="input" />
          <PdfFormatPanel direction="output" />
          <PdfAvailabilityLegend />
        </div>
      </PdfSection>

      <PdfSection id="pdf-setup" title="Guidelines, profiles and processing">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <PdfGuidelinesSummary />
          <PdfSavedProfilesPanel />
          <PdfProcessingInfoPanel />
        </div>
      </PdfSection>

      <PdfSection id="pdf-recent-activity" title="Recent activity">
        <PdfRecentActivityPanel historyHref={historyHref} />
      </PdfSection>

      <PdfSection id="pdf-help" title="Help & format guidance">
        <PdfHelpGuidance />
      </PdfSection>
    </div>
  )
}
