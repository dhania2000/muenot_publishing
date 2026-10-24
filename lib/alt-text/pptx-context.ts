/**
 * @file lib/alt-text/pptx-context.ts
 * @module Publishing · Alt Text
 * @kind Pure logic (no I/O)
 * @summary Phase 3 Task 9 — turns the existing PPTX reader output (`readPptxPackage(..., { collectText })`)
 *   into per-picture `ContextEvidence`. Titles come from placeholders, labels and captions from slide
 *   geometry, and speaker notes are kept separate from displayed slide content. Shape order is never
 *   treated as verified reading order.
 */

import {
  boxDistance,
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
import type { PptxOccurrence, PptxTextLayout, PptxTextShape } from "./pptx-package"

/** Fractions of the slide (top-left origin). */
export const PPTX_CONTEXT_RULES = {
  captionGap: 0.1,
  labelDistance: 0.12,
  nearbyDistance: 0.25,
  tieRatio: 0.1,
  maxLabelChars: 80,
} as const

const TITLE_PH = new Set(["title", "ctrTitle"])
const SUBTITLE_PH = new Set(["subTitle"])
const NON_CONTENT_PH = new Set(["dt", "ftr", "sldNum", "hdr"])

const shapeText = (s: PptxTextShape) => normalizeContextText(s.paragraphs.join("\n"))
const shapeRef = (part: string, s: PptxTextShape) => `${part}#sp:${s.shapeId ?? `o${s.order}`}`

export function buildPptxContextEvidence(occurrences: PptxOccurrence[], layout: PptxTextLayout | null | undefined): Map<string, ContextEvidence> {
  const R = PPTX_CONTEXT_RULES
  const out = new Map<string, ContextEvidence>()
  const slides = new Map((layout?.slides ?? []).map((s) => [s.slidePart, s]))

  for (const o of occurrences) {
    const warnings: ContextWarning[] = []
    const ev: ContextEvidence = {
      location: { slide: o.slideNumber, part: o.slidePart, label: `Slide ${o.slideNumber}` },
      readingOrder: { index: o.occurrenceIndex, basis: "pptx_shape_tree", verified: false },
      warnings,
    }
    out.set(o.sourceLocator, ev)
    if (layout?.title) ev.documentTitle = { text: layout.title, method: "ooxml_core_title", source: { kind: "pptx_core_properties", ref: "docProps/core.xml#dc:title" }, provenance: "explicit" }
    if (o.description) ev.existingAlt = { text: o.description, source: { kind: "pptx_picture", ref: `${o.slidePart}#pic:${o.shapeId ?? ""}` } }

    const captions: CaptionCandidate[] = []
    if (o.title && figureLabel(normalizeContextText(o.title))) {
      captions.push({ text: o.title, method: "pptx_picture_title", source: { kind: "pptx_picture", ref: `${o.slidePart}#pic:${o.shapeId ?? ""}` }, provenance: "derived", captionSource: "shape_metadata", sharedWith: 1 })
    }

    const slide = slides.get(o.slidePart)
    if (!slide) {
      ev.captions = captions
      continue
    }
    if (slide.section) ev.sectionName = { text: slide.section, method: "pptx_section", source: { kind: "pptx_section", ref: slide.section }, provenance: "structural" }
    if (slide.notes) ev.speakerNotes = { text: slide.notes, method: "pptx_notes_slide", source: { kind: "pptx_notes", ref: o.slidePart }, provenance: "explicit" }

    const content: PptxTextShape[] = []
    for (const s of slide.shapes) {
      const text = shapeText(s)
      if (!text) continue
      if (s.placeholder && TITLE_PH.has(s.placeholder)) {
        ev.pageTitle ??= { text, method: `pptx_placeholder_${s.placeholder}`, source: { kind: "pptx_shape", ref: shapeRef(o.slidePart, s) }, provenance: "structural" }
      } else if (s.placeholder && SUBTITLE_PH.has(s.placeholder)) {
        ev.subtitle ??= { text, method: "pptx_placeholder_subTitle", source: { kind: "pptx_shape", ref: shapeRef(o.slidePart, s) }, provenance: "structural" }
      } else if (!s.placeholder || !NON_CONTENT_PH.has(s.placeholder)) {
        content.push(s)
      }
    }

    const pictures = [...slide.pictures.entries()]
    const box = (slide.pictures.get(o.sourceLocator)?.box ?? null) as Box | null
    const otherBoxes = pictures.filter(([k]) => k !== o.sourceLocator).map(([, v]) => v.box as Box | null)
    if (pictures.length > 1) {
      warnings.push({ code: "MULTIPLE_IMAGES_NEARBY", message: `This slide has ${pictures.length} pictures; only text closest to this picture was associated with it.` })
    }
    if (!box) {
      warnings.push({ code: "GEOMETRY_UNAVAILABLE", message: "The picture position is inherited or unknown, so slide text was not associated by position." })
      ev.captions = captions
      continue
    }
    const known = otherBoxes.filter((b): b is Box => !!b)
    if (known.length < otherBoxes.length) warnings.push({ code: "GEOMETRY_UNAVAILABLE", message: "Some other pictures on this slide have no known position; associations may be incomplete." })
    const all = [box, ...known]
    const shareOf = (b: Box) => {
      const d = all.map((ib) => boxDistance(ib, b))
      const best = Math.min(...d)
      const slack = R.tieRatio * Math.max(best, 0.01)
      return d[0] > best + slack ? 0 : d.filter((x) => x <= best + slack).length
    }

    const nearby: NearbyCandidate[] = []
    const labels: NonNullable<ContextEvidence["labels"]> = []
    for (const s of content) {
      const text = shapeText(s)
      const src = { kind: "pptx_shape", ref: shapeRef(o.slidePart, s) }
      if (!s.box) continue
      const sb = s.box as Box
      const dist = boxDistance(box, sb)
      const share = shareOf(sb)
      if (share === 0) continue
      const gap = sb.y0 >= box.y1 ? sb.y0 - box.y1 : box.y0 >= sb.y1 ? box.y0 - sb.y1 : Infinity
      const column = horizontalOverlap(box, sb) >= Math.min(boxWidth(box), boxWidth(sb)) * 0.3
      if (figureLabel(text) && column && gap <= R.captionGap) {
        captions.push({ text, method: sb.y0 >= box.y1 ? "spatial_below_labelled" : "spatial_above_labelled", source: src, provenance: "approximate", captionSource: "proximity", sharedWith: share })
      } else if (text.length <= R.maxLabelChars && dist <= R.labelDistance) {
        const over = horizontalOverlap(box, sb) > 0 && verticalOverlap(box, sb) > 0
        labels.push({ text, method: over ? "pptx_text_over_picture" : "pptx_text_near_picture", source: src, provenance: "approximate", distance: dist })
      } else if (dist <= R.nearbyDistance) {
        nearby.push({ text, method: "pptx_spatial_adjacent", source: src, provenance: "approximate", relation: "spatial_adjacent", distance: dist })
      } else if (pictures.length === 1) {
        nearby.push({ text, method: "pptx_same_slide", source: src, provenance: "approximate", relation: "same_page", distance: dist })
      }
    }
    ev.captions = captions
    ev.nearby = nearby
    ev.labels = labels
  }
  return out
}
