/**
 * @file components/publishing/conversion/pdf/pdf-header-config.ts
 * @module Publishing › Conversion › PDF
 * @kind Pure configuration
 * @summary Configuration-driven header copy, breadcrumbs and contextual actions for every PDF section.
 * @exports getPdfHeader, PdfHeader, PdfHeaderAction, PdfHeaderActionId
 * @see PDF_PHASE1_TASK2_UI_ARCHITECTURE.md, PDF_PHASE2_TASK1_OVERVIEW_AUDIT.md §5
 *
 * Action hierarchy (Phase 2 Task 2):
 * - One primary action: "Open Workspace". The Workspace is the only working entry point today —
 *   it is where source files are selected (locally) and conversions are configured. "Upload Files"
 *   and "New Conversion" would open the exact same page, so they are folded into this action
 *   instead of being shown as duplicate buttons.
 * - Secondary actions live in the "More actions" menu and carry their real availability using the
 *   shared six-state capability model, so a registered route with a "Coming soon" body is never
 *   presented as operational.
 * - Guidelines are always optional: never required, and only linked once a Guidelines route exists.
 */
import type { Crumb } from "@/components/enterprise/page-header"
import { CONVERSION_CRUMB, PUBLISHING_CRUMBS } from "@/components/publishing/conversion/conversion-nav"
import { PDF_CAPABILITY_STATUS_META, type PdfCapabilityStatus } from "@/components/publishing/conversion/pdf/pdf-capabilities"
import { getPdfSection } from "@/components/publishing/conversion/pdf/pdf-sections"
import { conversionHref, type ConversionModule, type ConversionPage } from "@/lib/conversion-modules"

export type PdfHeaderActionId = "open-workspace" | "upload" | "batch-processing" | "guidelines"

type PdfHeaderActionBase = {
  id: PdfHeaderActionId
  label: string
  variant: "primary" | "secondary"
  /** Real availability of the underlying feature, using the shared capability status model. */
  availability: PdfCapabilityStatus
  /** Short, visible explanation of what the action does or why it is limited. */
  description: string
}

export type PdfHeaderAction =
  | (PdfHeaderActionBase & { status: "link"; href: string })
  | (PdfHeaderActionBase & { status: "unavailable"; reason: string })

export type PdfHeader = {
  title: string
  subtitle: string
  breadcrumbs: Crumb[]
  actions: PdfHeaderAction[]
}

/** Publishing › Conversion › PDF — the "Modules" root is omitted for the PDF trail by design. */
const PDF_ROOT_CRUMBS: Crumb[] = [...PUBLISHING_CRUMBS.filter((c) => c.label === "Publishing"), CONVERSION_CRUMB]

function isRegistered(module: ConversionModule, slug: string) {
  return module.pages.some((p) => p.slug === slug)
}

export function availabilityLabel(availability: PdfCapabilityStatus) {
  return PDF_CAPABILITY_STATUS_META[availability].label
}

export function getPdfHeader(module: ConversionModule, page?: ConversionPage): PdfHeader {
  const slug = page?.slug ?? ""
  const section = getPdfSection(slug)
  const title = section?.headerTitle ?? section?.label ?? page?.label ?? module.label
  const subtitle = section?.description ?? module.description
  const currentLabel = section?.breadcrumbLabel ?? page?.label ?? "Overview"

  const breadcrumbs: Crumb[] = [
    ...PDF_ROOT_CRUMBS,
    { label: module.label, href: conversionHref(module.slug) },
    { label: currentLabel },
  ]

  const actions: PdfHeaderAction[] = []

  if (slug !== "workspace" && isRegistered(module, "workspace")) {
    actions.push({
      id: "open-workspace",
      label: "Open Workspace",
      variant: "primary",
      availability: "ui-ready",
      status: "link",
      href: conversionHref(module.slug, "workspace"),
      description: "Add source files and set up a conversion. Files stay in this browser until server upload is available.",
    })
  }

  // No server uploader exists yet (Phase 3). Local file selection lives in the Workspace.
  actions.push({
    id: "upload",
    label: "Server upload",
    variant: "secondary",
    availability: "planned",
    status: "unavailable",
    description: "Upload source files to Muenot for processing.",
    reason:
      slug === "workspace"
        ? "Planned. Files added in Source Files stay in this browser."
        : "Planned. Add files locally in the Workspace for now.",
  })

  if (slug !== "batch-processing" && isRegistered(module, "batch-processing")) {
    actions.push({
      id: "batch-processing",
      label: "Batch Processing",
      variant: "secondary",
      availability: "planned",
      status: "link",
      href: conversionHref(module.slug, "batch-processing"),
      description: "Planned. Opens the section overview; batch runs are not available yet.",
    })
  }

  if (slug !== "guidelines") {
    actions.push(
      isRegistered(module, "guidelines")
        ? {
            id: "guidelines",
            label: "Guidelines (optional)",
            variant: "secondary",
            availability: "ui-ready",
            status: "link",
            href: conversionHref(module.slug, "guidelines"),
            description: "Optional client instructions. The Standard Profile applies when none are provided.",
          }
        : {
            id: "guidelines",
            label: "Guidelines (optional)",
            variant: "secondary",
            availability: "planned",
            status: "unavailable",
            description: "Optional client instructions.",
            reason: "Planned. Not required: the Standard Profile applies when no guidelines are provided.",
          },
    )
  }

  return { title, subtitle, breadcrumbs, actions }
}
