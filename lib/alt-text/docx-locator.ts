/**
 * @file lib/alt-text/docx-locator.ts
 * @module Publishing · Alt Text
 * @kind Pure domain logic (browser-safe, no I/O)
 * @summary Phase 3 Task 15 — the DOCX picture-occurrence source-locator contract shared by the
 *   (future) DOCX extractor and the Alt Text inserter.
 *
 *   docx:<part>#drawing=<ordinal>;docPr=<id>;rel=<rId>
 *
 *   - part     lower-cased package part name (word/document.xml, word/header2.xml, …)
 *   - ordinal  1-based position of the `w:drawing` element among all `w:drawing` elements of that
 *              part in document order, excluding copies inside `mc:Fallback` (those duplicate the
 *              `mc:Choice` content for older readers)
 *   - docPr    `wp:docPr/@id` of that drawing
 *   - rel      `a:blip/@r:embed` relationship id of the picture
 *
 *   All three must agree with the source XML for an insertion to happen; the binary hash and media
 *   filename are never used to locate an element, so one media file used by several pictures is
 *   mapped per occurrence.
 */

export type DocxLocator = { part: string; ordinal: number; docPrId: string; relId: string }

export const DOCX_LOCATOR_PARTS = /^word\/(document|header\d{0,3}|footer\d{0,3}|footnotes|endnotes)\.xml$/

const LOCATOR = /^docx:([a-z0-9/._-]{1,120})#drawing=([1-9]\d{0,5});docPr=(\d{1,10});rel=([A-Za-z_][\w.-]{0,63})$/

export function parseDocxLocator(raw: string): DocxLocator | null {
  const m = LOCATOR.exec(raw.trim())
  if (!m || !DOCX_LOCATOR_PARTS.test(m[1])) return null
  return { part: m[1], ordinal: Number(m[2]), docPrId: m[3], relId: m[4] }
}

export function formatDocxLocator(l: DocxLocator): string {
  return `docx:${l.part.toLowerCase()}#drawing=${l.ordinal};docPr=${l.docPrId};rel=${l.relId}`
}

/** Header/footer/body/notes classification for reports (structural location, never a page number). */
export function docxPartRegion(part: string): "body" | "header" | "footer" | "footnotes" | "endnotes" {
  if (part.startsWith("word/header")) return "header"
  if (part.startsWith("word/footer")) return "footer"
  if (part === "word/footnotes.xml") return "footnotes"
  if (part === "word/endnotes.xml") return "endnotes"
  return "body"
}
