import { describe, expect, it } from "vitest"
import {
  deriveOcrStatus,
  mapEngineLayout,
  meanWordConfidence,
  normalizeOcrText,
  parseOcrRunRequest,
  pickActiveResult,
  regionCrop,
  sanitizeOcrText,
  truncateText,
} from "@/lib/alt-text/ocr-contract"
import { buildRecognitionResult, regionIneligibility } from "@/lib/alt-text/ocr-service"

const box = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 })

describe("parseOcrRunRequest", () => {
  it("accepts a minimal request", () => {
    const r = parseOcrRunRequest({ requestId: "abcdefgh12" })
    expect(r).toEqual({ ok: true, value: { requestId: "abcdefgh12", occurrenceId: null, regionId: null, reprocess: false, settingsRevision: null, languageMode: null } })
  })
  it("rejects unknown fields such as engine options or paths", () => {
    const r = parseOcrRunRequest({ requestId: "abcdefgh12", language: "deu", path: "/etc/passwd" })
    expect(r.ok).toBe(false)
  })
  it("rejects malformed ids", () => {
    expect(parseOcrRunRequest({ requestId: "short" }).ok).toBe(false)
    expect(parseOcrRunRequest({ requestId: "abcdefgh12", regionId: "../x" }).ok).toBe(false)
    expect(parseOcrRunRequest({ requestId: "abcdefgh12", occurrenceId: -1 }).ok).toBe(false)
    expect(parseOcrRunRequest([]).ok).toBe(false)
  })
})

describe("text normalisation", () => {
  it("only changes whitespace and keeps symbols, units and digits", () => {
    const raw = "Temp: -4.75 °C   \r\nH₂O 9.81 m/s²\n\n\n\nEnd  "
    expect(normalizeOcrText(raw)).toBe("Temp: -4.75 °C\nH₂O 9.81 m/s²\n\nEnd")
  })
  it("strips control and bidi override characters", () => {
    expect(sanitizeOcrText("a\u0000b\u202Ec\td")).toBe("abc\td")
  })
  it("truncates with a flag", () => {
    expect(truncateText("abcdef", 3)).toEqual({ text: "abc", truncated: true })
    expect(truncateText("ab", 3)).toEqual({ text: "ab", truncated: false })
  })
})

describe("layout mapping", () => {
  const blocks = [
    {
      paragraphs: [
        {
          lines: [
            { text: "Hello world", confidence: 91.234, bbox: box(10, 10, 110, 30), words: [{ text: "Hello", confidence: 95, bbox: box(10, 10, 50, 30) }, { text: "world", confidence: 40, bbox: box(55, 10, 110, 30) }] },
            { text: "bad box", confidence: 90, bbox: box(10, 10, 5, 5) },
            { text: "   ", confidence: 90, bbox: box(0, 0, 10, 10) },
          ],
        },
      ],
    },
  ]
  it("drops lines without a valid box or text and never guesses", () => {
    const layout = mapEngineLayout(blocks, true)
    expect(layout.lines).toHaveLength(1)
    expect(layout.lines[0]).toMatchObject({ text: "Hello world", confidence: 91.2, box: { left: 10, top: 10, width: 100, height: 20 } })
  })
  it("averages word confidence and counts low-confidence words", () => {
    expect(meanWordConfidence(mapEngineLayout(blocks, true))).toEqual({ mean: 67.5, low: 1 })
    expect(meanWordConfidence(mapEngineLayout([], true))).toEqual({ mean: null, low: 0 })
  })
  it("tolerates garbage input", () => {
    expect(mapEngineLayout("nope", true).lines).toEqual([])
    expect(mapEngineLayout([{ paragraphs: [{ lines: [{ text: "x" }] }] }], true).lines).toEqual([])
  })
})

describe("region crop", () => {
  it("maps a normalised box to stored pixels, clamped", () => {
    expect(regionCrop({ x: 0.1, y: 0.2, width: 0.5, height: 0.5 }, 1000, 300)).toEqual({ left: 100, top: 60, width: 500, height: 150 })
    expect(regionCrop({ x: 0.9, y: 0.9, width: 0.5, height: 0.5 }, 1000, 1000)).toEqual({ left: 900, top: 900, width: 100, height: 100 })
  })
  it("rejects regions that are too small to read", () => {
    expect(regionCrop({ x: 0, y: 0, width: 0.001, height: 0.5 }, 1000, 1000)).toBeNull()
  })
})

describe("region eligibility", () => {
  const upright = { orientation: 1, orientationUnknown: false }
  it("allows verified text regions on upright images", () => {
    expect(regionIneligibility({ primaryType: "text_region", locationStatus: "verified_frame" } as never, upright)).toBeNull()
  })
  it("refuses non-text types, unverified frames and rotated images", () => {
    expect(regionIneligibility({ primaryType: "photograph", locationStatus: "verified_frame" } as never, upright)).toMatch(/text-bearing/)
    expect(regionIneligibility({ primaryType: "text_region", locationStatus: "unverified" } as never, upright)).toMatch(/unverified/)
    expect(regionIneligibility({ primaryType: "text_region", locationStatus: "verified_frame" } as never, { orientation: 6, orientationUnknown: false })).toMatch(/orientation/)
  })
})

describe("status and active result", () => {
  it("derives status without inventing text", () => {
    expect(deriveOcrStatus({ normalizedText: "", meanConfidence: null, warnings: [] })).toBe("no_text_detected")
    expect(deriveOcrStatus({ normalizedText: "x", meanConfidence: 95, warnings: [] })).toBe("completed")
    expect(deriveOcrStatus({ normalizedText: "x", meanConfidence: 30, warnings: [] })).toBe("completed_with_warnings")
  })
  it("a newer failure never replaces an earlier usable result", () => {
    const rows = [
      { version: 1, status: "completed" as const },
      { version: 2, status: "failed" as const },
    ]
    const { active, latestFailure } = pickActiveResult(rows)
    expect(active?.version).toBe(1)
    expect(latestFailure?.version).toBe(2)
    expect(pickActiveResult([...rows, { version: 3, status: "completed" as const }]).latestFailure).toBeNull()
  })
})

describe("buildRecognitionResult", () => {
  const upright = { orientationMatches: true, orientation: 1, orientationUnknown: false }
  it("reports no text for an empty engine result", () => {
    const r = buildRecognitionResult({ text: "  \n ", blocks: [], durationMs: 5 }, upright)
    expect(r.status).toBe("no_text_detected")
    expect(r.normalizedText).toBe("")
    expect(r.layout).toBeNull()
  })
  it("warns and hides boxes when the image is stored rotated", () => {
    const blocks = [{ paragraphs: [{ lines: [{ text: "Hi", confidence: 95, bbox: box(0, 0, 10, 10), words: [{ text: "Hi", confidence: 95, bbox: box(0, 0, 10, 10) }] }] }] }]
    const r = buildRecognitionResult({ text: "Hi\n", blocks, durationMs: 5 }, { orientationMatches: false, orientation: 6, orientationUnknown: false })
    expect(r.status).toBe("completed_with_warnings")
    expect(r.layout?.drawable).toBe(false)
    expect(r.warnings[0]).toMatch(/EXIF orientation 6/)
  })
})
