/**
 * @file lib/alt-text/pdf-package.ts
 * @module Publishing · Alt Text
 * @kind Server-side library (pure, no I/O)
 * @summary Phase 3 Task 7 — safe PDF reader for image extraction. Uses pdf-lib only for object
 *   parsing (no rendering, no JavaScript, no external fetches), walks the page tree in display
 *   order with cycle/depth guards, interprets page and Form XObject content streams to find every
 *   image *drawing occurrence* (Image XObjects and inline images), and maps each to its page,
 *   page label, parent forms, transform and — when reliably associated — the tagged-PDF Figure
 *   /Alt text. Never modifies the document and never decodes pixels (see pdf-image-decode.ts).
 */
import "server-only"
import { createHash } from "node:crypto"
import {
  EncryptedPDFError,
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  type PDFContext,
  type PDFObject,
} from "pdf-lib"
import {
  ContentLimitError,
  IDENTITY,
  PName,
  PStr,
  decodePdfText,
  interpretContentStream,
  multiply,
  toMatrix,
  type ContentBudget,
  type ContentState,
  type ContentStats,
  type Matrix,
  type PDict,
  type PValue,
} from "./pdf-content-stream"
import {
  DecodeLimitError,
  UnsupportedFilterError,
  decodeFilters,
  describeImageSpec,
  normalizeFilter,
  type DeviceSpace,
  type FilterParams,
  type PdfColorSpace,
  type PdfImageSpec,
} from "./pdf-image-decode"

const MIB = 1024 * 1024

export const PDF_EXTRACTION_LIMITS = {
  maxPages: 2000,
  /** Image occurrences handled by one synchronous extraction request. */
  maxOccurrences: 500,
  maxFormDepth: 12,
  maxPageTreeDepth: 64,
  maxContentStreamBytes: 16 * MIB,
  maxTotalContentBytes: 96 * MIB,
  maxOperators: 3_000_000,
  maxInlineImageBytes: 1 * MIB,
  maxEncodedImageBytes: 32 * MIB,
  maxStructNodes: 50_000,
  maxLabelNodes: 5_000,
  /** Fraction of the visible page an image must cover to be flagged as a likely scanned page. */
  scannedPageCoverage: 0.85,
} as const

export class PdfPackageError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "PdfPackageError"
  }
}

export type OccurrenceProblem = { status: "failed" | "unsupported"; code: string; message: string }

export type FigureAssociation = "resolved" | "ambiguous" | "unresolved" | "no_figure" | "untagged"

export type PdfOccurrenceStructure = {
  association: FigureAssociation
  mcid: number | null
  /** Object reference of the /Figure structure element, e.g. `45 0 R`. */
  structRef: string | null
  /** Existing /Alt, only when the association is `resolved`. Never AI-generated. */
  alt: string | null
  actualText: string | null
  /** /Alt or /ActualText found directly on the enclosing marked-content sequence. */
  markedContentAlt: string | null
}

export type ImageClassification = "embedded_image" | "likely_scanned_page" | "mask"

export type PdfOccurrence = {
  /** Stable across retries: `pdf:p<page>:o<order>:<xobj|inline>:<form chain>`. */
  sourceLocator: string
  /** 0-based order across the whole document (page tree order, then content order). */
  occurrenceIndex: number
  pageIndex: number
  pageNumber: number
  pageLabel: string | null
  /** 0-based drawing order on the page. */
  ordinalOnPage: number
  kind: "xobject" | "inline"
  resourceName: string | null
  objectRef: string | null
  parentForms: { name: string; ref: string | null }[]
  ctm: Matrix
  pageBox: [number, number, number, number]
  rotate: number
  pageCoverage: number
  classification: ImageClassification
  artifact: boolean
  image: PdfImageSpec | null
  problem: OccurrenceProblem | null
  /** Identifies the underlying image binary so repeated draws decode it once. */
  cacheKey: string
  structure: PdfOccurrenceStructure
}

export type PdfLimitation = { code: string; count: number; message: string }

export type PdfExtractionReport = {
  totalPages: number
  tagged: boolean
  pageLabels: boolean
  pagesWithImages: number
  /** Pages that draw vector paths but no raster images (vector artwork is not extracted). */
  vectorOnlyPages: number
  /** Figure elements with /Alt that could not be tied to exactly one image occurrence. */
  unmatchedFigures: number
  limitations: PdfLimitation[]
}

export type PdfPackage = { totalPages: number; occurrences: PdfOccurrence[]; report: PdfExtractionReport }

// ---------------------------------------------------------------------------
// pdf-lib helpers
// ---------------------------------------------------------------------------

type Ctx = PDFContext

const n = (name: string) => PDFName.of(name)
const refTag = (v: PDFObject | undefined) => (v instanceof PDFRef ? v.tag : null)

function look(ctx: Ctx, v: PDFObject | undefined): PDFObject | undefined {
  let cur = v
  for (let i = 0; i < 8 && cur instanceof PDFRef; i++) cur = ctx.lookup(cur)
  return cur instanceof PDFRef ? undefined : cur
}
const dictOf = (ctx: Ctx, v: PDFObject | undefined) => {
  const o = look(ctx, v)
  return o instanceof PDFDict ? o : o instanceof PDFStream ? o.dict : null
}
const numOf = (ctx: Ctx, v: PDFObject | undefined) => {
  const o = look(ctx, v)
  return o instanceof PDFNumber ? o.asNumber() : null
}
const nameOf = (ctx: Ctx, v: PDFObject | undefined) => {
  const o = look(ctx, v)
  return o instanceof PDFName ? o.decodeText() : null
}
const textOf = (ctx: Ctx, v: PDFObject | undefined) => {
  const o = look(ctx, v)
  return o instanceof PDFString || o instanceof PDFHexString ? decodePdfText(o.asBytes()) : null
}
const bytesOf = (ctx: Ctx, v: PDFObject | undefined) => {
  const o = look(ctx, v)
  return o instanceof PDFString || o instanceof PDFHexString ? o.asBytes() : null
}
const arrOf = (ctx: Ctx, v: PDFObject | undefined) => {
  const o = look(ctx, v)
  return o instanceof PDFArray ? o.asArray() : null
}
const numbersOf = (ctx: Ctx, v: PDFObject | undefined) => {
  const a = arrOf(ctx, v)
  if (!a) return null
  const out = a.map((x) => numOf(ctx, x))
  return out.every((x): x is number => x != null && Number.isFinite(x)) ? out : null
}

function streamBytes(s: PDFStream): Uint8Array {
  return s instanceof PDFRawStream ? s.contents : s.getContents()
}

function filterChain(ctx: Ctx, dict: PDFDict): { filters: string[]; parms: (FilterParams | null)[] } {
  const f = look(ctx, dict.get(n("Filter")))
  const filters = f instanceof PDFName ? [f.decodeText()] : f instanceof PDFArray ? f.asArray().map((x) => nameOf(ctx, x) ?? "?") : []
  const p = look(ctx, dict.get(n("DecodeParms")) ?? dict.get(n("DP")))
  const toParams = (o: PDFObject | undefined): FilterParams | null => {
    const d = dictOf(ctx, o)
    if (!d) return null
    const out: FilterParams = {}
    for (const [k, v] of d.entries()) {
      const num = numOf(ctx, v)
      if (num != null) out[k.decodeText()] = num
      else {
        const b = look(ctx, v)
        if (b instanceof PDFBool) out[k.decodeText()] = b.asBoolean() ? 1 : 0
      }
    }
    return out
  }
  const parms = p instanceof PDFArray ? p.asArray().map(toParams) : filters.map((_, i) => (i === 0 ? toParams(p) : null))
  return { filters, parms }
}

/** Decode a non-image stream (content streams, ICC/lookup streams) within a byte cap. */
function decodeStream(ctx: Ctx, s: PDFStream, max: number): Uint8Array {
  const { filters, parms } = filterChain(ctx, s.dict)
  const r = decodeFilters(streamBytes(s), filters, parms, max)
  if (r.codec) throw new UnsupportedFilterError(r.codec)
  return r.data
}

// ---------------------------------------------------------------------------
// Colour spaces
// ---------------------------------------------------------------------------

const DEVICE: Record<string, DeviceSpace> = {
  DeviceGray: { kind: "gray", label: "DeviceGray" },
  G: { kind: "gray", label: "DeviceGray" },
  CalGray: { kind: "gray", label: "CalGray" },
  DeviceRGB: { kind: "rgb", label: "DeviceRGB" },
  RGB: { kind: "rgb", label: "DeviceRGB" },
  CalRGB: { kind: "rgb", label: "CalRGB" },
  DeviceCMYK: { kind: "cmyk", label: "DeviceCMYK" },
  CMYK: { kind: "cmyk", label: "DeviceCMYK" },
}

function resolveColorSpace(ctx: Ctx, raw: PDFObject | undefined, resources: PDFDict | null, depth = 0): PdfColorSpace | null {
  if (depth > 4) return { kind: "unsupported", label: "Nested colour space" }
  const o = look(ctx, raw)
  if (!o) return null
  if (o instanceof PDFName) {
    const name = o.decodeText()
    if (DEVICE[name]) return DEVICE[name]
    const named = dictOf(ctx, resources?.get(n("ColorSpace")))?.get(n(name))
    if (named) return resolveColorSpace(ctx, named, resources, depth + 1)
    return { kind: "unsupported", label: name }
  }
  if (!(o instanceof PDFArray) || o.size() === 0) return null
  const family = nameOf(ctx, o.get(0)) ?? ""
  if (DEVICE[family]) return DEVICE[family]
  if (family === "ICCBased") {
    const stream = look(ctx, o.get(1))
    const d = stream instanceof PDFStream ? stream.dict : null
    const comps = d ? numOf(ctx, d.get(n("N"))) : null
    const base: DeviceSpace | null = comps === 1 ? DEVICE.DeviceGray : comps === 3 ? DEVICE.DeviceRGB : comps === 4 ? DEVICE.DeviceCMYK : null
    if (base) return { kind: base.kind, label: `ICCBased(${base.label})` }
    const alt = d?.get(n("Alternate"))
    return alt ? resolveColorSpace(ctx, alt, resources, depth + 1) : { kind: "unsupported", label: "ICCBased" }
  }
  if (family === "Indexed" || family === "I") {
    const base = resolveColorSpace(ctx, o.get(1), resources, depth + 1)
    const hival = numOf(ctx, o.get(2))
    if (!base || base.kind === "indexed" || base.kind === "unsupported" || hival == null || hival < 0 || hival > 255) {
      return { kind: "unsupported", label: `Indexed(${base?.label ?? "?"})` }
    }
    const lk = look(ctx, o.get(3))
    let lookup = bytesOf(ctx, lk)
    if (!lookup && lk instanceof PDFStream) {
      try {
        lookup = decodeStream(ctx, lk, 4096)
      } catch {
        lookup = null
      }
    }
    if (!lookup) return { kind: "unsupported", label: "Indexed" }
    return { kind: "indexed", base, hival: Math.trunc(hival), lookup, label: `Indexed(${base.label})` }
  }
  return { kind: "unsupported", label: family || "Unknown" }
}

/** Inline images use abbreviated keys/values and may reference named resource colour spaces. */
function resolveInlineColorSpace(ctx: Ctx, v: PValue | undefined, resources: PDFDict | null): PdfColorSpace | null {
  if (v instanceof PName) {
    if (DEVICE[v.v]) return DEVICE[v.v]
    const named = dictOf(ctx, resources?.get(n("ColorSpace")))?.get(n(v.v))
    return named ? resolveColorSpace(ctx, named, resources, 1) : { kind: "unsupported", label: v.v }
  }
  if (Array.isArray(v) && v[0] instanceof PName && (v[0].v === "I" || v[0].v === "Indexed")) {
    const base = resolveInlineColorSpace(ctx, v[1], resources)
    const hival = v[2]
    const lookup = v[3] instanceof PStr ? v[3].bytes : null
    if (!base || base.kind === "indexed" || base.kind === "unsupported" || typeof hival !== "number" || !lookup) return { kind: "unsupported", label: "Indexed" }
    return { kind: "indexed", base, hival: Math.trunc(hival), lookup, label: `Indexed(${base.label})` }
  }
  return v == null ? null : { kind: "unsupported", label: "Inline colour space" }
}

// ---------------------------------------------------------------------------
// Image specs
// ---------------------------------------------------------------------------

function imageSpecFromXObject(ctx: Ctx, stream: PDFStream, resources: PDFDict | null, depth = 0): PdfImageSpec | OccurrenceProblem {
  const d = stream.dict
  const width = numOf(ctx, d.get(n("Width")))
  const height = numOf(ctx, d.get(n("Height")))
  if (width == null || height == null) return { status: "failed", code: "INVALID_DIMENSIONS", message: "The image dimensions are missing." }
  const data = streamBytes(stream)
  if (data.length > PDF_EXTRACTION_LIMITS.maxEncodedImageBytes) return { status: "unsupported", code: "IMAGE_TOO_LARGE", message: "The embedded image stream is too large to process." }
  const imBool = look(ctx, d.get(n("ImageMask")))
  const imageMask = imBool instanceof PDFBool && imBool.asBoolean()
  const { filters, parms } = filterChain(ctx, d)
  let softMask: PdfImageSpec | null = null
  let softMaskMatte = false
  let stencilMask: PdfImageSpec | null = null
  let colorKeyMask: number[] | null = null
  if (depth === 0) {
    const sm = look(ctx, d.get(n("SMask")))
    if (sm instanceof PDFStream) {
      const s = imageSpecFromXObject(ctx, sm, resources, 1)
      if ("status" in s) return { status: s.status, code: "INVALID_SOFT_MASK", message: "The image soft mask is damaged." }
      softMask = s
      softMaskMatte = sm.dict.has(n("Matte"))
    }
    const mask = look(ctx, d.get(n("Mask")))
    if (mask instanceof PDFStream) {
      const s = imageSpecFromXObject(ctx, mask, resources, 1)
      if ("status" in s) return { status: s.status, code: "INVALID_MASK", message: "The image mask is damaged." }
      stencilMask = { ...s, imageMask: true, bitsPerComponent: s.bitsPerComponent ?? 1 }
    } else if (mask instanceof PDFArray) {
      colorKeyMask = numbersOf(ctx, mask)
    }
  }
  return {
    width,
    height,
    bitsPerComponent: numOf(ctx, d.get(n("BitsPerComponent"))) ?? (imageMask ? 1 : null),
    colorSpace: imageMask ? null : resolveColorSpace(ctx, d.get(n("ColorSpace")), resources),
    filters,
    decodeParms: parms,
    imageMask,
    decode: numbersOf(ctx, d.get(n("Decode"))),
    data,
    softMask,
    softMaskMatte,
    colorKeyMask,
    stencilMask,
  }
}

const inlineGet = (d: PDict, short: string, long: string) => (d.has(short) ? d.get(short) : d.get(long))

function inlineParams(v: PValue | undefined): FilterParams | null {
  if (!(v instanceof Map)) return null
  const out: FilterParams = {}
  for (const [k, x] of v) if (typeof x === "number") out[k] = x
  return out
}

function imageSpecFromInline(ctx: Ctx, d: PDict, data: Uint8Array, resources: PDFDict | null): PdfImageSpec {
  const f = inlineGet(d, "F", "Filter")
  const filters = f instanceof PName ? [f.v] : Array.isArray(f) ? f.map((x) => (x instanceof PName ? x.v : "?")) : []
  const dp = inlineGet(d, "DP", "DecodeParms")
  const parms = Array.isArray(dp) ? dp.map(inlineParams) : filters.map((_, i) => (i === 0 ? inlineParams(dp) : null))
  const im = inlineGet(d, "IM", "ImageMask") === true
  const num = (v: PValue | undefined) => (typeof v === "number" ? v : null)
  const decode = inlineGet(d, "D", "Decode")
  return {
    width: num(inlineGet(d, "W", "Width")) ?? 0,
    height: num(inlineGet(d, "H", "Height")) ?? 0,
    bitsPerComponent: num(inlineGet(d, "BPC", "BitsPerComponent")) ?? (im ? 1 : null),
    colorSpace: im ? null : resolveInlineColorSpace(ctx, inlineGet(d, "CS", "ColorSpace"), resources),
    filters,
    decodeParms: parms,
    imageMask: im,
    decode: Array.isArray(decode) && decode.every((x) => typeof x === "number") ? (decode as number[]) : null,
    data,
    softMask: null,
    softMaskMatte: false,
    colorKeyMask: null,
    stencilMask: null,
  }
}

/** Exact byte length of unfiltered inline data, so binary that happens to contain "EI" is safe. */
function inlineLength(ctx: Ctx, resources: PDFDict | null) {
  return (d: PDict): number | null => {
    if (inlineGet(d, "F", "Filter") != null) return null
    const w = inlineGet(d, "W", "Width")
    const h = inlineGet(d, "H", "Height")
    const im = inlineGet(d, "IM", "ImageMask") === true
    const bpc = inlineGet(d, "BPC", "BitsPerComponent") ?? (im ? 1 : null)
    if (typeof w !== "number" || typeof h !== "number" || typeof bpc !== "number") return null
    const cs = im ? null : resolveInlineColorSpace(ctx, inlineGet(d, "CS", "ColorSpace"), resources)
    const comps = im ? 1 : cs?.kind === "gray" || cs?.kind === "indexed" ? 1 : cs?.kind === "rgb" ? 3 : cs?.kind === "cmyk" ? 4 : null
    return comps == null ? null : Math.ceil((w * comps * bpc) / 8) * h
  }
}

// ---------------------------------------------------------------------------
// Page tree & labels
// ---------------------------------------------------------------------------

type PageInfo = {
  ref: string | null
  dict: PDFDict
  resources: PDFDict | null
  box: [number, number, number, number]
  rotate: number
}

function normBox(v: number[] | null): [number, number, number, number] | null {
  if (!v || v.length !== 4) return null
  const [a, b, c, d] = v
  return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)]
}

function collectPages(ctx: Ctx, rootRef: PDFObject | undefined): PageInfo[] {
  const pages: PageInfo[] = []
  const visited = new Set<string>()
  type Inherit = { resources: PDFDict | null; media: number[] | null; crop: number[] | null; rotate: number }
  const walk = (node: PDFObject | undefined, inh: Inherit, depth: number) => {
    if (depth > PDF_EXTRACTION_LIMITS.maxPageTreeDepth) throw new PdfPackageError("UNSAFE_DOCUMENT", "The PDF page tree is too deep.")
    const tag = refTag(node)
    if (tag) {
      if (visited.has(tag)) throw new PdfPackageError("UNSAFE_DOCUMENT", "The PDF page tree contains a cycle.")
      visited.add(tag)
    }
    const d = dictOf(ctx, node)
    if (!d) return
    const next: Inherit = {
      resources: dictOf(ctx, d.get(n("Resources"))) ?? inh.resources,
      media: numbersOf(ctx, d.get(n("MediaBox"))) ?? inh.media,
      crop: numbersOf(ctx, d.get(n("CropBox"))) ?? inh.crop,
      rotate: numOf(ctx, d.get(n("Rotate"))) ?? inh.rotate,
    }
    const kids = arrOf(ctx, d.get(n("Kids")))
    const type = nameOf(ctx, d.get(n("Type")))
    if (kids && type !== "Page") {
      for (const k of kids) walk(k, next, depth + 1)
      return
    }
    if (pages.length >= PDF_EXTRACTION_LIMITS.maxPages) throw new PdfPackageError("TOO_MANY_PAGES", `PDFs with more than ${PDF_EXTRACTION_LIMITS.maxPages} pages need background processing.`)
    const media = normBox(next.media) ?? [0, 0, 612, 792]
    const crop = normBox(next.crop)
    const box: [number, number, number, number] = crop
      ? [Math.max(media[0], crop[0]), Math.max(media[1], crop[1]), Math.min(media[2], crop[2]), Math.min(media[3], crop[3])]
      : media
    pages.push({ ref: tag, dict: d, resources: next.resources, box, rotate: ((Math.round(next.rotate / 90) * 90) % 360 + 360) % 360 })
  }
  walk(rootRef, { resources: null, media: null, crop: null, rotate: 0 }, 0)
  return pages
}

const ROMAN: [number, string][] = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]]

/** PDF 32000 §12.4.2 page label formatting. */
export function formatPageLabel(style: string | null, prefix: string, value: number): string {
  let body = ""
  if (style === "D") body = String(value)
  else if (style === "R" || style === "r") {
    let v = value
    for (const [k, s] of ROMAN) while (v >= k) (body += s), (v -= k)
    if (style === "R") body = body.toUpperCase()
  } else if (style === "A" || style === "a") {
    const letter = String.fromCharCode(65 + ((value - 1) % 26))
    body = letter.repeat(Math.floor((value - 1) / 26) + 1)
    if (style === "a") body = body.toLowerCase()
  }
  return prefix + body
}

function readPageLabels(ctx: Ctx, root: PDFObject | undefined, pageCount: number): (string | null)[] | null {
  const ranges: { start: number; style: string | null; prefix: string; first: number }[] = []
  const visited = new Set<string>()
  let nodes = 0
  const walk = (node: PDFObject | undefined, depth: number) => {
    if (depth > 32 || ++nodes > PDF_EXTRACTION_LIMITS.maxLabelNodes) return
    const tag = refTag(node)
    if (tag) {
      if (visited.has(tag)) return
      visited.add(tag)
    }
    const d = dictOf(ctx, node)
    if (!d) return
    const nums = arrOf(ctx, d.get(n("Nums")))
    if (nums) {
      for (let i = 0; i + 1 < nums.length; i += 2) {
        const start = numOf(ctx, nums[i])
        const ld = dictOf(ctx, nums[i + 1])
        if (start == null || !ld || start < 0) continue
        ranges.push({ start, style: nameOf(ctx, ld.get(n("S"))), prefix: textOf(ctx, ld.get(n("P"))) ?? "", first: numOf(ctx, ld.get(n("St"))) ?? 1 })
      }
    }
    for (const k of arrOf(ctx, d.get(n("Kids"))) ?? []) walk(k, depth + 1)
  }
  walk(root, 0)
  if (ranges.length === 0) return null
  ranges.sort((a, b) => a.start - b.start)
  const out: (string | null)[] = []
  let r = -1
  for (let i = 0; i < pageCount; i++) {
    while (r + 1 < ranges.length && ranges[r + 1].start <= i) r++
    if (r < 0) out.push(null)
    else {
      const range = ranges[r]
      out.push(formatPageLabel(range.style, range.prefix, range.first + (i - range.start)).slice(0, 64) || null)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Structure tree (tagged PDF)
// ---------------------------------------------------------------------------

type Figure = { structRef: string | null; alt: string | null; actualText: string | null; occurrences: number }

/** Map `<pageRef>#<mcid>` → Figure. MCRs pointing into a form stream (/Stm) are not mapped. */
function readFigures(ctx: Ctx, root: PDFDict | null): { figures: Map<string, Figure>; all: Figure[]; formMcrs: number } {
  const figures = new Map<string, Figure>()
  const all: Figure[] = []
  let formMcrs = 0
  if (!root) return { figures, all, formMcrs }
  const roleMap = dictOf(ctx, root.get(n("RoleMap")))
  const roleOf = (s: string | null) => {
    let cur = s
    for (let i = 0; i < 6 && cur && roleMap; i++) {
      const mapped = nameOf(ctx, roleMap.get(n(cur)))
      if (!mapped || mapped === cur) break
      cur = mapped
    }
    return cur
  }
  const visited = new Set<string>()
  let nodes = 0
  const seen = (o: PDFObject | undefined) => {
    const tag = refTag(o)
    if (!tag) return false
    if (visited.has(tag)) return true
    visited.add(tag)
    return false
  }
  const stack: { node: PDFObject | undefined; pg: string | null; figure: Figure | null; depth: number }[] = [{ node: root.get(n("K")), pg: null, figure: null, depth: 0 }]
  while (stack.length > 0) {
    const { node, pg, figure, depth } = stack.pop()!
    if (++nodes > PDF_EXTRACTION_LIMITS.maxStructNodes || depth > 128) break
    const o = look(ctx, node)
    if (o instanceof PDFNumber) {
      if (figure && pg) figures.set(`${pg}#${o.asNumber()}`, figure)
      continue
    }
    if (o instanceof PDFArray) {
      for (const k of o.asArray()) stack.push({ node: k, pg, figure, depth: depth + 1 })
      continue
    }
    if (!(o instanceof PDFDict) || seen(node)) continue
    const type = nameOf(ctx, o.get(n("Type")))
    const elemPg = refTag(o.get(n("Pg"))) ?? pg
    if (type === "MCR" || (o.has(n("MCID")) && !o.has(n("S")))) {
      const mcid = numOf(ctx, o.get(n("MCID")))
      if (o.has(n("Stm"))) formMcrs++
      else if (figure && elemPg && mcid != null) figures.set(`${elemPg}#${mcid}`, figure)
      continue
    }
    if (type === "OBJR") continue
    const role = roleOf(nameOf(ctx, o.get(n("S"))))
    let current = figure
    if (role === "Figure" && !figure) {
      current = {
        structRef: refTag(node),
        alt: textOf(ctx, o.get(n("Alt"))),
        actualText: textOf(ctx, o.get(n("ActualText"))),
        occurrences: 0,
      }
      all.push(current)
    }
    stack.push({ node: o.get(n("K")), pg: elemPg, figure: current, depth: depth + 1 })
  }
  return { figures, all, formMcrs }
}

// ---------------------------------------------------------------------------
// Occurrence collection
// ---------------------------------------------------------------------------

const safeName = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 48) || "_"

function buildLocator(pageNumber: number, ordinal: number, kind: "xobject" | "inline", chain: string[]): string {
  const prefix = `pdf:p${pageNumber}:o${ordinal}:${kind === "inline" ? "inline" : "xobj"}`
  const full = chain.length ? `${prefix}:${chain.map(safeName).join(">")}` : prefix
  if (full.length <= 255) return full
  return `${prefix}:h${createHash("sha256").update(chain.join(">")).digest("hex").slice(0, 32)}`
}

function coverage(ctm: Matrix, box: [number, number, number, number]): number {
  const pts = [
    [ctm[4], ctm[5]],
    [ctm[0] + ctm[4], ctm[1] + ctm[5]],
    [ctm[2] + ctm[4], ctm[3] + ctm[5]],
    [ctm[0] + ctm[2] + ctm[4], ctm[1] + ctm[3] + ctm[5]],
  ]
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const ix = Math.max(0, Math.min(Math.max(...xs), box[2]) - Math.max(Math.min(...xs), box[0]))
  const iy = Math.max(0, Math.min(Math.max(...ys), box[3]) - Math.max(Math.min(...ys), box[1]))
  const area = (box[2] - box[0]) * (box[3] - box[1])
  return area > 0 ? Math.min(1, (ix * iy) / area) : 0
}

type Limitations = Map<string, PdfLimitation>
function note(l: Limitations, code: string, message: string) {
  const cur = l.get(code)
  if (cur) cur.count++
  else l.set(code, { code, count: 1, message })
}

type Draft = Omit<PdfOccurrence, "occurrenceIndex" | "structure" | "sourceLocator"> & { chain: string[]; mcid: number | null; mcAlt: string | null; mcActual: string | null; inForm: boolean }

function contentBytes(ctx: Ctx, v: PDFObject | undefined, total: { bytes: number }): Uint8Array | null {
  const o = look(ctx, v)
  const parts: Uint8Array[] = []
  const add = (s: PDFObject | undefined) => {
    const st = look(ctx, s)
    if (!(st instanceof PDFStream)) return
    const bytes = decodeStream(ctx, st, PDF_EXTRACTION_LIMITS.maxContentStreamBytes)
    total.bytes += bytes.length
    if (total.bytes > PDF_EXTRACTION_LIMITS.maxTotalContentBytes) throw new DecodeLimitError("The document's drawing instructions are too large.")
    parts.push(bytes, Uint8Array.of(0x0a))
  }
  if (o instanceof PDFArray) for (const s of o.asArray()) add(s)
  else add(v)
  if (parts.length === 0) return null
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0))
  let off = 0
  for (const p of parts) out.set(p, off), (off += p.length)
  return out
}

function collectPageOccurrences(
  ctx: Ctx,
  page: PageInfo,
  pageIndex: number,
  label: string | null,
  budget: ContentBudget,
  total: { bytes: number },
  limitations: Limitations,
): { drafts: Draft[]; stats: ContentStats } {
  const drafts: Draft[] = []
  const stats: ContentStats = { pathPaints: 0, textShows: 0, doCalls: 0, inlineImages: 0, inlineUnreadable: 0 }
  const pageNumber = pageIndex + 1

  const push = (d: Omit<Draft, "ordinalOnPage" | "pageIndex" | "pageNumber" | "pageLabel" | "pageBox" | "rotate" | "pageCoverage" | "classification">, imageMask: boolean) => {
    const cov = coverage(d.ctm, page.box)
    drafts.push({
      ...d,
      ordinalOnPage: drafts.length,
      pageIndex,
      pageNumber,
      pageLabel: label,
      pageBox: page.box,
      rotate: page.rotate,
      pageCoverage: Math.round(cov * 1000) / 1000,
      classification: imageMask ? "mask" : cov >= PDF_EXTRACTION_LIMITS.scannedPageCoverage ? "likely_scanned_page" : "embedded_image",
    })
    if (drafts.length > PDF_EXTRACTION_LIMITS.maxOccurrences) {
      throw new PdfPackageError("TOO_MANY_IMAGES", `PDFs with more than ${PDF_EXTRACTION_LIMITS.maxOccurrences} image occurrences need background processing.`)
    }
  }

  const run = (bytes: Uint8Array, resources: PDFDict | null, state: ContentState, forms: { name: string; ref: string | null }[], ancestors: Set<string>) => {
    const inForm = forms.length > 0
    const mcInfo = (s: ContentState) => {
      const withMcid = [...s.marked].reverse().find((m) => m.mcid != null)
      const withAlt = [...s.marked].reverse().find((m) => m.alt || m.actualText)
      return {
        mcid: withMcid?.mcid ?? null,
        mcAlt: withAlt?.alt ?? null,
        mcActual: withAlt?.actualText ?? null,
        artifact: s.marked.some((m) => m.tag === "Artifact"),
      }
    }
    interpretContentStream(
      bytes,
      state,
      {
        resolveProperties: (name) => {
          const p = dictOf(ctx, dictOf(ctx, resources?.get(n("Properties")))?.get(n(name)))
          if (!p) return null
          const out: PDict = new Map()
          const mcid = numOf(ctx, p.get(n("MCID")))
          if (mcid != null) out.set("MCID", mcid)
          for (const key of ["Alt", "ActualText"]) {
            const b = bytesOf(ctx, p.get(n(key)))
            if (b) out.set(key, new PStr(b))
          }
          return out
        },
        inlineImageLength: inlineLength(ctx, resources),
        onInlineImage: (dict, data, s) => {
          const spec = imageSpecFromInline(ctx, dict, data, resources)
          const key = createHash("sha256").update(data).update(JSON.stringify(describeImageSpec(spec))).digest("hex")
          push(
            {
              kind: "inline",
              resourceName: null,
              objectRef: null,
              parentForms: forms,
              chain: [...forms.map((f) => f.name)],
              ctm: s.ctm,
              image: spec,
              problem: null,
              cacheKey: `inline:${key}`,
              ...mcInfo(s),
              inForm,
            },
            spec.imageMask,
          )
        },
        onDo: (name, s) => {
          const xobjects = dictOf(ctx, resources?.get(n("XObject")))
          const raw = xobjects?.get(n(name))
          const target = look(ctx, raw)
          const ref = refTag(raw)
          if (!(target instanceof PDFStream)) {
            note(limitations, "MISSING_XOBJECT", "Some drawing instructions reference objects that are missing from the PDF.")
            return
          }
          const subtype = nameOf(ctx, target.dict.get(n("Subtype")))
          if (subtype === "Image") {
            const spec = imageSpecFromXObject(ctx, target, resources)
            const problem = "status" in spec ? spec : null
            const image = "status" in spec ? null : spec
            push(
              {
                kind: "xobject",
                resourceName: name,
                objectRef: ref,
                parentForms: forms,
                chain: [...forms.map((f) => f.name), name],
                ctm: s.ctm,
                image,
                problem,
                cacheKey: ref ? `obj:${ref}` : `anon:${pageIndex}:${drafts.length}`,
                ...mcInfo(s),
                inForm,
              },
              image?.imageMask ?? false,
            )
            return
          }
          if (subtype !== "Form") return
          if (forms.length >= PDF_EXTRACTION_LIMITS.maxFormDepth) {
            note(limitations, "FORM_DEPTH_EXCEEDED", `Form XObjects nested deeper than ${PDF_EXTRACTION_LIMITS.maxFormDepth} levels were not inspected.`)
            return
          }
          if (ref && ancestors.has(ref)) {
            note(limitations, "FORM_CYCLE", "A Form XObject that draws itself was skipped.")
            return
          }
          let formBytes: Uint8Array
          try {
            formBytes = decodeStream(ctx, target, PDF_EXTRACTION_LIMITS.maxContentStreamBytes)
            total.bytes += formBytes.length
            if (total.bytes > PDF_EXTRACTION_LIMITS.maxTotalContentBytes) throw new DecodeLimitError("The document's drawing instructions are too large.")
          } catch (err) {
            if (err instanceof DecodeLimitError) throw err
            note(limitations, "CONTENT_UNREADABLE", "Some drawing instructions could not be decoded and were skipped.")
            return
          }
          const matrix = toMatrix(numbersOf(ctx, target.dict.get(n("Matrix")))) ?? IDENTITY
          const formResources = dictOf(ctx, target.dict.get(n("Resources"))) ?? resources
          const nextAncestors = new Set(ancestors)
          if (ref) nextAncestors.add(ref)
          run(formBytes, formResources, { ctm: multiply(matrix, s.ctm), marked: s.marked }, [...forms, { name: name.slice(0, 64), ref }], nextAncestors)
        },
      },
      budget,
      stats,
      { maxInlineImageBytes: PDF_EXTRACTION_LIMITS.maxInlineImageBytes },
    )
  }

  let bytes: Uint8Array | null = null
  try {
    bytes = contentBytes(ctx, page.dict.get(n("Contents")), total)
  } catch (err) {
    if (err instanceof DecodeLimitError) throw err
    note(limitations, "CONTENT_UNREADABLE", "Some drawing instructions could not be decoded and were skipped.")
  }
  if (bytes) run(bytes, page.resources, { ctm: IDENTITY, marked: [] }, [], new Set(page.ref ? [page.ref] : []))
  if (stats.inlineUnreadable > 0) {
    for (let i = 0; i < stats.inlineUnreadable; i++) note(limitations, "INLINE_IMAGE_UNREADABLE", "Some inline images could not be located safely in the drawing instructions and were not extracted.")
  }
  return { drafts, stats }
}

/** Parse the PDF and enumerate image occurrences. Throws PdfPackageError for document-level problems. */
export async function readPdfPackage(bytes: Uint8Array): Promise<PdfPackage> {
  if (!/^%PDF-[12]\.\d/.test(Buffer.from(bytes.subarray(0, 16)).toString("latin1"))) throw new PdfPackageError("INVALID_DOCUMENT", "The file is not a valid PDF document.")
  let doc: PDFDocument
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false, throwOnInvalidObject: false })
  } catch (err) {
    if (err instanceof EncryptedPDFError) throw new PdfPackageError("ENCRYPTED_DOCUMENT", "Password-protected or encrypted PDFs cannot be inspected safely.")
    throw new PdfPackageError("INVALID_DOCUMENT", "The PDF is damaged and could not be read.")
  }
  if (doc.isEncrypted) throw new PdfPackageError("ENCRYPTED_DOCUMENT", "Password-protected or encrypted PDFs cannot be inspected safely.")
  const ctx = doc.context
  const catalog = doc.catalog

  let pages: PageInfo[]
  try {
    pages = collectPages(ctx, catalog.get(n("Pages")))
  } catch (err) {
    if (err instanceof PdfPackageError) throw err
    throw new PdfPackageError("INVALID_DOCUMENT", "The PDF page tree could not be read.")
  }
  if (pages.length === 0) throw new PdfPackageError("INVALID_DOCUMENT", "The PDF has no pages.")

  const labels = (() => {
    try {
      return readPageLabels(ctx, catalog.get(n("PageLabels")), pages.length)
    } catch {
      return null
    }
  })()
  const structRoot = dictOf(ctx, catalog.get(n("StructTreeRoot")))
  const { figures, all: allFigures, formMcrs } = (() => {
    try {
      return readFigures(ctx, structRoot)
    } catch {
      return { figures: new Map<string, Figure>(), all: [] as Figure[], formMcrs: 0 }
    }
  })()
  const tagged = structRoot != null

  const limitations: Limitations = new Map()
  const budget: ContentBudget = { operators: 0, maxOperators: PDF_EXTRACTION_LIMITS.maxOperators }
  const total = { bytes: 0 }
  const occurrences: PdfOccurrence[] = []
  let pagesWithImages = 0
  let vectorOnlyPages = 0

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]
    let drafts: Draft[]
    let stats: ContentStats
    try {
      ;({ drafts, stats } = collectPageOccurrences(ctx, page, i, labels?.[i] ?? null, budget, total, limitations))
    } catch (err) {
      if (err instanceof PdfPackageError) throw err
      if (err instanceof ContentLimitError || err instanceof DecodeLimitError || err instanceof RangeError) {
        throw new PdfPackageError("RESOURCE_LIMIT", "This PDF is too complex to process safely.")
      }
      throw new PdfPackageError("INVALID_DOCUMENT", "The PDF drawing instructions are damaged.")
    }
    if (drafts.length > 0) pagesWithImages++
    else if (stats.pathPaints > 0) vectorOnlyPages++

    // MCID → number of image occurrences on this page sharing it (for ambiguity detection).
    const byMcid = new Map<number, number>()
    for (const d of drafts) if (d.mcid != null) byMcid.set(d.mcid, (byMcid.get(d.mcid) ?? 0) + 1)

    for (const d of drafts) {
      const figure = d.mcid != null && page.ref ? figures.get(`${page.ref}#${d.mcid}`) : undefined
      let association: FigureAssociation
      if (!tagged) association = "untagged"
      else if (figure) association = (byMcid.get(d.mcid!) ?? 0) === 1 ? "resolved" : "ambiguous"
      else association = d.mcid != null ? "no_figure" : "unresolved"
      if (figure && association === "resolved") figure.occurrences++
      const { chain, mcid, mcAlt, mcActual, inForm: _inForm, ...rest } = d
      if (occurrences.length >= PDF_EXTRACTION_LIMITS.maxOccurrences) {
        throw new PdfPackageError("TOO_MANY_IMAGES", `PDFs with more than ${PDF_EXTRACTION_LIMITS.maxOccurrences} image occurrences need background processing.`)
      }
      occurrences.push({
        ...rest,
        occurrenceIndex: occurrences.length,
        sourceLocator: buildLocator(d.pageNumber, d.ordinalOnPage, d.kind, chain),
        structure: {
          association,
          mcid,
          structRef: figure?.structRef ?? null,
          alt: association === "resolved" ? (figure?.alt ?? null) : null,
          actualText: association === "resolved" ? (figure?.actualText ?? null) : null,
          markedContentAlt: mcAlt ?? mcActual,
        },
      })
    }
  }
  if (formMcrs > 0) note(limitations, "FORM_MARKED_CONTENT", "Some Figure tags point into Form XObject content and were not associated with an image.")

  return {
    totalPages: pages.length,
    occurrences,
    report: {
      totalPages: pages.length,
      tagged,
      pageLabels: labels != null,
      pagesWithImages,
      vectorOnlyPages,
      unmatchedFigures: allFigures.filter((f) => f.alt && f.occurrences === 0).length,
      limitations: [...limitations.values()],
    },
  }
}

export { normalizeFilter }
