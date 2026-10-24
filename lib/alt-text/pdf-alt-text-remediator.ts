/**
 * @file lib/alt-text/pdf-alt-text-remediator.ts
 * @module Publishing · Alt Text
 * @kind Server-side library (pure, no I/O)
 * @summary Phase 3 Task 17 — writes approved alt text into a copy of a tagged PDF.
 *
 *   Re-reads the original with the Task 7 extractor (`readPdfPackage`) so every instruction is
 *   matched by the same `sourceLocator` and the same Figure ↔ page-MCID association used during
 *   review. Only occurrences that resolve to exactly one indirect /Figure structure element (and
 *   whose ParentTree entry, when present, points back to that Figure) receive a new `/Alt`.
 *
 *   Output is a standard PDF *incremental update*: the original bytes are kept verbatim and only
 *   the modified structure-element objects plus a new cross-reference section are appended. Page
 *   content streams, images, fonts, links, bookmarks, forms, page labels, the RoleMap, ParentTree
 *   and reading order are therefore untouched by construction. The result is reopened and
 *   re-extracted before it is accepted.
 *
 *   Never guesses and never claims conformance: untagged/scanned/encrypted/signed files are
 *   refused, ambiguous or unmapped images and decorative retagging are reported for manual
 *   remediation, and PDF/UA / WCAG are always reported as NOT VERIFIED.
 */
import "server-only"
import {
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  decodePDFRawStream,
  type PDFContext,
  type PDFDocument,
  type PDFObject,
} from "pdf-lib"
import { decodePdfText } from "./pdf-content-stream"
import { PdfPackageError, readPdfPackage, type PdfOccurrence, type PdfPackage } from "./pdf-package"

export type PdfInsertInstruction = { occurrenceId: number; sourceLocator: string; text: string; decorative: boolean }

export type PdfInsertItemStatus = "updated" | "unchanged" | "unsupported" | "failed"

export type PdfInsertItem = {
  occurrenceId: number
  sourceLocator: string
  status: PdfInsertItemStatus
  code: string
  message: string
  pageNumber: number | null
  previousDescription: string | null
  decorative: boolean
}

export type PdfTaggingStatus = "tagged" | "partially_tagged" | "untagged" | "scanned" | "protected"

export type PdfValidationCheck = { code: string; passed: boolean; message: string }

export type PdfRemediationDetails = {
  taggingStatus: PdfTaggingStatus
  pdfVersion: string | null
  totalPages: number
  imageOccurrences: number
  uniqueImages: number
  /** Content images that resolve to exactly one Figure element (eligible targets). */
  mappedFigures: number
  ambiguousOccurrences: number
  unmappedOccurrences: number
  artifactOccurrences: number
  scannedPages: number
  scannedPagesWithoutText: number
  vectorOnlyPages: number
  decorativeProcessed: number
  /** Distinct image occurrences that still need human remediation after this run. */
  manualRemediationRequired: number
  structure: { structTreeRoot: boolean; markedContent: boolean; parentTree: boolean; roleMap: boolean }
  conformance: { pdfuaIdentifierPresent: boolean; pdfua: "not_verified"; wcag: "not_verified" }
  validation: { status: "passed" | "failed" | "not_run"; checks: PdfValidationCheck[] }
  /** Reading order is never rewritten; it is preserved but not assessed. */
  readingOrder: "preserved_not_verified"
  limitations: { code: string; message: string }[]
}

export type PdfInsertWarning = { code: string; message: string }

export type PdfInsertReport = {
  items: PdfInsertItem[]
  updated: number
  unchanged: number
  unsupported: number
  failed: number
  pictureCount: number
  uniqueMediaCount: number
  existingAltTextPreserved: number
  warnings: PdfInsertWarning[]
  pdf: PdfRemediationDetails
}

export type PdfInsertFailureCode =
  | "INVALID_DOCUMENT"
  | "ENCRYPTED_DOCUMENT"
  | "SIGNED_DOCUMENT"
  | "UNTAGGED_PDF"
  | "SCANNED_PDF"
  | "TOO_MANY_IMAGES"
  | "RESOURCE_LIMIT"
  | "UNSUPPORTED_STRUCTURE"
  | "OUTPUT_TOO_LARGE"
  | "VERIFICATION_FAILED"

export type PdfInsertResult =
  | { ok: true; output: Buffer | null; report: PdfInsertReport }
  | { ok: false; code: PdfInsertFailureCode; message: string; details?: PdfRemediationDetails }

export const PDF_INSERT_LIMITS = { maxTextChars: 4000, maxFieldNodes: 5000, maxTreeNodes: 20_000, maxXmpBytes: 4 * 1024 * 1024 } as const

/* ---------- pdf-lib helpers ---------- */

const n = (name: string) => PDFName.of(name)

function look(ctx: PDFContext, v: PDFObject | undefined): PDFObject | undefined {
  let cur = v
  for (let i = 0; i < 8 && cur instanceof PDFRef; i++) cur = ctx.lookup(cur)
  return cur instanceof PDFRef ? undefined : cur
}
const dictOf = (ctx: PDFContext, v: PDFObject | undefined) => {
  const o = look(ctx, v)
  return o instanceof PDFDict ? o : o instanceof PDFStream ? o.dict : null
}
const numOf = (ctx: PDFContext, v: PDFObject | undefined) => {
  const o = look(ctx, v)
  return o instanceof PDFNumber ? o.asNumber() : null
}
const nameOf = (ctx: PDFContext, v: PDFObject | undefined) => {
  const o = look(ctx, v)
  return o instanceof PDFName ? o.decodeText() : null
}
const arrOf = (ctx: PDFContext, v: PDFObject | undefined) => {
  const o = look(ctx, v)
  return o instanceof PDFArray ? o.asArray() : null
}
const textOf = (ctx: PDFContext, v: PDFObject | undefined) => {
  const o = look(ctx, v)
  return o instanceof PDFString || o instanceof PDFHexString ? decodePdfText(o.asBytes()) : null
}

function objBytes(o: PDFObject): Uint8Array {
  const b = new Uint8Array(o.sizeInBytes())
  o.copyBytesInto(b, 0)
  return b
}
const latin1 = (b: Uint8Array) => Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString("latin1")
const ascii = (s: string) => Uint8Array.from(Buffer.from(s, "latin1"))

function parseRef(tag: string | null): PDFRef | null {
  const m = tag ? /^(\d+) (\d+) R$/.exec(tag) : null
  return m ? PDFRef.of(Number(m[1]), Number(m[2])) : null
}

/* ---------- Document inspection ---------- */

/** Signed or certified: rewriting (even incrementally) is outside the authorised output policy. */
function isSigned(ctx: PDFContext, catalog: PDFDict): boolean {
  if (catalog.has(n("Perms"))) return true
  const acro = dictOf(ctx, catalog.get(n("AcroForm")))
  if (!acro) return false
  const flags = numOf(ctx, acro.get(n("SigFlags")))
  if (flags != null && (flags & 1) === 1) return true
  const stack = [...(arrOf(ctx, acro.get(n("Fields"))) ?? [])]
  let visited = 0
  while (stack.length > 0 && visited++ < PDF_INSERT_LIMITS.maxFieldNodes) {
    const f = dictOf(ctx, stack.pop())
    if (!f) continue
    if (nameOf(ctx, f.get(n("FT"))) === "Sig" && f.has(n("V"))) return true
    stack.push(...(arrOf(ctx, f.get(n("Kids"))) ?? []))
  }
  return false
}

/** Reports (never adds) an existing PDF/UA identifier in the XMP metadata. */
function hasPdfUaIdentifier(ctx: PDFContext, catalog: PDFDict): boolean {
  const meta = look(ctx, catalog.get(n("Metadata")))
  if (!(meta instanceof PDFRawStream) || meta.contents.length > PDF_INSERT_LIMITS.maxXmpBytes) return false
  try {
    return /pdfuaid:part/.test(latin1(decodePDFRawStream(meta).decode()))
  } catch {
    return false
  }
}

function numberTreeGet(ctx: PDFContext, node: PDFObject | undefined, key: number, budget: { left: number }, depth = 0): PDFObject | undefined {
  if (depth > 32 || budget.left-- <= 0) return undefined
  const d = dictOf(ctx, node)
  if (!d) return undefined
  const nums = arrOf(ctx, d.get(n("Nums")))
  if (nums) for (let i = 0; i + 1 < nums.length; i += 2) if (numOf(ctx, nums[i]) === key) return nums[i + 1]
  for (const kid of arrOf(ctx, d.get(n("Kids"))) ?? []) {
    const kd = dictOf(ctx, kid)
    const limits = kd ? arrOf(ctx, kd.get(n("Limits")))?.map((x) => numOf(ctx, x)) : null
    if (limits && limits.length === 2 && limits[0] != null && limits[1] != null && (key < limits[0] || key > limits[1])) continue
    const found = numberTreeGet(ctx, kid, key, budget, depth + 1)
    if (found !== undefined) return found
  }
  return undefined
}

type ParentCheck = "consistent" | "missing" | "mismatch"

/** ParentTree[page.StructParents][mcid] must be the Figure or one of its descendants. */
function checkParentTree(ctx: PDFContext, structRoot: PDFDict, page: PDFDict | null, mcid: number, figureTag: string): ParentCheck {
  const key = page ? numOf(ctx, page.get(n("StructParents"))) : null
  if (key == null || !structRoot.has(n("ParentTree"))) return "missing"
  const entry = arrOf(ctx, numberTreeGet(ctx, structRoot.get(n("ParentTree")), key, { left: PDF_INSERT_LIMITS.maxTreeNodes }))
  const target = entry?.[mcid]
  if (!(target instanceof PDFRef)) return "missing"
  let cur: PDFRef | null = target
  for (let i = 0; i < 64 && cur; i++) {
    if (cur.tag === figureTag) return "consistent"
    const p: PDFObject | undefined = dictOf(ctx, cur)?.get(n("P"))
    cur = p instanceof PDFRef ? p : null
  }
  return "mismatch"
}

function pageDicts(doc: PDFDocument): PDFDict[] | null {
  try {
    return doc.getPages().map((p) => p.node)
  } catch {
    return null
  }
}

/* ---------- Classification ---------- */

type Assessment = {
  details: PdfRemediationDetails
  figureUse: Map<string, number>
  structRoot: PDFDict | null
}

function assess(pkg: PdfPackage, doc: PDFDocument, header: string): Assessment {
  const ctx = doc.context
  const catalog = doc.catalog
  const structRoot = dictOf(ctx, catalog.get(n("StructTreeRoot")))
  const k = structRoot ? look(ctx, structRoot.get(n("K"))) : undefined
  const usableTree = !!structRoot && k != null && !(k instanceof PDFArray && k.size() === 0)
  const markInfo = dictOf(ctx, catalog.get(n("MarkInfo")))
  const markedContent = markInfo ? String(look(ctx, markInfo.get(n("Marked")))) === "true" : false

  const content = pkg.occurrences.filter((o) => o.classification !== "mask" && !o.artifact)
  const figureUse = new Map<string, number>()
  for (const o of pkg.occurrences) {
    if (o.structure.association === "resolved" && o.structure.structRef) figureUse.set(o.structure.structRef, (figureUse.get(o.structure.structRef) ?? 0) + 1)
  }
  const isMapped = (o: PdfOccurrence) => o.structure.association === "resolved" && !!o.structure.structRef && figureUse.get(o.structure.structRef) === 1

  const scanned = new Set(pkg.occurrences.filter((o) => o.classification === "likely_scanned_page").map((o) => o.pageIndex))
  const textless = new Set((pkg.text?.pages ?? []).filter((p) => p.runs.length === 0).map((p) => p.pageIndex))
  const scannedNoText = [...scanned].filter((p) => textless.has(p)).length
  const mostlyScanned = scannedNoText > 0 && scannedNoText >= Math.ceil(pkg.totalPages / 2)

  const limitations: PdfRemediationDetails["limitations"] = pkg.report.limitations.map((l) => ({ code: l.code, message: l.message }))
  let taggingStatus: PdfTaggingStatus
  if (mostlyScanned) taggingStatus = "scanned"
  else if (!usableTree) taggingStatus = "untagged"
  else if (content.some((o) => !isMapped(o)) || !markedContent || !structRoot?.has(n("ParentTree")) || limitations.some((l) => l.code === "FORM_MARKED_CONTENT")) {
    taggingStatus = "partially_tagged"
  } else taggingStatus = "tagged"

  if (scanned.size > 0 && !mostlyScanned) {
    limitations.push({ code: "SCANNED_PAGES", message: `${scanned.size} page${scanned.size === 1 ? " is" : "s are"} mostly a scanned image and may need OCR and tagging.` })
  }
  if (pkg.report.vectorOnlyPages > 0) {
    limitations.push({ code: "VECTOR_GRAPHICS", message: `${pkg.report.vectorOnlyPages} page${pkg.report.vectorOnlyPages === 1 ? " has" : "s have"} vector artwork only; vector figures are not extracted or remediated here.` })
  }

  return {
    structRoot,
    figureUse,
    details: {
      taggingStatus,
      pdfVersion: /^%PDF-(\d\.\d)/.exec(header)?.[1] ?? null,
      totalPages: pkg.totalPages,
      imageOccurrences: pkg.occurrences.length,
      uniqueImages: new Set(pkg.occurrences.map((o) => o.cacheKey)).size,
      mappedFigures: content.filter(isMapped).length,
      ambiguousOccurrences: content.filter((o) => o.structure.association === "ambiguous" || (o.structure.association === "resolved" && !isMapped(o))).length,
      unmappedOccurrences: content.filter((o) => ["no_figure", "unresolved", "untagged"].includes(o.structure.association)).length,
      artifactOccurrences: pkg.occurrences.filter((o) => o.artifact).length,
      scannedPages: scanned.size,
      scannedPagesWithoutText: scannedNoText,
      vectorOnlyPages: pkg.report.vectorOnlyPages,
      decorativeProcessed: 0,
      manualRemediationRequired: 0,
      structure: { structTreeRoot: !!structRoot, markedContent, parentTree: !!structRoot?.has(n("ParentTree")), roleMap: !!structRoot?.has(n("RoleMap")) },
      conformance: { pdfuaIdentifierPresent: hasPdfUaIdentifier(ctx, catalog), pdfua: "not_verified", wcag: "not_verified" },
      validation: { status: "not_run", checks: [] },
      readingOrder: "preserved_not_verified",
      limitations,
    },
  }
}

/* ---------- Incremental update writer ---------- */

type Written = { num: number; gen: number; offset: number }

function buildIncrementalUpdate(src: Uint8Array, ctx: PDFContext, objects: { ref: PDFRef; value: PDFObject }[]): { ok: true; bytes: Uint8Array; written: Written[] } | { ok: false; message: string } {
  const buf = Buffer.from(src.buffer, src.byteOffset, src.byteLength)
  const tailStart = Math.max(0, buf.length - 4096)
  const tail = buf.subarray(tailStart).toString("latin1")
  const sx = /startxref\s+(\d+)\s*%%EOF\s*$/.exec(tail) ?? /startxref\s+(\d+)/.exec(tail.slice(tail.lastIndexOf("startxref")))
  const prev = sx ? Number(sx[1]) : NaN
  if (!Number.isSafeInteger(prev) || prev <= 0 || prev >= buf.length) return { ok: false, message: "The PDF cross-reference location could not be read." }

  const at = buf.subarray(prev, Math.min(buf.length, prev + 8192)).toString("latin1")
  let prevSize: number | null = null
  let kind: "table" | "stream"
  if (/^\s*xref/.test(at)) {
    kind = "table"
    const t = buf.indexOf("trailer", prev, "latin1")
    if (t < 0) return { ok: false, message: "The PDF trailer could not be read." }
    const trailer = buf.subarray(t, Math.min(buf.length, t + 8192)).toString("latin1")
    prevSize = Number(/\/Size\s+(\d+)/.exec(trailer)?.[1] ?? NaN)
  } else if (/^\s*\d+\s+\d+\s+obj\s*<</.test(at) && /\/Type\s*\/XRef/.test(at.slice(0, at.indexOf("stream") > 0 ? at.indexOf("stream") : at.length))) {
    kind = "stream"
    prevSize = Number(/\/Size\s+(\d+)/.exec(at)?.[1] ?? NaN)
  } else {
    return { ok: false, message: "The PDF cross-reference data is inconsistent, so it cannot be updated safely." }
  }
  if (!Number.isSafeInteger(prevSize) || prevSize == null || prevSize <= 0) return { ok: false, message: "The PDF cross-reference size could not be read." }

  const { Root, Info, ID } = ctx.trailerInfo
  if (!(Root instanceof PDFRef)) return { ok: false, message: "The PDF catalog reference could not be read." }

  const parts: Uint8Array[] = [src]
  let pos = src.length
  const push = (b: Uint8Array) => {
    parts.push(b)
    pos += b.length
  }
  const last = src[src.length - 1]
  if (last !== 0x0a && last !== 0x0d) push(ascii("\n"))

  const written: Written[] = []
  for (const { ref, value } of [...objects].sort((a, b) => a.ref.objectNumber - b.ref.objectNumber)) {
    written.push({ num: ref.objectNumber, gen: ref.generationNumber, offset: pos })
    push(ascii(`${ref.objectNumber} ${ref.generationNumber} obj\n`))
    push(objBytes(value))
    push(ascii("\nendobj\n"))
  }

  const trailerTail = () => {
    const p: Uint8Array[] = [ascii(` /Root ${Root.toString()}`)]
    if (Info instanceof PDFRef) p.push(ascii(` /Info ${Info.toString()}`))
    if (ID) p.push(ascii(" /ID "), objBytes(ID))
    p.push(ascii(` /Prev ${prev}`))
    return p
  }

  const xrefOffset = pos
  if (kind === "table") {
    const size = Math.max(prevSize, ctx.largestObjectNumber + 1)
    let section = "xref\n"
    for (const w of written) section += `${w.num} 1\n${String(w.offset).padStart(10, "0")} ${String(w.gen).padStart(5, "0")} n\r\n`
    push(ascii(`${section}trailer\n<< /Size ${size}`))
    for (const p of trailerTail()) push(p)
    push(ascii(` >>\nstartxref\n${xrefOffset}\n%%EOF\n`))
  } else {
    const selfNum = Math.max(prevSize, ctx.largestObjectNumber + 1)
    const entries = [...written, { num: selfNum, gen: 0, offset: xrefOffset }]
    if (entries.some((e) => e.offset > 0xffffffff || e.gen > 0xffff)) return { ok: false, message: "The PDF is too large to update safely." }
    const data = new Uint8Array(entries.length * 7)
    entries.forEach((e, i) => {
      const o = i * 7
      data[o] = 1
      data[o + 1] = (e.offset >>> 24) & 0xff
      data[o + 2] = (e.offset >>> 16) & 0xff
      data[o + 3] = (e.offset >>> 8) & 0xff
      data[o + 4] = e.offset & 0xff
      data[o + 5] = (e.gen >>> 8) & 0xff
      data[o + 6] = e.gen & 0xff
    })
    push(ascii(`${selfNum} 0 obj\n<< /Type /XRef /Size ${selfNum + 1} /W [1 4 2] /Index [${entries.map((e) => `${e.num} 1`).join(" ")}]`))
    for (const p of trailerTail()) push(p)
    push(ascii(` /Length ${data.length} >>\nstream\n`))
    push(data)
    push(ascii(`\nendstream\nendobj\nstartxref\n${xrefOffset}\n%%EOF\n`))
    written.push({ num: selfNum, gen: 0, offset: xrefOffset })
  }

  const out = new Uint8Array(pos)
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  return { ok: true, bytes: out, written }
}

/* ---------- Main entry ---------- */

type Target = { item: PdfInsertItem; ref: PDFRef; dict: PDFDict; text: string; preserved: Uint8Array }

const withoutAlt = (dict: PDFDict) => {
  const copy = dict.clone()
  copy.delete(n("Alt"))
  return objBytes(copy)
}
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0

const UNMAPPED_MESSAGES: Record<string, { code: string; message: string }> = {
  ambiguous: { code: "AMBIGUOUS_FIGURE", message: "Several images share one tagged marked-content sequence, so the Figure cannot be tied to this image. Manual remediation is required." },
  no_figure: { code: "NO_FIGURE_TAG", message: "This image is tagged, but not inside a Figure structure element. Manual tagging is required." },
  unresolved: { code: "NOT_MARKED", message: "This image is not enclosed in tagged marked content (or sits inside a form XObject). Manual tagging is required." },
  untagged: { code: "UNTAGGED_PDF", message: "This PDF has no tag structure, so alt text cannot be attached safely." },
}

/**
 * Applies approved descriptions to reliably mapped Figure elements of a copy of `source`.
 * The source buffer is never modified. `dryRun` performs every check but writes nothing.
 */
export async function remediatePdfAltText(source: Uint8Array, instructions: PdfInsertInstruction[], opts: { maxOutputBytes: number; dryRun?: boolean }): Promise<PdfInsertResult> {
  const src = new Uint8Array(source)
  let pkg: PdfPackage
  try {
    pkg = await readPdfPackage(src, { collectText: true, retainDocument: true })
  } catch (err) {
    if (err instanceof PdfPackageError) {
      const code = (["ENCRYPTED_DOCUMENT", "TOO_MANY_IMAGES", "RESOURCE_LIMIT"] as const).find((c) => c === err.code) ?? "INVALID_DOCUMENT"
      return { ok: false, code, message: err.message }
    }
    return { ok: false, code: "INVALID_DOCUMENT", message: "The PDF could not be read." }
  }
  const doc = pkg.document
  if (!doc) return { ok: false, code: "INVALID_DOCUMENT", message: "The PDF could not be read." }
  const ctx = doc.context

  const { details, figureUse, structRoot } = assess(pkg, doc, latin1(src.subarray(0, 16)))
  if (isSigned(ctx, doc.catalog)) {
    return {
      ok: false,
      code: "SIGNED_DOCUMENT",
      message: "This PDF is digitally signed or certified. Changing it could invalidate the signature, so alt text was not inserted.",
      details: { ...details, taggingStatus: "protected" },
    }
  }
  if (details.taggingStatus === "scanned") {
    return {
      ok: false,
      code: "SCANNED_PDF",
      message: "This PDF consists mostly of scanned pages without a text layer. It needs OCR, tagging and reading-order work before alt text can be attached; approved descriptions remain saved in the ERP.",
      details,
    }
  }
  if (details.taggingStatus === "untagged") {
    return {
      ok: false,
      code: "UNTAGGED_PDF",
      message: "This PDF has no usable tag structure, so there are no Figure elements to receive alt text. Structural tagging is required; approved descriptions remain saved in the ERP.",
      details,
    }
  }

  const byLocator = new Map(pkg.occurrences.map((o) => [o.sourceLocator, o]))
  const pages = pageDicts(doc)
  const items: PdfInsertItem[] = []
  const targets: Target[] = []
  const seen = new Set<string>()
  const edited = new Set<string>()
  let parentTreeMissing = 0
  let decorativeProcessed = 0

  for (const ins of instructions) {
    const occ = byLocator.get(ins.sourceLocator)
    const base = { occurrenceId: ins.occurrenceId, sourceLocator: ins.sourceLocator, pageNumber: occ?.pageNumber ?? null, previousDescription: occ?.structure.alt ?? null, decorative: ins.decorative }
    const report = (status: PdfInsertItemStatus, code: string, message: string) => items.push({ ...base, status, code, message })

    if (!occ) {
      report("failed", "LOCATOR_NOT_FOUND", "This image could not be found in the original PDF at its recorded location.")
      continue
    }
    if (seen.has(ins.sourceLocator)) {
      report("failed", "DUPLICATE_INSTRUCTION", "This image location was targeted more than once.")
      continue
    }
    seen.add(ins.sourceLocator)
    if (occ.classification === "likely_scanned_page") {
      report("unsupported", "SCANNED_PAGE", "This image covers a whole scanned page. It needs OCR and structural tagging rather than a one-line description.")
      continue
    }
    if (occ.classification === "mask") {
      report("unsupported", "MASK_IMAGE", "This image is a mask used by another image and cannot carry alt text.")
      continue
    }
    if (ins.decorative) {
      if (occ.artifact) {
        decorativeProcessed++
        report("unchanged", "ALREADY_ARTIFACT", "Already marked as a decorative artifact in the PDF; no change was needed.")
      } else {
        report("unsupported", "DECORATIVE_RETAG_UNSUPPORTED", "Marking this image as a decorative artifact requires content-stream and structure-tree changes that cannot be made safely here. Manual remediation is required.")
      }
      continue
    }
    if (occ.artifact) {
      report("unsupported", "ARTIFACT_CONTENT", "This image is marked as a decorative artifact in the PDF. Tagging it as a Figure requires manual remediation.")
      continue
    }
    const s = occ.structure
    if (s.association !== "resolved") {
      const m = UNMAPPED_MESSAGES[s.association] ?? UNMAPPED_MESSAGES.unresolved
      report("unsupported", m.code, m.message)
      continue
    }
    const ref = parseRef(s.structRef)
    if (!ref) {
      report("unsupported", "FIGURE_NOT_INDIRECT", "The Figure element is stored inline and cannot be updated safely.")
      continue
    }
    if ((figureUse.get(s.structRef!) ?? 0) > 1 || edited.has(s.structRef!)) {
      report("unsupported", "FIGURE_SHARED", "One Figure element contains several images, so a single description cannot be tied to this image. Manual remediation is required.")
      continue
    }
    const dict = look(ctx, ref)
    if (!(dict instanceof PDFDict)) {
      report("unsupported", "FIGURE_UNREADABLE", "The Figure element could not be read.")
      continue
    }
    if (structRoot && s.mcid != null) {
      const check = checkParentTree(ctx, structRoot, pages?.[occ.pageIndex] ?? null, s.mcid, s.structRef!)
      if (check === "mismatch") {
        report("unsupported", "PARENT_TREE_MISMATCH", "The PDF's ParentTree links this image to a different structure element. Manual remediation is required.")
        continue
      }
      if (check === "missing") parentTreeMissing++
    }
    const text = ins.text
    if (!text.trim()) {
      report("failed", "EMPTY_DESCRIPTION", "The approved description is empty.")
      continue
    }
    if (text.length > PDF_INSERT_LIMITS.maxTextChars) {
      report("failed", "DESCRIPTION_TOO_LONG", "The approved description is too long for PDF alt text.")
      continue
    }
    const current = textOf(ctx, dict.get(n("Alt")))
    if (current === text) {
      report("unchanged", "ALREADY_CURRENT", "The PDF already contains this approved description.")
      continue
    }
    edited.add(s.structRef!)
    const item: PdfInsertItem = {
      ...base,
      previousDescription: current,
      status: "updated",
      code: current ? "REPLACED" : "ADDED",
      message: current ? "The existing description was replaced with the approved version." : "The approved description was added to the Figure.",
    }
    items.push(item)
    targets.push({ item, ref, dict, text, preserved: withoutAlt(dict) })
  }

  const instructed = new Set(instructions.map((i) => i.sourceLocator))
  const willHaveAlt = new Set(items.filter((i) => i.status === "updated" || (i.status === "unchanged" && !i.decorative)).map((i) => i.sourceLocator))
  let existingAltTextPreserved = 0
  const manual = new Set<string>()
  for (const o of pkg.occurrences) {
    if (o.classification === "mask") continue
    if (o.artifact) continue
    const mapped = o.structure.association === "resolved" && !!o.structure.structRef && figureUse.get(o.structure.structRef) === 1
    if (mapped && o.structure.alt && !instructed.has(o.sourceLocator)) existingAltTextPreserved++
    if (!mapped || (!o.structure.alt && !willHaveAlt.has(o.sourceLocator))) manual.add(o.sourceLocator)
  }
  for (const i of items) if (i.status === "unsupported" || i.status === "failed") manual.add(i.sourceLocator)

  const warnings: PdfInsertWarning[] = [
    { code: "DETAILED_DESCRIPTION_RETAINED", message: "Detailed descriptions remain saved in the ERP and are not embedded in the PDF; only the short alt text is written to Figure tags." },
    { code: "CONFORMANCE_NOT_VERIFIED", message: "PDF/UA and WCAG conformance are not verified by this export. Screen-reader and full standards review are still required." },
  ]
  if (parentTreeMissing > 0) {
    warnings.push({ code: "PARENT_TREE_MISSING", message: `${parentTreeMissing} updated figure${parentTreeMissing === 1 ? " has" : "s have"} no ParentTree entry; the Figure tag itself was used for the association.` })
  }
  if (details.conformance.pdfuaIdentifierPresent) {
    warnings.push({ code: "PDFUA_IDENTIFIER_PRESERVED", message: "The PDF already declares PDF/UA. The declaration was left unchanged and has not been re-verified." })
  }

  const finalDetails: PdfRemediationDetails = { ...details, decorativeProcessed, manualRemediationRequired: manual.size }
  const count = (s: PdfInsertItemStatus) => items.filter((i) => i.status === s).length
  const report: PdfInsertReport = {
    items,
    updated: count("updated"),
    unchanged: count("unchanged"),
    unsupported: count("unsupported"),
    failed: count("failed"),
    pictureCount: pkg.occurrences.length,
    uniqueMediaCount: details.uniqueImages,
    existingAltTextPreserved,
    warnings,
    pdf: finalDetails,
  }

  if (opts.dryRun || targets.length === 0) return { ok: true, output: null, report }

  for (const t of targets) t.dict.set(n("Alt"), PDFHexString.fromText(t.text))
  const built = buildIncrementalUpdate(src, ctx, targets.map((t) => ({ ref: t.ref, value: t.dict })))
  if (!built.ok) return { ok: false, code: "UNSUPPORTED_STRUCTURE", message: built.message, details: finalDetails }
  if (built.bytes.length > opts.maxOutputBytes) return { ok: false, code: "OUTPUT_TOO_LARGE", message: "The updated PDF would be too large to store." }

  const checks = await verifyOutput(src, built.bytes, built.written, pkg, targets)
  finalDetails.validation = { status: checks.every((c) => c.passed) ? "passed" : "failed", checks }
  if (finalDetails.validation.status === "failed") {
    const failed = checks.filter((c) => !c.passed).map((c) => c.code)
    console.error("[alt-text/pdf-remediation] verification failed", failed.join(","))
    return { ok: false, code: "VERIFICATION_FAILED", message: "The updated PDF did not pass verification, so it was not saved.", details: finalDetails }
  }
  return { ok: true, output: Buffer.from(built.bytes), report }
}

/* ---------- Output validation ---------- */

async function verifyOutput(src: Uint8Array, out: Uint8Array, written: Written[], before: PdfPackage, targets: Target[]): Promise<PdfValidationCheck[]> {
  const checks: PdfValidationCheck[] = []
  const add = (code: string, passed: boolean, message: string) => checks.push({ code, passed, message })

  add("ORIGINAL_BYTES_PRESERVED", sameBytes(out.subarray(0, src.length), src), "Every byte of the original PDF is kept; changes are appended as an incremental update.")
  const outBuf = Buffer.from(out.buffer, out.byteOffset, out.byteLength)
  add(
    "XREF_OFFSETS_VALID",
    written.every((w) => outBuf.subarray(w.offset, w.offset + 32).toString("latin1").startsWith(`${w.num} ${w.gen} obj`)),
    "New cross-reference entries point at the appended objects.",
  )

  let after: PdfPackage
  try {
    after = await readPdfPackage(out, { retainDocument: true })
  } catch {
    add("REOPENS", false, "The updated PDF could not be reopened.")
    return checks
  }
  add("REOPENS", true, "The updated PDF opens and its pages, images and tags can be read.")
  add("PAGE_COUNT_PRESERVED", after.totalPages === before.totalPages, "Page count is unchanged.")

  const sameOccurrences =
    after.occurrences.length === before.occurrences.length &&
    after.occurrences.every((o, i) => {
      const b = before.occurrences[i]
      return o.sourceLocator === b.sourceLocator && o.structure.association === b.structure.association && o.structure.structRef === b.structure.structRef && o.structure.mcid === b.structure.mcid
    })
  add("FIGURE_ASSOCIATIONS_PRESERVED", sameOccurrences, "Every image keeps its location, MCID and Figure association.")

  const expected = new Map(targets.map((t) => [t.item.sourceLocator, t.text]))
  const byLoc = new Map(after.occurrences.map((o) => [o.sourceLocator, o]))
  add("ALT_TEXT_WRITTEN", [...expected].every(([loc, text]) => byLoc.get(loc)?.structure.alt === text), "Approved descriptions are readable on the intended Figure tags.")
  add(
    "UNRELATED_ALT_UNCHANGED",
    before.occurrences.every((b) => expected.has(b.sourceLocator) || byLoc.get(b.sourceLocator)?.structure.alt === b.structure.alt),
    "No other figure description was changed.",
  )

  const doc = after.document
  const ctx = doc?.context
  add(
    "STRUCTURE_ELEMENTS_PRESERVED",
    !!ctx &&
      targets.every((t) => {
        const d = look(ctx, t.ref)
        return d instanceof PDFDict && sameBytes(withoutAlt(d), t.preserved)
      }),
    "Updated Figure elements keep every other entry (role, parent, children, page, attributes).",
  )
  const beforeRoot = before.document?.catalog.get(n("StructTreeRoot"))
  const afterRoot = doc?.catalog.get(n("StructTreeRoot"))
  add(
    "STRUCTURE_TREE_PRESERVED",
    !!beforeRoot && !!afterRoot && String(beforeRoot) === String(afterRoot) && after.report.tagged === before.report.tagged,
    "The structure tree root, ParentTree and RoleMap are unchanged.",
  )
  return checks
}
