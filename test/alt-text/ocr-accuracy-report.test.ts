import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { normalizeOcrText, type OcrLanguageMode } from "@/lib/alt-text/ocr-contract"
import { OCR_ENGINE_VERSION, modelsForMode, recognizeImage, shutdownOcrEngine } from "@/lib/alt-text/ocr-engine"
import { errorRates } from "./ocr-metrics"

/**
 * Phase 3 Task 6 — real-engine accuracy report over the labelled multilingual fixtures.
 * Opt-in (slow): OCR_ACCURACY_REPORT=1 npx vitest run test/alt-text/ocr-accuracy-report.test.ts
 * Writes docs/alt-text/ocr-accuracy-report.json. Uses the production provider (recognizeImage), so the
 * numbers describe exactly what the app runs. Small synthetic fixtures: not a production guarantee.
 */
type Sample = { id: string; file: string; mode: OcrLanguageMode; expected: string; category: string }

const dir = path.join(process.cwd(), "test/fixtures/ocr/multilingual")
const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")) as { font: string; renderer: string; samples: Sample[] }

describe.runIf(process.env.OCR_ACCURACY_REPORT === "1")("OCR accuracy report (real engine)", () => {
  afterAll(async () => {
    await shutdownOcrEngine()
  })

  it("recognises every labelled fixture and records CER/WER", async () => {
    const rows = []
    for (const s of manifest.samples) {
      const r = await recognizeImage({ bytes: new Uint8Array(readFileSync(path.join(dir, s.file))), languageMode: s.mode, timeoutMs: 120_000 })
      const recognized = normalizeOcrText(r.text)
      const e = errorRates(s.expected, recognized)
      rows.push({ id: s.id, category: s.category, mode: s.mode, loadedLanguages: r.loadedLanguages, expected: s.expected, recognized, cer: round(e.cer), wer: round(e.wer), charEdits: e.charEdits, refChars: e.refChars, wordEdits: e.wordEdits, refWords: e.refWords, durationMs: r.durationMs })
      expect(r.loadedLanguages).toBe(s.mode === "eng_hin" ? "hin+eng" : s.mode)
    }
    const aggregate = (filter: (r: (typeof rows)[number]) => boolean) => {
      const sel = rows.filter(filter)
      const ce = sel.reduce((a, r) => a + r.charEdits, 0)
      const cr = sel.reduce((a, r) => a + r.refChars, 0)
      const we = sel.reduce((a, r) => a + r.wordEdits, 0)
      const wr = sel.reduce((a, r) => a + r.refWords, 0)
      return { samples: sel.length, exactMatches: sel.filter((r) => r.charEdits === 0).length, cer: round(cr ? ce / cr : 0), wer: round(wr ? we / wr : 0), meanDurationMs: Math.round(sel.reduce((a, r) => a + r.durationMs, 0) / Math.max(1, sel.length)) }
    }
    const categories = [...new Set(rows.map((r) => r.category))]
    const report = {
      generatedAt: new Date().toISOString(),
      engine: OCR_ENGINE_VERSION,
      models: { eng: modelsForMode("eng"), hin: modelsForMode("hin"), eng_hin: modelsForMode("eng_hin") },
      fixtures: { font: manifest.font, renderer: manifest.renderer, count: rows.length },
      comparisonPolicy: "NFC on both sides; whitespace runs collapsed to one space; everything else (case, punctuation, digit script, symbols) must match. CER over code points, WER over space-separated tokens.",
      overall: aggregate(() => true),
      byMode: Object.fromEntries((["eng", "hin", "eng_hin"] as const).map((m) => [m, aggregate((r) => r.mode === m)])),
      byCategory: Object.fromEntries(categories.map((c) => [c, aggregate((r) => r.category === c)])),
      samples: rows,
    }
    mkdirSync(path.join(process.cwd(), "docs/alt-text"), { recursive: true })
    writeFileSync(path.join(process.cwd(), "docs/alt-text/ocr-accuracy-report.json"), `${JSON.stringify(report, null, 2)}\n`)
    console.log(JSON.stringify({ overall: report.overall, byMode: report.byMode, byCategory: report.byCategory }, null, 2))
  }, 900_000)
})

const round = (n: number) => Math.round(n * 10_000) / 10_000
