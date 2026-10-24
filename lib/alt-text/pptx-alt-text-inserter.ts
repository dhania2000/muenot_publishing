/**
 * @file lib/alt-text/pptx-alt-text-inserter.ts
 * @module Publishing · Alt Text
 * @kind Server-side library (pure, no I/O)
 * @summary Phase 3 Task 16 — writes approved alt text into a copy of a PPTX package.
 *
 *   Each instruction names one picture occurrence by the `sourceLocator` produced by
 *   `readPptxPackage` (slide part + `p:cNvPr/@id` + `a:blip/@r:embed`, with a `:n` suffix for
 *   collisions). The inserter re-reads the original with that same walker, then builds a
 *   string-level model of each targeted slide and requires the two to agree picture-for-picture
 *   (count, order, shape id, name, image relationship, group path). Only then does it change that
 *   picture's `p:cNvPr/@descr`, or — for decorative approvals — remove `descr` and set the Office
 *   decorative extension. Slide XML is spliced, never re-serialized, so animations, transitions,
 *   timing, notes, layouts, masters, media and every untouched ZIP entry stay byte-identical.
 *
 *   Never guesses: anything missing, ambiguous, linked, inside a chart/SmartArt/table frame, or in
 *   a signed package is reported, not modified.
 */
import "server-only"
import { XMLValidator } from "fast-xml-parser"
import { asValidationRejection, readZipDirectory, readZipEntryBytes, validateDocumentBytes, type ZipEntry } from "./document-validation"
import { rawEntryMap, rewriteZipEntries } from "./ooxml-zip-rewrite"
import { PptxPackageError, readPptxPackage, type PptxOccurrence, type PptxPackage } from "./pptx-package"
import {
  attrs,
  collectPrefixes,
  decodeXml,
  decorativeOn,
  elementSpans,
  maskNonMarkup,
  normalizeAltText,
  nvPropsEdit,
  onlyEditsApplied,
  prefixesFor,
  readDescr,
  readNvProps,
  tagRe,
  tagsIn,
  within,
  applyEdits,
  type Edit,
  type NvProps,
  type Span,
} from "./ooxml-xml-splice"

export type PptxInsertInstruction = { occurrenceId: number; sourceLocator: string; text: string; decorative: boolean }

export type PptxInsertItemStatus = "updated" | "unchanged" | "unsupported" | "failed"

export type PptxInsertItem = {
  occurrenceId: number
  sourceLocator: string
  status: PptxInsertItemStatus
  code: string
  message: string
  slideNumber: number | null
  grouped: boolean
  hidden: boolean
  previousDescription: string | null
  decorative: boolean
}

export type PptxInsertWarning = { code: string; message: string }

export type PptxInsertReport = {
  items: PptxInsertItem[]
  updated: number
  unchanged: number
  unsupported: number
  failed: number
  partsModified: string[]
  slideCount: number
  pictureCount: number
  uniqueMediaCount: number
  existingAltTextPreserved: number
  groupedPictureCount: number
  warnings: PptxInsertWarning[]
}

export type PptxInsertFailureCode = "INVALID_DOCUMENT" | "ENCRYPTED_DOCUMENT" | "SIGNED_DOCUMENT" | "TOO_MANY_IMAGES" | "OUTPUT_TOO_LARGE" | "VERIFICATION_FAILED"

export type PptxInsertResult =
  | { ok: true; output: Buffer | null; report: PptxInsertReport }
  | { ok: false; code: PptxInsertFailureCode; message: string }

export const PPTX_INSERT_LIMITS = { maxPartBytes: 32 * 1024 * 1024, maxTextChars: 4000 } as const

const NS = {
  p: "http://schemas.openxmlformats.org/presentationml/2006/main",
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  mc: "http://schemas.openxmlformats.org/markup-compatibility/2006",
} as const

const clip = (v: string | null, max: number) => (v == null ? null : v.length > max ? v.slice(0, max) : v)

/* ---------- Slide model ---------- */

type Pic = {
  span: Span
  props: NvProps | null
  shapeId: string | null
  name: string | null
  descr: string | null
  rel: string | null
  groupPath: string[]
}

type SlideModel = { name: string; xml: string; pics: Pic[]; byLocator: Map<string, Pic> }

class SlideError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

/** Pictures the extractor would visit, in document order (spTree → groups → chosen mc branch). */
function modelSlide(name: string, xml: string): Omit<SlideModel, "byLocator"> {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new SlideError("UNSAFE_XML", "The slide contains disallowed XML declarations.")
  const decl = /^\uFEFF?<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i.exec(xml)
  if (decl && !/^utf-?8$/i.test(decl[1])) throw new SlideError("UNSUPPORTED_ENCODING", "The slide does not use UTF-8 encoding.")
  const masked = maskNonMarkup(xml)
  const map = collectPrefixes(masked)
  if (!map) throw new SlideError("UNSUPPORTED_STRUCTURE", "The slide re-binds an XML prefix to different namespaces.")
  const P = { p: prefixesFor(map, NS.p), a: prefixesFor(map, NS.a), r: prefixesFor(map, NS.r), mc: prefixesFor(map, NS.mc) }

  let trees: Span[], picSpans: Span[], groups: Span[], acs: Span[], choices: Span[], fallbacks: Span[], frames: Span[], shapes: Span[]
  try {
    trees = elementSpans(masked, P.p, "spTree")
    picSpans = elementSpans(masked, P.p, "pic")
    groups = elementSpans(masked, P.p, "grpSp")
    acs = elementSpans(masked, P.mc, "AlternateContent")
    choices = elementSpans(masked, P.mc, "Choice")
    fallbacks = elementSpans(masked, P.mc, "Fallback")
    frames = elementSpans(masked, P.p, "graphicFrame")
    shapes = elementSpans(masked, P.p, "sp")
  } catch {
    throw new SlideError("INVALID_XML", "The slide's shape markup is not well formed.")
  }
  if (trees.length !== 1) throw new SlideError("UNSUPPORTED_STRUCTURE", "The slide does not have exactly one shape tree.")
  const root = trees[0]
  const inside = (outer: Span, pos: number) => pos > outer.start && pos < outer.end

  const chosenBranch = (ac: Span): Span | null => {
    const nestedAcs = acs.filter((x) => x !== ac && inside(ac, x.start))
    const direct = (s: Span) => inside(ac, s.start) && !nestedAcs.some((n) => inside(n, s.start))
    return fallbacks.find(direct) ?? choices.find(direct) ?? null
  }
  const reachable = (pos: number) => {
    if (!inside(root, pos) || within(pos, frames) || within(pos, shapes)) return false
    if (picSpans.some((s) => s.start !== pos && inside(s, pos))) return false
    return acs.filter((ac) => inside(ac, pos)).every((ac) => {
      const branch = chosenBranch(ac)
      return !!branch && inside(branch, pos)
    })
  }

  const cNvPrRe = tagRe(P.p, "cNvPr")
  const blipRe = tagRe(P.a, "blip")
  const relAttr = (a: Map<string, string>, local: string) => P.r.map((p) => a.get(`${p}:${local}`)).find((v) => v !== undefined) ?? null

  const pics: Pic[] = picSpans
    .filter((s) => reachable(s.start))
    .map((span) => {
      const cNvPr = tagsIn(xml, masked, cNvPrRe, span, [])[0] ?? null
      const props = cNvPr ? readNvProps(xml, masked, cNvPr, "cNvPr", span.end) : null
      if (cNvPr && !props) throw new SlideError("INVALID_XML", "A picture's properties are not well formed.")
      const a = cNvPr ? attrs(cNvPr.text) : new Map<string, string>()
      const blip = tagsIn(xml, masked, blipRe, span, [])[0] ?? null
      const b = blip ? attrs(blip.text) : new Map<string, string>()
      const groupPath = groups
        .filter((g) => inside(g, span.start))
        .sort((x, y) => x.start - y.start)
        .map((g) => {
          const t = tagsIn(xml, masked, cNvPrRe, g, [])[0]
          return (t && decodeXml(attrs(t.text).get("id") ?? "")) || "?"
        })
        .slice(-16)
      const opt = (k: string) => (a.has(k) ? decodeXml(a.get(k) ?? "") : null)
      return {
        span,
        props,
        shapeId: opt("id"),
        name: opt("name"),
        descr: props ? readDescr(props) : null,
        rel: relAttr(b, "embed") ?? relAttr(b, "link"),
        groupPath,
      }
    })
  return { name, xml, pics }
}

const sameIdentity = (o: PptxOccurrence, p: Pic) =>
  o.shapeId === clip(p.shapeId, 32) && o.name === clip(p.name, 255) && o.mediaRelationshipId === clip(p.rel, 255) && o.groupPath.join("/") === p.groupPath.join("/")

/* ---------- Entry point ---------- */

type Plan = { item: PptxInsertItem; slide?: SlideModel; pic?: Pic; text?: string }

function item(ins: PptxInsertInstruction, status: PptxInsertItemStatus, code: string, message: string, extra: Partial<PptxInsertItem> = {}): PptxInsertItem {
  return { occurrenceId: ins.occurrenceId, sourceLocator: ins.sourceLocator, status, code, message, slideNumber: null, grouped: false, hidden: false, previousDescription: null, decorative: ins.decorative, ...extra }
}

/**
 * Insert approved alt text into a copy of `source`. With `dryRun` the package is analysed and the
 * per-occurrence plan reported, but no output is built.
 */
export function insertPptxAltText(source: Buffer, instructions: PptxInsertInstruction[], opts: { maxOutputBytes: number; dryRun?: boolean }): PptxInsertResult {
  const valid = validateDocumentBytes(source, "pptx")
  if (!valid.ok) return { ok: false, code: valid.code === "ENCRYPTED_DOCUMENT" ? "ENCRYPTED_DOCUMENT" : "INVALID_DOCUMENT", message: valid.message }

  let entries: ZipEntry[]
  try {
    entries = readZipDirectory(source)
  } catch (err) {
    return { ok: false, code: "INVALID_DOCUMENT", message: asValidationRejection(err)?.message ?? "The presentation package could not be read." }
  }
  const byName = new Map(entries.map((e) => [e.name.toLowerCase(), e]))
  if ([...byName.keys()].some((n) => n.startsWith("_xmlsignatures/"))) {
    return { ok: false, code: "SIGNED_DOCUMENT", message: "This presentation is digitally signed. Changing it would invalidate the signature, so alt text was not inserted." }
  }

  let pkg: PptxPackage
  try {
    pkg = readPptxPackage(source)
  } catch (err) {
    if (err instanceof PptxPackageError) return { ok: false, code: err.code === "TOO_MANY_IMAGES" ? "TOO_MANY_IMAGES" : "INVALID_DOCUMENT", message: err.message }
    return { ok: false, code: "INVALID_DOCUMENT", message: asValidationRejection(err)?.message ?? "The presentation package could not be read." }
  }

  const readText = (name: string): string | null => {
    const e = byName.get(name.toLowerCase())
    return e ? readZipEntryBytes(source, e, PPTX_INSERT_LIMITS.maxPartBytes).toString("utf8") : null
  }

  const warnings: PptxInsertWarning[] = []
  try {
    const presentation = readText("ppt/presentation.xml")
    if (presentation && /<(?:[\w-]+:)?modifyVerifier\b/i.test(presentation)) {
      warnings.push({ code: "WRITE_PROTECTION_PRESENT", message: "The presentation asks for a password to modify. This setting is kept unchanged in the output." })
    }
  } catch (err) {
    return { ok: false, code: "INVALID_DOCUMENT", message: asValidationRejection(err)?.message ?? "The presentation package could not be read." }
  }

  const occByLocator = new Map(pkg.occurrences.map((o) => [o.sourceLocator, o]))
  const slides = new Map<string, SlideModel | SlideError>()
  const slideFor = (part: string): SlideModel | SlideError => {
    const cached = slides.get(part)
    if (cached) return cached
    let result: SlideModel | SlideError
    try {
      const xml = readText(part)
      if (xml === null) throw new SlideError("PART_NOT_FOUND", "The referenced slide is not in this presentation.")
      const model = modelSlide(part, xml)
      const occs = pkg.occurrences.filter((o) => o.slidePart === part)
      if (occs.length !== model.pics.length || occs.some((o, i) => !sameIdentity(o, model.pics[i]))) {
        throw new SlideError("STRUCTURE_MISMATCH", "This slide's picture structure could not be matched reliably, so it was not changed.")
      }
      result = { ...model, byLocator: new Map(occs.map((o, i) => [o.sourceLocator, model.pics[i]])) }
    } catch (err) {
      if (err instanceof SlideError) result = err
      else result = new SlideError("INVALID_XML", asValidationRejection(err)?.message ?? "The slide could not be read.")
    }
    slides.set(part, result)
    return result
  }

  const plans: Plan[] = instructions.map((ins) => {
    const occ = occByLocator.get(ins.sourceLocator)
    if (!occ) return { item: item(ins, "failed", "LOCATOR_NOT_FOUND", "The mapped picture was not found in this presentation.") }
    const base = { slideNumber: occ.slideNumber, grouped: occ.groupPath.length > 0, hidden: occ.hidden, previousDescription: occ.description }
    if (occ.problem) return { item: item(ins, occ.problem.status, occ.problem.code, occ.problem.message, base) }
    const slide = slideFor(occ.slidePart)
    if (slide instanceof SlideError) return { item: item(ins, slide.code === "PART_NOT_FOUND" ? "failed" : "unsupported", slide.code, slide.message, base) }
    const pic = slide.byLocator.get(ins.sourceLocator)
    if (!pic) return { item: item(ins, "failed", "LOCATOR_NOT_FOUND", "The mapped picture was not found at its source location.", base) }
    const full = { ...base, previousDescription: pic.descr }
    if (!pic.props) return { item: item(ins, "unsupported", "MISSING_PROPERTIES", "The picture has no properties element to hold alt text.", full) }
    if (slide.pics.some((x) => x !== pic && x.shapeId === pic.shapeId && x.rel === pic.rel)) {
      return { item: item(ins, "failed", "AMBIGUOUS_LOCATOR", "More than one picture on this slide has the same identifiers.", full) }
    }
    const value = normalizeAltText(ins.text)
    if (!ins.decorative && !value) return { item: item(ins, "failed", "EMPTY_DESCRIPTION", "The approved description is empty.", full) }
    if (value.length > PPTX_INSERT_LIMITS.maxTextChars) return { item: item(ins, "failed", "TEXT_TOO_LONG", "The approved description is too long to insert.", full) }
    const current = ins.decorative ? pic.descr === null && decorativeOn(pic.props) : pic.descr === value && !decorativeOn(pic.props)
    if (current) return { item: item(ins, "unchanged", "ALREADY_CURRENT", "The presentation already contains this approved alt text.", full), slide, pic }
    if (ins.decorative && !pic.props.decorativeTag && pic.props.extLstMisplaced) {
      return { item: item(ins, "unsupported", "DECORATIVE_METADATA_UNSUPPORTED", "The picture's extension list cannot safely receive the decorative flag.", full) }
    }
    return { item: item(ins, "updated", "UPDATED", ins.decorative ? "Marked as decorative." : "Alt text inserted.", full), slide, pic, text: value }
  })

  const targets = new Map<Pic, Plan[]>()
  for (const p of plans) if (p.pic) targets.set(p.pic, [...(targets.get(p.pic) ?? []), p])
  for (const group of targets.values()) {
    if (group.length < 2) continue
    for (const p of group) {
      p.item = { ...p.item, status: "failed", code: "DUPLICATE_OCCURRENCE", message: "Several mapped occurrences point to the same picture." }
      p.text = undefined
      p.pic = undefined
    }
  }

  const editsBySlide = new Map<string, Edit[]>()
  for (const p of plans) {
    if (p.item.status !== "updated" || !p.slide || !p.pic || p.text === undefined) continue
    const props = p.pic.props as NvProps
    editsBySlide.set(p.slide.name, [...(editsBySlide.get(p.slide.name) ?? []), nvPropsEdit(p.slide.xml, props, p.text, p.item.decorative)])
    if (!p.item.decorative && decorativeOn(props)) warnings.push({ code: "DECORATIVE_FLAG_CLEARED", message: `Occurrence ${p.item.occurrenceId} was marked decorative in the source; the flag was cleared for its approved description.` })
  }

  const edited = new Set(plans.filter((p) => p.item.status === "updated" && p.pic).map((p) => p.item.sourceLocator))
  const supported = pkg.occurrences.filter((o) => !o.problem)
  const n = pkg.notExtracted
  if (n.slideBackgrounds) warnings.push({ code: "BACKGROUND_IMAGES_NOT_REMEDIATED", message: `${n.slideBackgrounds} slide background image(s) cannot carry alt text and were left unchanged.` })
  if (n.shapePictureFills) warnings.push({ code: "SHAPE_FILL_PICTURES", message: `${n.shapePictureFills} shape(s) filled with a picture were left unchanged.` })
  if (n.graphicFrames) warnings.push({ code: "GRAPHIC_FRAMES_NOT_REMEDIATED", message: `${n.graphicFrames} chart, SmartArt, table or embedded object frame(s) were left unchanged.` })
  if (n.layoutAndMasterImages) warnings.push({ code: "LAYOUT_MASTER_IMAGES_NOT_REMEDIATED", message: `${n.layoutAndMasterImages} image(s) on slide layouts or masters were left unchanged.` })

  const items = plans.map((p) => p.item)
  const count = (s: PptxInsertItemStatus) => items.filter((i) => i.status === s).length
  const report: PptxInsertReport = {
    items,
    updated: count("updated"),
    unchanged: count("unchanged"),
    unsupported: count("unsupported"),
    failed: count("failed"),
    partsModified: [...editsBySlide.keys()].sort(),
    slideCount: pkg.totalSlides,
    pictureCount: supported.length,
    uniqueMediaCount: new Set(supported.map((o) => o.mediaPart)).size,
    existingAltTextPreserved: supported.filter((o) => !edited.has(o.sourceLocator) && o.description).length,
    groupedPictureCount: supported.filter((o) => o.groupPath.length > 0).length,
    warnings,
  }
  if (opts.dryRun || editsBySlide.size === 0) return { ok: true, output: null, report }

  const replacements = new Map<string, Buffer>()
  const newXml = new Map<string, string>()
  for (const [name, edits] of editsBySlide) {
    const xml = applyEdits((slides.get(name) as SlideModel).xml, edits)
    newXml.set(name, xml)
    replacements.set(name, Buffer.from(xml, "utf8"))
  }

  let output: Buffer
  try {
    output = rewriteZipEntries(source, replacements)
  } catch {
    return { ok: false, code: "VERIFICATION_FAILED", message: "The updated presentation package could not be assembled." }
  }
  if (output.length > opts.maxOutputBytes) return { ok: false, code: "OUTPUT_TOO_LARGE", message: "The updated presentation is larger than the allowed size." }

  const problem = verifyOutput({ source, output, pkg, slides, newXml, editsBySlide, plans })
  if (problem) return { ok: false, code: "VERIFICATION_FAILED", message: problem }
  return { ok: true, output, report }
}

/** Re-open the output and prove only the intended picture properties changed. Returns a reason or null. */
function verifyOutput(v: {
  source: Buffer
  output: Buffer
  pkg: PptxPackage
  slides: Map<string, SlideModel | SlideError>
  newXml: Map<string, string>
  editsBySlide: Map<string, Edit[]>
  plans: Plan[]
}): string | null {
  const { source, output, pkg, slides, newXml, editsBySlide, plans } = v
  if (!validateDocumentBytes(output, "pptx").ok) return "The updated presentation failed package validation."
  const before = rawEntryMap(source)
  const after = rawEntryMap(output)
  if ([...before.keys()].join("\n") !== [...after.keys()].join("\n")) return "The updated presentation's part list changed."
  const modified = new Set([...newXml.keys()].map((k) => k.toLowerCase()))
  for (const [name, raw] of before) if (!modified.has(name.toLowerCase()) && !raw.equals(after.get(name) as Buffer)) return "An unrelated presentation part changed."

  const entries = new Map(readZipDirectory(output).map((e) => [e.name.toLowerCase(), e]))
  for (const [name, xml] of newXml) {
    const entry = entries.get(name.toLowerCase())
    if (!entry || readZipEntryBytes(output, entry, PPTX_INSERT_LIMITS.maxPartBytes).toString("utf8") !== xml) return "A modified slide did not round-trip."
    if (XMLValidator.validate(xml.replace(/^\uFEFF/, "")) !== true) return "A modified slide is not well-formed XML."
    const original = slides.get(name) as SlideModel
    if (!onlyEditsApplied(original.xml, xml, editsBySlide.get(name) ?? [])) return "A modified slide changed outside the edited picture properties."
  }

  let reread: PptxPackage
  try {
    reread = readPptxPackage(output)
  } catch {
    return "The updated presentation could not be re-read."
  }
  if (reread.totalSlides !== pkg.totalSlides) return "The number of slides changed."
  if (reread.occurrences.length !== pkg.occurrences.length) return "The number of pictures changed."
  if (JSON.stringify(reread.notExtracted) !== JSON.stringify(pkg.notExtracted)) return "Non-picture visual content changed."

  const updated = new Map(plans.filter((p) => p.item.status === "updated" && p.text !== undefined).map((p) => [p.item.sourceLocator, p]))
  for (let i = 0; i < pkg.occurrences.length; i++) {
    const o = pkg.occurrences[i]
    const n = reread.occurrences[i]
    const same =
      o.sourceLocator === n.sourceLocator &&
      o.slidePart === n.slidePart &&
      o.slideNumber === n.slideNumber &&
      o.shapeId === n.shapeId &&
      o.name === n.name &&
      o.title === n.title &&
      o.hidden === n.hidden &&
      o.groupPath.join("/") === n.groupPath.join("/") &&
      o.mediaRelationshipId === n.mediaRelationshipId &&
      o.mediaPart === n.mediaPart &&
      (o.problem?.code ?? null) === (n.problem?.code ?? null)
    if (!same) return "A picture's identity changed."
    const plan = updated.get(o.sourceLocator)
    if (!plan) {
      if (o.description !== n.description || o.decorative !== n.decorative) return "An unrelated picture changed."
      continue
    }
    const ok = plan.item.decorative ? n.description === null && n.decorative === true : n.description === clip(plan.text as string, 2000) && n.decorative !== true
    if (!ok) return "Inserted alt text did not verify."
  }
  return null
}
