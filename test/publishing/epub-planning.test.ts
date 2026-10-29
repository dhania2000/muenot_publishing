import {describe,it,expect} from "vitest"
import {createElement as h} from "react"
import {renderToStaticMarkup} from "react-dom/server"
import {emptyEpubDraft,parseEpubDraft,selectionProblems,detectEpubSource,EPUB_PROFILES,DEFAULT_EPUB_SELECTION} from "@/lib/epub/intake-plan"
import {EpubOverview} from "@/components/publishing/conversion/epub/epub-overview"
import {EpubRequirements} from "@/components/publishing/conversion/epub/epub-requirements"
import {getConversionModule} from "@/lib/conversion-modules"
describe("EPUB planning contract",()=>{
 it("detects filename types while refusing unknown/protected executable suffixes",()=>{expect(detectEpubSource("BOOK.DOCX")).toBe("docx");expect(detectEpubSource("book.xhtml")).toBe("html");expect(detectEpubSource("scan.tiff")).toBe("images");expect(detectEpubSource("book.epub.exe")).toBeNull()})
 it("round trips a bounded plan with optional guidelines absent",()=>{const draft={...emptyEpubDraft(),title:"Unicode कथा",step:4,sources:[{name:"source.docx",kind:"docx" as const,size:1024}]};expect(parseEpubDraft(JSON.parse(JSON.stringify(draft)))).toEqual(draft);expect(draft.guidelineNotes).toBe("")})
 it("rejects invalid legacy and roll combinations with actionable alternatives",()=>{expect(selectionProblems({...DEFAULT_EPUB_SELECTION,version:"2.0.1-legacy",layout:"fixed"})[0]).toContain("EPUB 3.3");expect(selectionProblems({...DEFAULT_EPUB_SELECTION,layout:"roll",rendition:"multiple"})).toHaveLength(1);expect(parseEpubDraft({...emptyEpubDraft(),selection:{...DEFAULT_EPUB_SELECTION,version:"2.0.1-legacy",profile:"enhanced"}})).toBeNull()})
 it("rejects corrupted, excessive, spoofed and incompatible persisted drafts",()=>{for(const patch of [{tenantId:99},{schemaVersion:2},{step:5},{title:"x".repeat(161)},{guidelineNotes:"x".repeat(2001)},{selection:{...DEFAULT_EPUB_SELECTION,version:"9"}},{sources:[{name:"../private.docx",size:1,kind:"docx"}]},{sources:[{name:"x.exe",size:1,kind:"docx"}]},{sources:[{name:"x.docx",size:26*1024*1024,kind:"docx"}]},{sources:Array.from({length:11},()=>({name:"x.docx",size:1,kind:"docx"}))}])expect(parseEpubDraft({...emptyEpubDraft(),...patch})).toBeNull()})
 it("limits total selection bytes and contains only metadata, never File bytes",()=>{const sources=Array.from({length:5},(_,i)=>({name:`${i}.pdf`,kind:"pdf" as const,size:25*1024*1024}));expect(parseEpubDraft({...emptyEpubDraft(),sources})).toBeNull();expect(parseEpubDraft({...emptyEpubDraft(),sources:[{name:"x.pdf",size:1,kind:"pdf",body:"secret"}]})).toBeNull()})
})
describe("EPUB landing and capability navigation",()=>{
 it("shows every requested profile without fabricated processing support",()=>{const html=renderToStaticMarkup(h(EpubOverview));for(const p of EPUB_PROFILES)expect(html).toContain(p.name);expect(html).toContain("No conversion engine is currently available");expect(html).toContain("Prepare an enterprise inquiry");expect(html).not.toMatch(/files converted|success rate|>Convert now</i)})
 it("links only to existing EPUB pages and provides requirements for every profile",()=>{const pages=getConversionModule("epub")!.pages.map(p=>p.slug);for(const p of EPUB_PROFILES){expect(pages).toContain(p.page);expect(renderToStaticMarkup(h(EpubRequirements,{page:p.page}))).toContain(p.name)}})
})
