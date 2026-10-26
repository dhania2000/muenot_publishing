import { readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { PDFDocument, PDFName, PDFNumber, degrees, StandardFonts } from "pdf-lib"
import { afterAll, describe, expect, it } from "vitest"
import { inspectPdfPages, recognizePdfPage, sourceHash } from "@/lib/alt-text/pdf-page-ocr-pipeline"
import { shutdownOcrEngine } from "@/lib/alt-text/ocr-engine"
import { openPdfForRender } from "@/lib/alt-text/pdf-page-renderer"
import { errorRates } from "./ocr-metrics"
import { rasterBoxToPdf, rasterBoxToNorm } from "@/lib/alt-text/pdf-page-ocr-contract"
import { readPdfPackage } from "@/lib/alt-text/pdf-package"

const root = "test/fixtures/ocr/multilingual/"
const manifest = JSON.parse(readFileSync(root + "manifest.json", "utf8")).samples as { id: string; file: string; expected: string }[]
const sample = (id: string) => manifest.find((s) => s.id === id)!
async function scanned(ids: string[], opts: { digital?: boolean; layer?: boolean; rotate?: number; crop?: boolean; userUnit?: number } = {}) {
  const pdf = await PDFDocument.create()
  const embedded = new Map<string, Awaited<ReturnType<typeof pdf.embedPng>>>()
  for (const id of ids) {
    let img = embedded.get(id)
    if (!img) { img = await pdf.embedPng(readFileSync(root + sample(id).file)); embedded.set(id,img) }
    const page = pdf.addPage([img.width * 72 / 200, img.height * 72 / 200])
    page.drawImage(img, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() })
    if (opts.layer) page.drawText("This is the original existing searchable PDF text layer preserved separately.", { size: 8, opacity: 0 })
    if (opts.rotate) page.setRotation(degrees(opts.rotate))
    if (opts.crop) page.setCropBox(12,6,page.getWidth()-24,page.getHeight()-12)
    if (opts.userUnit) page.node.set(PDFName.of("UserUnit"), PDFNumber.of(opts.userUnit))
  }
  if (opts.digital) {
    const page = pdf.addPage([612,792])
    page.drawText("A born digital page with sufficient native selectable text and no scanned image.", { size: 12, font: await pdf.embedFont(StandardFonts.Helvetica) })
  }
  return pdf.save()
}
afterAll(shutdownOcrEngine)

describe("real PDF page evidence and geometry", () => {
  it("allows automatic eligibility only when existing image OCR confirmed text in the full-page image",async()=>{
    const bytes=await scanned(["eng-clean"]), pkg=await readPdfPackage(bytes)
    const pages=await inspectPdfPages(2,bytes,new Set([pkg.occurrences[0].sourceLocator]))
    expect(pages[0].status).toBe("eligible");expect(pages[0].evidence.confirmedRasterText).toBe(true)
  })
  it("keeps mixed documents page-local and requires review for full-page photos/scan candidates", async () => {
    const pages = await inspectPdfPages(2,await scanned(["eng-clean"],{digital:true}))
    expect(pages.map((p) => p.classification.pageClass)).toEqual(["scanned","born_digital"])
    expect(pages[0].status).toBe("needs_review")
    expect(pages[0].classification.reasons.join(" ")).toContain("photograph")
    expect(pages[1].nativeText).toContain("born digital")
    expect(pages[1].result).toBeNull()
    expect(pages.map((p) => p.pageNumber)).toEqual([1,2])
  })
  it("preserves an existing invisible text layer instead of transcribing it on inspection", async () => {
    const [page] = await inspectPdfPages(2,await scanned(["eng-clean"],{layer:true}))
    expect(page.classification.pageClass).toBe("scanned_with_text_layer")
    expect(page.status).toBe("not_required")
    expect(page.nativeText).toContain("original existing searchable")
    expect(page.result).toBeNull()
  })
  for (const n of [10,100,500]) it(`inspects ${n} repeated scanned pages without creating assets or changing the PDF`, async () => {
    const bytes = await scanned(Array(n).fill("eng-clean")), hash = sourceHash(bytes)
    const pages = await inspectPdfPages(2,bytes)
    expect(pages).toHaveLength(n)
    expect(pages[n-1].pageIndex).toBe(n-1)
    expect(new Set(pages.map((p) => p.sourceSha256))).toEqual(new Set([hash]))
    expect(sourceHash(bytes)).toBe(hash)
  },60_000)
  it("retains CropBox offsets, rotation and UserUnit in actual rendered coordinates", async () => {
    const bytes = await scanned(["eng-clean"],{rotate:90,crop:true,userUnit:2})
    const [page] = await inspectPdfPages(2,bytes)
    const handle = await openPdfForRender(bytes)
    try {
      const r = await handle.renderPage(1,{targetDpi:200})
      expect(page.geometry.cropBox.slice(0,2)).toEqual([12,6])
      expect(r.rotate).toBe(90); expect(r.userUnit).toBe(2)
      const box = rasterBoxToPdf({left:0,top:0,width:r.width,height:r.height},r.viewportTransform)!
      expect(box.x0).toBeCloseTo(12,0); expect(box.y0).toBeCloseTo(6,0)
      expect(rasterBoxToNorm({left:1,top:1,width:5,height:5},r.width,r.height)).not.toBeNull()
    } finally { await handle.destroy() }
  })
  it("rejects invalid and encrypted PDF inputs", async () => {
    await expect(inspectPdfPages(2,new TextEncoder().encode("not a PDF"))).rejects.toMatchObject({code:"INVALID_DOCUMENT"})
    const pdf = await PDFDocument.create(); pdf.addPage()
    pdf.context.trailerInfo.Encrypt = pdf.context.register(pdf.context.obj({Filter:"Standard",V:1,R:2}))
    await expect(inspectPdfPages(2,await pdf.save())).rejects.toMatchObject({code:"ENCRYPTED_DOCUMENT"})
  })
  it("reports blank and vector-only pages without inventing text", async () => {
    const pdf=await PDFDocument.create(); pdf.addPage([200,200]); const v=pdf.addPage([200,200]); v.drawRectangle({x:20,y:20,width:50,height:50})
    const pages=await inspectPdfPages(2,await pdf.save())
    expect(pages[0].status).toBe("not_required"); expect(pages[1].classification.needsReview).toBe(true)
    expect(pages.every((p)=>p.nativeText==="" && p.result===null)).toBe(true)
  })
  it("rejects more than 500 pages rather than promising unlimited processing",async()=>{
    const pdf=await PDFDocument.create();for(let i=0;i<501;i++)pdf.addPage([200,200])
    await expect(inspectPdfPages(2,await pdf.save())).rejects.toMatchObject({code:"PAGE_COUNT_LIMIT"})
  })
})

describe("real scanned PDF → classification → renderer → local multilingual OCR", () => {
  const report: unknown[] = []
  afterAll(() => {
    mkdirSync("docs/alt-text",{recursive:true})
    writeFileSync("docs/alt-text/page-ocr-smoke-results.json",JSON.stringify({ policy:"Synthetic samples only. NFC, collapsed whitespace, case/punctuation/digit script preserved; CER over code points, WER over words. No database/API smoke was performed in this suite.",samples:report},null,2)+"\n")
  })
  for (const [id,languageMode] of [["eng-clean","eng"],["hin-paragraph","hin"],["bi-01","eng_hin"]] as const) it(`recognizes ${languageMode} with source identity, real models, Unicode and page boxes`,async()=>{
    const bytes=await scanned([id]), before=sourceHash(bytes), [page]=await inspectPdfPages(9,bytes)
    const result=await recognizePdfPage({documentId:9,page,bytes,runId:10,request:{action:"recognize",mode:"selected",pages:[0],languageMode,dpi:300,segmentation:"auto"},guard:async()=>{},onRecognizing:async()=>{}})
    const rates=errorRates(sample(id).expected,result.normalizedText)
    report.push({sample:id,languageMode,expected:sample(id).expected,actual:result.rawText,cer:rates.cer,wer:rates.wer,dpi:result.render.dpi,models:result.models})
    expect(rates.cer).toBeLessThan(.2)
    expect(result.sourceType).toBe("ocr_page_text"); expect(result.documentId).toBe(9); expect(result.pageNumber).toBe(1)
    expect(result.render.dpi).toBe(200); expect(result.models.length).toBe(languageMode==="eng_hin"?2:1)
    expect(result.loadedLanguages).toBe(languageMode==="eng_hin"?"hin+eng":languageMode)
    if(languageMode!=="eng") expect(result.rawText).toMatch(/\p{Script=Devanagari}/u)
    expect(result.lines.length).toBeGreaterThan(0); expect(sourceHash(bytes)).toBe(before)
  },180_000)
})
