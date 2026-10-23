import { describe, expect, it } from "vitest"
import { PDFDocument, PDFName, PDFString, type PDFPage, type PDFRef } from "pdf-lib"
import { PdfPackageError, readPdfPackage } from "@/lib/alt-text/pdf-package"
import { decodePdfImage, type PdfImageSpec } from "@/lib/alt-text/pdf-image-decode"

const LIMITS = { maxDecodedBytes: 8 * 1024 * 1024, maxDimension: 4096 }
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** Minimal baseline JPEG header (SOI + SOF0 3×2, 3 components + EOI) — enough for header parsing. */
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x02, 0x00, 0x03, 0x03, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0, 0xff, 0xd9])

async function makePdf(build: (d: PDFDocument, page: PDFPage) => void): Promise<Uint8Array> {
  const d = await PDFDocument.create()
  const page = d.addPage([200, 200])
  build(d, page)
  return d.save({ useObjectStreams: false })
}

const setContent = (d: PDFDocument, page: PDFPage, content: string) => page.node.set(PDFName.of("Contents"), d.context.register(d.context.stream(content)))

const rgbImage = (d: PDFDocument): PDFRef =>
  d.context.register(
    d.context.flateStream(Uint8Array.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]), {
      Type: "XObject",
      Subtype: "Image",
      Width: 2,
      Height: 2,
      ColorSpace: "DeviceRGB",
      BitsPerComponent: 8,
    }),
  )

const addFigure = (d: PDFDocument, page: PDFPage, mcid: number, alt: string) => {
  const elem = d.context.register(d.context.obj({ Type: "StructElem", S: "Figure", Pg: page.ref, K: mcid, Alt: PDFString.of(alt) }))
  const root = d.context.register(d.context.obj({ Type: "StructTreeRoot", K: [elem] }))
  d.catalog.set(PDFName.of("StructTreeRoot"), root)
  d.catalog.set(PDFName.of("MarkInfo"), d.context.obj({ Marked: true }))
}

const decode = (spec: PdfImageSpec | null) => {
  expect(spec).not.toBeNull()
  return decodePdfImage(spec!, LIMITS)
}

describe("readPdfPackage", () => {
  it("extracts a raw RGB Image XObject as a real PNG with a stable locator", async () => {
    const pkg = await readPdfPackage(
      await makePdf((d, page) => {
        page.node.setXObject(PDFName.of("Im1"), rgbImage(d))
        setContent(d, page, "q 50 0 0 50 10 10 cm /Im1 Do Q")
      }),
    )
    expect(pkg.totalPages).toBe(1)
    expect(pkg.occurrences).toHaveLength(1)
    const o = pkg.occurrences[0]
    expect(o.sourceLocator).toBe("pdf:p1:o0:xobj:Im1")
    expect(o.kind).toBe("xobject")
    expect(o.classification).toBe("embedded_image")
    expect(o.structure.association).toBe("untagged")
    const img = decode(o.image)
    expect(img.ok).toBe(true)
    if (img.ok) {
      expect(img.format).toBe("png")
      expect(img.preserved).toBe(false)
      expect([...img.bytes.subarray(0, 8)]).toEqual(PNG_SIG)
      expect(img.width).toBe(2)
    }
  })

  it("records each drawing of a reused XObject as a separate occurrence that shares one decode", async () => {
    const pkg = await readPdfPackage(
      await makePdf((d, page) => {
        page.node.setXObject(PDFName.of("Im1"), rgbImage(d))
        setContent(d, page, "q 20 0 0 20 0 0 cm /Im1 Do Q q 20 0 0 20 100 100 cm /Im1 Do Q")
      }),
    )
    expect(pkg.occurrences).toHaveLength(2)
    const [a, b] = pkg.occurrences
    expect(a.sourceLocator).not.toBe(b.sourceLocator)
    expect(a.cacheKey).toBe(b.cacheKey)
    expect(a.ctm).not.toEqual(b.ctm)
  })

  it("preserves DCT (JPEG) data byte-for-byte", async () => {
    const pkg = await readPdfPackage(
      await makePdf((d, page) => {
        const ref = d.context.register(
          d.context.stream(JPEG, { Type: "XObject", Subtype: "Image", Width: 3, Height: 2, ColorSpace: "DeviceRGB", BitsPerComponent: 8, Filter: "DCTDecode" }),
        )
        page.node.setXObject(PDFName.of("Im1"), ref)
        setContent(d, page, "q 30 0 0 20 0 0 cm /Im1 Do Q")
      }),
    )
    const img = decode(pkg.occurrences[0].image)
    expect(img.ok && img.preserved).toBe(true)
    if (img.ok) {
      expect(img.mimeType).toBe("image/jpeg")
      expect([...img.bytes]).toEqual([...JPEG])
    }
  })

  it("finds images inside Form XObjects and records the form chain", async () => {
    const pkg = await readPdfPackage(
      await makePdf((d, page) => {
        const im = rgbImage(d)
        const form = d.context.register(
          d.context.stream("q 10 0 0 10 0 0 cm /Im1 Do Q", {
            Type: "XObject",
            Subtype: "Form",
            BBox: [0, 0, 100, 100],
            Resources: { XObject: { Im1: im } },
          }),
        )
        page.node.setXObject(PDFName.of("Fm1"), form)
        setContent(d, page, "q 2 0 0 2 0 0 cm /Fm1 Do Q")
      }),
    )
    expect(pkg.occurrences).toHaveLength(1)
    const o = pkg.occurrences[0]
    expect(o.parentForms.map((f) => f.name)).toEqual(["Fm1"])
    expect(o.sourceLocator).toBe("pdf:p1:o0:xobj:Fm1>Im1")
    expect(o.ctm).toEqual([20, 0, 0, 20, 0, 0])
  })

  it("extracts inline images (BI/ID/EI)", async () => {
    const pkg = await readPdfPackage(
      await makePdf((d, page) => {
        setContent(d, page, "q 40 0 0 20 0 0 cm BI /W 2 /H 1 /CS /G /BPC 8 ID \x80\xff EI Q")
      }),
    )
    expect(pkg.occurrences).toHaveLength(1)
    expect(pkg.occurrences[0].kind).toBe("inline")
    const img = decode(pkg.occurrences[0].image)
    expect(img.ok).toBe(true)
  })

  it("flags full-page images as likely scanned pages", async () => {
    const pkg = await readPdfPackage(
      await makePdf((d, page) => {
        page.node.setXObject(PDFName.of("Im1"), rgbImage(d))
        setContent(d, page, "q 200 0 0 200 0 0 cm /Im1 Do Q")
      }),
    )
    expect(pkg.occurrences[0].classification).toBe("likely_scanned_page")
  })

  it("marks images drawn inside /Artifact as decorative candidates", async () => {
    const pkg = await readPdfPackage(
      await makePdf((d, page) => {
        page.node.setXObject(PDFName.of("Im1"), rgbImage(d))
        setContent(d, page, "/Artifact BMC q 20 0 0 20 0 0 cm /Im1 Do Q EMC")
      }),
    )
    expect(pkg.occurrences[0].artifact).toBe(true)
  })

  it("resolves a tagged Figure's existing Alt through its page-level MCID", async () => {
    const pkg = await readPdfPackage(
      await makePdf((d, page) => {
        page.node.setXObject(PDFName.of("Im1"), rgbImage(d))
        setContent(d, page, "/Figure <</MCID 0>> BDC q 20 0 0 20 0 0 cm /Im1 Do Q EMC")
        addFigure(d, page, 0, "A red, green and blue swatch")
      }),
    )
    const s = pkg.occurrences[0].structure
    expect(s.association).toBe("resolved")
    expect(s.mcid).toBe(0)
    expect(s.alt).toBe("A red, green and blue swatch")
    expect(pkg.report.tagged).toBe(true)
  })

  it("marks two images sharing one Figure MCID as ambiguous and copies no Alt", async () => {
    const pkg = await readPdfPackage(
      await makePdf((d, page) => {
        page.node.setXObject(PDFName.of("Im1"), rgbImage(d))
        setContent(d, page, "/Figure <</MCID 0>> BDC /Im1 Do q 2 0 0 2 0 0 cm /Im1 Do Q EMC")
        addFigure(d, page, 0, "Shared")
      }),
    )
    expect(pkg.occurrences.map((o) => o.structure.association)).toEqual(["ambiguous", "ambiguous"])
    expect(pkg.occurrences.every((o) => o.structure.alt === null)).toBe(true)
  })

  it("does not resolve a form-local MCID against the page's structure tree", async () => {
    const pkg = await readPdfPackage(
      await makePdf((d, page) => {
        const im = rgbImage(d)
        const form = d.context.register(
          d.context.stream("/Figure <</MCID 0>> BDC /Im1 Do EMC", { Type: "XObject", Subtype: "Form", BBox: [0, 0, 1, 1], Resources: { XObject: { Im1: im } } }),
        )
        page.node.setXObject(PDFName.of("Fm1"), form)
        setContent(d, page, "q 20 0 0 20 0 0 cm /Fm1 Do Q")
        addFigure(d, page, 0, "Belongs to a different image")
      }),
    )
    const s = pkg.occurrences[0].structure
    expect(s.association).toBe("unresolved")
    expect(s.alt).toBeNull()
  })

  it("rejects files that are not PDFs", async () => {
    await expect(readPdfPackage(new TextEncoder().encode("PK\x03\x04 not a pdf"))).rejects.toMatchObject({ code: "INVALID_DOCUMENT" })
    await expect(readPdfPackage(new TextEncoder().encode("%PDF-1.7\n garbage"))).rejects.toBeInstanceOf(PdfPackageError)
  })
})

describe("decodePdfImage", () => {
  const base: PdfImageSpec = {
    width: 2,
    height: 1,
    bitsPerComponent: 8,
    colorSpace: { kind: "gray", label: "DeviceGray" },
    filters: [],
    decodeParms: [],
    imageMask: false,
    decode: null,
    data: Uint8Array.from([0, 255]),
    softMask: null,
    softMaskMatte: false,
    colorKeyMask: null,
    stencilMask: null,
  }

  it("applies a soft mask as PNG alpha", () => {
    const img = decodePdfImage({ ...base, softMask: { ...base, data: Uint8Array.from([255, 0]) } }, LIMITS)
    expect(img.ok).toBe(true)
    // IHDR colour type byte: 4 = grayscale + alpha.
    if (img.ok) expect(img.bytes[25]).toBe(4)
  })

  it("reports JPEG 2000 as unsupported instead of guessing", () => {
    const img = decodePdfImage({ ...base, filters: ["JPXDecode"] }, LIMITS)
    expect(img).toMatchObject({ ok: false, status: "unsupported", code: "UNSUPPORTED_COMPRESSION" })
  })

  it("refuses stencil masks as standalone pictures", () => {
    expect(decodePdfImage({ ...base, imageMask: true }, LIMITS)).toMatchObject({ ok: false, code: "STENCIL_MASK" })
  })

  it("caps decompression so a Flate bomb cannot exhaust memory", async () => {
    const { deflateSync } = await import("node:zlib")
    const bomb = deflateSync(new Uint8Array(4 * 1024 * 1024))
    const img = decodePdfImage({ ...base, width: 2048, height: 2048, filters: ["FlateDecode"], data: bomb }, { maxDecodedBytes: 1024 * 1024, maxDimension: 4096 })
    expect(img).toMatchObject({ ok: false, code: "IMAGE_TOO_LARGE" })
  })

  it("rejects custom /Decode arrays it cannot reproduce exactly", () => {
    expect(decodePdfImage({ ...base, decode: [0.2, 0.8] }, LIMITS)).toMatchObject({ ok: false, code: "UNSUPPORTED_DECODE_ARRAY" })
  })
})
