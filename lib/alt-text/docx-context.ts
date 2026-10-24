/**
 * @file lib/alt-text/docx-context.ts
 * @module Publishing · Alt Text
 * @kind Shared library (pure, no I/O)
 * @summary Phase 3 Task 9 — DOCX context evidence over the logical (unrendered) document structure:
 *   heading hierarchy, anchor paragraph, adjacent paragraphs within the same section and container,
 *   caption-styled / SEQ-field captions, table cell / row / header cells (nested tables included),
 *   header/footer isolation and floating-image anchors. Never fabricates page numbers.
 *
 *   The repository has no DOCX image extractor yet, so no DOCX occurrences are persisted. This
 *   builder consumes the `DocxTextLayout` model that the future DOCX reader must produce (the same
 *   way `pptx-package` produces `PptxTextLayout` with `collectText`); keys are the occurrence
 *   `sourceLocator`s so the results plug straight into the shared context service.
 */
import type { ContextEvidence, EvidenceText, NearbyCandidate } from "./document-context"

export type DocxDrawing = {
  sourceLocator: string
  placement: "inline" | "floating"
  /** `wp:docPr/@descr` — author alt text, copied verbatim. */
  description: string | null
  name: string | null
  title: string | null
}

export type DocxParagraph = {
  kind: "paragraph"
  ref: string
  paraId?: string | null
  text: string
  styleId: string | null
  /** Outline level from the heading style (1 = Heading 1); null for body text. */
  headingLevel: number | null
  /** Paragraph uses the built-in `Caption` style (or a style based on it). */
  isCaption: boolean
  /** Contains a `SEQ Figure|Table|…` field. */
  hasSeqField: boolean
  /** `w:sectPr` index the paragraph belongs to. */
  section: number
  drawings: DocxDrawing[]
}

export type DocxTable = {
  kind: "table"
  ref: string
  caption: string | null
  rows: { header: boolean; cells: { ref: string; blocks: DocxBlock[] }[] }[]
}

export type DocxBlock = DocxParagraph | DocxTable

export type DocxTextLayout = {
  title: string | null
  body: DocxBlock[]
  headers: { part: string; blocks: DocxBlock[] }[]
  footers: { part: string; blocks: DocxBlock[] }[]
}

export const DOCX_CONTEXT_RULES = {
  /** Paragraphs on each side of the anchor considered as nearby explanation. */
  adjacentParagraphs: 2,
} as const

type TableFrame = { tableId: string; row: number; column: number; caption: string | null; headerCells: string[]; rowLabel: string | null; cellText: string; cellRef: string }

type Heading = EvidenceText & { level: number | null }

const BODY_PART = "word/document.xml"
const cellPlainText = (blocks: DocxBlock[]): string =>
  blocks.map((b) => (b.kind === "paragraph" ? b.text : b.rows.map((r) => r.cells.map((c) => cellPlainText(c.blocks)).join(" ")).join(" "))).join(" ").trim()

export function buildDocxContextEvidence(layout: DocxTextLayout | null | undefined): Map<string, ContextEvidence> {
  const out = new Map<string, ContextEvidence>()
  if (!layout) return out
  let order = 0
  const docTitle: EvidenceText | null = layout.title
    ? { text: layout.title, method: "docx_core_title", source: { kind: "docx_core", ref: "docProps/core.xml#dc:title" }, provenance: "explicit" }
    : null

  const visit = (blocks: DocxBlock[], part: string, headings: Heading[] | null, frame: TableFrame | null, tablePath: string) => {
    const paras = blocks.filter((b): b is DocxParagraph => b.kind === "paragraph")
    let tableNo = 0
    for (const block of blocks) {
      if (block.kind === "table") {
        tableNo++
        const tableId = `${tablePath}t${tableNo}`
        const headerRow = block.rows.find((r) => r.header)
        const headerCells = headerRow ? headerRow.cells.map((c) => cellPlainText(c.blocks)) : []
        block.rows.forEach((row, ri) => {
          row.cells.forEach((cell, ci) => {
            const cellText = cellPlainText(cell.blocks)
            const rowLabel = ci > 0 ? cellPlainText(row.cells[0]?.blocks ?? []) || null : null
            visit(cell.blocks, part, headings, { tableId, row: ri + 1, column: ci + 1, caption: block.caption, headerCells, rowLabel, cellText, cellRef: cell.ref }, `${tableId}/r${ri + 1}c${ci + 1}/`)
          })
        })
        continue
      }
      if (block.headingLevel != null && headings && !frame) {
        while (headings.length && (headings[headings.length - 1].level ?? 99) >= block.headingLevel) headings.pop()
        if (block.text.trim()) {
          headings.push({ text: block.text, level: block.headingLevel, method: "docx_heading_style", source: { kind: "docx_paragraph", ref: `${part}#${block.ref}` }, provenance: "structural" })
        }
      }
      if (!block.drawings.length) continue
      const i = paras.indexOf(block)
      for (const d of block.drawings) out.set(d.sourceLocator, evidenceFor(d, block, i, paras, part, headings, frame))
    }
  }

  const evidenceFor = (d: DocxDrawing, anchor: DocxParagraph, i: number, paras: DocxParagraph[], part: string, headings: Heading[] | null, frame: TableFrame | null): ContextEvidence => {
    const ev: ContextEvidence = { documentTitle: docTitle, warnings: [], captions: [], nearby: [] }
    const src = (p: DocxParagraph) => ({ kind: "docx_paragraph", ref: `${part}#${p.ref}` })
    ev.headings = headings ? headings.map((h) => ({ ...h })) : []
    ev.location = { part, paragraph: anchor.paraId ?? anchor.ref, label: frame ? `Table ${frame.tableId} row ${frame.row}, column ${frame.column}` : null }
    ev.readingOrder = { index: order++, basis: part === BODY_PART ? "docx_document_order" : "docx_header_footer", verified: false }
    if (d.description?.trim()) ev.existingAlt = { text: d.description, source: { kind: "docx_docpr_descr", ref: `${part}#${d.sourceLocator}` } }
    if (part !== BODY_PART) {
      ev.warnings!.push({ code: "HEADER_FOOTER_IMAGE", message: "This image is in a page header or footer and repeats on several pages; body headings are not applied." })
    }
    if (d.placement === "floating") {
      ev.warnings!.push({ code: "FLOATING_IMAGE_ANCHOR", message: "Floating image: context comes from its anchor paragraph, which may be displayed away from the image." })
    }
    if (anchor.drawings.length > 1) {
      ev.warnings!.push({ code: "MULTIPLE_IMAGES_NEARBY", message: `This paragraph holds ${anchor.drawings.length} images; nearby text may describe another one.` })
    }

    const isCaption = (p: DocxParagraph) => p.isCaption || p.hasSeqField
    const drawingsAround = (k: number) => [paras[k - 1], paras[k + 1]].reduce((n, p) => n + (p?.drawings.length ?? 0), 0)
    if (isCaption(anchor) && anchor.text.trim()) {
      ev.captions!.push({ text: anchor.text, method: anchor.hasSeqField ? "docx_seq_field" : "docx_caption_style", source: src(anchor), provenance: "structural", captionSource: "caption_style", sharedWith: anchor.drawings.length })
    }
    for (const k of [i + 1, i - 1]) {
      const p = paras[k]
      if (!p || p.section !== anchor.section || !isCaption(p) || !p.text.trim()) continue
      ev.captions!.push({ text: p.text, method: p.hasSeqField ? "docx_seq_field_adjacent" : "docx_caption_style_adjacent", source: src(p), provenance: "structural", captionSource: "caption_style", sharedWith: Math.max(1, drawingsAround(k)) })
    }

    if (anchor.text.trim() && !isCaption(anchor)) {
      ev.nearby!.push({ text: anchor.text, method: "docx_anchor_paragraph", source: src(anchor), provenance: "structural", relation: "anchor_paragraph", distance: 0 })
    }
    const near: NearbyCandidate[] = []
    for (const dir of [-1, 1]) {
      for (let step = 1; step <= DOCX_CONTEXT_RULES.adjacentParagraphs; step++) {
        const p = paras[i + dir * step]
        // Stop at section breaks and headings: text beyond them belongs to another topic.
        if (!p || p.section !== anchor.section || p.headingLevel != null) break
        if (isCaption(p) || !p.text.trim()) continue
        near.push({ text: p.text, method: dir < 0 ? "docx_preceding_paragraph" : "docx_following_paragraph", source: src(p), provenance: "derived", relation: "adjacent_paragraph", distance: step })
      }
    }
    ev.nearby!.push(...near)
    if (!anchor.text.trim() && near.some((n) => n.method === "docx_preceding_paragraph") && near.some((n) => n.method === "docx_following_paragraph")) {
      ev.warnings!.push({ code: "BETWEEN_PARAGRAPHS", message: "The image sits between two paragraphs; either may describe it." })
    }

    if (frame) {
      ev.table = {
        tableId: frame.tableId,
        row: frame.row,
        column: frame.column,
        caption: frame.caption,
        headerCells: frame.headerCells,
        cellText: frame.cellText || null,
        rowLabel: frame.rowLabel,
        provenance: "explicit",
        source: { kind: "docx_table_cell", ref: `${part}#${frame.cellRef}` },
      }
    }
    return ev
  }

  visit(layout.body, BODY_PART, [], null, "")
  for (const h of layout.headers) visit(h.blocks, h.part, null, null, "")
  for (const f of layout.footers) visit(f.blocks, f.part, null, null, "")
  return out
}
