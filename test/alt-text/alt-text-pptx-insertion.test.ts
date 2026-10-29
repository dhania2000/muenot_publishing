import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import { insertPptxAltText, type PptxInsertInstruction } from "@/lib/alt-text/pptx-alt-text-inserter"
import { readPptxPackage, type PptxOccurrence } from "@/lib/alt-text/pptx-package"
import { readZipDirectory, readZipEntryBytes } from "@/lib/alt-text/document-validation"
import { rawEntryMap } from "@/lib/alt-text/ooxml-zip-rewrite"
import { approvalSnapshot, exportFilename, exportPolicyFailure, mergeExportReport, planDocxExport, strictPreconditionFailure } from "@/lib/alt-text/docx-export-plan"
import type { InsertionReadinessRow } from "@/lib/alt-text/document-approval-contract"
import { buildZip, ooxmlEntries, type ZipFixtureEntry } from "./fixtures/documents"

const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
const NS = `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${R}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"`
const PNG = (fill: number) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, fill)])

type Pic = { id: number; rid: string; descr?: string; link?: boolean; inner?: string }

const pic = (p: Pic) => {
  const descr = p.descr === undefined ? "" : ` descr="${p.descr}"`
  const cNvPr = p.inner ? `<p:cNvPr id="${p.id}" name="Picture ${p.id}"${descr}>${p.inner}</p:cNvPr>` : `<p:cNvPr id="${p.id}" name="Picture ${p.id}"${descr}/>`
  const blip = p.link ? `<a:blip r:link="${p.rid}"/>` : `<a:blip r:embed="${p.rid}"/>`
  return `<p:pic><p:nvPicPr>${cNvPr}<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill>${blip}<a:srcRect l="1200" t="300"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm rot="5400000" flipH="1"><a:off x="100" y="200"/><a:ext cx="3000" cy="4000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
}
const group = (id: number, inner: string) =>
  `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${id}" name="Group ${id}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="10" cy="10"/><a:chOff x="0" y="0"/><a:chExt cx="10" cy="10"/></a:xfrm></p:grpSpPr>${inner}</p:grpSp>`
const textBox = (id: number, text: string) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Title ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en-US" sz="2400"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:rPr><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`
const chart = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="40" name="Chart 1"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId9"/></a:graphicData></a:graphic></p:graphicFrame>`
const TIMING = `<p:transition spd="slow"><p:fade/></p:transition><p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" nodeType="tmRoot"><p:childTnLst><p:par><p:cTn id="2"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:tnLst><p:bldLst><p:bldP spid="4" grpId="0"/></p:bldLst></p:timing>`

const slideXml = (shapes: string, opts: { bg?: boolean; timing?: boolean } = {}) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sld ${NS}><p:cSld>${opts.bg ? '<p:bg><p:bgPr><a:blipFill><a:blip r:embed="rId5"/></a:blipFill><a:effectLst/></p:bgPr></p:bg>' : ""}<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>${opts.timing ? TIMING : ""}</p:sld>`

const relsXml = (items: [string, string, string, boolean?][]) =>
  `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([id, type, target, ext]) => `<Relationship Id="${id}" Type="${R}/${type}" Target="${target}"${ext ? ' TargetMode="External"' : ""}/>`).join("")}</Relationships>`

type SlideSpec = { shapes: string; rels?: [string, string, string, boolean?][]; bg?: boolean; timing?: boolean; hidden?: boolean }

/**
 * Builds a PPTX whose file order differs from presentation order: the sldIdLst lists slides in
 * reverse, so `slide<N>.xml` is displayed at position `slides.length - N + 1`.
 */
function pptx(slides: SlideSpec[], extra: ZipFixtureEntry[] = []): Buffer {
  const n = slides.length
  const files = slides.map((_, i) => `slide${n - i}.xml`)
  const presRels: [string, string, string][] = files.map((f, i) => [`rId${100 + i}`, "slide", `slides/${f}`])
  const sldIds = files.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${100 + i}"/>`).join("")
  const entries: ZipFixtureEntry[] = [
    { name: "ppt/presentation.xml", data: `<?xml version="1.0"?><p:presentation ${NS}><p:sldIdLst>${sldIds}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`, deflate: true },
    { name: "ppt/media/image1.png", data: PNG(1) },
    { name: "ppt/media/image2.png", data: PNG(2), deflate: true },
    { name: "ppt/theme/theme1.xml", data: `<?xml version="1.0"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office"/>`, deflate: true },
    { name: "ppt/notesSlides/notesSlide1.xml", data: `<?xml version="1.0"?><p:notes ${NS}><p:cSld><p:spTree/></p:cSld></p:notes>`, deflate: true },
  ]
  slides.forEach((s, i) => {
    const rels = s.rels ?? [["rId5", "image", "../media/image1.png"], ["rId6", "image", "../media/image2.png"], ["rId7", "notesSlide", "../notesSlides/notesSlide1.xml"]]
    const xml = slideXml(s.shapes, s).replace("<p:sld ", s.hidden ? '<p:sld show="0" ' : "<p:sld ")
    entries.push({ name: `ppt/slides/${files[i]}`, data: xml, deflate: true }, { name: `ppt/slides/_rels/${files[i]}.rels`, data: relsXml(rels), deflate: true })
  })
  return buildZip(ooxmlEntries("pptx", { omitMain: true, mainRels: relsXml(presRels), extra: [...entries, ...extra] }))
}

const run = (src: Buffer, list: PptxInsertInstruction[], dryRun = false) => insertPptxAltText(src, list, { maxOutputBytes: 10 * 1024 * 1024, dryRun })
const ins = (o: PptxOccurrence, text: string, decorative = false, occurrenceId = o.occurrenceIndex + 1): PptxInsertInstruction => ({ occurrenceId, sourceLocator: o.sourceLocator, text, decorative })
const occs = (buf: Buffer) => readPptxPackage(buf).occurrences
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex")

function part(buf: Buffer, name: string) {
  const e = readZipDirectory(buf).find((x) => x.name === name)
  if (!e) throw new Error(`missing ${name}`)
  return readZipEntryBytes(buf, e, 1 << 24).toString("utf8")
}
function changedParts(a: Buffer, b: Buffer) {
  const before = rawEntryMap(a)
  const after = rawEntryMap(b)
  return [...before.keys()].filter((k) => !before.get(k)!.equals(after.get(k)!))
}
function output(r: ReturnType<typeof run>) {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`)
  if (!r.output) throw new Error("no output")
  return r.output
}

describe("insertPptxAltText", () => {
  it("updates one picture and keeps every other part, media and the source byte-identical", () => {
    const src = pptx([{ shapes: textBox(2, "Heading") + pic({ id: 4, rid: "rId5" }), timing: true }])
    const before = sha(src)
    const [o] = occs(src)
    expect(o.sourceLocator).toBe("ppt/slides/slide1.xml#pic:4:rId5")
    const r = run(src, [ins(o, "Bar chart of 2024 sales")])
    const out = output(r)
    expect(sha(src)).toBe(before)
    expect(changedParts(src, out)).toEqual(["ppt/slides/slide1.xml"])
    expect(r.ok && r.report).toMatchObject({ updated: 1, failed: 0, unsupported: 0, slideCount: 1, pictureCount: 1, partsModified: ["ppt/slides/slide1.xml"] })
    const reread = occs(out)[0]
    expect(reread.description).toBe("Bar chart of 2024 sales")
    expect(reread.shapeId).toBe("4")
    expect(reread.name).toBe("Picture 4")
  })

  it("only touches the cNvPr start tag: geometry, crop, rotation, text, transitions and animations stay identical", () => {
    const src = pptx([{ shapes: textBox(2, "Heading") + pic({ id: 4, rid: "rId5" }) + chart, timing: true }])
    const out = output(run(src, [ins(occs(src)[0], "A photo")]))
    const a = part(src, "ppt/slides/slide1.xml")
    const b = part(out, "ppt/slides/slide1.xml")
    expect(b.replace(' descr="A photo"', "")).toBe(a)
    for (const fragment of ['<a:srcRect l="1200" t="300"/>', '<a:xfrm rot="5400000" flipH="1">', "<a:t>Heading</a:t>", TIMING, "<c:chart"]) expect(b).toContain(fragment)
  })

  it("resolves slide numbers from sldIdLst rather than file names", () => {
    const src = pptx([{ shapes: pic({ id: 4, rid: "rId5" }) }, { shapes: pic({ id: 4, rid: "rId5" }) }])
    const list = occs(src)
    expect(list.map((o) => [o.slidePart, o.slideNumber])).toEqual([
      ["ppt/slides/slide2.xml", 1],
      ["ppt/slides/slide1.xml", 2],
    ])
    const r = run(src, [ins(list[1], "Second displayed slide")])
    const out = output(r)
    expect(r.ok && r.report.items[0].slideNumber).toBe(2)
    expect(changedParts(src, out)).toEqual(["ppt/slides/slide1.xml"])
    expect(part(out, "ppt/presentation.xml")).toBe(part(src, "ppt/presentation.xml"))
  })

  it("handles multiple pictures on one slide and the same media reused with different descriptions", () => {
    const src = pptx([
      { shapes: pic({ id: 4, rid: "rId5" }) + pic({ id: 5, rid: "rId5" }) + pic({ id: 6, rid: "rId6" }) },
      { shapes: pic({ id: 4, rid: "rId5", descr: "Logo" }) },
    ])
    const list = occs(src)
    expect(list).toHaveLength(4)
    const r = run(src, [ins(list[0], "Company logo"), ins(list[1], "Logo in brand identity section"), ins(list[2], "Second image")])
    const out = output(r)
    expect(r.ok && r.report).toMatchObject({ updated: 3, pictureCount: 4, uniqueMediaCount: 2, existingAltTextPreserved: 1 })
    const after = occs(out)
    expect(after.map((o) => o.description)).toEqual(["Company logo", "Logo in brand identity section", "Second image", "Logo"])
    expect(rawEntryMap(out).get("ppt/media/image1.png")!.equals(rawEntryMap(src).get("ppt/media/image1.png")!)).toBe(true)
  })

  it("updates pictures inside nested groups without changing the group structure", () => {
    const src = pptx([{ shapes: group(10, pic({ id: 11, rid: "rId5" }) + group(20, pic({ id: 21, rid: "rId6" }))) }])
    const list = occs(src)
    expect(list.map((o) => o.groupPath)).toEqual([["10"], ["10", "20"]])
    const r = run(src, [ins(list[1], "Nested diagram part")])
    const out = output(r)
    expect(r.ok && r.report).toMatchObject({ updated: 1, groupedPictureCount: 2 })
    expect(r.ok && r.report.items[0].grouped).toBe(true)
    const after = occs(out)
    expect(after[1]).toMatchObject({ description: "Nested diagram part", groupPath: ["10", "20"], shapeId: "21" })
    expect(after[0].description).toBeNull()
  })

  it("replaces existing alt text, records the previous value and preserves unapproved descriptions", () => {
    const src = pptx([{ shapes: pic({ id: 4, rid: "rId5", descr: "old text" }) + pic({ id: 5, rid: "rId6", descr: "manual" }) }])
    const list = occs(src)
    const r = run(src, [ins(list[0], "new text")])
    const out = output(r)
    expect(r.ok && r.report.items[0].previousDescription).toBe("old text")
    expect(occs(out).map((o) => o.description)).toEqual(["new text", "manual"])
  })

  it("escapes XML and preserves Hindi, mathematical and chemical notation", () => {
    const text = 'Graph of y = x² + 2x < 5 & "H₂SO₄" — जल चक्र आरेख ∑∫√π'
    const src = pptx([{ shapes: pic({ id: 4, rid: "rId5" }) }])
    const out = output(run(src, [ins(occs(src)[0], text)]))
    expect(occs(out)[0].description).toBe(text)
    expect(part(out, "ppt/slides/slide1.xml")).toContain("&lt; 5 &amp; &quot;H₂SO₄&quot;")
  })

  it("marks decorative pictures with the Office decorative extension and removes descr", () => {
    const src = pptx([{ shapes: pic({ id: 4, rid: "rId5", descr: "border" }) }])
    const out = output(run(src, [ins(occs(src)[0], "", true)]))
    const after = occs(out)[0]
    expect(after.description).toBeNull()
    expect(after.decorative).toBe(true)
    expect(part(out, "ppt/slides/slide1.xml")).toContain("{C183D7F6-B498-43B3-948B-1728B52AA6E4}")
  })

  it("reports already-current alt text as unchanged and builds no output", () => {
    const src = pptx([{ shapes: pic({ id: 4, rid: "rId5", descr: "same" }) }])
    const r = run(src, [ins(occs(src)[0], "same")])
    expect(r.ok && r.output).toBeNull()
    expect(r.ok && r.report).toMatchObject({ updated: 0, unchanged: 1 })
  })

  it("refuses stale locators and duplicate mappings instead of guessing", () => {
    const src = pptx([{ shapes: pic({ id: 4, rid: "rId5" }) }])
    const [o] = occs(src)
    const r = run(src, [
      { occurrenceId: 1, sourceLocator: "ppt/slides/slide1.xml#pic:99:rId5", text: "x", decorative: false },
      ins(o, "a", false, 2),
      ins(o, "b", false, 3),
    ])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.output).toBeNull()
    expect(r.report.items.map((i) => i.code)).toEqual(["LOCATOR_NOT_FOUND", "DUPLICATE_OCCURRENCE", "DUPLICATE_OCCURRENCE"])
  })

  it("reports linked pictures as unsupported and backgrounds, charts and layout images as warnings", () => {
    const src = pptx([
      {
        shapes: pic({ id: 4, rid: "rId8", link: true }) + chart + pic({ id: 5, rid: "rId5" }),
        bg: true,
        rels: [["rId5", "image", "../media/image1.png"], ["rId8", "image", "https://example.com/x.png", true]],
      },
    ])
    const list = occs(src)
    const r = run(src, [ins(list[0], "linked"), ins(list[1], "local")])
    const out = output(r)
    if (!r.ok) return
    expect(r.report.items.map((i) => [i.status, i.code])).toEqual([
      ["unsupported", "EXTERNAL_IMAGE"],
      ["updated", "UPDATED"],
    ])
    const codes = r.report.warnings.map((w) => w.code)
    expect(codes).toContain("BACKGROUND_IMAGES_NOT_REMEDIATED")
    expect(codes).toContain("GRAPHIC_FRAMES_NOT_REMEDIATED")
    expect(part(out, "ppt/slides/slide1.xml")).toContain('<p:bg><p:bgPr><a:blipFill><a:blip r:embed="rId5"/>')
  })

  it("preserves hidden-slide state, speaker notes and theme parts", () => {
    const src = pptx([{ shapes: pic({ id: 4, rid: "rId5" }), hidden: true }])
    const [o] = occs(src)
    const out = output(run(src, [ins(o, "hidden slide image")]))
    expect(part(out, "ppt/slides/slide1.xml")).toContain('<p:sld show="0" ')
    for (const name of ["ppt/notesSlides/notesSlide1.xml", "ppt/theme/theme1.xml", "ppt/slides/_rels/slide1.xml.rels"]) expect(part(out, name)).toBe(part(src, name))
  })

  it("blocks digitally signed packages", () => {
    const signed = pptx([{ shapes: pic({ id: 4, rid: "rId5" }) }], [{ name: "_xmlsignatures/sig1.xml", data: "<Signature/>" }])
    const s = run(signed, [ins(occs(signed)[0], "x")])
    expect(s).toMatchObject({ ok: false, code: "SIGNED_DOCUMENT" })
  })

  it("rejects invalid packages and enforces the output size limit", () => {
    expect(run(Buffer.from("not a zip"), [])).toMatchObject({ ok: false, code: "INVALID_DOCUMENT" })
    const src = pptx([{ shapes: pic({ id: 4, rid: "rId5" }) }])
    expect(insertPptxAltText(src, [ins(occs(src)[0], "x")], { maxOutputBytes: 10 })).toMatchObject({ ok: false, code: "OUTPUT_TOO_LARGE" })
  })

  it("dry runs report the plan without building output", () => {
    const src = pptx([{ shapes: pic({ id: 4, rid: "rId5" }) }])
    const r = run(src, [ins(occs(src)[0], "planned")], true)
    expect(r.ok && r.output).toBeNull()
    expect(r.ok && r.report.updated).toBe(1)
  })
})

describe("PPTX export planning and policy", () => {
  const row = (id: number, over: Partial<InsertionReadinessRow> = {}): InsertionReadinessRow => ({
    documentId: 1,
    imageOccurrenceId: id,
    sourceLocator: `ppt/slides/slide1.xml#pic:${id}:rId5`,
    approvedVersionId: 100 + id,
    approvedVersion: 1,
    approvedShortAlt: `Alt ${id}`,
    approvedLongDescription: null,
    decorativeApproved: false,
    reviewerId: 7,
    approvedAt: "2026-10-01T00:00:00Z",
    eligible: true,
    blockingReason: null,
    blockingMessage: null,
    ...over,
  })

  it("excludes unapproved and rejected rows and blocks strict mode", () => {
    const plan = planDocxExport([row(1), row(2, { eligible: false, blockingReason: "NOT_APPROVED", approvedShortAlt: "draft" }), row(3, { eligible: false, blockingReason: "NO_SOURCE_MAPPING" })])
    expect(plan.instructions.map((i) => i.occurrenceId)).toEqual([1])
    expect(plan.totals).toMatchObject({ eligible: 1, pendingReview: 1, unmapped: 1 })
    expect(strictPreconditionFailure(plan.totals)).toMatch(/not approved/)
  })

  it("changes the snapshot when an approval changes", () => {
    expect(approvalSnapshot([row(1)])).not.toBe(approvalSnapshot([row(1, { approvedVersionId: 999 })]))
    expect(approvalSnapshot([row(1)])).not.toBe(approvalSnapshot([row(1, { approvedShortAlt: "edited" })]))
  })

  it("reports detailed descriptions as retained in the ERP only and fails strict mode on unsupported items", () => {
    const src = pptx([{ shapes: pic({ id: 4, rid: "rId8", link: true }) + pic({ id: 5, rid: "rId5" }), rels: [["rId5", "image", "../media/image1.png"], ["rId8", "image", "https://example.com/x.png", true]] }])
    const list = occs(src)
    const plan = planDocxExport([row(1, { sourceLocator: list[0].sourceLocator }), row(2, { sourceLocator: list[1].sourceLocator, approvedLongDescription: "Long technical description" })])
    const r = run(src, plan.instructions)
    if (!r.ok) throw new Error(r.message)
    const merged = mergeExportReport(r.report, plan)
    expect(merged.summary).toMatchObject({ updated: 1, unsupported: 1, slideCount: 1 })
    expect(merged.items.find((i) => i.occurrenceId === 2)?.slideNumber).toBe(1)
    expect(merged.summary.warnings.map((w) => w.code)).toContain("DETAILED_DESCRIPTION_ERP_ONLY")
    expect(exportPolicyFailure("strict", merged.summary)?.code).toBe("STRICT_POLICY_UNMET")
    expect(exportPolicyFailure("approved_only", merged.summary)).toBeNull()
  })

  it("builds safe filenames per format", () => {
    const name = exportFilename("Deck ../Q3.pptx", "pptx")
    expect(name).not.toContain("/")
    expect(name.endsWith("-alt-text-updated.pptx")).toBe(true)
    expect(exportFilename("Report.docx", "docx")).toBe("Report-alt-text.docx")
  })
})
