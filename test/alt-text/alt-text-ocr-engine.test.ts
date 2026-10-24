import { readFileSync } from "node:fs"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { normalizeOcrText } from "@/lib/alt-text/ocr-contract"
import { probeOcrEngine, recognizeImage, shutdownOcrEngine } from "@/lib/alt-text/ocr-engine"

/** Runs the real self-hosted engine against rendered fixtures. Fully offline. */
const fixture = (name: string) => new Uint8Array(readFileSync(path.join(process.cwd(), "test", "fixtures", "ocr", name)))

describe("self-hosted OCR engine", () => {
  afterAll(async () => {
    await shutdownOcrEngine()
  })

  it("passes the integrity-checked health probe", async () => {
    const health = await probeOcrEngine()
    expect(health.status).toBe("available")
  }, 60_000)

  it("reads a printed sentence", async () => {
    const r = await recognizeImage({ bytes: fixture("ocr-sentence.png") })
    expect(normalizeOcrText(r.text).replace(/\s+/g, " ")).toBe("The quick brown fox jumps over the lazy dog.")
  }, 60_000)

  it("keeps numbers, punctuation and units", async () => {
    const text = normalizeOcrText((await recognizeImage({ bytes: fixture("ocr-multiline.png") })).text)
    expect(text).toContain("Annual Results 2026")
    expect(text).toContain("12.5%")
    expect(text).toContain("3,450")
    expect(text).toContain("-4.75")
    expect(text).toContain("101.3 kPa")
  }, 60_000)

  it("returns nothing for a blank image instead of inventing text", async () => {
    const r = await recognizeImage({ bytes: fixture("ocr-blank.png") })
    expect(normalizeOcrText(r.text)).toBe("")
  }, 60_000)

  it("reads only the requested region, with boxes in full-image coordinates", async () => {
    const left = await recognizeImage({ bytes: fixture("ocr-regions.png"), rectangle: { left: 0, top: 60, width: 480, height: 140 } })
    const right = await recognizeImage({ bytes: fixture("ocr-regions.png"), rectangle: { left: 520, top: 60, width: 480, height: 140 } })
    expect(normalizeOcrText(left.text)).toBe("LEFT LABEL")
    expect(normalizeOcrText(right.text)).toBe("Right Side")
  }, 60_000)

  it("rejects bytes that are not an image", async () => {
    await expect(recognizeImage({ bytes: new TextEncoder().encode("not an image") })).rejects.toThrow()
  }, 60_000)
})
