"use client"

/**
 * @file components/publishing/conversion/pdf/pdf-format-matrix.tsx
 * @module Publishing › Conversion › PDF
 * @kind React client component
 * @summary Supported Format & Compatibility Matrix: searchable, filterable list of every registered capability
 *   with expandable technical details. Desktop/tablet render a table; mobile renders record cards.
 * @exports PdfFormatMatrix, PdfFormatReference
 */
import { useId, useState } from "react"
import Link from "next/link"
import { ArrowRight, ChevronDown, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { PdfCapabilityStatusIndicator } from "@/components/publishing/conversion/pdf/pdf-capability-status"
import {
  PDF_CAPABILITIES,
  PDF_OCR_META,
  PDF_OPERATION_KIND_META,
  type PdfCapability,
} from "@/components/publishing/conversion/pdf/pdf-capabilities"
import { getPdfFormat, PDF_FORMAT_FAMILIES, PDF_FORMATS } from "@/components/publishing/conversion/pdf/pdf-formats"
import {
  canOpenCapabilityInWorkspace,
  capabilityDirection,
  capabilityRequirements,
  categoryLabel,
  filterPdfCapabilities,
  isFormatAcceptedForUpload,
  PDF_MATRIX_DEFAULT_FILTERS,
  pdfMatrixOptions,
  type PdfMatrixFilters,
} from "@/components/publishing/conversion/pdf/pdf-format-matrix-model"
import { cn } from "@/lib/utils"

const SELECT_CLASS =
  "h-9 w-full min-w-0 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"

const GUIDELINES_NOTE =
  "Optional. The Standard Profile applies when none are supplied. Guidelines can request a format but cannot make an unavailable operation available."

const VALIDATION_NOTE =
  "Workspace upload checks the filename extension only. MIME type, file content, corrupt files and password-protected PDFs are not verified yet."

function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <select id={id} className={SELECT_CLASS} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="all">All</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}

function FormatList({ labels }: { labels: string[] }) {
  return <span className="font-mono text-xs">{labels.join(", ")}</span>
}

function formatFacts(labels: string[]) {
  return labels.map((label) => {
    const format = getPdfFormat(label)
    return {
      label,
      extensions: format ? format.extensions.map((ext) => `.${ext}`).join(", ") : "Not registered",
      mime: format ? format.mimeTypes.join(", ") : "Not registered",
    }
  })
}

function CapabilityDetails({ capability }: { capability: PdfCapability }) {
  const kind = PDF_OPERATION_KIND_META[capability.kind]
  const ocr = PDF_OCR_META[capability.ocr]
  const uploadable = capability.inputFormats.filter(isFormatAcceptedForUpload)
  const facts = [
    { term: "Direction", detail: capabilityDirection(capability) },
    { term: "Operation type", detail: `${kind.label}. ${kind.description}` },
    {
      term: "Source",
      detail: formatFacts(capability.inputFormats).map((f) => `${f.label}: ${f.extensions} (${f.mime})`).join("; "),
    },
    {
      term: "Output",
      detail: formatFacts(capability.outputFormats).map((f) => `${f.label}: ${f.extensions} (${f.mime})`).join("; "),
    },
    { term: "OCR", detail: `${ocr.label}. ${ocr.description}` },
    {
      term: "Upload",
      detail: `${uploadable.length ? `Accepted: ${uploadable.join(", ")}.` : "No source format is accepted by Workspace upload."} ${VALIDATION_NOTE}`,
    },
    { term: "Engine", detail: capability.engineRef ?? "No verified engine is integrated in the PDF module." },
    { term: "Client guidelines", detail: GUIDELINES_NOTE },
  ]

  return (
    <div className="flex flex-col gap-3 text-sm">
      <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
        {facts.map(({ term, detail }) => (
          <div key={term} className="contents">
            <dt className="text-xs font-medium text-muted-foreground sm:pt-0.5">{term}</dt>
            <dd className="leading-relaxed break-words">{detail}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium text-muted-foreground">Known limitations</p>
        <ul className="list-disc pl-5 leading-relaxed">
          {capability.note && <li>{capability.note}</li>}
          {capability.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function CapabilityAction({ capability, workspaceHref }: { capability: PdfCapability; workspaceHref: string | null }) {
  if (canOpenCapabilityInWorkspace(capability) && workspaceHref) {
    return (
      <Link
        href={workspaceHref}
        className="inline-flex min-h-9 items-center gap-1 rounded-md text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        Open Workspace<span className="sr-only">{` for ${capability.label}`}</span>
        <ArrowRight className="size-4" aria-hidden="true" />
      </Link>
    )
  }
  return <span className="text-xs text-muted-foreground">Not runnable yet</span>
}

function RequirementSummary({ capability }: { capability: PdfCapability }) {
  return (
    <ul className="flex flex-col gap-0.5">
      {capabilityRequirements(capability).map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  )
}

function ExpandButton({
  expanded,
  controls,
  label,
  onToggle,
}: {
  expanded: boolean
  controls: string
  label: string
  onToggle: () => void
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-8 shrink-0"
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onToggle}
    >
      <ChevronDown className={cn("size-4 transition-transform", expanded && "rotate-180")} aria-hidden="true" />
      <span className="sr-only">{`${expanded ? "Hide" : "Show"} details for ${label}`}</span>
    </Button>
  )
}

export function PdfFormatMatrix({ workspaceHref }: { workspaceHref: string | null }) {
  const baseId = useId()
  const [filters, setFilters] = useState<PdfMatrixFilters>(PDF_MATRIX_DEFAULT_FILTERS)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())

  const rows = filterPdfCapabilities(filters)
  const options = pdfMatrixOptions(filters)
  const isFiltered = JSON.stringify(filters) !== JSON.stringify(PDF_MATRIX_DEFAULT_FILTERS)

  function update<K extends keyof PdfMatrixFilters>(key: K, value: PdfMatrixFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }))
  }

  function toggle(id: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const detailsId = (id: string) => `${baseId}-details-${id.replace(/\W/g, "-")}`
  const resultLabel = `${rows.length} of ${PDF_CAPABILITIES.length} operations`

  return (
    <div className="flex min-w-0 flex-col gap-4 rounded-lg border bg-card p-4 text-card-foreground sm:p-5">
      <div role="search" aria-label="Filter supported formats" className="flex flex-col gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={`${baseId}-query`} className="text-xs text-muted-foreground">
            Search formats and operations
          </Label>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              id={`${baseId}-query`}
              type="search"
              value={filters.query}
              onChange={(event) => update("query", event.target.value)}
              placeholder="e.g. DOCX, .tif, JATS, rasterization"
              className="h-9 pl-8"
            />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <FilterSelect
            id={`${baseId}-category`}
            label="Category"
            value={filters.category}
            onChange={(value) => update("category", value as PdfMatrixFilters["category"])}
            options={options.categories}
          />
          <FilterSelect
            id={`${baseId}-source`}
            label="Source format"
            value={filters.source}
            onChange={(value) => update("source", value)}
            options={options.sources.map((format) => ({ value: format, label: format }))}
          />
          <FilterSelect
            id={`${baseId}-target`}
            label="Output format"
            value={filters.target}
            onChange={(value) => update("target", value)}
            options={options.targets.map((format) => ({ value: format, label: format }))}
          />
          <FilterSelect
            id={`${baseId}-status`}
            label="Availability"
            value={filters.status}
            onChange={(value) => update("status", value as PdfMatrixFilters["status"])}
            options={options.statuses}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
            {`Showing ${resultLabel}`}
          </p>
          <Button type="button" variant="outline" size="sm" className="min-h-9" disabled={!isFiltered} onClick={() => setFilters(PDF_MATRIX_DEFAULT_FILTERS)}>
            Reset filters
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-center">
          <p className="text-sm font-medium">No operations match these filters.</p>
          <p className="mt-1 text-sm text-muted-foreground">Change the search or reset filters to see all registered operations.</p>
        </div>
      ) : (
        <>
          <div className="hidden min-w-0 overflow-x-auto rounded-md border md:block">
            <Table className="min-w-[46rem]">
              <TableCaption className="sr-only">{`Supported PDF formats and operations, ${resultLabel}`}</TableCaption>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead scope="col" className="w-10">
                    <span className="sr-only">Details</span>
                  </TableHead>
                  <TableHead scope="col">Source</TableHead>
                  <TableHead scope="col">Output / operation</TableHead>
                  <TableHead scope="col" className="hidden lg:table-cell">
                    Category
                  </TableHead>
                  <TableHead scope="col">Availability</TableHead>
                  <TableHead scope="col" className="hidden lg:table-cell">
                    Requirements
                  </TableHead>
                  <TableHead scope="col">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((capability) => {
                  const open = expanded.has(capability.id)
                  const id = detailsId(capability.id)
                  return (
                    <MatrixRows
                      key={capability.id}
                      capability={capability}
                      open={open}
                      detailsId={id}
                      onToggle={() => toggle(capability.id)}
                      workspaceHref={workspaceHref}
                    />
                  )
                })}
              </TableBody>
            </Table>
          </div>

          <ul className="flex flex-col divide-y rounded-md border md:hidden" aria-label={`Supported PDF formats and operations, ${resultLabel}`}>
            {rows.map((capability) => {
              const open = expanded.has(capability.id)
              const id = `${detailsId(capability.id)}-m`
              return (
                <li key={capability.id} className="flex flex-col gap-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <p className="text-sm font-medium">{capability.label}</p>
                      <p className="font-mono text-xs text-muted-foreground">{capabilityDirection(capability)}</p>
                    </div>
                    <ExpandButton expanded={open} controls={id} label={capability.label} onToggle={() => toggle(capability.id)} />
                  </div>
                  <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
                    <dt className="text-xs text-muted-foreground">Category</dt>
                    <dd>{categoryLabel(capability.category)}</dd>
                    <dt className="text-xs text-muted-foreground">Availability</dt>
                    <dd>
                      <PdfCapabilityStatusIndicator status={capability.status} />
                    </dd>
                    <dt className="text-xs text-muted-foreground">Requires</dt>
                    <dd>
                      <RequirementSummary capability={capability} />
                    </dd>
                  </dl>
                  <CapabilityAction capability={capability} workspaceHref={workspaceHref} />
                  {open && (
                    <div id={id} className="rounded-md bg-muted/40 p-3">
                      <CapabilityDetails capability={capability} />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}

function MatrixRows({
  capability,
  open,
  detailsId,
  onToggle,
  workspaceHref,
}: {
  capability: PdfCapability
  open: boolean
  detailsId: string
  onToggle: () => void
  workspaceHref: string | null
}) {
  return (
    <>
      <TableRow data-state={open ? "selected" : undefined}>
        <TableCell className="py-1.5">
          <ExpandButton expanded={open} controls={detailsId} label={capability.label} onToggle={onToggle} />
        </TableCell>
        <TableCell className="whitespace-normal">
          <FormatList labels={capability.inputFormats} />
        </TableCell>
        <TableCell className="whitespace-normal">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">{capability.label}</span>
            <span className="text-xs text-muted-foreground">
              <span className="sr-only">Output: </span>
              {capability.kind === "format-conversion" || capability.kind === "page-rasterization" || capability.kind === "pdf-creation" ? (
                <FormatList labels={capability.outputFormats} />
              ) : (
                `${PDF_OPERATION_KIND_META[capability.kind].label} · ${capability.outputFormats.join(", ")}`
              )}
            </span>
          </div>
        </TableCell>
        <TableCell className="hidden whitespace-normal text-sm lg:table-cell">{categoryLabel(capability.category)}</TableCell>
        <TableCell>
          <PdfCapabilityStatusIndicator status={capability.status} />
        </TableCell>
        <TableCell className="hidden whitespace-normal text-xs text-muted-foreground lg:table-cell">
          <RequirementSummary capability={capability} />
        </TableCell>
        <TableCell>
          <CapabilityAction capability={capability} workspaceHref={workspaceHref} />
        </TableCell>
      </TableRow>
      {open && (
        <TableRow id={detailsId} className="bg-muted/30 hover:bg-muted/30">
          <TableCell colSpan={7} className="whitespace-normal p-4">
            <CapabilityDetails capability={capability} />
          </TableCell>
        </TableRow>
      )}
    </>
  )
}

/** Recognized formats grouped by family. A listed format is not necessarily used by any operation. */
export function PdfFormatReference() {
  const usage = (label: string) =>
    PDF_CAPABILITIES.filter((c) => c.inputFormats.includes(label) || c.outputFormats.includes(label)).length

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {PDF_FORMAT_FAMILIES.map((family) => {
        const formats = PDF_FORMATS.filter((format) => format.family === family.id)
        const headingId = `pdf-format-family-${family.id}`
        return (
          <section key={family.id} aria-labelledby={headingId} className="flex min-w-0 flex-col gap-2 rounded-lg border bg-card p-4 text-card-foreground">
            <h3 id={headingId} className="text-sm font-semibold">
              {family.label}
            </h3>
            <ul className="flex flex-col divide-y">
              {formats.map((format) => {
                const count = usage(format.label)
                const traits = [
                  format.variantOf && `${format.standardProfile ? "Profile" : "Variant"} of ${format.variantOf}`,
                  format.generation && { legacy: "Legacy", modern: "Modern", "open-document": "OpenDocument" }[format.generation],
                  isFormatAcceptedForUpload(format.label) ? "Upload accepted" : null,
                ].filter(Boolean)
                return (
                  <li key={format.label} className="flex flex-col gap-0.5 py-2 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="text-sm">
                        <span className="font-mono font-medium">{format.label}</span>
                        <span className="text-muted-foreground">{` · ${format.name}`}</span>
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {count === 0 ? "No operations" : `${count} ${count === 1 ? "operation" : "operations"}`}
                      </span>
                    </div>
                    <p className="font-mono text-xs text-muted-foreground break-words">
                      {format.extensions.map((ext) => `.${ext}`).join(" ")} · {format.mimeTypes.join(", ")}
                    </p>
                    {(traits.length > 0 || format.note) && (
                      <p className="text-xs leading-relaxed text-muted-foreground">{[...traits, format.note].filter(Boolean).join(". ")}</p>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
