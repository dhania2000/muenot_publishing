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
import { ArrowRight, ChevronDown } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { PdfSection } from "@/components/publishing/conversion/pdf/pdf-content"
import { PdfCapabilityStatusIndicator } from "@/components/publishing/conversion/pdf/pdf-capability-status"
import {
  capabilitiesByCategory,
  categoryFormats,
  deriveFormatAvailability,
  summarizeCategoryAvailability,
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

/** Operations shown before the "Show all" disclosure; keeps the 13-item Advanced card in line with the others. */
export const PDF_CATEGORY_VISIBLE_OPERATIONS = 6

const FORMAT_AXIS_LABEL: Record<PdfCapabilityCategory["formatAxis"], string> = {
  output: "Output formats",
  input: "Source formats",
  pdf: "Works on",
}

function capabilityFormat(category: PdfCapabilityCategory, capability: PdfCapability) {
  return (category.formatAxis === "input" ? capability.inputFormats : capability.outputFormats).join(", ")
}

function PdfCategoryOperation({ category, capability }: { category: PdfCapabilityCategory; capability: PdfCapability }) {
  const format = capabilityFormat(category, capability)
  const showFormat = category.formatAxis !== "pdf" || format !== "PDF"
  return (
    <li className="flex flex-col gap-0.5 py-2 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-medium">{capability.label}</span>
          {showFormat && (
            <span className="font-mono text-xs text-muted-foreground">
              <span className="sr-only">{category.formatAxis === "input" ? "from " : "to "}</span>
              {format}
            </span>
          )}
        </span>
        <PdfCapabilityStatusIndicator status={capability.status} />
      </div>
      {capability.note && <p className="text-xs leading-relaxed text-muted-foreground">{capability.note}</p>}
    </li>
  )
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
  const formats = categoryFormats(category, capabilities)
  const availability = summarizeCategoryAvailability(capabilities)
  const visible = capabilities.slice(0, PDF_CATEGORY_VISIBLE_OPERATIONS)
  const overflow = capabilities.slice(PDF_CATEGORY_VISIBLE_OPERATIONS)
  const listClass = "flex flex-col divide-y"

  return (
    <article aria-labelledby={headingId} className="flex h-full min-w-0 flex-col gap-4 rounded-lg border bg-card p-4 text-card-foreground sm:p-5">
      <header className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted text-foreground">
          <Icon className="size-4" strokeWidth={2} aria-hidden="true" />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <h3 id={headingId} className="text-base font-semibold leading-tight text-balance">
            {category.label}
          </h3>
          <p className="text-sm leading-relaxed text-muted-foreground text-pretty">{category.description}</p>
        </div>
      </header>

      <div className="flex flex-col gap-1.5">
        <h4 className="text-xs font-medium text-muted-foreground">{FORMAT_AXIS_LABEL[category.formatAxis]}</h4>
        <ul className="flex flex-wrap gap-1.5" aria-label={`${category.label}: ${FORMAT_AXIS_LABEL[category.formatAxis]}`}>
          {formats.map((format) => (
            <li key={format}>
              <Badge variant="outline" className="font-mono">
                {format}
              </Badge>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-2">
        <h4 className="text-xs font-medium text-muted-foreground">
          Operations <span className="tabular-nums">({capabilities.length})</span>
        </h4>
        <ul className={listClass} aria-label={`${category.label} operations`}>
          {visible.map((capability) => (
            <PdfCategoryOperation key={capability.id} category={category} capability={capability} />
          ))}
        </ul>
        {overflow.length > 0 && (
          <details className="group flex flex-col">
            <summary className="flex min-h-9 w-fit cursor-pointer list-none items-center gap-1 rounded-md text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
              <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden="true" />
              <span className="group-open:hidden">{`Show all ${capabilities.length} operations`}</span>
              <span className="hidden group-open:inline">Show fewer operations</span>
              <span className="sr-only">{` in ${category.label}`}</span>
            </summary>
            <ul className={`${listClass} border-t pt-2`} aria-label={`More ${category.label} operations`}>
              {overflow.map((capability) => (
                <PdfCategoryOperation key={capability.id} category={category} capability={capability} />
              ))}
            </ul>
          </details>
        )}
      </div>

      <footer className="mt-auto flex flex-col gap-2 border-t pt-3">
        <div className="flex flex-wrap gap-x-3 gap-y-1" aria-label={`${category.label} availability summary`} role="group">
          {summarizeStatuses(capabilities).map(({ status, count }) => (
            <PdfCapabilityStatusIndicator key={status} status={status} count={count} />
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">{availability.summary}</p>
          {availability.runnable && workspaceHref && (
            <Link
              href={workspaceHref}
              className="inline-flex min-h-9 items-center gap-1 rounded-md text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Open Workspace<span className="sr-only">{` for ${category.label}`}</span>
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          )}
        </div>
      </footer>
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
        description={`${PDF_CAPABILITIES.length} operations across five categories. Each status reflects what is implemented and verified today; client guidelines are optional for every category.`}
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
