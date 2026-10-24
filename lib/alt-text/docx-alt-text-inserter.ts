/**
 * @file lib/alt-text/docx-alt-text-inserter.ts
 * @module Publishing · Alt Text
 * @kind Server-side library (pure, no I/O)
 * @summary Phase 3 Task 15 — writes approved alt text into a copy of a DOCX package.
 *
 *   Each instruction names one picture occurrence by its `docx-locator` source locator. The
 *   inserter resolves part + drawing ordinal + `wp:docPr/@id` + `a:blip/@r:embed`, and only when all
 *   agree does it change that drawing's `wp:docPr/@descr` (and the matching `pic:cNvPr/@descr`).
 *   Decorative approvals remove the description and set the Office decorative extension
 *   (`adec:decorative val="1"`) inside `wp:docPr/a:extLst`. Nothing else in the XML is rewritten:
 *   edits are applied as exact string splices, and unmodified ZIP entries are copied byte-for-byte.
 *
 *   Never guesses: anything ambiguous, stale, nested in a text box, linked, chart/SmartArt/shape,
 *   legacy VML, or inside a signed package is reported, not modified.
 */
import "server-only"
import { XMLValidator } from "fast-xml-parser"
import { DOCX_LOCATOR_PARTS, docxPartRegion, parseDocxLocator, type DocxLocator } from "./docx-locator"
import { asValidationRejection, readZipDirectory, readZipEntryBytes, resolvePartTarget, validateDocumentBytes, type ZipEntry } from "./document-validation"
import { rawEntryMap, rewriteZipEntries } from "./ooxml-zip-rewrite"

export type DocxInsertInstruction = { occurrenceId: number; sourceLocator: string; text: string; decorative: boolean }

export type DocxInsertItemStatus = "updated" | "unchanged" | "unsupported" | "failed"

export type DocxInsertItem = {
  occurrenceId: number
  sourceLocator: string
  status: DocxInsertItemStatus
  code: string
  message: string
  region: ReturnType<typeof docxPartRegion> | null
  placement: "inline" | "floating" | null
  previousDescription: string | null
  decorative: boolean
}

export type DocxInsertWarning = { code: string; message: string }

export type DocxInsertReport = {
  items: DocxInsertItem[]
  updated: number
  unchanged: number
  unsupported: number
  failed: number
  partsModified: string[]
  pictureCount: number
  uniqueMediaCount: number
  existingAltTextPreserved: number
  textboxPictureCount: number
  legacyVmlCount: number
  warnings: DocxInsertWarning[]
}

export type DocxInsertFailureCode = "INVALID_DOCUMENT" | "SIGNED_DOCUMENT" | "OUTPUT_TOO_LARGE" | "VERIFICATION_FAILED"

export type DocxInsertResult =
  | { ok: true; output: Buffer | null; report: DocxInsertReport }
  | { ok: false; code: DocxInsertFailureCode; message: string }

export const DOCX_INSERT_LIMITS = { maxPartBytes: 32 * 1024 * 1024, maxTextChars: 4000 } as const

const NS = {
  w: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  mc: "http://schemas.openxmlformats.org/markup-compatibility/2006",
  wp: "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  pic: "http://schemas.openxmlformats.org/drawingml/2006/picture",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
} as const
const ADEC = "http://schemas.microsoft.com/office/drawing/2017/decorative"
const DECORATIVE_URI = "{C183D7F6-B498-43B3-948B-1728B52AA6E4}"
const IMAGE_REL = /\/relationships\/image$/
const PART_REL = /\/relationships\/(header|footer|footnotes|endnotes)$/

/* ---------- XML primitives ---------- */

type Span = { start: number; end: number }
type Tag = Span & { text: string; selfClosing: boolean; name: string }

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")
const NEVER = "(?!)"
const alt = (prefixes: string[]) => (prefixes.length ? prefixes.map(escapeRe).join("|") : NEVER)

/** Blank comments, CDATA and PIs (same length) so tag scanning never matches inside them. */
const maskNonMarkup = (xml: string) => xml.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>/g, (m) => " ".repeat(m.length))

/** prefix → namespace URI across the whole part, or null when a prefix is bound to two URIs. */
function collectPrefixes(masked: string): Map<string, string> | null {
  const map = new Map<string, string>()
  for (const m of masked.matchAll(/xmlns:([\w.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const uri = m[2] ?? m[3] ?? ""
    const prev = map.get(m[1])
    if (prev !== undefined && prev !== uri) return null
    map.set(m[1], uri)
  }
  return map
}

const prefixesFor = (map: Map<string, string>, uri: string) => [...map].filter(([, u]) => u === uri).map(([p]) => p)

function tagRe(prefixes: string[], local: string, closing = false) {
  return new RegExp(`<${closing ? "\\/" : ""}(${alt(prefixes)}):${local}(?=[\\s/>])[^>]*?(\\/?)>`, "g")
}

/** Element spans for a (possibly nested) element type, in document order of start tags. */
function elementSpans(masked: string, prefixes: string[], local: string): Span[] {
  const re = new RegExp(`<(\\/?)(?:${alt(prefixes)}):${local}(?=[\\s/>])[^>]*?(\\/?)>`, "g")
  const stack: number[] = []
  const spans: Span[] = []
  for (const m of masked.matchAll(re)) {
    const at = m.index ?? 0
    if (m[1]) {
      const start = stack.pop()
      if (start === undefined) throw new Error("unbalanced")
      spans.push({ start, end: at + m[0].length })
    } else if (m[2]) spans.push({ start: at, end: at + m[0].length })
    else stack.push(at)
  }
  if (stack.length) throw new Error("unbalanced")
  return spans.sort((x, y) => x.start - y.start)
}

const within = (pos: number, spans: Span[]) => spans.some((s) => pos >= s.start && pos < s.end)

function tagsIn(xml: string, masked: string, re: RegExp, region: Span, exclude: Span[]): Tag[] {
  const out: Tag[] = []
  re.lastIndex = region.start
  for (let m = re.exec(masked); m && m.index < region.end; m = re.exec(masked)) {
    if (within(m.index, exclude)) continue
    const text = xml.slice(m.index, m.index + m[0].length)
    out.push({ start: m.index, end: m.index + m[0].length, text, selfClosing: m[2] === "/", name: `${m[1]}:` })
  }
  return out
}

function attrs(tagText: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const a of tagText.matchAll(/\s([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out.set(a[1], a[2] ?? a[3] ?? "")
  return out
}

function decodeXml(v: string): string {
  return v.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_, e: string) => {
    const k = e.toLowerCase()
    if (k === "lt") return "<"
    if (k === "gt") return ">"
    if (k === "amp") return "&"
    if (k === "quot") return '"'
    if (k === "apos") return "'"
    const code = k.startsWith("#x") ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10)
    return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : ""
  })
}

const escapeAttr = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/** Set (or remove with null) an unprefixed attribute, touching nothing else in the start tag. */
function setAttr(tagText: string, name: string, value: string | null): string {
  const re = new RegExp(`(\\s)${escapeRe(name)}\\s*=\\s*(?:"[^"]*"|'[^']*')`)
  if (re.test(tagText)) return value === null ? tagText.replace(new RegExp(`\\s+${escapeRe(name)}\\s*=\\s*(?:"[^"]*"|'[^']*')`), "") : tagText.replace(re, `$1${name}="${escapeAttr(value)}"`)
  if (value === null) return tagText
  return tagText.replace(/\s*(\/?)>$/, ` ${name}="${escapeAttr(value)}"$1>`)
}

export function normalizeAltText(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

/* ---------- Package model ---------- */

type Drawing = {
  ordinal: number | null
  span: Span
  nested: boolean
  placement: "inline" | "floating" | null
  docPr: Tag | null
  docPrEnd: number
  docPrInner: Span | null
  docPrId: string | null
  descr: string | null
  decorativeTag: Tag | null
  extLstClose: Tag | null
  cNvPr: Tag | null
  isPicture: boolean
  blipEmbed: string | null
  blipLinked: boolean
  blipCount: number
}

type PartModel = {
  name: string
  xml: string
  drawings: Drawing[]
  rels: Map<string, { type: string; target: string; external: boolean }>
  legacyVml: number
}

class PartError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

function relsPathFor(part: string) {
  const i = part.lastIndexOf("/")
  return `${part.slice(0, i)}/_rels/${part.slice(i + 1)}.rels`
}

function parseRels(xml: string | null, baseDir: string) {
  const rels = new Map<string, { type: string; target: string; external: boolean }>()
  if (!xml) return rels
  for (const m of maskNonMarkup(xml).matchAll(/<(?:[\w-]+:)?Relationship\b[^>]*>/g)) {
    const a = attrs(m[0])
    const id = a.get("Id")
    if (!id) continue
    const external = (a.get("TargetMode") ?? "").toLowerCase() === "external"
    const target = external ? (a.get("Target") ?? "") : (resolvePartTarget(baseDir, a.get("Target") ?? "") ?? "")
    rels.set(id, { type: a.get("Type") ?? "", target, external })
  }
  return rels
}

function modelPart(name: string, xml: string, relsXml: string | null): PartModel {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new PartError("UNSAFE_XML", "The part contains disallowed XML declarations.")
  const decl = /^\uFEFF?<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i.exec(xml)
  if (decl && !/^utf-?8$/i.test(decl[1])) throw new PartError("UNSUPPORTED_ENCODING", "The part does not use UTF-8 encoding.")
  const masked = maskNonMarkup(xml)
  const map = collectPrefixes(masked)
  if (!map) throw new PartError("UNSUPPORTED_STRUCTURE", "The part re-binds an XML prefix to different namespaces.")
  const P = {
    w: prefixesFor(map, NS.w),
    mc: prefixesFor(map, NS.mc),
    wp: prefixesFor(map, NS.wp),
    a: prefixesFor(map, NS.a),
    pic: prefixesFor(map, NS.pic),
    r: prefixesFor(map, NS.r),
  }
  let drawingSpans: Span[]
  let fallbackSpans: Span[]
  try {
    drawingSpans = elementSpans(masked, P.w, "drawing")
    fallbackSpans = elementSpans(masked, P.mc, "Fallback")
  } catch {
    throw new PartError("INVALID_XML", "The part's drawing markup is not well formed.")
  }

  const containerRe = new RegExp(`<(?:${alt(P.wp)}):(inline|anchor)(?=[\\s/>])`, "g")
  const docPrRe = tagRe(P.wp, "docPr")
  const blipRe = tagRe(P.a, "blip")
  const picRe = tagRe(P.pic, "pic")
  const cNvPrRe = tagRe(P.pic, "cNvPr")
  const embedAttr = (a: Map<string, string>, local: string) => P.r.map((p) => a.get(`${p}:${local}`)).find((v) => v !== undefined) ?? null

  let ordinal = 0
  const drawings: Drawing[] = drawingSpans.map((span) => {
    const children = drawingSpans.filter((s) => s !== span && s.start > span.start && s.end <= span.end)
    const nested = drawingSpans.some((s) => s !== span && s.start < span.start && s.end >= span.end)
    const inFallback = within(span.start, fallbackSpans)
    containerRe.lastIndex = span.start
    let placement: Drawing["placement"] = null
    for (let m = containerRe.exec(masked); m && m.index < span.end; m = containerRe.exec(masked)) {
      if (within(m.index, children)) continue
      placement = m[1] === "inline" ? "inline" : "floating"
      break
    }
    const docPr = tagsIn(xml, masked, docPrRe, span, children)[0] ?? null
    let docPrEnd = docPr?.end ?? 0
    let docPrInner: Span | null = null
    let decorativeTag: Tag | null = null
    let extLstClose: Tag | null = null
    if (docPr && !docPr.selfClosing) {
      const close = masked.indexOf(`</${docPr.name}docPr>`, docPr.end)
      if (close < 0 || close > span.end) throw new PartError("INVALID_XML", "A drawing's properties are not well formed.")
      docPrInner = { start: docPr.end, end: close }
      docPrEnd = close + `</${docPr.name}docPr>`.length
      const inner = masked.slice(docPrInner.start, docPrInner.end)
      if (inner.includes(DECORATIVE_URI)) {
        const m = /<([\w.-]+:)?decorative(?=[\s/>])[^>]*>/.exec(inner)
        if (m) decorativeTag = { start: docPrInner.start + m.index, end: docPrInner.start + m.index + m[0].length, text: m[0], selfClosing: m[0].endsWith("/>"), name: m[1] ?? "" }
      }
      const lst = /<\/([\w.-]+:)?extLst>/.exec(inner)
      if (lst) extLstClose = { start: docPrInner.start + lst.index, end: docPrInner.start + lst.index + lst[0].length, text: lst[0], selfClosing: false, name: lst[1] ?? "" }
    }
    const blips = tagsIn(xml, masked, blipRe, span, children)
    const blipAttrs = blips[0] ? attrs(blips[0].text) : new Map<string, string>()
    const docAttrs = docPr ? attrs(docPr.text) : new Map<string, string>()
    return {
      ordinal: inFallback ? null : ++ordinal,
      span,
      nested,
      placement,
      docPr,
      docPrEnd,
      docPrInner,
      docPrId: docAttrs.get("id") ?? null,
      descr: docAttrs.has("descr") ? decodeXml(docAttrs.get("descr") ?? "") : null,
      decorativeTag,
      extLstClose,
      cNvPr: tagsIn(xml, masked, cNvPrRe, span, children)[0] ?? null,
      isPicture: tagsIn(xml, masked, picRe, span, children).length > 0,
      blipEmbed: embedAttr(blipAttrs, "embed"),
      blipLinked: embedAttr(blipAttrs, "link") !== null,
      blipCount: blips.length,
    }
  })

  const pictRe = new RegExp(`<(?:${alt(P.w)}):pict(?=[\\s/>])`, "g")
  const legacyVml = [...masked.matchAll(pictRe)].filter((m) => !within(m.index ?? 0, fallbackSpans)).length
  const baseDir = name.slice(0, name.lastIndexOf("/"))
  return { name, xml, drawings, rels: parseRels(relsXml, baseDir), legacyVml }
}

const decorativeOn = (d: Drawing) => (d.decorativeTag ? /\bval\s*=\s*["'](1|true|on)["']/i.test(d.decorativeTag.text) : false)

const isSupportedPicture = (d: Drawing, part: PartModel) => {
  if (d.ordinal === null || d.nested || !d.isPicture || d.blipCount !== 1 || !d.blipEmbed || !d.docPr) return false
  const rel = part.rels.get(d.blipEmbed)
  return !!rel && !rel.external && IMAGE_REL.test(rel.type)
}

/* ---------- Edits ---------- */

type Edit = Span & { text: string }

function decorativeExt(val: "1" | "0") {
  return `<a:ext xmlns:a="${NS.a}" uri="${DECORATIVE_URI}"><adec:decorative xmlns:adec="${ADEC}" val="${val}"/></a:ext>`
}

function docPrEdit(part: PartModel, d: Drawing, text: string, decorative: boolean): Edit {
  const docPr = d.docPr as Tag
  const startTag = setAttr(docPr.text, "descr", decorative ? null : text)
  if (decorative) {
    if (d.decorativeTag) {
      const inner = part.xml.slice(docPr.end, d.decorativeTag.start) + setAttr(d.decorativeTag.text, "val", "1") + part.xml.slice(d.decorativeTag.end, d.docPrEnd)
      return { start: docPr.start, end: d.docPrEnd, text: startTag + inner }
    }
    if (d.extLstClose) {
      return { start: docPr.start, end: d.docPrEnd, text: startTag + part.xml.slice(docPr.end, d.extLstClose.start) + decorativeExt("1") + part.xml.slice(d.extLstClose.start, d.docPrEnd) }
    }
    const extLst = `<a:extLst xmlns:a="${NS.a}">${decorativeExt("1")}</a:extLst>`
    if (docPr.selfClosing) return { start: docPr.start, end: d.docPrEnd, text: `${startTag.replace(/\s*\/>$/, ">")}${extLst}</${docPr.name}docPr>` }
    const closeAt = (d.docPrInner as Span).end
    return { start: docPr.start, end: d.docPrEnd, text: startTag + part.xml.slice(docPr.end, closeAt) + extLst + part.xml.slice(closeAt, d.docPrEnd) }
  }
  if (d.decorativeTag && decorativeOn(d)) {
    const inner = part.xml.slice(docPr.end, d.decorativeTag.start) + setAttr(d.decorativeTag.text, "val", "0") + part.xml.slice(d.decorativeTag.end, d.docPrEnd)
    return { start: docPr.start, end: d.docPrEnd, text: startTag + inner }
  }
  return { start: docPr.start, end: docPr.end, text: startTag }
}

function applyEdits(xml: string, edits: Edit[]): string {
  let out = xml
  for (const e of [...edits].sort((x, y) => y.start - x.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end)
  return out
}

/* ---------- Entry point ---------- */

type Plan = { item: DocxInsertItem; part?: PartModel; drawing?: Drawing; text?: string }

function item(ins: DocxInsertInstruction, status: DocxInsertItemStatus, code: string, message: string, extra: Partial<DocxInsertItem> = {}): DocxInsertItem {
  return { occurrenceId: ins.occurrenceId, sourceLocator: ins.sourceLocator, status, code, message, region: null, placement: null, previousDescription: null, decorative: ins.decorative, ...extra }
}

/**
 * Insert approved alt text into a copy of `source`. With `dryRun` the package is analysed and the
 * per-occurrence plan reported, but no output is built.
 */
export function insertDocxAltText(source: Buffer, instructions: DocxInsertInstruction[], opts: { maxOutputBytes: number; dryRun?: boolean }): DocxInsertResult {
  const valid = validateDocumentBytes(source, "docx")
  if (!valid.ok) return { ok: false, code: "INVALID_DOCUMENT", message: valid.message }

  let entries: ZipEntry[]
  try {
    entries = readZipDirectory(source)
  } catch (err) {
    return { ok: false, code: "INVALID_DOCUMENT", message: asValidationRejection(err)?.message ?? "The document package could not be read." }
  }
  const byName = new Map(entries.map((e) => [e.name.toLowerCase(), e]))
  if ([...byName.keys()].some((n) => n.startsWith("_xmlsignatures/"))) {
    return { ok: false, code: "SIGNED_DOCUMENT", message: "This document is digitally signed. Changing it would invalidate the signature, so alt text was not inserted." }
  }
  const text = (name: string): string | null => {
    const e = byName.get(name)
    return e ? readZipEntryBytes(source, e, DOCX_INSERT_LIMITS.maxPartBytes).toString("utf8") : null
  }

  const warnings: DocxInsertWarning[] = []
  const parts = new Map<string, PartModel | PartError>()
  try {
    const settings = text("word/settings.xml")
    if (settings && /<(?:[\w-]+:)?documentProtection\b[^>]*\benforcement\s*=\s*["'](1|true|on)["']/i.test(settings)) {
      warnings.push({ code: "EDITING_RESTRICTIONS_PRESENT", message: "The document has Word editing restrictions. They are kept unchanged in the output." })
    }
    if (settings && /<(?:[\w-]+:)?writeProtection\b/i.test(settings)) {
      warnings.push({ code: "WRITE_PROTECTION_PRESENT", message: "The document recommends read-only opening. This setting is kept unchanged in the output." })
    }
    const mainRels = parseRels(text("word/_rels/document.xml.rels"), "word")
    const partNames = new Set(["word/document.xml"])
    for (const r of mainRels.values()) if (!r.external && PART_REL.test(r.type) && DOCX_LOCATOR_PARTS.test(r.target) && byName.has(r.target)) partNames.add(r.target)
    for (const name of partNames) {
      try {
        parts.set(name, modelPart(name, text(name) ?? "", text(relsPathFor(name))))
      } catch (err) {
        if (err instanceof PartError) parts.set(name, err)
        else throw err
      }
    }
  } catch (err) {
    return { ok: false, code: "INVALID_DOCUMENT", message: asValidationRejection(err)?.message ?? "The document package could not be read." }
  }

  const plans: Plan[] = instructions.map((ins) => {
    const loc: DocxLocator | null = parseDocxLocator(ins.sourceLocator)
    if (!loc) return { item: item(ins, "failed", "INVALID_LOCATOR", "The source location is not a valid Word picture locator.") }
    const region = docxPartRegion(loc.part)
    const part = parts.get(loc.part)
    if (!part) return { item: item(ins, "failed", "PART_NOT_FOUND", "The referenced document part is not in this document.", { region }) }
    if (part instanceof PartError) return { item: item(ins, "unsupported", part.code, part.message, { region }) }
    const d = part.drawings.find((x) => x.ordinal === loc.ordinal)
    if (!d) return { item: item(ins, "failed", "LOCATOR_NOT_FOUND", "The mapped picture was not found at its source location.", { region }) }
    const base = { region, placement: d.placement, previousDescription: d.descr }
    if (!d.docPr || d.docPrId !== loc.docPrId) return { item: item(ins, "failed", "LOCATOR_MISMATCH", "The picture at this location no longer matches the mapped occurrence.", base) }
    if (d.nested) return { item: item(ins, "unsupported", "TEXTBOX_PICTURE", "Pictures inside text boxes or shapes cannot be updated automatically.", base) }
    if (!d.isPicture) return { item: item(ins, "unsupported", "NOT_A_PICTURE", "This drawing is a chart, SmartArt or shape, not a picture.", base) }
    if (d.blipCount !== 1) return { item: item(ins, "unsupported", "UNSUPPORTED_PICTURE", "This drawing does not contain exactly one picture.", base) }
    if (!d.blipEmbed) {
      return { item: item(ins, "unsupported", d.blipLinked ? "LINKED_IMAGE" : "UNSUPPORTED_PICTURE", d.blipLinked ? "Linked (external) pictures are not updated." : "The picture has no embedded image.", base) }
    }
    if (d.blipEmbed !== loc.relId) return { item: item(ins, "failed", "LOCATOR_MISMATCH", "The picture at this location no longer matches the mapped occurrence.", base) }
    const rel = part.rels.get(d.blipEmbed)
    if (!rel || rel.external || !IMAGE_REL.test(rel.type)) return { item: item(ins, "unsupported", "UNSUPPORTED_RELATIONSHIP", "The picture's image relationship is missing or external.", base) }
    if (part.drawings.some((x) => x !== d && x.ordinal !== null && x.docPrId === d.docPrId && x.blipEmbed === d.blipEmbed)) {
      return { item: item(ins, "failed", "AMBIGUOUS_LOCATOR", "More than one picture in this part has the same identifiers.", base) }
    }
    const value = normalizeAltText(ins.text)
    if (!ins.decorative && !value) return { item: item(ins, "failed", "EMPTY_DESCRIPTION", "The approved description is empty.", base) }
    if (value.length > DOCX_INSERT_LIMITS.maxTextChars) return { item: item(ins, "failed", "TEXT_TOO_LONG", "The approved description is too long to insert.", base) }
    const current = ins.decorative ? d.descr === null && decorativeOn(d) : d.descr === value && !decorativeOn(d)
    if (current) return { item: item(ins, "unchanged", "ALREADY_CURRENT", "The document already contains this approved alt text.", base), part, drawing: d }
    return { item: item(ins, "updated", "UPDATED", ins.decorative ? "Marked as decorative." : "Alt text inserted.", base), part, drawing: d, text: value }
  })

  const targets = new Map<Drawing, Plan[]>()
  for (const p of plans) if (p.drawing) targets.set(p.drawing, [...(targets.get(p.drawing) ?? []), p])
  for (const group of targets.values()) {
    if (group.length < 2) continue
    for (const p of group) {
      p.item = { ...p.item, status: "failed", code: "DUPLICATE_OCCURRENCE", message: "Several mapped occurrences point to the same picture." }
      p.text = undefined
      p.drawing = undefined
    }
  }

  const editsByPart = new Map<string, Edit[]>()
  for (const p of plans) {
    if (p.item.status !== "updated" || !p.part || !p.drawing || p.text === undefined) continue
    const d = p.drawing
    const list = editsByPart.get(p.part.name) ?? []
    list.push(docPrEdit(p.part, d, p.text, p.item.decorative))
    if (d.cNvPr) list.push({ start: d.cNvPr.start, end: d.cNvPr.end, text: setAttr(d.cNvPr.text, "descr", p.item.decorative ? null : p.text) })
    if (!p.item.decorative && decorativeOn(d)) warnings.push({ code: "DECORATIVE_FLAG_CLEARED", message: `Occurrence ${p.item.occurrenceId} was marked decorative in the source; the flag was cleared for its approved description.` })
    editsByPart.set(p.part.name, list)
  }

  const editedDrawings = new Set(plans.filter((p) => p.item.status === "updated" && p.drawing).map((p) => p.drawing as Drawing))
  let pictureCount = 0
  let existingAltTextPreserved = 0
  let textboxPictureCount = 0
  let legacyVmlCount = 0
  const media = new Set<string>()
  for (const part of parts.values()) {
    if (part instanceof PartError) continue
    legacyVmlCount += part.legacyVml
    for (const d of part.drawings) {
      if (d.ordinal !== null && d.nested && d.isPicture) textboxPictureCount++
      if (!isSupportedPicture(d, part)) continue
      pictureCount++
      media.add(part.rels.get(d.blipEmbed as string)?.target ?? "")
      if (!editedDrawings.has(d) && d.descr) existingAltTextPreserved++
    }
  }
  if (legacyVmlCount) warnings.push({ code: "LEGACY_VML_PICTURES", message: `${legacyVmlCount} legacy (VML) picture element(s) are not supported and were left unchanged.` })

  const items = plans.map((p) => p.item)
  const count = (s: DocxInsertItemStatus) => items.filter((i) => i.status === s).length
  const report: DocxInsertReport = {
    items,
    updated: count("updated"),
    unchanged: count("unchanged"),
    unsupported: count("unsupported"),
    failed: count("failed"),
    partsModified: [...editsByPart.keys()].sort(),
    pictureCount,
    uniqueMediaCount: media.size,
    existingAltTextPreserved,
    textboxPictureCount,
    legacyVmlCount,
    warnings,
  }
  if (opts.dryRun || editsByPart.size === 0) return { ok: true, output: null, report }

  const replacements = new Map<string, Buffer>()
  const newXml = new Map<string, string>()
  for (const [name, edits] of editsByPart) {
    const part = parts.get(name) as PartModel
    const xml = applyEdits(part.xml, edits)
    newXml.set(name, xml)
    replacements.set(name, Buffer.from(xml, "utf8"))
  }

  let output: Buffer
  try {
    output = rewriteZipEntries(source, replacements)
  } catch {
    return { ok: false, code: "VERIFICATION_FAILED", message: "The updated document package could not be assembled." }
  }
  if (output.length > opts.maxOutputBytes) return { ok: false, code: "OUTPUT_TOO_LARGE", message: "The updated document is larger than the allowed size." }

  const problem = verifyOutput(source, output, parts, newXml, plans)
  if (problem) return { ok: false, code: "VERIFICATION_FAILED", message: problem }
  return { ok: true, output, report }
}

/** Re-open the output and prove only the intended attributes changed. Returns a reason or null. */
function verifyOutput(source: Buffer, output: Buffer, parts: Map<string, PartModel | PartError>, newXml: Map<string, string>, plans: Plan[]): string | null {
  if (!validateDocumentBytes(output, "docx").ok) return "The updated document failed package validation."
  const before = rawEntryMap(source)
  const after = rawEntryMap(output)
  if ([...before.keys()].join("\n") !== [...after.keys()].join("\n")) return "The updated document's part list changed."
  for (const [name, raw] of before) if (!newXml.has(name) && !raw.equals(after.get(name) as Buffer)) return "An unrelated document part changed."

  const entries = new Map(readZipDirectory(output).map((e) => [e.name.toLowerCase(), e]))
  for (const [name, xml] of newXml) {
    const stored = readZipEntryBytes(output, entries.get(name) as ZipEntry, DOCX_INSERT_LIMITS.maxPartBytes).toString("utf8")
    if (stored !== xml) return "A modified part did not round-trip."
    if (XMLValidator.validate(xml.replace(/^\uFEFF/, "")) !== true) return "A modified part is not well-formed XML."
    const original = parts.get(name) as PartModel
    let reread: PartModel
    try {
      reread = modelPart(name, xml, null)
    } catch {
      return "A modified part could not be re-read."
    }
    if (reread.drawings.length !== original.drawings.length) return "The number of drawings changed."
    for (let i = 0; i < original.drawings.length; i++) {
      const o = original.drawings[i]
      const n = reread.drawings[i]
      if (o.ordinal !== n.ordinal || o.docPrId !== n.docPrId || o.blipEmbed !== n.blipEmbed) return "A drawing's identity changed."
      const plan = plans.find((p) => p.drawing === o && p.item.status === "updated")
      if (!plan) {
        if (original.xml.slice(o.span.start, o.span.end) !== xml.slice(n.span.start, n.span.end)) return "An unrelated drawing changed."
        continue
      }
      if (plan.item.decorative ? n.descr !== null || !decorativeOn(n) : n.descr !== plan.text || decorativeOn(n)) return "Inserted alt text did not verify."
    }
  }
  return null
}
