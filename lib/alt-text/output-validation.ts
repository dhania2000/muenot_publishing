/**
 * @file lib/alt-text/output-validation.ts
 * @module Publishing · Alt Text
 * @kind Server-side library (pure — no DB, no storage)
 * @summary Phase 3 Task 18 — read-only quality validation of an accessible DOCX / PPTX / PDF output
 *   against its original and the approved-version snapshot recorded at export time.
 *   Reuses the Task 15–17 package readers (the same parsers the inserters use) so what is checked is
 *   exactly what was written. Neither buffer is modified. Visual rendering, PDF/UA conformance and
 *   human-judgement checks are reported as Not Verified / Manual Review — never as passed.
 */
import "server-only"
import {documentProvenanceChecks} from "./document-export-provenance"
import { createHash } from "node:crypto"
import { XMLValidator } from "fast-xml-parser"
import { readZipDirectory, readZipEntryBytes, validateDocumentBytes } from "./document-validation"
import { docxPartRegion, parseDocxLocator } from "./docx-locator"
import { inspectDocxPictures, normalizeAltText, type DocxPartSnapshot } from "./docx-alt-text-inserter"
import type { AccessibleExportFormat, DocxExportItemStatus } from "./docx-export-contract"
import { rawEntryMap } from "./ooxml-zip-rewrite"
import type { CheckLocation, CheckStatus, Severity, ValidationCategory, ValidationCheck } from "./output-validation-contract"
import { readPdfPackage, type PdfPackage } from "./pdf-package"
import { readPptxPackage, type PptxPackage } from "./pptx-package"
import { terminologyIssues,TERMINOLOGY_RULE_VERSION } from "./terminology-policy"

export type ExpectedOccurrence = {
  assetId?:number|null
  currentSourceLocator?:string|null
  sourceLocatorSnapshotVerified?:boolean
  accessibility?:import("./document-accessibility-contract").DocumentAccessibilitySnapshot
  outputLanguage?: "en"|"hi"
  occurrenceId: number
  sourceLocator: string
  exportStatus: DocxExportItemStatus
  exportCode: string
  exportMessage: string
  decorative: boolean
  /** Version id recorded on the export row for this occurrence (Task 14 immutable version). */
  approvedVersionId: number | null
  approvedVersion: number | null
  /** `short_alt` of that exact version; null when the version row could not be found. */
  approvedText: string | null
  versionFound: boolean
  /** The occurrence's approval *now* — differs from approvedVersionId when approvals moved after export. */
  currentApprovedVersionId: number | null
  location: CheckLocation | null
}

export type ValidationInput = {
  format: AccessibleExportFormat
  original: Buffer
  /** null when the stored output could not be read. */
  output: Buffer | null
  outputReadError?: string | null
  record: { sourceChecksum: string | null; outputChecksum: string | null; sizeBytes: number | null; policy: string }
  occurrences: ExpectedOccurrence[]
  shortMaxChars: number
}

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex")
const chars = (s: string) => [...s].length
const SNIPPET = 120
const snippet = (s: string) => (chars(s) > SNIPPET ? `${[...s].slice(0, SNIPPET).join("")}…` : s)

/* ---------- check builder ---------- */

type Spec = {
  ruleId: string
  category: ValidationCategory
  severity: Severity
  title: string
  description: string
  machineCheckable?: boolean
  recommendation?: string | null
}

class Checks {
  readonly list: ValidationCheck[] = []
  add(spec: Spec, status: CheckStatus, actual: string, extra: { occurrenceId?: number | null; location?: CheckLocation | null; expectedVersionId?: number | null; recommendation?: string | null } = {}) {
    const id = extra.occurrenceId != null ? `${spec.ruleId}:${extra.occurrenceId}` : spec.ruleId
    this.list.push({
      id,
      ruleId: spec.ruleId,
      category: spec.category,
      severity: spec.severity,
      status,
      title: spec.title,
      description: spec.description,
      machineCheckable: spec.machineCheckable ?? true,
      location: extra.location ?? null,
      occurrenceId: extra.occurrenceId ?? null,
      expectedVersionId: extra.expectedVersionId ?? null,
      actual,
      recommendation: status === "passed" || status === "not_applicable" ? null : (extra.recommendation ?? spec.recommendation ?? null),
    })
  }
}

const REVIEW_FIX = "Correct the description through Alt Text review, then generate a new accessible document. Validation never edits files."

const R = {
  outputPresent: { ruleId: "FI-001", category: "file_integrity", severity: "critical", title: "Output file present", description: "The stored output exists and its size matches the export record.", recommendation: "Generate a new accessible document." },
  outputChecksum: { ruleId: "FI-002", category: "file_integrity", severity: "critical", title: "Output checksum", description: "The stored output's SHA-256 matches the checksum recorded when it was produced.", recommendation: "The stored file changed after export. Generate a new accessible document." },
  outputParses: { ruleId: "FI-003", category: "file_integrity", severity: "critical", title: "Output opens with supported parsers", description: "The output passes package validation and the same parser used for extraction and insertion.", recommendation: "Do not distribute this file. Generate a new accessible document." },
  originalChecksum: { ruleId: "FI-004", category: "file_integrity", severity: "critical", title: "Original unchanged", description: "The original upload's SHA-256 still matches the checksum recorded at export.", recommendation: "The original file changed. Re-upload the document and re-run the workflow." },
  versionResolved: { ruleId: "AT-001", category: "alt_text", severity: "high", title: "Approved version resolved", description: "The approved version used at export can be retrieved.", recommendation: "Re-approve the image in Alt Text review and generate a new accessible document." },
  located: { ruleId: "AT-002", category: "alt_text", severity: "critical", title: "Correct occurrence updated", description: "The picture/figure at the occurrence's source locator is found in the output and is the same element as in the original (not just the same image binary).", recommendation: REVIEW_FIX },
  matches: { ruleId: "AT-003", category: "alt_text", severity: "critical", title: "Inserted text matches approved version", description: "The description read from the output equals the approved text (whitespace-normalised, exact Unicode), with no truncation.", recommendation: REVIEW_FIX },
  decorative: { ruleId: "AT-004", category: "alt_text", severity: "critical", title: "Decorative treatment applied", description: "An approved decorative decision is written as native decorative metadata with an empty description.", recommendation: REVIEW_FIX },
  quality: { ruleId: "QR-001", category: "accessibility", severity: "medium", title: "Description quality rules", description: "Encoding corruption, placeholder text, empty text on a non-decorative image and the configured short-description length.", recommendation: "Review the description in Alt Text review." },
  stale: { ruleId: "UC-002", category: "unapproved_content", severity: "medium", title: "Approval current", description: "The approval used for this output is still the occurrence's current approval.", recommendation: "Approvals changed after this output was produced. Generate a new accessible document to include the latest approval." },
  preserved: { ruleId: "UC-001", category: "unapproved_content", severity: "critical", title: "Source description preserved", description: "An occurrence that was not authorised for replacement keeps exactly its original description and decorative flag.", recommendation: "Unauthorised content was written. Do not distribute this file; report the issue." },
  unmapped: { ruleId: "UC-003", category: "unapproved_content", severity: "critical", title: "Unmapped pictures unchanged", description: "Pictures that are not mapped occurrences keep their original description.", recommendation: "Unauthorised content was written. Do not distribute this file; report the issue." },
  missingAlt: { ruleId: "AS-001", category: "accessibility", severity: "high", title: "Required alt text present", description: "Non-decorative images without an inserted approved description and without an existing description.", recommendation: "Approve a description (or mark decorative) in Alt Text review, then generate a new accessible document." },
  unsupported: { ruleId: "AS-002", category: "accessibility", severity: "medium", title: "Occurrence could be updated", description: "Occurrences the export skipped as unsupported or failed (text boxes, charts, ambiguous mappings, …).", recommendation: "Add this description manually in the authoring application." },
  duplicates: { ruleId: "AS-006", category: "accessibility", severity: "low", title: "Repeated descriptions", description: "Different occurrences share identical descriptions. This is not an error by itself (repeated logos legitimately share text) but should be reviewed.", machineCheckable: false, recommendation: "Confirm each repeated description is appropriate in its context." },
} satisfies Record<string, Spec>

const PLACEHOLDER = /^(image|picture|photo|graphic|figure|img|untitled|placeholder|todo|tbd|alt text|description|n\/?a|null|undefined|lorem ipsum.*|\S+\.(png|jpe?g|gif|bmp|tiff?|svg|emf|wmf|webp))$/i

/* ---------- normalised picture snapshots ---------- */

type Pic = { key: string; identity: string; description: string | null; decorative: boolean | null; location: CheckLocation }
type Snapshot = { pics: Map<string, Pic>; keyFor: (locator: string) => { key: string; identityHint: string | null } | null; locatable: boolean }

function docxSnapshot(parts: Map<string, DocxPartSnapshot>): Snapshot {
  const pics = new Map<string, Pic>()
  for (const p of parts.values()) {
    if ("error" in p) continue
    for (const d of p.pictures) {
      const key = `${p.name}#${d.ordinal}`
      pics.set(key, {
        key,
        identity: `${d.docPrId}|${d.relId}|${d.mediaTarget}|${d.placement}|${d.nested}`,
        description: d.descr,
        decorative: d.decorative,
        location: { region: docxPartRegion(p.name), part: p.name },
      })
    }
  }
  return {
    pics,
    locatable: true,
    keyFor: (locator) => {
      const l = parseDocxLocator(locator)
      return l ? { key: `${l.part}#${l.ordinal}`, identityHint: `${l.docPrId}|${l.relId}|` } : null
    },
  }
}

function pptxSnapshot(pkg: PptxPackage): Snapshot {
  const pics = new Map<string, Pic>()
  for (const o of pkg.occurrences) {
    pics.set(o.sourceLocator, {
      key: o.sourceLocator,
      identity: `${o.slidePart}|${o.shapeId}|${o.groupPath.join("/")}|${o.mediaRelationshipId}|${o.mediaPart}`,
      description: o.description,
      decorative: o.decorative,
      location: { slideNumber: o.slideNumber, region: o.groupPath.length ? "group" : null },
    })
  }
  return { pics, locatable: true, keyFor: (locator) => ({ key: locator, identityHint: null }) }
}

function pdfSnapshot(pkg: PdfPackage): Snapshot {
  const pics = new Map<string, Pic>()
  for (const o of pkg.occurrences) {
    const s = o.structure
    pics.set(o.sourceLocator, {
      key: o.sourceLocator,
      identity: `${o.objectRef}|${s.association}|${s.structRef}|${s.mcid}`,
      description: s.association === "resolved" ? s.alt : null,
      decorative: null,
      location: { pageNumber: o.pageNumber },
    })
  }
  return { pics, locatable: true, keyFor: (locator) => ({ key: locator, identityHint: null }) }
}

type Parsed =
  | { ok: true; snapshot: Snapshot; docx?: Map<string, DocxPartSnapshot>; pptx?: PptxPackage; pdf?: PdfPackage }
  | { ok: false; message: string }

async function parse(format: AccessibleExportFormat, buf: Buffer): Promise<Parsed> {
  try {
    if (format === "docx") {
      const r = inspectDocxPictures(buf)
      return r.ok ? { ok: true, snapshot: docxSnapshot(r.parts), docx: r.parts } : { ok: false, message: r.message }
    }
    const valid = validateDocumentBytes(buf, format)
    if (!valid.ok) return { ok: false, message: valid.message }
    if (format === "pptx") {
      const pkg = readPptxPackage(buf)
      return { ok: true, snapshot: pptxSnapshot(pkg), pptx: pkg }
    }
    const pkg = await readPdfPackage(new Uint8Array(buf))
    return { ok: true, snapshot: pdfSnapshot(pkg), pdf: pkg }
  } catch (err) {
    return { ok: false, message: err instanceof Error && err.message.length < 200 ? err.message : "The file could not be parsed." }
  }
}

/* ---------- entry point ---------- */

export async function validateExportOutput(input: ValidationInput): Promise<ValidationCheck[]> {
  const c = new Checks()
  c.list.push(...documentProvenanceChecks(input.occurrences))
  const { format, original, output, record } = input

  // A. File integrity
  if (!output) {
    c.add(R.outputPresent, "failed", input.outputReadError ?? "The stored output could not be read.")
  } else if (record.sizeBytes != null && output.length !== record.sizeBytes) {
    c.add(R.outputPresent, "failed", `Stored size ${output.length} bytes differs from the recorded ${record.sizeBytes} bytes.`)
  } else c.add(R.outputPresent, "passed", `Output present (${output.length} bytes).`)

  if (output) {
    if (!record.outputChecksum) c.add(R.outputChecksum, "not_verified", "No output checksum was recorded for this export.")
    else c.add(R.outputChecksum, sha256(output) === record.outputChecksum ? "passed" : "failed", sha256(output) === record.outputChecksum ? "Checksum matches." : "Checksum differs from the recorded value.")
  } else c.add(R.outputChecksum, "not_executed", "Output not available.")

  if (!record.sourceChecksum) c.add(R.originalChecksum, "not_verified", "No original checksum was recorded for this export.")
  else c.add(R.originalChecksum, sha256(original) === record.sourceChecksum ? "passed" : "failed", sha256(original) === record.sourceChecksum ? "Original checksum unchanged." : "The original file no longer matches its recorded checksum.")

  const before = await parse(format, original)
  const after = output ? await parse(format, output) : null
  if (!after) c.add(R.outputParses, "not_executed", "Output not available.")
  else c.add(R.outputParses, after.ok ? "passed" : "failed", after.ok ? `Valid ${format.toUpperCase()} — parsed successfully.` : `Output could not be parsed: ${after.message}`)

  if (!after?.ok || !before.ok || !output) {
    const why = !before.ok ? `The original could not be parsed (${before.message}).` : "The output is not available or not parseable."
    for (const spec of [R.located, R.matches, R.preserved, R.unmapped]) c.add(spec, "not_executed", why)
    addStructureNotExecuted(c, format, why)
    addManual(c, format)
    return c.list
  }

  // B / C. Per-occurrence alt text and unapproved-content checks
  const mappedKeys = new Set<string>()
  const finalTexts = new Map<string, number[]>()
  for (const occ of input.occurrences) {
    const ref = before.snapshot.keyFor(occ.sourceLocator)
    if (ref) mappedKeys.add(ref.key)
    const src = ref ? before.snapshot.pics.get(ref.key) : undefined
    const out = ref ? after.snapshot.pics.get(ref.key) : undefined
    const loc = out?.location ?? src?.location ?? occ.location
    const ex = { occurrenceId: occ.occurrenceId, location: loc, expectedVersionId: occ.approvedVersionId }
    const inserted = occ.exportStatus === "updated" || occ.exportStatus === "unchanged"

    const finalText = out?.description ? normalizeAltText(out.description) : ""
    if (finalText) finalTexts.set(finalText, [...(finalTexts.get(finalText) ?? []), occ.occurrenceId])

    if (inserted) {
      if (!occ.versionFound || occ.approvedVersionId == null) {
        c.add(R.versionResolved, "failed", occ.approvedVersionId == null ? "The export recorded no approved version for this occurrence." : `Approved version #${occ.approvedVersionId} could not be found.`, ex)
      } else c.add(R.versionResolved, "passed", `Approved version v${occ.approvedVersion ?? "?"} (#${occ.approvedVersionId}).`, ex)

      const identityOk = !!src && !!out && src.identity === out.identity && (!ref?.identityHint || out.identity.startsWith(ref.identityHint))
      if (!out) c.add({ ...R.located, severity: "high" }, "failed", "The mapped picture was not found at its source location in the output.", ex)
      else if (!identityOk) c.add(R.located, "failed", "The element at this location is not the same picture/figure as in the original (cross-occurrence or wrong-element insertion).", ex)
      else c.add(R.located, "passed", "Same element as the original source occurrence.", ex)

      if (occ.decorative) {
        if (!out || !identityOk) c.add(R.decorative, "not_executed", "Occurrence not located.", ex)
        else if (format === "pdf") c.add(R.decorative, "not_verified", "Decorative (artifact) re-tagging of PDF figures is not verified by this validator.", ex)
        else {
          const ok = out.decorative === true && !normalizeAltText(out.description ?? "")
          c.add(R.decorative, ok ? "passed" : "failed", ok ? "Native decorative flag set; description empty." : `Decorative flag ${out.decorative === true ? "set" : "missing"}; description ${out.description ? "present" : "empty"}.`, ex)
        }
      } else if (!occ.versionFound || occ.approvedText == null) {
        c.add(R.matches, "not_executed", "No approved text to compare against.", ex)
      } else if (!out || !identityOk) {
        c.add(R.matches, "not_executed", "Occurrence not located.", ex)
      } else {
        const expected = normalizeAltText(occ.approvedText)
        const actual = normalizeAltText(out.description ?? "")
        if (actual === expected) c.add(R.matches, "passed", `Matches approved version (${chars(expected)} characters).`, ex)
        else if (actual && expected.startsWith(actual)) c.add(R.matches, "failed", `Inserted description is truncated: ${chars(actual)} of ${chars(expected)} characters.`, ex)
        else if (actual.normalize("NFC") === expected.normalize("NFC")) c.add({ ...R.matches, severity: "medium" }, "warning", "Text matches only after Unicode normalisation (NFC); code points differ.", ex)
        else if (!actual) c.add({ ...R.matches, severity: "high" }, "failed", "Approved description was not inserted (output description is empty).", ex)
        else c.add(R.matches, "failed", `Output contains a different description (${chars(actual)} chars): “${snippet(actual)}”.`, ex)

        const issues: string[] = []
        let corrupt = false
        if (/\uFFFD|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(out.description ?? "")) {
          corrupt = true
          issues.push("encoding corruption (replacement character or lone surrogate)")
        }
        if (!actual) issues.push("empty description on a non-decorative image")
        else if (PLACEHOLDER.test(actual)) issues.push("looks like placeholder text or a filename")
        if (chars(actual) > input.shortMaxChars) issues.push(`longer than the configured ${input.shortMaxChars}-character editorial target (${chars(actual)}); this is not a universal WCAG limit`)
        issues.push(...terminologyIssues(actual,occ.outputLanguage,expected?[{id:`approved:${occ.approvedVersionId}`,text:expected}]:[]).filter(i=>i.code!=="unicode_corruption").map(i=>`${TERMINOLOGY_RULE_VERSION}: ${i.message}`))
        if (corrupt) c.add({ ...R.quality, severity: "critical" }, "failed", issues.join("; "), ex)
        else c.add(R.quality, issues.length ? "warning" : "passed", issues.length ? issues.join("; ") : "No encoding, placeholder or length issues.", ex)
      }

      if (occ.currentApprovedVersionId !== occ.approvedVersionId) {
        c.add(R.stale, "warning", occ.currentApprovedVersionId == null ? "The occurrence is no longer approved." : `Current approval is #${occ.currentApprovedVersionId}; this output used #${occ.approvedVersionId ?? "none"}.`, ex)
      }
    } else {
      // Not authorised for replacement: whatever the source had must survive verbatim.
      if (!src && !out) c.add(R.preserved, "not_verified", "This occurrence cannot be located by the parser in either file.", ex)
      else if (src && !out) c.add({ ...R.preserved, severity: "high" }, "failed", "The occurrence is present in the original but missing from the output (content loss).", ex)
      else {
        const same = (src?.description ?? null) === (out?.description ?? null) && (src?.decorative ?? null) === (out?.decorative ?? null)
        c.add(R.preserved, same ? "passed" : "failed", same ? (src?.description ? "Existing source description preserved." : "Left unchanged (no description).") : "The description or decorative flag changed although no replacement was authorised.", ex)
      }
      if (occ.exportStatus === "unsupported" || occ.exportStatus === "failed") {
        c.add(R.unsupported, "warning", `${occ.exportCode}: ${occ.exportMessage}`, ex)
      }
      if (!occ.decorative && !normalizeAltText(out?.description ?? "") && !(out?.decorative === true)) {
        c.add(R.missingAlt, "warning", occ.exportStatus === "skipped" ? `No approved description was inserted (${occ.exportMessage || occ.exportCode}).` : "No description in the output.", ex)
      }
    }
  }

  // Pictures the export never mapped must be untouched.
  let unmappedChanged = 0
  let unmappedTotal = 0
  for (const [key, src] of before.snapshot.pics) {
    if (mappedKeys.has(key)) continue
    unmappedTotal++
    const out = after.snapshot.pics.get(key)
    if (!out || out.description !== src.description || out.decorative !== src.decorative) unmappedChanged++
  }
  if (unmappedTotal === 0) c.add(R.unmapped, "not_applicable", "Every picture in the original is a mapped occurrence.")
  else c.add(R.unmapped, unmappedChanged ? "failed" : "passed", unmappedChanged ? `${unmappedChanged} of ${unmappedTotal} unmapped pictures changed or disappeared.` : `${unmappedTotal} unmapped pictures unchanged.`)

  const dupes = [...finalTexts.values()].filter((ids) => ids.length > 1)
  if (dupes.length) c.add(R.duplicates, "manual_review", `${dupes.length} description${dupes.length === 1 ? " is" : "s are"} shared by more than one occurrence (e.g. occurrences ${dupes[0].slice(0, 5).map((i) => `#${i}`).join(", ")}).`)

  // C. Structure — format specific
  if (format === "pdf") pdfStructure(c, before.pdf!, after.pdf!, original, output)
  else ooxmlStructure(c, format, original, output, before, after)

  addManual(c, format)
  return c.list
}

/* ---------- structure checks ---------- */

const S = (ruleId: string, title: string, description: string, severity: Severity = "high", recommendation = "Do not distribute this file. Generate a new accessible document and report the issue."): Spec => ({
  ruleId,
  category: "structure",
  severity,
  title,
  description,
  recommendation,
})

function partXml(buf: Buffer, name: string): string | null {
  const e = readZipDirectory(buf).find((x) => x.name === name)
  return e ? readZipEntryBytes(buf, e, 64 * 1024 * 1024).toString("utf8") : null
}

const count = (xml: string, re: RegExp) => (xml.match(re) ?? []).length

const DOCX_STRUCTURE: [string, RegExp][] = [
  ["paragraphs", /<w:p[\s>]/g],
  ["tables", /<w:tbl[\s>]/g],
  ["sections", /<w:sectPr[\s>]/g],
  ["hyperlinks", /<w:hyperlink[\s>]/g],
  ["equations", /<m:oMath[\s>]/g],
  ["drawings", /<w:drawing[\s>]/g],
  ["text runs", /<w:t[\s>]/g],
  ["header/footer refs", /<w:(?:header|footer)Reference[\s/]/g],
]
const PPTX_STRUCTURE: [string, RegExp][] = [
  ["shapes", /<p:sp[\s>]/g],
  ["pictures", /<p:pic[\s>]/g],
  ["groups", /<p:grpSp[\s>]/g],
  ["graphic frames", /<p:graphicFrame[\s>]/g],
  ["text runs", /<a:t[\s>]/g],
  ["timing (animations)", /<p:timing[\s>]/g],
  ["transitions", /<p:transition[\s>]/g],
]

function ooxmlStructure(c: Checks, format: "docx" | "pptx", original: Buffer, output: Buffer, before: Extract<Parsed, { ok: true }>, after: Extract<Parsed, { ok: true }>) {
  const a = rawEntryMap(original)
  const b = rawEntryMap(output)
  const missing = [...a.keys()].filter((k) => !b.has(k))
  const added = [...b.keys()].filter((k) => !a.has(k))
  c.add(S("DS-001", "Package parts preserved", "Every part of the original package is present and no parts were added."), missing.length || added.length ? "failed" : "passed", missing.length || added.length ? `${missing.length} missing, ${added.length} added (e.g. ${[...missing, ...added].slice(0, 3).join(", ")}).` : `${a.size} parts present.`)

  const altPart = format === "docx" ? /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/ : /^ppt\/slides\/slide\d+\.xml$/
  const changed = [...a.keys()].filter((k) => b.has(k) && !a.get(k)!.equals(b.get(k)!))
  const unexpected = changed.filter((k) => !altPart.test(k))
  c.add(S("DS-002", "Unrelated parts byte-identical", format === "docx" ? "Styles, numbering, settings, themes, relationships, headers/footers without pictures and all media are unchanged." : "Presentation, layouts, masters, themes, notes, relationships and all media are unchanged."), unexpected.length ? "failed" : "passed", unexpected.length ? `Unexpected changes in: ${unexpected.slice(0, 5).join(", ")}.` : `${a.size - changed.length} parts identical; ${changed.length} picture part${changed.length === 1 ? "" : "s"} carry alt-text edits.`)

  const media = [...a.keys()].filter((k) => /\/media\//.test(k))
  const mediaLost = media.filter((k) => !b.has(k) || !a.get(k)!.equals(b.get(k)!))
  c.add(S("DS-003", "Embedded media preserved", "Original image binaries are byte-identical in the output."), media.length === 0 ? "not_applicable" : mediaLost.length ? "failed" : "passed", media.length === 0 ? "No embedded media." : mediaLost.length ? `${mediaLost.length} media part(s) missing or changed.` : `${media.length} media parts identical.`)

  const rels = [...a.keys()].filter((k) => k.endsWith(".rels"))
  const relsChanged = rels.filter((k) => !b.has(k) || !a.get(k)!.equals(b.get(k)!))
  c.add(S("DS-006", "Relationships preserved", format === "docx" ? "All relationship parts (images, hyperlinks, headers, footers, numbering, styles) are unchanged." : "All relationship parts (slide layouts, masters, themes, notes, media) are unchanged."), relsChanged.length ? "failed" : "passed", relsChanged.length ? `Changed: ${relsChanged.slice(0, 5).join(", ")}.` : `${rels.length} relationship parts identical.`)

  let malformed = 0
  const diffs: string[] = []
  const patterns = format === "docx" ? DOCX_STRUCTURE : PPTX_STRUCTURE
  for (const name of changed.filter((k) => altPart.test(k))) {
    const x0 = partXml(original, name) ?? ""
    const x1 = partXml(output, name) ?? ""
    if (XMLValidator.validate(x1.replace(/^\uFEFF/, "")) !== true) malformed++
    for (const [label, re] of patterns) {
      const n0 = count(x0, re)
      const n1 = count(x1, re)
      if (n0 !== n1) diffs.push(`${name}: ${label} ${n0} → ${n1}`)
    }
  }
  c.add({ ...S("DS-004", "Modified XML well-formed", "Every part that received alt-text edits is well-formed XML."), severity: "critical" }, malformed ? "failed" : changed.length ? "passed" : "not_applicable", malformed ? `${malformed} modified part(s) are not well-formed.` : changed.length ? `${changed.length} modified part(s) well-formed.` : "No parts were modified.")
  c.add(
    S("DS-005", "Content structure preserved", format === "docx" ? "In modified parts: paragraphs, tables, sections, hyperlinks, equations, drawings and text runs keep their counts." : "In modified slides: shapes, pictures, groups, graphic frames, text runs, animation timing and transitions keep their counts."),
    diffs.length ? "failed" : changed.length ? "passed" : "not_applicable",
    diffs.length ? diffs.slice(0, 5).join("; ") : changed.length ? "Element counts identical in every modified part." : "No parts were modified.",
  )

  if (format === "docx") {
    const p0 = before.docx!
    const p1 = after.docx!
    let mismatch = 0
    for (const [name, s0] of p0) {
      const s1 = p1.get(name)
      if ("error" in s0) continue
      if (!s1 || "error" in s1) {
        mismatch++
        continue
      }
      const sig = (s: typeof s0) => s.pictures.map((d) => `${d.ordinal}|${d.docPrId}|${d.relId}|${d.placement}|${d.nested}`).join(";") + `|vml:${s.legacyVml}`
      if (sig(s0) !== sig(s1)) mismatch++
    }
    const total = [...before.snapshot.pics.values()]
    c.add(
      S("DS-007", "Picture occurrences preserved", "Inline, floating, table, header/footer pictures keep their order, wp:docPr ids, image relationships and placement."),
      mismatch ? "failed" : "passed",
      mismatch ? `${mismatch} part(s) have a different picture sequence.` : `${total.length} pictures (${total.filter((p) => p.location.region === "body").length} body, ${total.filter((p) => p.location.region !== "body").length} header/footer/notes) identical.`,
    )
  } else {
    const k0 = before.pptx!
    const k1 = after.pptx!
    c.add(S("DS-010", "Slide count and order", "The output has the same slides in the same order."), k0.totalSlides === k1.totalSlides && seq(k0) === seq(k1) ? "passed" : "failed", `${k0.totalSlides} → ${k1.totalSlides} slides${seq(k0) === seq(k1) ? "; order identical" : "; slide order differs"}.`)
    const id0 = k0.occurrences.map((o) => `${o.sourceLocator}|${o.shapeId}|${o.groupPath.join("/")}|${o.mediaPart}`).join(";")
    const id1 = k1.occurrences.map((o) => `${o.sourceLocator}|${o.shapeId}|${o.groupPath.join("/")}|${o.mediaPart}`).join(";")
    c.add(S("DS-011", "Picture shape ids and groups", "Picture shape ids, group nesting and media references are identical."), id0 === id1 ? "passed" : "failed", id0 === id1 ? `${k0.occurrences.length} pictures (${k0.occurrences.filter((o) => o.groupPath.length).length} grouped) identical.` : "Picture shape ids, grouping or media references differ.")
  }
  c.add(
    { ruleId: "VP-001", category: "structure", severity: "medium", title: "Visual preservation", description: "Rendered comparison of original and output pages/slides.", recommendation: "Open the output in the authoring application and compare it visually with the original." },
    "not_verified",
    "No trusted Office renderer is available. Structural equality does not prove identical rendering.",
  )
}

const seq = (k: PptxPackage) => [...new Set(k.occurrences.map((o) => `${o.slideNumber}:${o.slidePart}`))].join(";")

function pdfStructure(c: Checks, a: PdfPackage, b: PdfPackage, original: Buffer, output: Buffer) {
  const prefix = output.length >= original.length && output.subarray(0, original.length).equals(original)
  c.add(S("DS-020", "Original bytes preserved", "The output is an incremental update: every byte of the original is kept and changes are appended."), prefix ? "passed" : "failed", prefix ? `Original ${original.length} bytes intact; ${output.length - original.length} bytes appended.` : "The original byte range was rewritten.")
  c.add(S("DS-021", "Page count", "The output has the same number of pages."), a.totalPages === b.totalPages ? "passed" : "failed", `${a.totalPages} → ${b.totalPages} pages.`)
  const sig = (p: PdfPackage) => p.occurrences.map((o) => `${o.sourceLocator}|${o.objectRef}|${o.classification}`).join(";")
  c.add(S("DS-022", "Image XObjects preserved", "Image occurrences, their XObject references and classifications are unchanged."), sig(a) === sig(b) ? "passed" : "failed", sig(a) === sig(b) ? `${a.occurrences.length} image occurrences identical.` : "Image occurrences or XObject references differ.")
  const assoc = (p: PdfPackage) => p.occurrences.map((o) => `${o.structure.association}|${o.structure.structRef}|${o.structure.mcid}|${o.structure.figureOrder}`).join(";")
  c.add(S("DS-023", "Figure associations", "Each image keeps its /Figure structure element, MCID and ParentTree association."), assoc(a) === assoc(b) ? "passed" : "failed", assoc(a) === assoc(b) ? "Figure ↔ MCID associations identical." : "Figure associations, MCIDs or structure order differ.")
  c.add(S("DS-024", "Tagging preserved", "The StructTreeRoot is still present and no additional figures became unmatched."), a.report.tagged === b.report.tagged && b.report.unmatchedFigures <= a.report.unmatchedFigures ? "passed" : "failed", `Tagged: ${a.report.tagged} → ${b.report.tagged}; unmatched figures ${a.report.unmatchedFigures} → ${b.report.unmatchedFigures}.`)

  const A = (ruleId: string, title: string, description: string, recommendation: string): Spec => ({ ruleId, category: "accessibility", severity: "medium", title, description, recommendation })
  const unresolved = b.occurrences.filter((o) => !o.artifact && o.structure.association !== "resolved").length
  c.add(A("AS-010", "Tagged PDF", "The document has a structure tree.", "Tag the PDF in a remediation tool before relying on figure alt text."), b.report.tagged ? "passed" : "failed", b.report.tagged ? "StructTreeRoot present." : "The PDF is untagged.")
  c.add(A("AS-011", "Figure coverage", "Every non-artifact image is tied to exactly one /Figure element.", "Review unassociated images in a PDF remediation tool."), unresolved || b.report.unmatchedFigures ? "warning" : "passed", unresolved || b.report.unmatchedFigures ? `Partially tagged: ${unresolved} image(s) without a resolved Figure; ${b.report.unmatchedFigures} Figure(s) without a matching image.` : "Every image resolves to one Figure.")
  const scanned = b.occurrences.filter((o) => o.classification === "likely_scanned_page").length
  c.add(A("AS-012", "Scanned content", "Pages that appear to be scanned images.", "OCR and full tagging review are required (out of scope)."), scanned ? "warning" : "passed", scanned ? `${scanned} likely scanned page image(s).` : "No scanned-page images detected.")
  c.add(
    { ruleId: "PU-001", category: "accessibility", severity: "medium", title: "PDF/UA validation", description: "Formal PDF/UA (ISO 14289-1) machine-checkable validation.", recommendation: "Run a PDF/UA validator such as veraPDF and complete the PDF/UA manual checks." },
    "not_verified",
    "No PDF/UA validator is installed in this environment. Passing figure /Alt checks is not PDF/UA conformance.",
  )
  c.add(
    { ruleId: "VP-001", category: "structure", severity: "medium", title: "Visual preservation", description: "Rendered comparison of original and output pages.", recommendation: "Open both files and compare pages visually." },
    "not_verified",
    "No trusted PDF renderer is configured. The incremental update leaves page content streams untouched.",
  )
}

function addStructureNotExecuted(c: Checks, format: AccessibleExportFormat, why: string) {
  const ids = format === "pdf" ? ["DS-020", "DS-021", "DS-022", "DS-023", "DS-024"] : ["DS-001", "DS-002", "DS-003", "DS-004", "DS-005", "DS-006"]
  for (const id of ids) c.add(S(id, "Structural comparison", "Structural comparison of original and output."), "not_executed", why)
}

/* ---------- manual review ---------- */

const MANUAL: Record<AccessibleExportFormat | "all", [string, string, string][]> = {
  all: [
    ["MR-001", "Meaning and accuracy", "Each description conveys the image's intended meaning and is factually / scientifically accurate in context."],
    ["MR-002", "Complex images", "Charts, diagrams and maths images have an adequate explanation (long description or surrounding text)."],
    ["MR-003", "Assistive technology", "The output reads correctly with a real screen reader."],
    ["MR-004", "Visual layout", "Pages/slides look the same as the original."],
  ],
  docx: [["MR-010", "Document-level accessibility", "Heading hierarchy, table headers, reading order and colour contrast (outside picture alt text) are reviewed."]],
  pptx: [
    ["MR-020", "Slide reading order", "Reading order is meaningful. Shape-tree order is not proof of reading order."],
    ["MR-021", "Slide titles and animations", "Each slide has a unique title, and animations/transitions still play as intended."],
  ],
  pdf: [
    ["MR-030", "Reading order and tags", "The tag tree's reading order and roles are correct."],
    ["MR-031", "PDF/UA manual checkpoints", "PDF/UA checkpoints that require human judgement are completed."],
  ],
}

function addManual(c: Checks, format: AccessibleExportFormat) {
  for (const [ruleId, title, description] of [...MANUAL.all, ...MANUAL[format]]) {
    c.add({ ruleId, category: "manual", severity: "low", title, description, machineCheckable: false, recommendation: "Review and acknowledge once checked." }, "manual_review", "Requires human judgement; not checked automatically.")
  }
}
