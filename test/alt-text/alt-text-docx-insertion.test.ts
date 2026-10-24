import { describe, expect, it } from "vitest"
import { formatDocxLocator, parseDocxLocator } from "@/lib/alt-text/docx-locator"
import { insertDocxAltText, normalizeAltText, type DocxInsertInstruction } from "@/lib/alt-text/docx-alt-text-inserter"
import { readZipDirectory, readZipEntryBytes } from "@/lib/alt-text/document-validation"
import { rawEntryMap } from "@/lib/alt-text/ooxml-zip-rewrite"
import { buildZip, ooxmlEntries, type ZipFixtureEntry } from "./fixtures/documents"

const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
const ROOT_NS = [
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"',
  `xmlns:r="${R}"`,
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"',
  'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"',
].join(" ")

type Pic = { id: number; rid: string; descr?: string; floating?: boolean; docPrInner?: string; chart?: boolean; link?: boolean }

function picture(p: Pic): string {
  const wrap = p.floating ? "anchor" : "inline"
  const descr = p.descr === undefined ? "" : ` descr="${p.descr}"`
  const docPr = p.docPrInner ? `<wp:docPr id="${p.id}" name="Picture ${p.id}"${descr}>${p.docPrInner}</wp:docPr>` : `<wp:docPr id="${p.id}" name="Picture ${p.id}"${descr}/>`
  const blip = p.link ? `<a:blip r:link="${p.rid}"/>` : `<a:blip r:embed="${p.rid}"/>`
  const graphic = p.chart
    ? `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="${p.rid}"/></a:graphicData></a:graphic>`
    : `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="img${p.id}.png"${descr}/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill>${blip}</pic:blipFill></pic:pic></a:graphicData></a:graphic>`
  return `<w:r><w:drawing><wp:${wrap} distT="0"><wp:extent cx="1" cy="1"/>${docPr}${graphic}</wp:${wrap}></w:drawing></w:r>`
}

const para = (inner: string) => `<w:p>${inner}</w:p>`
const doc = (body: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${ROOT_NS}><w:body>${body}<w:sectPr/></w:body></w:document>`
const relsXml = (items: [string, string, string][]) =>
  `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([id, type, target]) => `<Relationship Id="${id}" Type="${R}/${type}" Target="${target}"/>`).join("")}</Relationships>`

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)])

function docx(body: string, opts: { rels?: [string, string, string][]; extra?: ZipFixtureEntry[]; header?: string } = {}) {
  const rels = opts.rels ?? [["rId5", "image", "media/image1.png"], ["rId6", "image", "media/image2.png"]]
  const extra: ZipFixtureEntry[] = [
    { name: "word/document.xml", data: doc(body), deflate: true },
    { name: "word/styles.xml", data: `<?xml version="1.0"?><w:styles ${ROOT_NS}/>`, deflate: true },
    { name: "word/media/image1.png", data: PNG },
    { name: "word/media/image2.png", data: PNG, deflate: true },
    ...(opts.header
      ? [
          { name: "word/header1.xml", data: `<?xml version="1.0"?><w:hdr ${ROOT_NS}>${opts.header}</w:hdr>`, deflate: true },
          { name: "word/_rels/header1.xml.rels", data: relsXml([["rId1", "image", "media/image1.png"]]), deflate: true },
        ]
      : []),
    ...(opts.extra ?? []),
  ]
  const mainRels = relsXml([...rels, ...(opts.header ? ([["rId9", "header", "header1.xml"]] as [string, string, string][]) : [])])
  return buildZip(ooxmlEntries("docx", { omitMain: true, mainRels, extra }))
}

const loc = (ordinal: number, docPr: number, rel: string, part = "word/document.xml") => formatDocxLocator({ part, ordinal, docPrId: String(docPr), relId: rel })
const ins = (occurrenceId: number, sourceLocator: string, text: string, decorative = false): DocxInsertInstruction => ({ occurrenceId, sourceLocator, text, decorative })
const run = (src: Buffer, list: DocxInsertInstruction[], dryRun = false) => insertDocxAltText(src, list, { maxOutputBytes: 10 * 1024 * 1024, dryRun })

function part(buf: Buffer, name: string) {
  const e = readZipDirectory(buf).find((x) => x.name === name)
  if (!e) throw new Error(`missing ${name}`)
  return readZipEntryBytes(buf, e, 1 << 24).toString("utf8")
}

describe("docx locator contract", () => {
  it("round-trips and rejects malformed or out-of-scope parts", () => {
    const s = loc(3, 12, "rId7", "word/header2.xml")
    expect(s).toBe("docx:word/header2.xml#drawing=3;docPr=12;rel=rId7")
    expect(parseDocxLocator(s)).toEqual({ part: "word/header2.xml", ordinal: 3, docPrId: "12", relId: "rId7" })
    expect(parseDocxLocator("docx:word/document.xml#drawing=0;docPr=1;rel=rId1")).toBeNull()
    expect(parseDocxLocator("docx:word/comments.xml#drawing=1;docPr=1;rel=rId1")).toBeNull()
    expect(parseDocxLocator("docx:../word/document.xml#drawing=1;docPr=1;rel=rId1")).toBeNull()
    expect(parseDocxLocator("pptx:ppt/slides/slide1.xml#pic=1")).toBeNull()
  })
})

describe("insertDocxAltText", () => {
  it("updates one inline picture and leaves every other part byte-identical", () => {
    const src = docx(para(picture({ id: 1, rid: "rId5" })) + para("<w:r><w:t>Text &amp; more</w:t></w:r>"))
    const r = run(src, [ins(10, loc(1, 1, "rId5"), 'Bar chart of "Q1" sales & <growth>')])
    expect(r.ok).toBe(true)
    if (!r.ok || !r.output) throw new Error("expected output")
    expect(r.report.updated).toBe(1)
    expect(r.report.partsModified).toEqual(["word/document.xml"])
    const xml = part(r.output, "word/document.xml")
    expect(xml).toContain('descr="Bar chart of &quot;Q1&quot; sales &amp; &lt;growth&gt;"')
    expect(xml).toContain("<w:t>Text &amp; more</w:t>")
    const before = rawEntryMap(src)
    const after = rawEntryMap(r.output)
    expect([...after.keys()]).toEqual([...before.keys()])
    for (const name of before.keys()) if (name !== "word/document.xml") expect(after.get(name)?.equals(before.get(name) as Buffer)).toBe(true)
  })

  it("never mutates the source buffer", () => {
    const src = docx(para(picture({ id: 1, rid: "rId5" })))
    const copy = Buffer.from(src)
    run(src, [ins(1, loc(1, 1, "rId5"), "A logo")])
    expect(src.equals(copy)).toBe(true)
  })

  it("maps the same media used twice per occurrence, and preserves unmapped existing alt text", () => {
    const body = para(picture({ id: 1, rid: "rId5" })) + para(picture({ id: 2, rid: "rId5", descr: "Author text" })) + para(picture({ id: 3, rid: "rId6", floating: true }))
    const r = run(docx(body), [ins(1, loc(1, 1, "rId5"), "First use"), ins(3, loc(3, 3, "rId6"), "Floating figure")])
    if (!r.ok || !r.output) throw new Error("expected output")
    const xml = part(r.output, "word/document.xml")
    expect(xml).toContain('id="1" name="Picture 1" descr="First use"')
    expect(xml).toContain('id="2" name="Picture 2" descr="Author text"')
    expect(xml).toContain('id="3" name="Picture 3" descr="Floating figure"')
    expect(r.report.items.find((i) => i.occurrenceId === 3)?.placement).toBe("floating")
    expect(r.report.pictureCount).toBe(3)
    expect(r.report.uniqueMediaCount).toBe(2)
    expect(r.report.existingAltTextPreserved).toBe(1)
  })

  it("replaces existing alt text and records the previous value", () => {
    const r = run(docx(para(picture({ id: 4, rid: "rId5", descr: "old" }))), [ins(1, loc(1, 4, "rId5"), "new")])
    if (!r.ok || !r.output) throw new Error("expected output")
    expect(r.report.items[0].previousDescription).toBe("old")
    expect(part(r.output, "word/document.xml")).toContain('descr="new"')
  })

  it("marks decorative pictures with the Office decorative extension and removes the description", () => {
    const r = run(docx(para(picture({ id: 1, rid: "rId5", descr: "old" }))), [ins(1, loc(1, 1, "rId5"), "", true)])
    if (!r.ok || !r.output) throw new Error("expected output")
    const xml = part(r.output, "word/document.xml")
    expect(xml).not.toContain('descr="old"')
    expect(xml).toMatch(/<wp:docPr id="1" name="Picture 1"><a:extLst[^>]*><a:ext [^>]*uri="\{C183D7F6-B498-43B3-948B-1728B52AA6E4\}"><adec:decorative [^>]*val="1"\/><\/a:ext><\/a:extLst><\/wp:docPr>/)
  })

  it("clears a source decorative flag when a real description is approved", () => {
    const inner = '<a:extLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:ext uri="{C183D7F6-B498-43B3-948B-1728B52AA6E4}"><adec:decorative xmlns:adec="http://schemas.microsoft.com/office/drawing/2017/decorative" val="1"/></a:ext></a:extLst>'
    const r = run(docx(para(picture({ id: 1, rid: "rId5", docPrInner: inner }))), [ins(1, loc(1, 1, "rId5"), "Now meaningful")])
    if (!r.ok || !r.output) throw new Error("expected output")
    const xml = part(r.output, "word/document.xml")
    expect(xml).toContain('val="0"')
    expect(xml).toContain('descr="Now meaningful"')
    expect(r.report.warnings.map((w) => w.code)).toContain("DECORATIVE_FLAG_CLEARED")
  })

  it("reports already-current alt text as unchanged and builds no output", () => {
    const r = run(docx(para(picture({ id: 1, rid: "rId5", descr: "Same" }))), [ins(1, loc(1, 1, "rId5"), "  Same ")])
    expect(r.ok && r.report.unchanged).toBe(1)
    expect(r.ok && r.output).toBeNull()
  })

  it("updates pictures in headers through the header's own relationships", () => {
    const src = docx(para("<w:r><w:t>Body</w:t></w:r>"), { header: para(picture({ id: 7, rid: "rId1" })) })
    const r = run(src, [ins(1, loc(1, 7, "rId1", "word/header1.xml"), "Company logo")])
    if (!r.ok || !r.output) throw new Error("expected output")
    expect(r.report.items[0].region).toBe("header")
    expect(r.report.partsModified).toEqual(["word/header1.xml"])
    expect(part(r.output, "word/header1.xml")).toContain('descr="Company logo"')
  })

  it("refuses stale, mismatched, ambiguous and duplicate mappings instead of guessing", () => {
    const body = para(picture({ id: 1, rid: "rId5" })) + para(picture({ id: 1, rid: "rId5" })) + para(picture({ id: 3, rid: "rId6" }))
    const r = run(docx(body), [
      ins(1, loc(9, 1, "rId5"), "x"),
      ins(2, loc(3, 99, "rId6"), "x"),
      ins(3, loc(3, 3, "rId5"), "x"),
      ins(4, loc(1, 1, "rId5"), "x"),
      ins(5, "not a locator", "x"),
      ins(6, loc(1, 1, "rId5", "word/footer3.xml"), "x"),
    ])
    if (!r.ok) throw new Error("expected report")
    expect(r.report.items.map((i) => i.code)).toEqual(["LOCATOR_NOT_FOUND", "LOCATOR_MISMATCH", "LOCATOR_MISMATCH", "AMBIGUOUS_LOCATOR", "INVALID_LOCATOR", "PART_NOT_FOUND"])
    expect(r.report.updated).toBe(0)
    expect(r.output).toBeNull()
  })

  it("flags two occurrences that resolve to the same picture", () => {
    const r = run(docx(para(picture({ id: 1, rid: "rId5" }))), [ins(1, loc(1, 1, "rId5"), "a"), ins(2, loc(1, 1, "rId5"), "b")])
    expect(r.ok && r.report.items.map((i) => i.code)).toEqual(["DUPLICATE_OCCURRENCE", "DUPLICATE_OCCURRENCE"])
  })

  it("reports charts, linked pictures, text-box pictures and legacy VML as unsupported", () => {
    const textbox = `<w:r><w:drawing><wp:anchor><wp:docPr id="20" name="Text Box"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="x"><wps:wsp><wps:txbx><w:txbxContent>${para(picture({ id: 21, rid: "rId5" }))}</w:txbxContent></wps:txbx></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`
    const body = para(picture({ id: 1, rid: "rId5", chart: true })) + para(picture({ id: 2, rid: "rId6", link: true })) + para(textbox) + para('<w:r><w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml"/></w:pict></w:r>')
    const r = run(docx(body), [ins(1, loc(1, 1, "rId5"), "x"), ins(2, loc(2, 2, "rId6"), "x"), ins(3, loc(4, 21, "rId5"), "x")])
    if (!r.ok) throw new Error("expected report")
    expect(r.report.items.map((i) => [i.status, i.code])).toEqual([
      ["unsupported", "NOT_A_PICTURE"],
      ["unsupported", "LINKED_IMAGE"],
      ["unsupported", "TEXTBOX_PICTURE"],
    ])
    expect(r.report.textboxPictureCount).toBe(1)
    expect(r.report.legacyVmlCount).toBe(1)
  })

  it("excludes mc:Fallback copies from drawing ordinals", () => {
    const body = para(`<mc:AlternateContent><mc:Choice Requires="wps">${picture({ id: 1, rid: "rId5" })}</mc:Choice><mc:Fallback>${picture({ id: 1, rid: "rId5" })}</mc:Fallback></mc:AlternateContent>`) + para(picture({ id: 2, rid: "rId6" }))
    const r = run(docx(body), [ins(1, loc(2, 2, "rId6"), "Second")])
    expect(r.ok && r.report.updated).toBe(1)
  })

  it("blocks digitally signed packages", () => {
    const src = docx(para(picture({ id: 1, rid: "rId5" })), { extra: [{ name: "_xmlsignatures/sig1.xml", data: "<Signature/>", deflate: true }] })
    const r = run(src, [ins(1, loc(1, 1, "rId5"), "x")])
    expect(r).toMatchObject({ ok: false, code: "SIGNED_DOCUMENT" })
  })

  it("keeps editing restrictions and warns about them", () => {
    const settings = `<?xml version="1.0"?><w:settings ${ROOT_NS}><w:documentProtection w:edit="readOnly" w:enforcement="1"/></w:settings>`
    const src = docx(para(picture({ id: 1, rid: "rId5" })), { extra: [{ name: "word/settings.xml", data: settings, deflate: true }] })
    const r = run(src, [ins(1, loc(1, 1, "rId5"), "x")])
    if (!r.ok || !r.output) throw new Error("expected output")
    expect(r.report.warnings.map((w) => w.code)).toContain("EDITING_RESTRICTIONS_PRESENT")
    expect(part(r.output, "word/settings.xml")).toBe(settings)
  })

  it("rejects invalid packages and enforces the output size limit", () => {
    expect(run(Buffer.from("not a zip"), [])).toMatchObject({ ok: false, code: "INVALID_DOCUMENT" })
    const src = docx(para(picture({ id: 1, rid: "rId5" })))
    expect(insertDocxAltText(src, [ins(1, loc(1, 1, "rId5"), "x")], { maxOutputBytes: 10 })).toMatchObject({ ok: false, code: "OUTPUT_TOO_LARGE" })
  })

  it("dry runs report the plan without building output", () => {
    const r = run(docx(para(picture({ id: 1, rid: "rId5" }))), [ins(1, loc(1, 1, "rId5"), "x")], true)
    expect(r.ok && r.report.updated).toBe(1)
    expect(r.ok && r.output).toBeNull()
  })

  it("normalizes whitespace and strips XML-illegal control characters", () => {
    expect(normalizeAltText(" a\u0001 \n b\t")).toBe("a b")
  })
})
