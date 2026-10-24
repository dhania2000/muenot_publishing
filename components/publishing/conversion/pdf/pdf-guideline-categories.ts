/**
 * @file components/publishing/conversion/pdf/pdf-guideline-categories.ts
 * @module Publishing › Conversion › PDF
 * @kind Pure configuration
 * @summary Requirement category registry used to classify PDF guideline rules (Task 9.9).
 * @exports PDF_GUIDELINE_CATEGORIES, PDF_GUIDELINE_CATEGORY_IDS, findGuidelineCategory
 *
 * These are classifications for future rule mapping, not enforced rules. Each service keeps its own registry;
 * the shared `GuidelineRule.categoryId` references an item id such as "formatting.page-size".
 */

export type PdfGuidelineCategoryGroupId = "formatting" | "structure" | "output" | "publishing" | "accessibility" | "quality"

export type PdfGuidelineCategoryItem = { id: string; label: string }

export type PdfGuidelineCategoryGroup = {
  id: PdfGuidelineCategoryGroupId
  label: string
  items: readonly PdfGuidelineCategoryItem[]
}

function group(id: PdfGuidelineCategoryGroupId, label: string, items: [slug: string, label: string][]): PdfGuidelineCategoryGroup {
  return { id, label, items: items.map(([slug, itemLabel]) => ({ id: `${id}.${slug}`, label: itemLabel })) }
}

export const PDF_GUIDELINE_CATEGORIES: readonly PdfGuidelineCategoryGroup[] = [
  group("formatting", "Document Formatting", [
    ["page-size", "Page size"],
    ["margins", "Margins"],
    ["fonts", "Fonts"],
    ["font-size", "Font size"],
    ["line-spacing", "Line spacing"],
    ["paragraph-spacing", "Paragraph spacing"],
    ["page-numbering", "Page numbering"],
    ["headers-footers", "Headers and footers"],
  ]),
  group("structure", "Document Structure", [
    ["heading-hierarchy", "Heading hierarchy"],
    ["tables", "Tables"],
    ["figures", "Figures"],
    ["footnotes", "Footnotes"],
    ["references", "References"],
    ["bookmarks", "Bookmarks"],
    ["reading-order", "Reading order"],
    ["hyperlinks", "Hyperlinks"],
  ]),
  group("output", "Output Requirements", [
    ["target-format", "Target format"],
    ["format-version", "Format version"],
    ["resolution", "Resolution"],
    ["compression", "Compression"],
    ["file-naming", "File naming"],
    ["folder-structure", "Output folder structure"],
    ["package-naming", "Package naming"],
  ]),
  group("publishing", "Publishing Standards", [
    ["journal-specifications", "Journal specifications"],
    ["publisher-standards", "Publisher standards"],
    ["xml-structure", "XML structure"],
    ["metadata", "Metadata"],
    ["cross-references", "Cross-references"],
    ["equations", "Equation handling"],
  ]),
  group("accessibility", "Accessibility Requirements", [
    ["pdf-tagging", "PDF tagging"],
    ["pdf-ua", "PDF/UA requirements"],
    ["reading-order", "Reading order"],
    ["alt-text", "Alternative text"],
    ["accessible-tables", "Accessible tables"],
    ["language-metadata", "Language metadata"],
  ]),
  group("quality", "Quality Requirements", [
    ["completeness", "Completeness"],
    ["text-accuracy", "Text accuracy"],
    ["layout-fidelity", "Layout fidelity"],
    ["image-quality", "Image quality"],
    ["table-integrity", "Table integrity"],
    ["equation-accuracy", "Equation accuracy"],
    ["validation", "Validation requirements"],
  ]),
]

export const PDF_GUIDELINE_CATEGORY_IDS: ReadonlySet<string> = new Set(PDF_GUIDELINE_CATEGORIES.flatMap((g) => g.items.map((i) => i.id)))

export function findGuidelineCategory(categoryId: string): { group: PdfGuidelineCategoryGroup; item: PdfGuidelineCategoryItem } | null {
  for (const g of PDF_GUIDELINE_CATEGORIES) {
    const item = g.items.find((i) => i.id === categoryId)
    if (item) return { group: g, item }
  }
  return null
}
