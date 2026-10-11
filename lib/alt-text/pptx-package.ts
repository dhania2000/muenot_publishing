/**
 * @file lib/alt-text/pptx-package.ts
 * @module Publishing · Alt Text
 * @kind Server-side library (pure, no I/O)
 * @summary Phase 3 Task 5 — safe PPTX package reader. Resolves slides in presentation order,
 *   walks each slide's shape tree (groups and markup-compatibility fallbacks included) and
 *   returns one entry per picture occurrence with its source metadata. Never touches storage,
 *   the database or AI. All ZIP access goes through the Task 3 bounded readers.
 */
import "server-only"
import { XMLParser } from "fast-xml-parser"
import { DOCUMENT_ARCHIVE_LIMITS } from "./document-upload-contract"
import {
  asValidationRejection,
  readZipDirectory,
  readZipEntryBytes,
  resolvePartTarget,
  validateDocumentBytes,
  type ZipEntry,
} from "./document-validation"

export const PPTX_EXTRACTION_LIMITS = {
  maxSlides: 1000,
  /** Picture occurrences handled by one synchronous extraction request. */
  maxOccurrences: 300,
  maxShapeDepth: 32,
} as const

export type PptxErrorCode = "INVALID_DOCUMENT" | "UNSAFE_ARCHIVE" | "UNSUPPORTED_STRUCTURE" | "TOO_MANY_IMAGES" | "MACRO_DOCUMENT" | "EXTERNAL_CONTENT" | "UNSAFE_DOCUMENT" | "TYPE_MISMATCH" | "INVALID_FILE"

export class PptxPackageError extends Error {
  constructor(
    readonly code: PptxErrorCode | string,
    message: string,
  ) {
    super(message)
    this.name = "PptxPackageError"
  }
}

export type OccurrenceProblem = { status: "failed" | "unsupported"; code: string; message: string }

export type PptxOccurrence = {
  /** Stable across retries: `<slide part>#pic:<shape id>:<media rel id>` (printable ASCII ≤ 255). */
  sourceLocator: string
  /** 0-based order across the whole presentation. */
  occurrenceIndex: number
  slideNumber: number
  slidePart: string
  slideRelationshipId: string
  shapeId: string | null
  name: string | null
  title: string | null
  /** Author alt text (`cNvPr/@descr`), verbatim. */
  description: string | null
  /** true / false when the decorative extension is present, null when the author never set it. */
  decorative: boolean | null
  hidden: boolean
  groupPath: string[]
  mediaRelationshipId: string | null
  mediaPart: string | null
  /** Companion SVG part when PowerPoint stored an SVG with a raster fallback. */
  svgMediaPart: string | null
  problem: OccurrenceProblem | null
}

export type PptxNotExtracted = {
  slideBackgrounds: number
  shapePictureFills: number
  graphicFrames: number
  layoutAndMasterImages: number
}

export type PptxPackage = {
  totalSlides: number
  occurrences: PptxOccurrence[]
  notExtracted: PptxNotExtracted
  /** Bounded media read (inflate capped at `maxBytes`); throws PptxPackageError("MEDIA_TOO_LARGE") above it. */
  readMedia(part: string, maxBytes: number): Buffer
}

type XNode = Record<string, unknown>

const ATTR = ":@"
const DECORATIVE_EXT_URI = "{C183D7F6-B498-43B3-948B-1728B52AA6E4}"
const SVG_BLIP_EXT_URI = "{96DAC541-7B7A-43D3-8B79-37D633B846F1}"

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  preserveOrder: true,
  processEntities: true,
  htmlEntities: true,
  ignoreDeclaration: true,
  ignorePiTags: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
})

const localName = (qname: string) => qname.slice(qname.indexOf(":") + 1)

function tagOf(node: XNode): string | null {
  for (const k of Object.keys(node)) if (k !== ATTR && k !== "#text") return k
  return null
}

const childrenOf = (node: XNode): XNode[] => {
  const tag = tagOf(node)
  const value = tag ? node[tag] : null
  return Array.isArray(value) ? (value as XNode[]) : []
}

function attrsOf(node: XNode): Record<string, string> {
  const raw = (node[ATTR] ?? {}) as Record<string, unknown>
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw)) if (typeof v === "string") out[k.startsWith("@_") ? k.slice(2) : k] = v
  return out
}

/** Unprefixed attribute (`id`, `name`, `descr`) or, with `prefixed`, a namespaced one (`r:embed`). */
function attr(node: XNode, name: string, prefixed = false): string | null {
  for (const [k, v] of Object.entries(attrsOf(node))) {
    const hasPrefix = k.includes(":")
    if (hasPrefix === prefixed && localName(k) === name && !k.startsWith("xmlns")) return v
  }
  return null
}

const is = (node: XNode, name: string) => {
  const tag = tagOf(node)
  return tag != null && localName(tag) === name
}
const child = (node: XNode, name: string) => childrenOf(node).find((c) => is(c, name)) ?? null
const path = (node: XNode | null, ...names: string[]): XNode | null => {
  let cur = node
  for (const n of names) cur = cur ? child(cur, n) : null
  return cur
}
function* descendants(node: XNode, name: string, depth = 0): Generator<XNode> {
  if (depth > 64) return
  for (const c of childrenOf(node)) {
    if (is(c, name)) yield c
    yield* descendants(c, name, depth + 1)
  }
}

type Rel = { type: string; target: string; external: boolean }

class PackageReader {
  private readonly entries = new Map<string, ZipEntry>()
  private xmlBudget: number = DOCUMENT_ARCHIVE_LIMITS.maxXmlBudgetBytes

  constructor(private readonly buf: Buffer) {
    for (const e of readZipDirectory(buf)) this.entries.set(e.name.toLowerCase(), e)
  }

  entry(part: string) {
    return this.entries.get(part.toLowerCase()) ?? null
  }

  names() {
    return [...this.entries.values()].map((e) => e.name)
  }

  xml(part: string): XNode[] | null {
    const e = this.entry(part)
    if (!e) return null
    if (e.size > DOCUMENT_ARCHIVE_LIMITS.maxXmlPartBytes) throw new PptxPackageError("UNSAFE_ARCHIVE", "A presentation part is too large to process.")
    this.xmlBudget -= e.size
    if (this.xmlBudget < 0) throw new PptxPackageError("UNSAFE_ARCHIVE", "The presentation contains too much XML to process.")
    const text = readZipEntryBytes(this.buf, e, DOCUMENT_ARCHIVE_LIMITS.maxXmlPartBytes).toString("utf8")
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new PptxPackageError("UNSAFE_DOCUMENT", "The presentation contains unsupported XML declarations.")
    try {
      return parser.parse(text) as XNode[]
    } catch {
      throw new PptxPackageError("INVALID_DOCUMENT", "A presentation part is malformed.")
    }
  }

  rels(part: string): Map<string, Rel> {
    const slash = part.lastIndexOf("/")
    const relsPart = `${part.slice(0, slash + 1)}_rels/${part.slice(slash + 1)}.rels`
    const map = new Map<string, Rel>()
    const doc = this.xml(relsPart)
    if (!doc) return map
    const root = doc.find((n) => is(n, "Relationships"))
    for (const r of root ? childrenOf(root).filter((n) => is(n, "Relationship")) : []) {
      const id = attr(r, "Id")
      const type = attr(r, "Type")
      const target = attr(r, "Target")
      if (!id || !type || target == null) continue
      map.set(id, { type: localName(type.slice(type.lastIndexOf("/") + 1)).toLowerCase(), target, external: (attr(r, "TargetMode") ?? "").toLowerCase() === "external" })
    }
    return map
  }

  /** Resolve an internal relationship target to an existing package part (never a URL or escape). */
  resolve(fromPart: string, rel: Rel): string | null {
    if (rel.external) return null
    const resolved = resolvePartTarget(fromPart.slice(0, fromPart.lastIndexOf("/") + 1), rel.target)
    return resolved && this.entry(resolved) ? this.entry(resolved)!.name : null
  }

  bytes(part: string, maxBytes: number): Buffer {
    const e = this.entry(part)
    if (!e) throw new PptxPackageError("MISSING_MEDIA", "The image file is missing from the presentation.")
    if (e.size > maxBytes) throw new PptxPackageError("MEDIA_TOO_LARGE", "The image is larger than the allowed size.")
    return readZipEntryBytes(this.buf, e, maxBytes)
  }
}

const printable = (s: string) => s.replace(/[^\x21-\x7e]/g, (c) => encodeURIComponent(c))

function buildLocator(slidePart: string, shapeId: string | null, relId: string | null, used: Set<string>): string {
  const base = `${printable(slidePart)}#pic:${printable(shapeId ?? "x")}:${printable(relId ?? "none")}`.slice(0, 240)
  let locator = base
  for (let n = 2; used.has(locator); n++) locator = `${base}:${n}`
  used.add(locator)
  return locator
}

function readDecorative(cNvPr: XNode | null): boolean | null {
  if (!cNvPr) return null
  for (const ext of descendants(cNvPr, "ext")) {
    if ((attr(ext, "uri") ?? "").toUpperCase() !== DECORATIVE_EXT_URI) continue
    const flag = child(ext, "decorative")
    const val = flag ? (attr(flag, "val") ?? "").toLowerCase() : ""
    return val === "1" || val === "true"
  }
  return null
}

const truthy = (v: string | null) => v === "1" || v?.toLowerCase() === "true"
const clip = (v: string | null, max: number) => (v == null ? null : v.length > max ? v.slice(0, max) : v)

type SlideContext = {
  reader: PackageReader
  slidePart: string
  slideNumber: number
  slideRelationshipId: string
  rels: Map<string, Rel>
  used: Set<string>
  out: PptxOccurrence[]
  notExtracted: PptxNotExtracted
  nextIndex: () => number
}

function readPicture(pic: XNode, groupPath: string[], ctx: SlideContext) {
  const cNvPr = path(pic, "nvPicPr", "cNvPr")
  const blip = path(pic, "blipFill", "blip")
  const embedId = blip ? attr(blip, "embed", true) : null
  const linkId = blip ? attr(blip, "link", true) : null
  const shapeId = cNvPr ? attr(cNvPr, "id") : null

  let svgMediaPart: string | null = null
  if (blip) {
    for (const ext of descendants(blip, "ext")) {
      if ((attr(ext, "uri") ?? "").toUpperCase() !== SVG_BLIP_EXT_URI) continue
      const svg = child(ext, "svgBlip")
      const svgRel = svg ? ctx.rels.get(attr(svg, "embed", true) ?? "") : undefined
      if (svgRel) svgMediaPart = ctx.reader.resolve(ctx.slidePart, svgRel)
    }
  }

  let mediaPart: string | null = null
  let problem: OccurrenceProblem | null = null
  if (embedId) {
    const rel = ctx.rels.get(embedId)
    if (!rel) problem = { status: "failed", code: "INVALID_RELATIONSHIP", message: "The picture references an image relationship that does not exist." }
    else if (rel.external) problem = { status: "unsupported", code: "EXTERNAL_IMAGE", message: "Linked (external) images are not downloaded." }
    else if (rel.type !== "image") problem = { status: "unsupported", code: "UNSUPPORTED_RELATIONSHIP", message: "The picture does not reference an embedded image." }
    else {
      mediaPart = ctx.reader.resolve(ctx.slidePart, rel)
      if (!mediaPart) problem = { status: "failed", code: "MISSING_MEDIA", message: "The image file is missing from the presentation." }
    }
  } else if (linkId) {
    problem = { status: "unsupported", code: "EXTERNAL_IMAGE", message: "Linked (external) images are not downloaded." }
  } else {
    problem = { status: "unsupported", code: "NO_IMAGE_DATA", message: "The picture has no embedded image data." }
  }

  ctx.out.push({
    sourceLocator: buildLocator(ctx.slidePart, shapeId, embedId ?? linkId, ctx.used),
    occurrenceIndex: ctx.nextIndex(),
    slideNumber: ctx.slideNumber,
    slidePart: ctx.slidePart,
    slideRelationshipId: ctx.slideRelationshipId,
    shapeId: clip(shapeId, 32),
    name: clip(cNvPr ? attr(cNvPr, "name") : null, 255),
    title: clip(cNvPr ? attr(cNvPr, "title") : null, 255),
    description: clip(cNvPr ? attr(cNvPr, "descr") : null, 2000),
    decorative: readDecorative(cNvPr),
    hidden: truthy(cNvPr ? attr(cNvPr, "hidden") : null),
    groupPath,
    mediaRelationshipId: clip(embedId ?? linkId, 255),
    mediaPart,
    svgMediaPart,
    problem,
  })
}

function walkShapes(nodes: XNode[], groupPath: string[], depth: number, ctx: SlideContext) {
  if (depth > PPTX_EXTRACTION_LIMITS.maxShapeDepth) throw new PptxPackageError("UNSUPPORTED_STRUCTURE", "The presentation nests shapes too deeply to process.")
  for (const node of nodes) {
    if (is(node, "pic")) readPicture(node, groupPath, ctx)
    else if (is(node, "grpSp")) {
      const id = path(node, "nvGrpSpPr", "cNvPr")
      walkShapes(childrenOf(node), [...groupPath, (id && attr(id, "id")) || "?"].slice(-16), depth + 1, ctx)
    } else if (is(node, "AlternateContent")) {
      // Prefer the Fallback branch: it is what every consumer renders, and taking one branch avoids double counting.
      const branch = child(node, "Fallback") ?? child(node, "Choice")
      if (branch) walkShapes(childrenOf(branch), groupPath, depth + 1, ctx)
    } else if (is(node, "sp")) {
      if (path(node, "spPr", "blipFill")) ctx.notExtracted.shapePictureFills++
    } else if (is(node, "graphicFrame")) ctx.notExtracted.graphicFrames++
  }
}

function countLayoutAndMasterImages(reader: PackageReader): number {
  let count = 0
  for (const name of reader.names()) {
    if (!/^ppt\/(slideLayouts|slideMasters)\/_rels\/[^/]+\.xml\.rels$/i.test(name)) continue
    const owner = name.replace(/_rels\/([^/]+)\.rels$/i, "$1")
    for (const rel of reader.rels(owner).values()) if (rel.type === "image" && !rel.external) count++
  }
  return count
}

/**
 * Parse a PPTX buffer. Re-runs the Task 3 package validation first (macros, external
 * load relationships, ZIP limits), so a package changed after upload is still rejected.
 * Throws PptxPackageError for document-level problems; per-picture problems are returned
 * on the occurrence instead.
 */
export function readPptxPackage(buf: Buffer): PptxPackage {
  const validation = validateDocumentBytes(buf, "pptx")
  if (!validation.ok) throw new PptxPackageError(validation.code, validation.message)

  try {
    const reader = new PackageReader(buf)
    const officeDoc = [...readRootRels(reader).values()].find((r) => r.type === "officedocument" && !r.external)
    const presentationPart = officeDoc ? resolveRootTarget(reader, officeDoc.target) : null
    if (!presentationPart) throw new PptxPackageError("INVALID_DOCUMENT", "The presentation part is missing.")

    const presentation = reader.xml(presentationPart)
    const root = presentation?.find((n) => is(n, "presentation"))
    if (!root) throw new PptxPackageError("INVALID_DOCUMENT", "The presentation part is malformed.")
    const presRels = reader.rels(presentationPart)
    const slideIds = path(root, "sldIdLst")
    const slides: { part: string; relId: string }[] = []
    const seen = new Set<string>()
    for (const sldId of slideIds ? childrenOf(slideIds).filter((n) => is(n, "sldId")) : []) {
      const relId = attr(sldId, "id", true)
      const rel = relId ? presRels.get(relId) : undefined
      if (!relId || !rel || rel.type !== "slide") continue
      const part = reader.resolve(presentationPart, rel)
      if (!part || seen.has(part.toLowerCase())) continue
      seen.add(part.toLowerCase())
      slides.push({ part, relId })
    }
    if (slides.length > PPTX_EXTRACTION_LIMITS.maxSlides) throw new PptxPackageError("UNSUPPORTED_STRUCTURE", `Presentations with more than ${PPTX_EXTRACTION_LIMITS.maxSlides} slides are not supported.`)

    const occurrences: PptxOccurrence[] = []
    const notExtracted: PptxNotExtracted = { slideBackgrounds: 0, shapePictureFills: 0, graphicFrames: 0, layoutAndMasterImages: 0 }
    const used = new Set<string>()
    let index = 0

    slides.forEach(({ part, relId }, i) => {
      const slide = reader.xml(part)?.find((n) => is(n, "sld"))
      if (!slide) throw new PptxPackageError("INVALID_DOCUMENT", `Slide ${i + 1} is missing or malformed.`)
      const cSld = child(slide, "cSld")
      if (path(cSld, "bg", "bgPr", "blipFill")) notExtracted.slideBackgrounds++
      const tree = path(cSld, "spTree")
      if (!tree) return
      walkShapes(childrenOf(tree), [], 0, {
        reader,
        slidePart: part,
        slideNumber: i + 1,
        slideRelationshipId: relId,
        rels: reader.rels(part),
        used,
        out: occurrences,
        notExtracted,
        nextIndex: () => index++,
      })
      if (occurrences.length > PPTX_EXTRACTION_LIMITS.maxOccurrences) {
        throw new PptxPackageError(
          "TOO_MANY_IMAGES",
          `This presentation has more than ${PPTX_EXTRACTION_LIMITS.maxOccurrences} pictures. Large presentations need background processing, which is not available yet.`,
        )
      }
    })
    notExtracted.layoutAndMasterImages = countLayoutAndMasterImages(reader)

    return { totalSlides: slides.length, occurrences, notExtracted, readMedia: (p, max) => reader.bytes(p, max) }
  } catch (err) {
    if (err instanceof PptxPackageError) throw err
    const rejection = asValidationRejection(err)
    if (rejection) throw new PptxPackageError(rejection.code, rejection.message)
    throw new PptxPackageError("INVALID_DOCUMENT", "The presentation could not be read.")
  }
}

function readRootRels(reader: PackageReader): Map<string, Rel> {
  // `_rels/.rels` belongs to the package root; PackageReader.rels() derives rels paths from an owner part.
  const map = new Map<string, Rel>()
  const doc = reader.xml("_rels/.rels")
  const root = doc?.find((n) => is(n, "Relationships"))
  for (const r of root ? childrenOf(root).filter((n) => is(n, "Relationship")) : []) {
    const type = attr(r, "Type")
    const target = attr(r, "Target")
    const id = attr(r, "Id")
    if (!id || !type || target == null) continue
    map.set(id, { type: type.slice(type.lastIndexOf("/") + 1).toLowerCase(), target, external: (attr(r, "TargetMode") ?? "").toLowerCase() === "external" })
  }
  return map
}

function resolveRootTarget(reader: PackageReader, target: string): string | null {
  const resolved = resolvePartTarget("", target)
  return resolved && reader.entry(resolved) ? reader.entry(resolved)!.name : null
}
