import "server-only"
import {createHash} from "node:crypto"
import {TextDecoder} from "node:util"
import {XMLValidator} from "fast-xml-parser"
import {validateDocumentBytes} from "@/lib/alt-text/document-validation"
import {inspectPackage,type PackageManifest} from "./package-inspection"
import {detectEpubSource} from "./intake-plan"
export type SourceInspection={kind:NonNullable<ReturnType<typeof detectEpubSource>>;mime:string;sha256:string;security:"pending";classification:string;reviewRequired:boolean;manifest?:PackageManifest}
export class SourceInspectionError extends Error{constructor(readonly code:string,message:string){super(message)}}
const reject=(code:string,message:string):never=>{throw new SourceInspectionError(code,message)}
export function inspectEpubSource(name:string,bytes:Buffer,declaredMime=""):SourceInspection{
 const kind=detectEpubSource(name),ext=name.toLowerCase().split('.').at(-1)
 if(!kind||!bytes.length||bytes.length>25*1024*1024||name.length>255||!name.isWellFormed()||/[\x00-\x1f\\/]/.test(name))return reject("UNSUPPORTED_SOURCE","Choose a supported source with a safe filename, up to 25 MiB.")
 if(bytes.subarray(0,2).toString()==="MZ"||bytes.subarray(0,4).equals(Buffer.from([127,69,76,70])))reject("UNSAFE_SOURCE","Executable content cannot be submitted as a publication.")
 let mime="application/octet-stream",classification:string=kind,reviewRequired=false,manifest:PackageManifest|undefined
 if(kind==="pdf"||kind==="docx"){
  if(kind==="docx")manifest=inspectPackage(bytes,"docx")
  const result=validateDocumentBytes(bytes,kind);if(!result.ok)reject(result.code,result.message)
  mime=kind==="pdf"?"application/pdf":"application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  if(kind==="pdf"){classification="pdf_requires_parser_review";reviewRequired=true}
 }else if(kind==="images"){
  const matches:Record<string,boolean>={png:bytes.length>=24&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.subarray(12,16).toString()==="IHDR",jpg:bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255,jpeg:bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255,webp:bytes.length>=16&&bytes.subarray(0,4).toString()==="RIFF"&&bytes.subarray(8,12).toString()==="WEBP",tif:bytes.subarray(0,4).equals(Buffer.from([73,73,42,0]))||bytes.subarray(0,4).equals(Buffer.from([77,77,0,42])),tiff:bytes.subarray(0,4).equals(Buffer.from([73,73,42,0]))||bytes.subarray(0,4).equals(Buffer.from([77,77,0,42]))}
  if(!matches[ext!])reject("SOURCE_MISMATCH","Image signature does not match its filename.")
  mime=ext==="jpg"||ext==="jpeg"?"image/jpeg":ext==="tif"||ext==="tiff"?"image/tiff":`image/${ext}`;classification="image_requires_decode_review";reviewRequired=true
 }else if(kind==="epub"||kind==="idml"||kind==="package"){
  if(!bytes.subarray(0,4).equals(Buffer.from([80,75,3,4])))reject("SOURCE_MISMATCH","Package signature does not match its filename.")
  manifest=inspectPackage(bytes,kind)
  mime=kind==="package"?"application/zip":kind==="epub"?"application/epub+zip":"application/vnd.adobe.indesign-idml-package";classification=manifest.classification;reviewRequired=true
 }else{
  let text:string;try{text=new TextDecoder("utf-8",{fatal:true}).decode(bytes)}catch{return reject("SOURCE_ENCODING","Text sources must contain valid UTF-8.")}
  if(text.includes("\0")||/<!ENTITY|<!DOCTYPE\s+(?!html\s*>)/i.test(text))reject("UNSAFE_SOURCE","External entities and active document declarations are not accepted.")
  if(/<\s*(?:script|iframe|object|embed)\b|\bon[a-z]+\s*=|javascript\s*:/i.test(text))reject("ACTIVE_CONTENT","Active web content must be removed before intake.")
  if(kind==="xml"){if(XMLValidator.validate(text)!==true)reject("SOURCE_MISMATCH","The XML source is malformed.");mime="application/xml";classification="xml_requires_vocabulary_review";reviewRequired=true}
  if(kind==="html"){if(!/<(?:!doctype\s+html|html)\b/i.test(text))reject("SOURCE_MISMATCH","The source is not a complete HTML document.");mime=ext==="xhtml"?"application/xhtml+xml":"text/html";classification="html_requires_structure_review";reviewRequired=true}
  if(kind==="latex"){if(!/\\(?:documentclass|begin\{document\})/.test(text)||/\\(?:write18|openout|immediate|usepackage\{shellesc\})/i.test(text))reject("UNSAFE_SOURCE","Choose a document source without shell or file-writing commands.");mime="application/x-tex";classification="latex_requires_sandbox_review";reviewRequired=true}
 }
 const declared=declaredMime.split(';')[0].trim().toLowerCase()
 if(declared&&declared!=="application/octet-stream"&&declared!==mime&&!(declared==="text/xml"&&mime==="application/xml")&&!(declared==="text/plain"&&["html","xml","latex"].includes(kind)))reject("MIME_MISMATCH","Declared content type does not match inspected source content.")
 return {kind,mime,sha256:createHash("sha256").update(bytes).digest("hex"),security:"pending",classification,reviewRequired,...(manifest?{manifest}:{})}
}
