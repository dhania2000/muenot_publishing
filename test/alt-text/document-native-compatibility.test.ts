import {afterAll,expect,it} from "vitest"
import {createHash} from "node:crypto"
import {writeFile} from "node:fs/promises"
import {performance} from "node:perf_hooks"
import {validateExportOutput,type ExpectedOccurrence} from "@/lib/alt-text/output-validation"
import {PDFDocument,PDFName,PDFHexString,PDFDict} from "pdf-lib"
import {createCanvas} from "@napi-rs/canvas"
import {buildZip,ooxmlEntries} from "./fixtures/documents"
import {readPptxPackage} from "@/lib/alt-text/pptx-package"
import {insertPptxAltText} from "@/lib/alt-text/pptx-alt-text-inserter"
import {rawEntryMap} from "@/lib/alt-text/ooxml-zip-rewrite"
import {readPdfPackage} from "@/lib/alt-text/pdf-package"
import {remediatePdfAltText} from "@/lib/alt-text/pdf-alt-text-remediator"
const R="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
const P="http://schemas.openxmlformats.org/presentationml/2006/main", A="http://schemas.openxmlformats.org/drawingml/2006/main"
const qaMeasurements:{format:string;occurrences:number;validationMs:number;checks:number}[]=[]
afterAll(async()=>{if(process.env.ALT_TEXT_OUTPUT_QA_AUDIT_OUTPUT)await writeFile(process.env.ALT_TEXT_OUTPUT_QA_AUDIT_OUTPUT,JSON.stringify({synthetic:true,scope:"Actual Output Validation over small native writer fixtures; excludes writing, storage, Office rendering and providers.",measurements:qaMeasurements},null,2)+"\n")})
const relationships=(entries:string)=>`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries}</Relationships>`
function pptx(){
 const picture=(n:number)=>`<p:pic><p:nvPicPr><p:cNvPr id="${n}" name="Image ${n}" descr="Original ${n}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdImage"/></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1000" cy="1000"/></a:xfrm></p:spPr></p:pic>`
 return buildZip(ooxmlEntries("pptx",{omitMain:true,mainRels:relationships(`<Relationship Id="rId1" Type="${R}/slide" Target="slides/slide1.xml"/>`),extra:[
  {name:"ppt/presentation.xml",data:`<p:presentation xmlns:p="${P}" xmlns:r="${R}"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>`},
  {name:"ppt/slides/slide1.xml",data:`<p:sld xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${R}"><p:cSld><p:spTree>${picture(2)}<p:grpSp><p:nvGrpSpPr><p:cNvPr id="9" name="Group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${picture(3)}</p:grpSp></p:spTree></p:cSld><p:transition spd="slow"/><p:timing><p:tnLst/></p:timing></p:sld>`,deflate:true},
  {name:"ppt/slides/_rels/slide1.xml.rels",data:relationships(`<Relationship Id="rIdImage" Type="${R}/image" Target="../media/image1.png"/>`)},
  {name:"ppt/media/image1.png",data:createCanvas(2,2).encodeSync("png")},
  {name:"ppt/notesSlides/notesSlide1.xml",data:"<notes>Speaker notes unchanged</notes>"},
  {name:"ppt/theme/theme1.xml",data:"<theme>Original theme</theme>"},
 ]}))
}
it("PPTX: updates the exact approved occurrence of reused media and preserves the grouped unapproved picture and all untouched ZIP entries",()=>{
 const source=pptx(),copy=Buffer.from(source),before=readPptxPackage(source)
 expect(before.occurrences).toHaveLength(2);expect(before.occurrences[1].groupPath).not.toHaveLength(0)
 const result=insertPptxAltText(source,[{occurrenceId:101,sourceLocator:before.occurrences[0].sourceLocator,text:"हृदय के चार कक्ष",decorative:false}],{maxOutputBytes:1<<20})
 expect(result.ok).toBe(true);if(!result.ok||!result.output)throw new Error(JSON.stringify(result))
 const after=readPptxPackage(result.output)
 expect(after.occurrences.map(o=>o.description)).toEqual(["हृदय के चार कक्ष","Original 3"])
 expect(after.occurrences.map(o=>o.sourceLocator)).toEqual(before.occurrences.map(o=>o.sourceLocator))
 expect(result.report.partsModified).toEqual(["ppt/slides/slide1.xml"])
 const rawBefore=rawEntryMap(source),rawAfter=rawEntryMap(result.output)
 for(const [name,bytes]of rawBefore)if(name!=="ppt/slides/slide1.xml")expect(rawAfter.get(name)?.equals(bytes)).toBe(true)
 expect(source.equals(copy)).toBe(true)
 expect(result.output.includes(Buffer.from("<math>"))).toBe(false)
})
it("PPTX: refuses an unmapped occurrence rather than changing the first picture",()=>{
 const source=pptx(),result=insertPptxAltText(source,[{occurrenceId:5,sourceLocator:"ppt/slides/slide99.xml#pic:2:rIdImage",text:"wrong target",decorative:false}],{maxOutputBytes:1<<20})
 expect(result.ok).toBe(true);if(result.ok){expect(result.report.updated).toBe(0);expect(result.report.unsupported+result.report.failed).toBe(1)}
})
async function pdf(tagged=true){
 const d=await PDFDocument.create(),root=d.context.obj({Type:"StructTreeRoot"}),rootRef=d.context.register(root),figures=[]
 const image=d.context.register(d.context.flateStream(Uint8Array.from([255,0,0]),{Type:"XObject",Subtype:"Image",Width:1,Height:1,ColorSpace:"DeviceRGB",BitsPerComponent:8}))
 for(let n=0;n<2;n++){
  const page=d.addPage([200,200]);page.node.setXObject(PDFName.of("Im1"),image)
  page.node.set(PDFName.of("Contents"),d.context.register(d.context.stream(`${tagged?"/Figure <</MCID 0>> BDC ":""}q 30 0 0 30 10 10 cm /Im1 Do Q${tagged?" EMC":""}`)))
  page.node.set(PDFName.of("StructParents"),d.context.obj(n))
  figures.push(d.context.register(d.context.obj({Type:"StructElem",S:"Figure",P:rootRef,Pg:page.ref,K:0,Alt:PDFHexString.fromText(`Original ${n+1}`)})))
 }
 if(tagged){root.set(PDFName.of("K"),d.context.obj(figures));root.set(PDFName.of("ParentTree"),d.context.register(d.context.obj({Nums:[0,[figures[0]],1,[figures[1]]]})));d.catalog.set(PDFName.of("StructTreeRoot"),rootRef);d.catalog.set(PDFName.of("MarkInfo"),d.context.obj({Marked:true}))}
 return Buffer.from(await d.save({useObjectStreams:false}))
}
it("PDF: changes one exact Figure Alt using an incremental update, preserving original bytes, ParentTree, other Figure and page content",async()=>{
 const source=await pdf(),copy=Buffer.from(source),before=await readPdfPackage(source)
 expect(before.occurrences).toHaveLength(2)
 const result=await remediatePdfAltText(source,[{occurrenceId:101,sourceLocator:before.occurrences[0].sourceLocator,text:"मानव हृदय का चित्र",decorative:false}],{maxOutputBytes:1<<20})
 expect(result.ok).toBe(true);if(!result.ok||!result.output)throw new Error(JSON.stringify(result))
 expect(result.report.updated).toBe(1);expect(result.report.pdf.conformance).toMatchObject({pdfua:"not_verified",wcag:"not_verified"})
 expect(result.output.subarray(0,source.length).equals(source)).toBe(true);expect(source.equals(copy)).toBe(true)
 const original=await PDFDocument.load(source),output=await PDFDocument.load(result.output)
 const tree=(d:PDFDocument)=>d.catalog.lookup(PDFName.of("StructTreeRoot"),PDFDict)
 expect(tree(output).get(PDFName.of("ParentTree"))?.toString()).toBe(tree(original).get(PDFName.of("ParentTree"))?.toString())
 const after=await readPdfPackage(result.output)
 expect(after.occurrences.map(o=>o.sourceLocator)).toEqual(before.occurrences.map(o=>o.sourceLocator))
 const serialized=result.output.subarray(source.length).toString("latin1")
 expect(serialized).toContain(PDFHexString.fromText("मानव हृदय का चित्र").toString())
 expect(serialized).not.toContain("/Contents");expect(serialized).not.toContain("/ParentTree")
})
it("PDF: untagged content is reported for manual remediation without fabricating tags or OCR text",async()=>{
 const source=await pdf(false),pkg=await readPdfPackage(source)
 const result=await remediatePdfAltText(source,[{occurrenceId:1,sourceLocator:pkg.occurrences[0].sourceLocator,text:"A diagram",decorative:false}],{maxOutputBytes:1<<20})
 expect(result.ok).toBe(false);if(!result.ok)expect(result.code).toBe("UNTAGGED_PDF")
})
it.each(["pdf","pptx"] as const)("%s: actual output QA verifies the approved native text, mapping, checksums and separate conformance limits",async format=>{
 const source=format==="pdf"?await pdf():pptx(),pkg=format==="pdf"?await readPdfPackage(source):readPptxPackage(source),sourceLocator=pkg.occurrences[0].sourceLocator,text="H₂O और ऊर्जा"
 const instruction=[{occurrenceId:101,sourceLocator,text,decorative:false}],result=format==="pdf"?await remediatePdfAltText(source,instruction,{maxOutputBytes:1<<20}):insertPptxAltText(source,instruction,{maxOutputBytes:1<<20})
 if(!result.ok||!result.output)throw new Error(JSON.stringify(result))
 const output=result.output,checksum=(b:Buffer)=>createHash("sha256").update(b).digest("hex")
 const occurrence:ExpectedOccurrence={occurrenceId:101,assetId:11,sourceLocator,currentSourceLocator:sourceLocator,sourceLocatorSnapshotVerified:true,exportStatus:"updated",exportCode:"UPDATED",exportMessage:"Inserted",decorative:false,approvedVersionId:901,approvedVersion:3,approvedText:text,versionFound:true,currentApprovedVersionId:901,location:{}}
 const input={format,original:source,output,record:{sourceChecksum:checksum(source),outputChecksum:checksum(output),sizeBytes:output.length,policy:"approved_only"},occurrences:[occurrence],shortMaxChars:125}
 const started=performance.now(),checks=await validateExportOutput(input)
 qaMeasurements.push({format,occurrences:pkg.occurrences.length,validationMs:Math.round((performance.now()-started)*1000)/1000,checks:checks.length})
 for(const id of ["FI-001","FI-002","FI-003","FI-004","AT-001","AT-002","AT-003"])expect(checks.find(c=>c.ruleId===id)?.status,id).toBe("passed")
 if(format==="pdf")expect(checks.find(c=>c.ruleId==="PU-001")?.status).toBe("not_verified")
 const wrong=await validateExportOutput({...input,occurrences:[{...occurrence,approvedText:text+" different approved version"}]})
 expect(wrong.find(c=>c.ruleId==="AT-003")?.status).toBe("failed")
 const missing=await validateExportOutput({...input,occurrences:[{...occurrence,versionFound:false,approvedText:null}]})
 expect(missing.find(c=>c.ruleId==="AT-001")?.status).toBe("failed")
 const drift=await validateExportOutput({...input,occurrences:[{...occurrence,sourceLocator:pkg.occurrences[1].sourceLocator}]})
 expect(drift.find(c=>c.ruleId==="AT-003")?.status).toBe("failed")
 const corrupt=await validateExportOutput({...input,record:{...input.record,outputChecksum:"0".repeat(64)}})
 expect(corrupt.find(c=>c.ruleId==="FI-002")?.status).toBe("failed")
})
