import { describe, expect, it } from "vitest"
import { isUnsafeEntryName, resolvePartTarget, validateDocumentBytes } from "@/lib/alt-text/document-validation"
import { buildZip, CFB, EXE, ooxml, ooxmlEntries, pdf, rel, rels, MAIN_CONTENT_TYPES } from "./fixtures/documents"

const code = (r: ReturnType<typeof validateDocumentBytes>) => (r.ok ? "OK" : r.code)

describe("document validation · PDF", () => {
  it("accepts a well-formed PDF", () => {
    expect(validateDocumentBytes(pdf(), "pdf")).toEqual({ ok: true })
  })

  it("rejects a file without a PDF signature", () => {
    expect(code(validateDocumentBytes(Buffer.from("hello world, not a pdf %%EOF startxref"), "pdf"))).toBe("CONTENT_MISMATCH")
  })

  it("rejects a disguised executable", () => {
    expect(code(validateDocumentBytes(EXE, "pdf"))).toBe("CONTENT_MISMATCH")
  })

  it("rejects a truncated PDF", () => {
    const full = pdf()
    expect(code(validateDocumentBytes(full.subarray(0, full.length - 20), "pdf"))).toBe("INVALID_DOCUMENT")
  })

  it("rejects encrypted PDFs", () => {
    expect(code(validateDocumentBytes(pdf("trailer << /Encrypt 5 0 R >>\n"), "pdf"))).toBe("ENCRYPTED_DOCUMENT")
  })

  it("rejects PDFs with JavaScript or launch actions", () => {
    expect(code(validateDocumentBytes(pdf("<< /S /JavaScript /JS (app.alert(1)) >>\n"), "pdf"))).toBe("ACTIVE_CONTENT")
    expect(code(validateDocumentBytes(pdf("<< /S /Launch /F (cmd.exe) >>\n"), "pdf"))).toBe("ACTIVE_CONTENT")
  })

  it("rejects empty input", () => {
    expect(validateDocumentBytes(Buffer.alloc(0), "pdf").ok).toBe(false)
  })
})

describe("document validation · OOXML package structure", () => {
  it("accepts valid DOCX and PPTX packages", () => {
    expect(validateDocumentBytes(ooxml("docx"), "docx")).toEqual({ ok: true })
    expect(validateDocumentBytes(ooxml("pptx"), "pptx")).toEqual({ ok: true })
  })

  it("rejects a generic ZIP renamed to .docx", () => {
    const zip = buildZip([{ name: "notes.txt", data: "hello", deflate: true }])
    expect(code(validateDocumentBytes(zip, "docx"))).toBe("CONTENT_MISMATCH")
  })

  it("rejects a PPTX uploaded with a .docx extension", () => {
    expect(code(validateDocumentBytes(ooxml("pptx"), "docx"))).toBe("CONTENT_MISMATCH")
  })

  it("rejects a disguised executable", () => {
    expect(code(validateDocumentBytes(EXE, "docx"))).toBe("CONTENT_MISMATCH")
  })

  it("rejects legacy/password-protected compound files", () => {
    expect(code(validateDocumentBytes(CFB, "docx"))).toBe("ENCRYPTED_DOCUMENT")
    expect(code(validateDocumentBytes(CFB, "pptx"))).toBe("ENCRYPTED_DOCUMENT")
  })

  it("rejects truncated/malformed packages", () => {
    const full = ooxml("docx")
    expect(code(validateDocumentBytes(full.subarray(0, full.length - 10), "docx"))).toBe("INVALID_DOCUMENT")
    expect(code(validateDocumentBytes(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]), "docx"))).toBe("INVALID_DOCUMENT")
  })

  it("rejects a package whose declared main part is missing", () => {
    expect(code(validateDocumentBytes(ooxml("docx", { omitMain: true }), "docx"))).toBe("INVALID_DOCUMENT")
  })

  it("rejects a package whose root relationship does not target the main part", () => {
    const rootRels = rels(rel("officeDocument", "word/other.xml"))
    expect(code(validateDocumentBytes(ooxml("docx", { rootRels }), "docx"))).toBe("INVALID_DOCUMENT")
  })

  it("rejects XML DOCTYPE / entity declarations", () => {
    const contentTypes = `<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><Types><Override PartName="/word/document.xml" ContentType="${MAIN_CONTENT_TYPES.docx}"/></Types>`
    expect(code(validateDocumentBytes(ooxml("docx", { contentTypes }), "docx"))).toBe("UNSAFE_ARCHIVE")
  })
})

describe("document validation · active content", () => {
  it("rejects macro projects", () => {
    const extra = [{ name: "word/vbaProject.bin", data: "x" }]
    expect(code(validateDocumentBytes(ooxml("docx", { extra }), "docx"))).toBe("MACROS_NOT_ALLOWED")
  })

  it("rejects macro-enabled content types", () => {
    const contentTypes = `<Types><Override PartName="/word/document.xml" ContentType="${MAIN_CONTENT_TYPES.docx}"/><Override PartName="/word/x.bin" ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/></Types>`
    expect(code(validateDocumentBytes(ooxml("docx", { contentTypes }), "docx"))).toBe("MACROS_NOT_ALLOWED")
  })

  it("rejects ActiveX controls", () => {
    const extra = [{ name: "ppt/activeX/activeX1.xml", data: "<x/>" }]
    expect(code(validateDocumentBytes(ooxml("pptx", { extra }), "pptx"))).toBe("ACTIVE_CONTENT")
  })

  it("rejects remote templates and local-file external links", () => {
    const remote = rels(rel("attachedTemplate", "https://evil.example/t.dotm", true))
    expect(code(validateDocumentBytes(ooxml("docx", { mainRels: remote }), "docx"))).toBe("ACTIVE_CONTENT")
    const local = rels(rel("hyperlink", "file:///C:/Windows/System32/calc.exe", true))
    expect(code(validateDocumentBytes(ooxml("docx", { mainRels: local }), "docx"))).toBe("ACTIVE_CONTENT")
  })

  it("allows ordinary external hyperlinks", () => {
    const mainRels = rels(rel("hyperlink", "https://example.com", true))
    expect(validateDocumentBytes(ooxml("docx", { mainRels }), "docx")).toEqual({ ok: true })
  })
})

describe("document validation · archive safety", () => {
  it("rejects path traversal entry names", () => {
    for (const name of ["../evil.xml", "word/../../evil.xml", "/abs.xml", "C:/win.xml", "a\\b.xml"]) {
      const extra = [{ name, data: "x" }]
      expect(code(validateDocumentBytes(ooxml("docx", { extra }), "docx"))).toBe("UNSAFE_ARCHIVE")
    }
  })

  it("rejects relationships that escape the package", () => {
    const mainRels = rels(rel("image", "../../../etc/passwd"))
    expect(code(validateDocumentBytes(ooxml("docx", { mainRels }), "docx"))).toBe("UNSAFE_ARCHIVE")
  })

  it("rejects duplicate parts", () => {
    const extra = [{ name: "WORD/DOCUMENT.XML", data: "x" }]
    expect(code(validateDocumentBytes(ooxml("docx", { extra }), "docx"))).toBe("UNSAFE_ARCHIVE")
  })

  it("rejects ZIP-level encryption", () => {
    const extra = [{ name: "word/media/a.bin", data: "x", flags: 0x1 }]
    expect(code(validateDocumentBytes(ooxml("docx", { extra }), "docx"))).toBe("ENCRYPTED_DOCUMENT")
  })

  it("rejects a high-ratio compression bomb", () => {
    const extra = [{ name: "word/media/bomb.bin", data: Buffer.alloc(4 * 1024 * 1024), deflate: true }]
    expect(code(validateDocumentBytes(ooxml("docx", { extra }), "docx"))).toBe("UNSAFE_ARCHIVE")
  })

  it("rejects packages that expand beyond the aggregate limit", () => {
    const extra = Array.from({ length: 260 }, (_, i) => ({ name: `word/media/p${i}.bin`, data: "abc", deflate: true, declaredSize: 1024 * 1024 }))
    expect(code(validateDocumentBytes(ooxml("docx", { extra }), "docx"))).toBe("ARCHIVE_TOO_LARGE")
  })

  it("rejects packages with too many entries", () => {
    const extra = Array.from({ length: 5001 }, (_, i) => ({ name: `word/media/e${i}`, data: "" }))
    expect(code(validateDocumentBytes(buildZip([...ooxmlEntries("docx"), ...extra]), "docx"))).toBe("UNSAFE_ARCHIVE")
  })

  it("isUnsafeEntryName / resolvePartTarget", () => {
    expect(isUnsafeEntryName("word/document.xml")).toBe(false)
    expect(isUnsafeEntryName("")).toBe(true)
    expect(resolvePartTarget("word/", "media/image1.png")).toBe("word/media/image1.png")
    expect(resolvePartTarget("word/", "../docProps/core.xml")).toBe("docprops/core.xml")
    expect(resolvePartTarget("", "../x")).toBeNull()
    expect(resolvePartTarget("word/", "file:///etc/passwd")).toBeNull()
    expect(resolvePartTarget("word/", "%2e%2e/%2e%2e/x")).toBeNull()
  })
})
