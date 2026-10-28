import { beforeEach, describe, expect, it, vi } from "vitest"

const deps = vi.hoisted(() => ({
  getDocumentForExtraction: vi.fn(),
  getDocumentImage: vi.fn(),
  getDocumentImages: vi.fn(),
  getDocumentImageContext: vi.fn(),
  saveDocumentImageContexts: vi.fn(),
  readVerifiedOriginal: vi.fn(),
  readPptxPackage: vi.fn(),
  readPdfPackage: vi.fn(),
  buildPptxContextEvidence: vi.fn(),
  buildPdfContextEvidence: vi.fn(),
  buildDocumentImageContext: vi.fn(),
  getSettings: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/alt-text/document-store", () => ({
  getDocumentImage: deps.getDocumentImage,
  getDocumentImages: deps.getDocumentImages,
  getDocumentImageContext: deps.getDocumentImageContext,
  saveDocumentImageContexts: deps.saveDocumentImageContexts,
}))
vi.mock("@/lib/alt-text/document-records", () => ({ DOCUMENT_IMAGE_PAGE_MAX: 2 }))
vi.mock("@/lib/alt-text/document-service", () => ({ getDocumentForExtraction: deps.getDocumentForExtraction }))
vi.mock("@/lib/alt-text/document-extraction-run", () => ({
  fail: (status: number, code: string, error: string) => ({ ok: false, status, code, error }),
  logName: () => "Error",
  readVerifiedOriginal: deps.readVerifiedOriginal,
}))
vi.mock("@/lib/alt-text/pdf-context", () => ({ buildPdfContextEvidence: deps.buildPdfContextEvidence }))
vi.mock("@/lib/alt-text/pptx-context", () => ({ buildPptxContextEvidence: deps.buildPptxContextEvidence }))
vi.mock("@/lib/alt-text/pdf-package", () => ({ readPdfPackage: deps.readPdfPackage }))
vi.mock("@/lib/alt-text/pptx-package", () => ({ readPptxPackage: deps.readPptxPackage }))
vi.mock("@/lib/alt-text/store", () => ({ getSettings: deps.getSettings }))
vi.mock("@/lib/alt-text/document-context-source", () => ({ documentContextSource: async()=>({sourceSha256:null,sourceRevision:"revision"}),contextSourceMatches:()=>false }))
vi.mock("@/lib/alt-text/upload", () => ({ ALT_TEXT_UPLOAD_MAX_MB: 25 }))
vi.mock("@/lib/alt-text/document-context", async (orig) => ({
  ...(await orig<typeof import("@/lib/alt-text/document-context")>()),
  buildDocumentImageContext: deps.buildDocumentImageContext,
}))

const { analyzeDocumentContexts, readDocumentImageContext } = await import("@/lib/alt-text/document-context-service")
const { DOCUMENT_CONTEXT_VERSION } = await import("@/lib/alt-text/document-context")

const scope = { uploadedBy: 7 }
const doc = { id: 5, filename: "Lesson 4.pptx", documentType: "pptx", securityStatus: "clean", processingStatus: "extracted" }
const occ = (id: number, locator: string, meta: Record<string, unknown> | null = null) => ({ id, documentId: 5, sourceLocator: locator, sourceMetadata: meta })
const ctxFor = (imageOccurrenceId: number, confidence: string) => ({ version: DOCUMENT_CONTEXT_VERSION, imageOccurrenceId, confidence, warnings: [] })

beforeEach(() => {
  vi.clearAllMocks()
  deps.getDocumentForExtraction.mockResolvedValue(doc)
  deps.getDocumentImages.mockResolvedValue([occ(1, "s1"), occ(2, "s2")].slice(0, 1))
  deps.readVerifiedOriginal.mockResolvedValue({ ok: true, bytes: Buffer.from("x") })
  deps.readPptxPackage.mockReturnValue({ occurrences: [], text: [] })
  deps.buildPptxContextEvidence.mockReturnValue(new Map([["s1", { existingAlt: null }], ["s2", { existingAlt: null }]]))
  deps.getSettings.mockResolvedValue({ defaultLanguage: "en", defaultAudience: "students" })
  deps.buildDocumentImageContext.mockImplementation((i: { imageOccurrenceId: number }) => ctxFor(i.imageOccurrenceId, "high"))
  deps.saveDocumentImageContexts.mockResolvedValue({ ok: true, saved: 1 })
})

describe("analyzeDocumentContexts", () => {
  it("rejects documents outside the caller's scope without reading the original", async () => {
    deps.getDocumentForExtraction.mockResolvedValueOnce(null)
    expect(await analyzeDocumentContexts(5, scope)).toMatchObject({ ok: false, status: 404 })
    expect(deps.readVerifiedOriginal).not.toHaveBeenCalled()
  })

  it("refuses unscanned, DOCX and not-yet-extracted documents", async () => {
    deps.getDocumentForExtraction.mockResolvedValueOnce({ ...doc, securityStatus: "pending" })
    expect(await analyzeDocumentContexts(5, scope)).toMatchObject({ status: 409, code: "DOCUMENT_NOT_CLEAN" })
    deps.getDocumentForExtraction.mockResolvedValueOnce({ ...doc, documentType: "docx" })
    expect(await analyzeDocumentContexts(5, scope)).toMatchObject({ status: 415, code: "CONTEXT_NOT_SUPPORTED" })
    deps.getDocumentForExtraction.mockResolvedValueOnce({ ...doc, processingStatus: "pending" })
    expect(await analyzeDocumentContexts(5, scope)).toMatchObject({ status: 409, code: "EXTRACTION_REQUIRED" })
    expect(deps.saveDocumentImageContexts).not.toHaveBeenCalled()
  })

  it("pages through every occurrence and persists one entry per image", async () => {
    deps.getDocumentImages.mockResolvedValueOnce([occ(1, "s1"), occ(2, "s2")]).mockResolvedValueOnce([occ(3, "missing")])
    deps.buildDocumentImageContext.mockImplementation((i: { imageOccurrenceId: number }) => ctxFor(i.imageOccurrenceId, i.imageOccurrenceId === 2 ? "unavailable" : "medium"))
    const r = await analyzeDocumentContexts(5, scope)
    expect(r).toEqual({ ok: true, summary: { analyzed: 1, unavailable: 1, failed: 1, total: 3 } })
    expect(deps.getDocumentImages).toHaveBeenCalledTimes(2)
    const entries = deps.saveDocumentImageContexts.mock.calls[0][1]
    expect(entries.map((e: { imageId: number; status: string }) => [e.imageId, e.status])).toEqual([
      [1, "analyzed"],
      [2, "unavailable"],
      [3, "failed"],
    ])
    expect(entries[2]).toMatchObject({ context: null, confidence: "unavailable" })
  })

  it("analyzes one occurrence but still parses the whole document, returning its context", async () => {
    deps.getDocumentImage.mockResolvedValueOnce(occ(2, "s2"))
    const r = await analyzeDocumentContexts(5, scope, { imageId: 2 })
    expect(r).toMatchObject({ ok: true, summary: { analyzed: 1, total: 1 }, context: { imageOccurrenceId: 2 } })
    expect(deps.getDocumentImages).not.toHaveBeenCalled()
  })

  it("returns 404 for an unknown occurrence", async () => {
    deps.getDocumentImage.mockResolvedValueOnce(null)
    expect(await analyzeDocumentContexts(5, scope, { imageId: 99 })).toMatchObject({ status: 404 })
  })

  it("falls back to source alt text from extraction metadata without altering it", async () => {
    deps.getDocumentImages.mockResolvedValueOnce([occ(1, "s1", { originalDescription: "  Author alt  " })])
    await analyzeDocumentContexts(5, scope)
    const input = deps.buildDocumentImageContext.mock.calls[0][0]
    expect(input.evidence.existingAlt).toEqual({ text: "  Author alt  ", source: { kind: "source_metadata", ref: "s1" } })
    expect(input.settings).toMatchObject({ outputLanguage: "en", targetAudience: "students", documentTitle: "Lesson 4" })
  })

  it("reports a parse failure without saving partial results", async () => {
    deps.readPptxPackage.mockImplementationOnce(() => {
      throw new Error("corrupt")
    })
    vi.spyOn(console, "error").mockImplementationOnce(() => {})
    expect(await analyzeDocumentContexts(5, scope)).toMatchObject({ status: 422, code: "INVALID_DOCUMENT" })
    expect(deps.saveDocumentImageContexts).not.toHaveBeenCalled()
  })

  it("reports a save failure", async () => {
    deps.saveDocumentImageContexts.mockResolvedValueOnce({ ok: false, code: "INTERNAL", error: "x" })
    expect(await analyzeDocumentContexts(5, scope)).toMatchObject({ status: 500, code: "CONTEXT_SAVE_FAILED" })
  })

  it("rejects documents with too many images", async () => {
    deps.getDocumentImages.mockResolvedValue([occ(1, "s1"), occ(2, "s2")])
    expect(await analyzeDocumentContexts(5, scope)).toMatchObject({ status: 413, code: "TOO_MANY_IMAGES" })
  })
})

describe("readDocumentImageContext", () => {
  it("reports not_analyzed for occurrences with no stored context", async () => {
    deps.getDocumentImageContext.mockResolvedValueOnce({ imageId: 3, status: null, confidence: null, version: null, analyzedAt: null, context: null })
    expect(await readDocumentImageContext(5, 3, scope)).toEqual({ ok: true, imageId: 3, status: "not_analyzed", analyzedAt: null, stale: false, context: null })
  })

  it("does not read context for documents outside scope", async () => {
    deps.getDocumentForExtraction.mockResolvedValueOnce(null)
    expect(await readDocumentImageContext(5, 3, scope)).toMatchObject({ ok: false, status: 404 })
    expect(deps.getDocumentImageContext).not.toHaveBeenCalled()
  })

  it("flags contexts written by an older builder version as stale", async () => {
    deps.getDocumentImageContext.mockResolvedValueOnce({ imageId: 3, status: "analyzed", confidence: "high", version: DOCUMENT_CONTEXT_VERSION - 1, analyzedAt: "2026-10-01T00:00:00.000Z", context: null })
    expect(await readDocumentImageContext(5, 3, scope)).toMatchObject({ status: "analyzed", stale: true })
  })
})
