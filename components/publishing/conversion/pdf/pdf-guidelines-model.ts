/**
 * @file components/publishing/conversion/pdf/pdf-guidelines-model.ts
 * @module Publishing › Conversion › PDF
 * @kind Pure TypeScript (no React)
 * @summary PDF adapter over the shared guidelines contract (lib/guidelines/contract.ts): the PDF service reference,
 *   the PDF requirement-category registry and the compact summary state shown in Workspace and Overview (Task 9).
 * @exports PDF_GUIDELINE_SERVICE, PDF_GUIDELINE_REQUIREMENT_CATEGORIES, PdfGuidelineContext, derivePdfGuidelineState,
 *   getPdfGuidelineCategory
 *
 * No guideline data source exists yet, so callers pass `null` (Scenario A). Categories are classifications for
 * future rule mapping only; nothing here validates or enforces a requirement.
 */
import {
  resolveGuidelineScenario,
  summarizeGuidelineCompliance,
  type GuidelineJobContext,
  type GuidelineRequirementCategory,
  type GuidelineServiceRef,
} from "@/lib/guidelines/contract"
import type { PdfGuidelineState } from "@/components/publishing/conversion/pdf/pdf-workspace-config"

export const PDF_GUIDELINE_SERVICE: GuidelineServiceRef = { area: "conversion", service: "pdf" }

/** The PDF module's guideline context. `null` means no guidelines were supplied. */
export type PdfGuidelineContext = GuidelineJobContext

const items = (...labels: string[]) =>
  labels.map((label) => ({ id: label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""), label }))

export const PDF_GUIDELINE_REQUIREMENT_CATEGORIES: readonly GuidelineRequirementCategory[] = [
  {
    id: "formatting",
    label: "Document Formatting",
    items: items("Page size", "Margins", "Fonts", "Font size", "Line spacing", "Paragraph spacing", "Page numbering", "Headers and footers"),
  },
  {
    id: "structure",
    label: "Document Structure",
    items: items("Heading hierarchy", "Tables", "Figures", "Footnotes", "References", "Bookmarks", "Reading order", "Hyperlinks"),
  },
  {
    id: "output",
    label: "Output Requirements",
    items: items("Target format", "Format version", "Resolution", "Compression", "File naming", "Output folder structure", "Package naming"),
  },
  {
    id: "publishing",
    label: "Publishing Standards",
    items: items("Journal specifications", "Publisher standards", "XML structure", "Metadata", "Cross-references", "Equation handling"),
  },
  {
    id: "accessibility",
    label: "Accessibility Requirements",
    items: items("PDF tagging", "PDF/UA requirements", "Reading order", "Alternative text", "Accessible tables", "Language metadata"),
  },
  {
    id: "quality",
    label: "Quality Requirements",
    items: items("Completeness", "Text accuracy", "Layout fidelity", "Image quality", "Table integrity", "Equation accuracy", "Validation requirements"),
  },
]

export function getPdfGuidelineCategory(id: string) {
  return PDF_GUIDELINE_REQUIREMENT_CATEGORIES.find((c) => c.id === id)
}

/**
 * Collapses the separate document, rule, application and verification statuses into one compact label for
 * summaries. It only reaches "verified" through the shared compliance verdict, never from upload or review alone.
 */
export function derivePdfGuidelineState(ctx: PdfGuidelineContext | null | undefined): PdfGuidelineState {
  if (resolveGuidelineScenario(ctx) === "none" || !ctx) return "not-provided"
  const summary = summarizeGuidelineCompliance(ctx)
  if (summary.verdict === "compliant") return "verified"
  if (summary.verdict === "compliant-with-exceptions") return "verified-with-exceptions"
  if (summary.verdict === "non-compliant") return "failed"
  if (summary.unresolvedConflicts > 0) return "conflict"
  const awaitingReview =
    ctx.documents.some((d) => d.status === "uploaded" || d.status === "pending-review") ||
    ctx.rules.some((r) => r.ruleStatus === "pending-review" || r.ruleStatus === "not-extracted")
  if (awaitingReview || summary.pendingReview > 0) return "pending-review"
  if (summary.unsupported > 0) return "unsupported"
  if (ctx.results.length > 0) return "verification-pending"
  if (summary.applied > 0) return "applied"
  return "profile-selected"
}
