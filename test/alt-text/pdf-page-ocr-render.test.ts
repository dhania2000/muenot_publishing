/**
 * Phase 3 Task 7 — REAL smoke tests: synthetic scanned PDFs (built with pdf-lib from the ground-truth
 * OCR fixtures) are rendered by the actual installed renderer (pdf.js + @napi-rs/canvas) and the
 * rasters are recognised by the actual self-hosted Tesseract engine. No mocks.
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { degrees, PDFDocument, StandardFonts } from "pdf-lib"
import { recognizeImage, shutdownOcrEngine } from "@/lib/alt-text/ocr-engine"
import { openPdfForRender, PageRenderError } from "@/lib/alt-text/pdf-page-renderer"
import { rasterBoxToNorm, rasterBoxToPdf } from "@/lib/alt-text/pdf-page-ocr-contract"
import { mapEngineLayout } from "@/lib/alt-text/ocr-contract"
import { errorRates } from "./ocr-metrics"

const dir = path.join(process.cwd(), "test/fixtures/ocr/multilingual")
const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")).samples as { id: string; file: string; mode: "eng" | "hin" | "eng_hin"; expected: string }[]
const sample = (id: string) => manifest.find((s) => s.id === id)!

/** A "scanned" page: one raster covering the whole page at `dpi`, no text layer. */
async function scannedPdf(ids: string[], opts: { dpi?: number; rotate?: number; margin?: number } = {}) {
  const pdf = await PDFDocument.create()
  for (const id of ids) {
    const png = await pdf.embedPng(readFileSync(path.join(dir, sample(id).file)))
    const k = 72 / (opts.dpi ?? 200)
    const m = opts.margin ?? 0
    const page = pdf.addPage([png.width * k + 2 * m, png.height * k + 2 * m])
    page.drawImage(png, { x: m, y: m, width: png.width * k, height: png.height * k })
    if (opts.rotate) page.setRotation(degrees(opts.rotate))
  }
  return pdf.save()
}

afterAll(async () => {
  await shutdownOcrEngine()
})

const results: Record<string, { cer: number; wer: number; text: string }> = {}

describe("real PDF page rendering", () => {
  it("opens a scanned PDF, selects pages and produces valid rasters", async () => {
    const bytes = await scannedPdf(["eng-clean", "hin-paragraph"])
    const original = Buffer.from(bytes)
    const handle = await openPdfForRender(bytes)
    try {
      expect(handle.numPages).toBe(2)
      const p2 = await handle.renderPage(2, { targetDpi: 200 })
      // 1100 px at 200 DPI → page width 396 pt → re-rendered at 200 DPI = 1100 px.
      expect(p2.width).toBe(1100)
      expect(p2.height).toBe(255)
      expect(p2.rotate).toBe(0)
      expect(Array.from(p2.png.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47])
      await expect(handle.renderPage(3)).rejects.toBeInstanceOf(PageRenderError)
    } finally {
      await handle.destroy()
    }
    expect(Buffer.from(bytes).equals(original)).toBe(true) // source bytes never modified
  }, 60_000)

  it("renders /Rotate 90 pages in displayed orientation and maps boxes back to PDF space", async () => {
    const bytes = await scannedPdf(["eng-clean"], { rotate: 90 })
    const handle = await openPdfForRender(bytes)
    try {
      const r = await handle.renderPage(1, { targetDpi: 200 })
      expect(r.rotate).toBe(90)
      expect(r.width).toBe(133) // landscape page displayed as portrait
      expect(r.height).toBe(1100)
      // The full raster maps back to the whole MediaBox (396 × 47.88 pt).
      const full = rasterBoxToPdf({ left: 0, top: 0, width: r.width, height: r.height }, r.viewportTransform)!
      expect(full.x0).toBeCloseTo(0, 0)
      expect(full.y0).toBeCloseTo(0, 0)
      expect(full.x1).toBeCloseTo(396, 0)
      expect(full.y1).toBeCloseTo(47.88, 0)
    } finally {
      await handle.destroy()
    }
  }, 60_000)

  it("enforces the pixel limit with a bounded DPI fallback", async () => {
    const pdf = await PDFDocument.create()
    pdf.addPage([14_000, 14_000]) // ~194 in square: cannot fit 25 MP even at 150 DPI
    const handle = await openPdfForRender(await pdf.save())
    try {
      await expect(handle.renderPage(1)).rejects.toMatchObject({ code: "PAGE_PIXEL_LIMIT" })
    } finally {
      await handle.destroy()
    }
  }, 30_000)

  it("renders a digital text page (vector glyphs) for comparison", async () => {
    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const page = pdf.addPage([612, 792])
    page.drawText("Digital text layer", { x: 72, y: 700, size: 24, font })
    const handle = await openPdfForRender(await pdf.save())
    try {
      const r = await handle.renderPage(1, { targetDpi: 150 })
      // Letter at 150 DPI; the renderer ceils fractional viewport sizes.
      expect(Math.abs(r.width - 1275)).toBeLessThanOrEqual(1)
      expect(Math.abs(r.height - 1650)).toBeLessThanOrEqual(1)
    } finally {
      await handle.destroy()
    }
  }, 30_000)
})

describe("real end-to-end page OCR (render → local OCR)", () => {
  for (const [id, mode] of [
    ["eng-clean", "eng"],
    ["hin-paragraph", "hin"],
    ["bi-01", "eng_hin"],
  ] as const) {
    it(`${mode}: ${id}`, async () => {
      const handle = await openPdfForRender(await scannedPdf([id], { margin: 18 }))
      try {
        const r = await handle.renderPage(1, { targetDpi: 300 })
        const ocr = await recognizeImage({ bytes: r.png, languageMode: mode, timeoutMs: 120_000 })
        const e = errorRates(sample(id).expected, ocr.text)
        results[id] = { cer: e.cer, wer: e.wer, text: ocr.text.trim() }
        console.log(`[task7-ocr] ${id} mode=${mode} dpi=${r.dpi} raster=${r.width}x${r.height} CER=${e.cer.toFixed(3)} WER=${e.wer.toFixed(3)} text=${JSON.stringify(ocr.text.trim())}`)
        expect(ocr.loadedLanguages).toBe(mode === "eng" ? "eng" : mode === "hin" ? "hin" : "hin+eng")
        expect(e.cer).toBeLessThan(0.2)
        const layout = mapEngineLayout(ocr.blocks, true)
        expect(layout.lines.length).toBeGreaterThan(0)
        for (const line of layout.lines) {
          expect(rasterBoxToNorm(line.box, r.width, r.height)).not.toBeNull()
          expect(rasterBoxToPdf(line.box, r.viewportTransform)).not.toBeNull()
        }
      } finally {
        await handle.destroy()
      }
    }, 180_000)
  }
})
