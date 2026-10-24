/**
 * @file lib/alt-text/ooxml-xml-splice.ts
 * @module Publishing · Alt Text
 * @kind Server-side library (pure, no I/O)
 * @summary Phase 3 Tasks 15–16 — string-level OOXML primitives shared by the DOCX and PPTX alt
 *   text inserters. Parts are never re-serialized: element positions are found on a masked copy
 *   (comments/CDATA/PIs blanked) and edits are applied as exact splices, so everything outside an
 *   edited start tag stays byte-identical. Also owns the non-visual properties (`wp:docPr`,
 *   `p:cNvPr`) description / Office decorative-extension edit.
 */
import "server-only"

export type Span = { start: number; end: number }
export type Tag = Span & { text: string; selfClosing: boolean; name: string }
export type Edit = Span & { text: string }

export const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main"
export const ADEC_NS = "http://schemas.microsoft.com/office/drawing/2017/decorative"
export const DECORATIVE_URI = "{C183D7F6-B498-43B3-948B-1728B52AA6E4}"

export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")
const NEVER = "(?!)"
export const alt = (prefixes: string[]) => (prefixes.length ? prefixes.map(escapeRe).join("|") : NEVER)

/** Blank comments, CDATA and PIs (same length) so tag scanning never matches inside them. */
export const maskNonMarkup = (xml: string) => xml.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>/g, (m) => " ".repeat(m.length))

/** prefix → namespace URI across the whole part, or null when a prefix is bound to two URIs. */
export function collectPrefixes(masked: string): Map<string, string> | null {
  const map = new Map<string, string>()
  for (const m of masked.matchAll(/xmlns:([\w.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const uri = m[2] ?? m[3] ?? ""
    const prev = map.get(m[1])
    if (prev !== undefined && prev !== uri) return null
    map.set(m[1], uri)
  }
  return map
}

export const prefixesFor = (map: Map<string, string>, uri: string) => [...map].filter(([, u]) => u === uri).map(([p]) => p)

export function tagRe(prefixes: string[], local: string, closing = false) {
  return new RegExp(`<${closing ? "\\/" : ""}(${alt(prefixes)}):${local}(?=[\\s/>])[^>]*?(\\/?)>`, "g")
}

/** Element spans for a (possibly nested) element type, in document order of start tags. Throws on imbalance. */
export function elementSpans(masked: string, prefixes: string[], local: string): Span[] {
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

export const within = (pos: number, spans: Span[]) => spans.some((s) => pos >= s.start && pos < s.end)

export function tagsIn(xml: string, masked: string, re: RegExp, region: Span, exclude: Span[]): Tag[] {
  const out: Tag[] = []
  re.lastIndex = region.start
  for (let m = re.exec(masked); m && m.index < region.end; m = re.exec(masked)) {
    if (within(m.index, exclude)) continue
    const text = xml.slice(m.index, m.index + m[0].length)
    out.push({ start: m.index, end: m.index + m[0].length, text, selfClosing: m[2] === "/", name: `${m[1]}:` })
  }
  return out
}

export function attrs(tagText: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const a of tagText.matchAll(/\s([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out.set(a[1], a[2] ?? a[3] ?? "")
  return out
}

export function decodeXml(v: string): string {
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

export const escapeAttr = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/** Set (or remove with null) an unprefixed attribute, touching nothing else in the start tag. */
export function setAttr(tagText: string, name: string, value: string | null): string {
  const re = new RegExp(`(\\s)${escapeRe(name)}\\s*=\\s*(?:"[^"]*"|'[^']*')`)
  if (re.test(tagText)) return value === null ? tagText.replace(new RegExp(`\\s+${escapeRe(name)}\\s*=\\s*(?:"[^"]*"|'[^']*')`), "") : tagText.replace(re, `$1${name}="${escapeAttr(value)}"`)
  if (value === null) return tagText
  return tagText.replace(/\s*(\/?)>$/, ` ${name}="${escapeAttr(value)}"$1>`)
}

/** Whitespace-normalize and strip XML-illegal control characters. Never rewrites wording, scripts or symbols. */
export function normalizeAltText(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

export function applyEdits(xml: string, edits: Edit[]): string {
  let out = xml
  for (const e of [...edits].sort((x, y) => y.start - x.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end)
  return out
}

/** True when `output` equals `original` with exactly `edits` applied and nothing else changed. */
export function onlyEditsApplied(original: string, output: string, edits: Edit[]): boolean {
  let o = 0
  let n = 0
  for (const e of [...edits].sort((x, y) => x.start - y.start)) {
    if (e.start < o) return false
    const seg = original.slice(o, e.start)
    if (output.slice(n, n + seg.length) !== seg) return false
    n += seg.length
    if (output.slice(n, n + e.text.length) !== e.text) return false
    n += e.text.length
    o = e.end
  }
  return output.slice(n) === original.slice(o)
}

/* ---------- Non-visual properties (wp:docPr / p:cNvPr) ---------- */

export type NvProps = {
  tag: Tag
  /** Local element name (`docPr`, `cNvPr`), used to build the matching end tag. */
  local: string
  end: number
  inner: Span | null
  decorativeTag: Tag | null
  extLstClose: Tag | null
  /** An `extLst` exists but is not the trailing child, so a decorative extension cannot be added safely. */
  extLstMisplaced: boolean
}

/** Model a non-visual properties element starting at `tag`, bounded by `limit`. Null when malformed. */
export function readNvProps(xml: string, masked: string, tag: Tag, local: string, limit: number): NvProps | null {
  if (tag.selfClosing) return { tag, local, end: tag.end, inner: null, decorativeTag: null, extLstClose: null, extLstMisplaced: false }
  const closeText = `</${tag.name}${local}>`
  const close = masked.indexOf(closeText, tag.end)
  if (close < 0 || close > limit) return null
  const inner: Span = { start: tag.end, end: close }
  const innerText = masked.slice(inner.start, inner.end)
  let decorativeTag: Tag | null = null
  if (innerText.includes(DECORATIVE_URI)) {
    const m = /<([\w.-]+:)?decorative(?=[\s/>])[^>]*>/.exec(innerText)
    if (m) decorativeTag = { start: inner.start + m.index, end: inner.start + m.index + m[0].length, text: xml.slice(inner.start + m.index, inner.start + m.index + m[0].length), selfClosing: m[0].endsWith("/>"), name: m[1] ?? "" }
  }
  // Schema order puts extLst last (after hlinkClick/hlinkHover, which may have their own extLst).
  let extLstClose: Tag | null = null
  let extLstMisplaced = false
  const closes = [...innerText.matchAll(/<\/([\w.-]+:)?extLst>/g)]
  const last = closes[closes.length - 1]
  if (last) {
    const at = inner.start + (last.index ?? 0)
    if (innerText.slice((last.index ?? 0) + last[0].length).trim() === "") extLstClose = { start: at, end: at + last[0].length, text: last[0], selfClosing: false, name: last[1] ?? "" }
    else extLstMisplaced = true
  }
  return { tag, local, end: close + closeText.length, inner, decorativeTag, extLstClose, extLstMisplaced }
}

export const decorativeOn = (p: Pick<NvProps, "decorativeTag">) => (p.decorativeTag ? /\bval\s*=\s*["'](1|true|on)["']/i.test(p.decorativeTag.text) : false)

export const readDescr = (p: NvProps): string | null => {
  const a = attrs(p.tag.text)
  return a.has("descr") ? decodeXml(a.get("descr") ?? "") : null
}

function decorativeExt(val: "1" | "0") {
  return `<a:ext xmlns:a="${NS_A}" uri="${DECORATIVE_URI}"><adec:decorative xmlns:adec="${ADEC_NS}" val="${val}"/></a:ext>`
}

/**
 * Edit replacing the properties element so it carries `text` as `descr` (meaningful) or no
 * `descr` plus `adec:decorative val="1"` (decorative). Every other attribute and child is kept.
 */
export function nvPropsEdit(xml: string, p: NvProps, text: string, decorative: boolean): Edit {
  const tag = p.tag
  const startTag = setAttr(tag.text, "descr", decorative ? null : text)
  if (decorative) {
    if (p.decorativeTag) {
      const inner = xml.slice(tag.end, p.decorativeTag.start) + setAttr(p.decorativeTag.text, "val", "1") + xml.slice(p.decorativeTag.end, p.end)
      return { start: tag.start, end: p.end, text: startTag + inner }
    }
    if (p.extLstClose) {
      return { start: tag.start, end: p.end, text: startTag + xml.slice(tag.end, p.extLstClose.start) + decorativeExt("1") + xml.slice(p.extLstClose.start, p.end) }
    }
    const extLst = `<a:extLst xmlns:a="${NS_A}">${decorativeExt("1")}</a:extLst>`
    if (tag.selfClosing) return { start: tag.start, end: p.end, text: `${startTag.replace(/\s*\/>$/, ">")}${extLst}</${tag.name}${p.local}>` }
    const closeAt = (p.inner as Span).end
    return { start: tag.start, end: p.end, text: startTag + xml.slice(tag.end, closeAt) + extLst + xml.slice(closeAt, p.end) }
  }
  if (p.decorativeTag && decorativeOn(p)) {
    const inner = xml.slice(tag.end, p.decorativeTag.start) + setAttr(p.decorativeTag.text, "val", "0") + xml.slice(p.decorativeTag.end, p.end)
    return { start: tag.start, end: p.end, text: startTag + inner }
  }
  return { start: tag.start, end: tag.end, text: startTag }
}
