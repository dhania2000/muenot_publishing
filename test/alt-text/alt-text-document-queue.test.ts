import { describe, expect, it } from "vitest"
import {
  checkSignature,
  createDocumentEntry,
  DOCUMENT_FORMATS,
  partitionNewFiles,
  preliminaryCheck,
  selectReadyFiles,
  summarizeDocuments,
} from "@/lib/alt-text/document-queue"

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00])
const file = (name: string, bytes: Uint8Array, type = "", lastModified = 1) => new File([bytes], name, { type, lastModified })

describe("document queue validation", () => {
  it("accepts PDF, PPTX and DOCX with correct or missing MIME", () => {
    expect(preliminaryCheck(file("a.pdf", PDF, "application/pdf"))).toEqual({ kind: "pdf" })
    expect(preliminaryCheck(file("b.pptx", ZIP, DOCUMENT_FORMATS.pptx.mime))).toEqual({ kind: "pptx" })
    expect(preliminaryCheck(file("c.DOCX", ZIP))).toEqual({ kind: "docx" })
  })

  it("rejects unsupported, legacy, mismatched, empty and oversized files", () => {
    expect(preliminaryCheck(file("a.png", PDF, "image/png")).error).toMatch(/Unsupported/)
    expect(preliminaryCheck(file("a.doc", PDF)).error).toMatch(/Legacy/)
    expect(preliminaryCheck(file("a.pdf", PDF, "image/png")).error).toMatch(/does not match/)
    expect(preliminaryCheck(file("a.pdf", new Uint8Array()))).toMatchObject({ error: "File is empty" })
    expect(preliminaryCheck(file("a.pdf", PDF), 0.000001).error).toMatch(/limit is/)
  })

  it("checks lightweight signatures", async () => {
    expect(await checkSignature(file("a.pdf", PDF), "pdf")).toBeNull()
    expect(await checkSignature(file("a.docx", ZIP), "docx")).toBeNull()
    expect(await checkSignature(file("a.pdf", ZIP), "pdf")).toMatch(/not a PDF/)
    expect(await checkSignature(file("a.pptx", PDF), "pptx")).toMatch(/not a valid/)
  })

  it("skips metadata duplicates against the queue and within a batch", () => {
    const a = file("a.pdf", PDF)
    const existing = [createDocumentEntry(a, "1")]
    const { accepted, duplicates } = partitionNewFiles(existing, [file("a.pdf", PDF), file("a.pdf", PDF, "", 2), file("a.pdf", PDF, "", 2)])
    expect(duplicates).toEqual(["a.pdf", "a.pdf"])
    expect(accepted).toHaveLength(1)
    expect(partitionNewFiles([], [a]).accepted).toEqual([a])
  })

  it("summarizes counters and exposes only ready File objects", () => {
    const ready = { ...createDocumentEntry(file("a.pdf", PDF), "1"), status: "ready" as const }
    const entries = [ready, createDocumentEntry(file("b.docx", ZIP), "2"), createDocumentEntry(file("c.txt", PDF), "3")]
    expect(summarizeDocuments(entries)).toMatchObject({ total: 3, pdf: 1, docx: 1, pptx: 0, invalid: 1, validating: 1, ready: 1, totalBytes: 18 })
    expect(selectReadyFiles(entries)).toEqual([ready.file])
  })
})
