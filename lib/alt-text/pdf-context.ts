/**
 * @file lib/alt-text/pdf-context.ts
 * @module Publishing · Alt Text
 * @kind Pure logic (no I/O)
 * @summary Phase 3 Task 9 — turns the existing PDF reader output (`readPdfPackage(..., { collectText })`)
 *   into per-occurrence `ContextEvidence`. Structure-tree links are preferred; untagged pages fall
 *   back to conservative, same-column proximity rules that are always marked `approximate`.
 *   No text is invented, translated or interpreted.
 */

import {
  boxDistance,
  boxHeight,
  boxWidth,
  figureLabel,
  horizontalOverlap,
  normalizeContextText,
  verticalOverlap,
  type Box,
  type CaptionCandidate,
  type ContextEvidence,
  type ContextWarning,
  type NearbyCandidate,
} from "./document-context"
import { normalizePdfImageBounds } from "./image-location"
import type { PdfOccurrence, PdfTextLayout, PdfTextRun } from "./pdf-package"

/** All values are fractions of the visible page (top-left origin). */
export const PDF_CONTEXT_RULES = {
  /** Max vertical gap between an image edge and a caption candidate. */
  captionGap: 0.08,
  /** Max vertical gap for same-column nearby text. */
  nearbyGap: 0.15,
  /** Header/footer band for untagged pages. */
  marginBand: 0.07,
  /** Two candidates within this relative distance are a tie. */
  tieRatio: 0.1,
  maxLabelChars: 40,
  maxSamePageBlocks: 2,
} as const

export type PdfTextBlock = {
  text: string
  box: Box
  size: number
  order: number
  role: string | null
  structRef: string | null
  structOrder: number | null
  artifact: boolean
}

const HEADING_ROLE = /^(H([1-6])?|Title)$/

const sameLine = (a: PdfTextRun, b: PdfTextRun) => {
  const h = Math.min(a.box.y1 - a.box.y0, b.box.y1 - b.box.y0)
  return h > 0 && verticalOverlap(a.box, b.box) >= h * 0.5 && b.box.x0 - a.box.x1 < Math.max(a.size, b.size) * 2 && b.box.x0 >= a.box.x0 - a.size
}

/** Runs → lines → blocks, in content-stream order. Blocks never span different structure elements. */
export function groupPdfTextBlocks(runs: PdfTextRun[], roles: PdfTextLayout["roles"], pageRef: string | null): PdfTextBlock[] {
  const roleOf = (r: PdfTextRun) => (pageRef && r.mcid != null ? roles.get(`${pageRef}#${r.mcid}`) ?? null : null)
  type Line = { runs: PdfTextRun[]; box: Box; size: number; roleKey: string | null }
  const lines: Line[] = []
  for (const run of [...runs].sort((a, b) => a.order - b.order)) {
    if (!normalizeContextText(run.text)) continue
    const role = roleOf(run)
    const roleKey = role ? (role.structRef ?? `${role.role}:${role.order}`) : null
    const last = lines[lines.length - 1]
    const prev = last?.runs[last.runs.length - 1]
    if (last && prev && last.roleKey === roleKey && sameLine(prev, run)) {
      last.runs.push(run)
      last.box = { x0: Math.min(last.box.x0, run.box.x0), y0: Math.min(last.box.y0, run.box.y0), x1: Math.max(last.box.x1, run.box.x1), y1: Math.max(last.box.y1, run.box.y1) }
      last.size = Math.max(last.size, run.size)
    } else {
      lines.push({ runs: [run], box: { ...run.box }, size: run.size, roleKey })
    }
  }

  const blocks: (PdfTextBlock & { roleKey: string | null; lines: number })[] = []
  for (const line of lines) {
    const text = line.runs.map((r) => r.text).join(" ")
    const first = line.runs[0]
    const role = roleOf(first)
    const artifact = line.runs.every((r) => r.artifact)
    const last = blocks[blocks.length - 1]
    const gap = last ? line.box.y0 - last.box.y1 : Infinity
    const joinable =
      last &&
      last.roleKey === line.roleKey &&
      last.artifact === artifact &&
      gap >= -line.size * 0.3 &&
      gap < line.size * 1.2 &&
      Math.abs(last.size - line.size) <= Math.max(last.size, line.size) * 0.2 &&
      horizontalOverlap(last.box, line.box) > 0
    if (joinable) {
      last.text += `\n${text}`
      last.box = { x0: Math.min(last.box.x0, line.box.x0), y0: Math.min(last.box.y0, line.box.y0), x1: Math.max(last.box.x1, line.box.x1), y1: Math.max(last.box.y1, line.box.y1) }
      last.lines++
    } else {
      blocks.push({ text, box: line.box, size: line.size, order: first.order, role: role?.role ?? null, structRef: role?.structRef ?? null, structOrder: role?.order ?? null, artifact, roleKey: line.roleKey, lines: 1 })
    }
  }
  return blocks.map(({ roleKey: _r, lines: _l, ...b }) => ({ ...b, text: normalizeContextText(b.text) })).filter((b) => b.text)
}

type PageModel = {
  pageIndex: number
  tagged: boolean
  /** Normalized (0–1) boxes are only available on unrotated pages with decodable text. */
  spatial: boolean
  blocks: (PdfTextBlock & { nbox: Box })[]
  multiColumn: boolean
  undecodable: number
}

function detectMultiColumn(blocks: { nbox: Box }[]): boolean {
  const wide = blocks.filter((b) => boxHeight(b.nbox) > 0.03)
  for (let i = 0; i < wide.length; i++)
    for (let j = i + 1; j < wide.length; j++) {
      const a = wide[i].nbox
      const b = wide[j].nbox
      if (horizontalOverlap(a, b) === 0 && verticalOverlap(a, b) > Math.min(boxHeight(a), boxHeight(b)) * 0.5) return true
    }
  return false
}

const blockRef = (p: number, b: PdfTextBlock) => b.structRef ?? `p${p + 1}:t${b.order}`

/**
 * Build evidence for every occurrence. Text is grouped once per page (not per image), and headings are
 * resolved once for the whole document.
 */
export function buildPdfContextEvidence(occurrences: PdfOccurrence[], layout: PdfTextLayout | null | undefined): Map<string, ContextEvidence> {
  const R = PDF_CONTEXT_RULES
  const out = new Map<string, ContextEvidence>()
  const pages = new Map<number, PageModel>()
  const taggedDoc = occurrences.some((o) => o.structure.association !== "untagged")

  for (const page of layout?.pages ?? []) {
    const spatial = (page.rotate || 0) % 360 === 0 && page.width > 0 && page.height > 0
    const blocks = groupPdfTextBlocks(page.runs, layout!.roles, page.pageRef).map((b) => ({
      ...b,
      nbox: spatial ? { x0: b.box.x0 / page.width, y0: b.box.y0 / page.height, x1: b.box.x1 / page.width, y1: b.box.y1 / page.height } : { x0: 0, y0: 0, x1: 0, y1: 0 },
    }))
    pages.set(page.pageIndex, { pageIndex: page.pageIndex, tagged: taggedDoc, spatial, blocks, multiColumn: spatial && detectMultiColumn(blocks), undecodable: page.undecodable })
  }

  // Body size (the font size carrying the most characters) drives the untagged heading heuristic.
  const charsBySize = new Map<number, number>()
  for (const p of pages.values()) for (const b of p.blocks) if (!b.artifact) charsBySize.set(Math.round(b.size * 2) / 2, (charsBySize.get(Math.round(b.size * 2) / 2) ?? 0) + b.text.length)
  const body = [...charsBySize.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 0
  const isHeaderFooter = (p: PageModel, b: PageModel["blocks"][number]) =>
    b.artifact || (!b.role && p.spatial && b.text.length <= 120 && (b.nbox.y1 <= R.marginBand || b.nbox.y0 >= 1 - R.marginBand))
  const headingLevel = (p: PageModel, b: PageModel["blocks"][number]): number | null | undefined => {
    if (b.role) {
      const m = HEADING_ROLE.exec(b.role)
      if (!m) return undefined
      return b.role === "Title" ? 0 : m[2] ? Number(m[2]) : null
    }
    if (p.tagged || isHeaderFooter(p, b)) return undefined
    if (body > 0 && b.size >= body * 1.3 && b.text.length <= 120 && !/[.;:]$/.test(b.text) && !figureLabel(b.text)) {
      return b.size >= body * 1.8 ? 1 : b.size >= body * 1.5 ? 2 : 3
    }
    return undefined
  }

  type HeadingEntry = { pageIndex: number; y: number; order: number; level: number | null; text: string; ref: string; tagged: boolean }
  const headings: HeadingEntry[] = []
  for (const p of [...pages.values()].sort((a, b) => a.pageIndex - b.pageIndex)) {
    for (const b of p.blocks) {
      const level = headingLevel(p, b)
      if (level === undefined) continue
      headings.push({ pageIndex: p.pageIndex, y: b.nbox.y0, order: b.order, level, text: b.text, ref: blockRef(p.pageIndex, b), tagged: !!b.role })
    }
  }

  // Image boxes on each page, for caption sharing and multi-image warnings.
  const imageBox = new Map<string, Box | null>()
  for (const o of occurrences) {
    const p = pages.get(o.pageIndex)
    if (!p?.spatial) {
      imageBox.set(o.sourceLocator, null)
      continue
    }
    const g = normalizePdfImageBounds({ ctm: o.ctm, pageBox: o.pageBox, rotate: o.rotate, clip: o.clip, formDepth: o.parentForms.length })
    const b = g.bounds ?? g.fullBounds
    imageBox.set(o.sourceLocator, b ? { x0: b.x, y0: b.y, x1: b.x + b.width, y1: b.y + b.height } : null)
  }
  const onPage = new Map<number, PdfOccurrence[]>()
  for (const o of occurrences) if (!o.problem && !o.artifact) onPage.set(o.pageIndex, [...(onPage.get(o.pageIndex) ?? []), o])
  // Images take part in column detection: text beside an image is another column, not the image's.
  for (const [pageIndex, list] of onPage) {
    const p = pages.get(pageIndex)
    if (!p?.spatial || p.multiColumn) continue
    const boxes = list.map((o) => imageBox.get(o.sourceLocator)).filter((b): b is Box => !!b)
    p.multiColumn = detectMultiColumn([...p.blocks, ...boxes.map((nbox) => ({ nbox }))])
  }

  const vgap = (img: Box, b: Box) => (b.y0 >= img.y1 ? b.y0 - img.y1 : img.y0 >= b.y1 ? img.y0 - b.y1 : 0)
  const sameColumn = (img: Box, b: Box) => horizontalOverlap(img, b) >= Math.min(boxWidth(img), boxWidth(b)) * 0.3

  for (const o of occurrences) {
    const p = pages.get(o.pageIndex)
    const box = imageBox.get(o.sourceLocator) ?? null
    const warnings: ContextWarning[] = []
    const ev: ContextEvidence = {
      location: { page: o.pageNumber, label: o.pageLabel ? `Page ${o.pageNumber} (${o.pageLabel})` : `Page ${o.pageNumber}` },
      readingOrder: { index: o.structure.figureOrder ?? o.occurrenceIndex, basis: o.structure.figureOrder != null ? "pdf_structure_tree" : "pdf_content_stream", verified: o.structure.figureOrder != null },
      warnings,
    }
    out.set(o.sourceLocator, ev)

    if (layout?.title) ev.documentTitle = { text: layout.title, method: "pdf_info_title", source: { kind: "pdf_metadata", ref: "Info/Title" }, provenance: "explicit" }
    const alt = o.structure.alt ?? o.structure.markedContentAlt
    if (alt) ev.existingAlt = { text: alt, source: { kind: o.structure.alt ? "pdf_struct" : "pdf_marked_content", ref: o.structure.structRef } }

    const captions: CaptionCandidate[] = []
    if (o.structure.caption?.text) {
      captions.push({ text: o.structure.caption.text, method: "pdf_struct_caption_child", source: { kind: "pdf_struct", ref: o.structure.caption.structRef }, provenance: "explicit", captionSource: "accessible_structure", sharedWith: 1 })
    }

    if (o.structure.association === "untagged") warnings.push({ code: "UNTAGGED_PDF", message: "This PDF has no accessibility tags; text associations use page layout and are approximate." })
    if (ev.readingOrder && !ev.readingOrder.verified) warnings.push({ code: "READING_ORDER_UNVERIFIED", message: "Reading order follows the drawing order on the page, which may differ from the visual order." })
    if (o.structure.association === "ambiguous") warnings.push({ code: "CAPTION_CANDIDATES_CONFLICT", message: "The image is linked to more than one Figure element in the document structure." })

    // Headings preceding the image, in document order, resolved to a hierarchy chain.
    const imageY = box?.y0 ?? 1
    const before = headings.filter((h) => h.pageIndex < o.pageIndex || (h.pageIndex === o.pageIndex && (p?.spatial ? h.y < imageY : false)))
    const chain: HeadingEntry[] = []
    for (let i = before.length - 1; i >= 0 && chain.length < 4; i--) {
      const h = before[i]
      const top = chain[0]
      if (!top) chain.unshift(h)
      else if (h.level != null && top.level != null && h.level < top.level) chain.unshift(h)
      if (chain[0].level === 0 || chain[0].level === 1) break
    }
    ev.headings = chain
      .filter((h) => h.level !== 0)
      .map((h) => ({ text: h.text, level: h.level, method: h.tagged ? "pdf_struct_heading" : "pdf_font_size_heading", source: { kind: h.tagged ? "pdf_struct" : "pdf_text_block", ref: h.ref }, provenance: h.tagged ? "structural" : "approximate" }))
    const titleHeading = chain.find((h) => h.level === 0)
    if (titleHeading && !ev.documentTitle) ev.documentTitle = { text: titleHeading.text, method: "pdf_struct_title", source: { kind: "pdf_struct", ref: titleHeading.ref }, provenance: "structural" }

    if (!p) {
      if (!layout) warnings.push({ code: "TEXT_UNREADABLE", message: "Page text was not read for this document." })
      ev.captions = captions
      continue
    }
    if (p.blocks.length === 0 && p.undecodable > 0) warnings.push({ code: "TEXT_UNREADABLE", message: "Text on this page uses fonts that cannot be decoded without OCR." })
    if (!box) {
      warnings.push({ code: "GEOMETRY_UNAVAILABLE", message: "The image position on the page is not reliably known, so nearby text was not associated." })
      ev.captions = captions
      continue
    }
    if (p.multiColumn) warnings.push({ code: "MULTI_COLUMN_LAYOUT", message: "This page has multiple text columns; only text in the image's column was used." })

    const others = (onPage.get(o.pageIndex) ?? []).filter((x) => x.sourceLocator !== o.sourceLocator).map((x) => imageBox.get(x.sourceLocator)).filter((b): b is Box => !!b)
    if (others.some((b) => boxDistance(b, box) < R.nearbyGap)) warnings.push({ code: "MULTIPLE_IMAGES_NEARBY", message: "Other images are close to this one; nearby text may describe a different image." })
    const allBoxes = [box, ...others]
    const closestCount = (b: Box) => {
      const d = allBoxes.map((ib) => boxDistance(ib, b))
      const mine = d[0]
      const best = Math.min(...d)
      if (mine > best + R.tieRatio * Math.max(best, 0.01)) return 0
      return d.filter((x) => x <= best + R.tieRatio * Math.max(best, 0.01)).length
    }

    const nearby: NearbyCandidate[] = []
    const labels: NonNullable<ContextEvidence["labels"]> = []
    const headingRefs = new Set(headings.map((h) => h.ref))
    let samePage = 0
    for (const b of p.blocks) {
      if (isHeaderFooter(p, b) || headingRefs.has(blockRef(p.pageIndex, b))) continue
      const ref = { kind: b.role ? "pdf_struct" : "pdf_text_block", ref: blockRef(p.pageIndex, b) }
      const inside = horizontalOverlap(box, b.nbox) > 0 && verticalOverlap(box, b.nbox) > 0
      if (inside && b.text.length <= R.maxLabelChars) {
        labels.push({ text: b.text, method: "pdf_text_over_image", source: ref, provenance: "approximate", distance: 0 })
        continue
      }
      const gap = vgap(box, b.nbox)
      const column = sameColumn(box, b.nbox)
      const share = closestCount(b.nbox)
      const isCaptionRole = b.role === "Caption"
      if ((figureLabel(b.text) || isCaptionRole) && column && gap <= R.captionGap && share > 0) {
        captions.push({
          text: b.text,
          method: isCaptionRole ? "pdf_struct_caption_adjacent" : b.nbox.y0 >= box.y1 ? "spatial_below_labelled" : "spatial_above_labelled",
          source: ref,
          provenance: isCaptionRole ? "derived" : "approximate",
          captionSource: isCaptionRole ? "accessible_structure" : "proximity",
          sharedWith: share,
        })
        continue
      }
      if (column && gap <= R.nearbyGap && share > 0) {
        nearby.push({ text: b.text, method: b.nbox.y0 >= box.y1 ? "spatial_below" : b.nbox.y1 <= box.y0 ? "spatial_above" : "spatial_beside", source: ref, provenance: "approximate", relation: "spatial_adjacent", distance: gap })
      } else if (!p.multiColumn && others.length === 0 && samePage < R.maxSamePageBlocks && b.text.length > R.maxLabelChars) {
        samePage++
        nearby.push({ text: b.text, method: "same_page", source: ref, provenance: "approximate", relation: "same_page", distance: boxDistance(box, b.nbox) })
      }
    }
    ev.captions = captions
    ev.nearby = nearby
    ev.labels = labels
  }
  return out
}
