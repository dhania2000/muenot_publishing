import {it,expect} from "vitest"
import {pdf} from "./fixtures/epub-pdf"
import {inspectEpubSource} from "@/lib/epub/source-inspection"
import {classifyEpubSource} from "@/lib/epub/source-classification"
it("uses the existing PDF parser for observed native text and retains human review",async()=>{const bytes=pdf("Native text");expect(await classifyEpubSource(inspectEpubSource("book.pdf",bytes),bytes)).toMatchObject({classification:"pdf_native_text_observed",security:"pending",reviewRequired:true,observations:{pages:1,nativeTextPages:1}})})
it("routes ambiguous/large PDFs to review and rejects corrupt small PDFs",async()=>{const blank=pdf("");expect((await classifyEpubSource(inspectEpubSource("book.pdf",blank),blank)).classification).toBe("pdf_ambiguous_requires_review");const corrupt=Buffer.from("%PDF-1.7\nstartxref\n0\n%%EOF");await expect(classifyEpubSource(inspectEpubSource("book.pdf",corrupt),corrupt)).rejects.toThrow();const large=Buffer.alloc(5*1024*1024+1);expect((await classifyEpubSource({...inspectEpubSource("book.pdf",blank)},large)).classification).toBe("pdf_large_requires_parser_review")})
