/**
 * @file components/publishing/conversion/pdf/pdf-module-layout.tsx
 * @module Publishing › Conversion › PDF
 * @kind React server component
 * @summary Shared page shell for every PDF section: header, navigation, feedback, main content and optional context panel.
 * @exports PdfModuleLayout, PdfLayoutWidth, PdfLayoutSpacing, PdfSectionLayout, getPdfSectionLayout
 * @see PDF_PHASE1_TASK2_UI_ARCHITECTURE.md §6.3, §7, §13
 */
import { getPdfSection } from "@/components/publishing/conversion/pdf/pdf-sections"
import { cn } from "@/lib/utils"

export type PdfLayoutWidth = "default" | "wide" | "full"
export type PdfLayoutSpacing = "compact" | "standard"
export type PdfSectionLayout = { width: PdfLayoutWidth; spacing: PdfLayoutSpacing }

const WIDTH_CLASS: Record<PdfLayoutWidth, string> = {
  default: "max-w-screen-xl",
  wide: "max-w-screen-2xl",
  full: "max-w-none",
}

const SPACING_CLASS: Record<PdfLayoutSpacing, string> = {
  compact: "gap-4 p-4 sm:p-5 md:p-6",
  standard: "gap-6 p-4 sm:p-6 md:p-8",
}

const DEFAULT_SECTION_LAYOUT: PdfSectionLayout = { width: "default", spacing: "standard" }

/** Per-section layout lives in the PDF section config ("" = Overview); unknown slugs use the default. */
export function getPdfSectionLayout(sectionSlug: string): PdfSectionLayout {
  return getPdfSection(sectionSlug)?.layout ?? DEFAULT_SECTION_LAYOUT
}

type PdfModuleLayoutProps = {
  /** Breadcrumbs, title, description and actions (detailed header arrives in Task 4). */
  header: React.ReactNode
  /** PDF internal section navigation (full navigation arrives in Task 5). */
  navigation?: React.ReactNode
  /** Persistent alerts, e.g. capability unavailable or guideline status. Announced politely. */
  status?: React.ReactNode
  /** Optional contextual panel (file info, metadata, guideline summary, QA findings). Takes no space when absent. */
  aside?: React.ReactNode
  asideLabel?: string
  /** Sticky toolbar above the main content (e.g. workspace Run/Cancel). */
  toolbar?: React.ReactNode
  width?: PdfLayoutWidth
  spacing?: PdfLayoutSpacing
  children: React.ReactNode
}

export function PdfModuleLayout({
  header,
  navigation,
  status,
  aside,
  asideLabel = "Details",
  toolbar,
  width = "default",
  spacing = "standard",
  children,
}: PdfModuleLayoutProps) {
  return (
    <div
      data-pdf-layout={width}
      className={cn("mx-auto flex w-full min-w-0 flex-col", WIDTH_CLASS[width], SPACING_CLASS[spacing])}
    >
      <div data-slot="pdf-header" className="min-w-0">
        {header}
      </div>

      {navigation && (
        <div data-slot="pdf-navigation" className="min-w-0">
          {navigation}
        </div>
      )}

      <div data-slot="pdf-status" aria-live="polite" className="flex min-w-0 flex-col gap-3 empty:hidden">
        {status}
      </div>

      {toolbar && (
        <div
          data-slot="pdf-toolbar"
          className="sticky top-0 z-10 -mx-1 flex min-w-0 flex-wrap items-center gap-2 border-b bg-background/95 px-1 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80"
        >
          {toolbar}
        </div>
      )}

      {aside ? (
        <div className="@container/pdf-module min-w-0">
          <div className="grid min-w-0 gap-6 @3xl/pdf-module:grid-cols-[minmax(0,1fr)_minmax(260px,320px)]">
            <div data-slot="pdf-content" className="flex min-w-0 flex-col gap-6">
              {children}
            </div>
            <aside data-slot="pdf-context" aria-label={asideLabel} className="flex min-w-0 flex-col gap-4">
              {aside}
            </aside>
          </div>
        </div>
      ) : (
        <div data-slot="pdf-content" className="flex min-w-0 flex-col gap-6">
          {children}
        </div>
      )}
    </div>
  )
}
