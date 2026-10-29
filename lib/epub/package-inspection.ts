import "server-only"
import {crc32} from "node:zlib"
import {createHash} from "node:crypto"
import {XMLParser,XMLValidator} from "fast-xml-parser"
import {readZipDirectory,assertSafeEntries,readZipEntryBytes} from "@/lib/alt-text/document-validation"
export class PackageInspectionError extends Error{}
const reject=(message:string):never=>{throw new PackageInspectionError(message)}
export function safePackagePath(name:string){return name.length<=240&&name===name.normalize("NFC")&&!/[\\\x00-\x1f\x7f:%?#]/.test(name)&&!name.startsWith('/')&&!name.includes('//')&&name.split('/').filter(Boolean).length<=12&&!name.split('/').some(x=>x==='..'||x==='.')&&name.length>0}
export type PackageManifest={entries:{path:string;size:number;sha256:string}[];expandedBytes:number;classification:string;rootfile?:string}
export function inspectPackage(bytes:Buffer,kind:"package"|"docx"|"epub"|"idml"):PackageManifest{
 try{
 const entries=readZipDirectory(bytes);assertSafeEntries(entries)
 if(!entries.length||entries.length>1024)reject("Use a package containing 1–1024 entries.")
 const end=bytes.lastIndexOf(Buffer.from([80,75,5,6]));if(end<0||end+22>bytes.length||end+22+bytes.readUInt16LE(end+20)!==bytes.length)reject("Package end record is inconsistent.")
 let central=bytes.readUInt32LE(end+16),expandedBytes=0
 if(central+bytes.readUInt32LE(end+12)!==end)reject("Package directory is inconsistent.")
 const seen=new Set<string>(),manifest:PackageManifest={entries:[],expandedBytes:0,classification:kind==="package"?"source_package_requires_review":`${kind}_package`},texts=new Map<string,string>()
 for(const e of entries){
  if(!safePackagePath(e.name))reject("Package contains an unsafe or excessive relative path.")
  const normalized=e.name.normalize("NFC").toLowerCase();if(seen.has(normalized))reject("Package contains colliding paths.");seen.add(normalized)
  const mode=(bytes.readUInt32LE(central+38)>>>16)&0xf000
  if(mode===0x4000&&!e.name.endsWith('/')||mode===0x8000&&e.name.endsWith('/'))reject("Package file and directory modes disagree.")
  if(mode&&![0x8000,0x4000].includes(mode))reject("Links and special files cannot be imported.")
  const localName=bytes.subarray(e.localOffset+30,e.localOffset+30+bytes.readUInt16LE(e.localOffset+26)),centralName=bytes.subarray(central+46,central+46+bytes.readUInt16LE(central+28))
  if(!localName.equals(centralName)||bytes.readUInt16LE(e.localOffset+6)!==e.flags||bytes.readUInt16LE(e.localOffset+8)!==e.method)reject("Local and central package records disagree.")
  if(/\.(?:zip|7z|rar|gz|bz2|xz|tar|docx|epub|idml|exe|dll|com|bat|cmd|ps1|vbs|js|mjs|jar)$/i.test(e.name))reject("Nested archives, scripts and executables are not accepted.")
  expandedBytes+=e.size;if(expandedBytes>64*1024*1024||e.size>16*1024*1024)reject("Package expands beyond the 64 MiB total or 16 MiB part limit.")
  const body=readZipEntryBytes(bytes,e,16*1024*1024);if(crc32(body)!==bytes.readUInt32LE(central+16))reject("Package checksum does not match its content.")
  if(!e.name.endsWith('/'))manifest.entries.push({path:e.name,size:e.size,sha256:createHash("sha256").update(body).digest("hex")})
  if(/\.(?:xml|opf|xhtml|html|htm|rels)$/i.test(e.name)||e.name==="mimetype"){
   if(body.length>4*1024*1024)reject("Text package part exceeds the inspection limit.")
   const text=new TextDecoder("utf-8",{fatal:true}).decode(body)
   if(/<!ENTITY|<!DOCTYPE\s+(?!html\s*>)/i.test(text)||/<\s*(?:script|iframe|object|embed)\b|\bon[a-z]+\s*=|javascript\s*:/i.test(text))reject("Active content or external entities require removal.")
   if(/\.(?:xml|opf|rels)$/i.test(e.name)&&XMLValidator.validate(text)!==true)reject("Package contains malformed XML.")
   if(["mimetype","META-INF/container.xml","designmap.xml"].includes(e.name)||/\.opf$/i.test(e.name))texts.set(e.name,text)
  }
  central+=46+bytes.readUInt16LE(central+28)+bytes.readUInt16LE(central+30)+bytes.readUInt16LE(central+32)
 }
 const filePaths=new Set(manifest.entries.map(e=>e.path.toLowerCase()))
 if(!manifest.entries.length||manifest.entries.some(e=>e.path.split('/').slice(0,-1).some((_,i,a)=>filePaths.has(a.slice(0,i+1).join('/').toLowerCase()))))reject("Package paths collide with parent files or contain no files.")
 if(central!==end)reject("Package directory has unexpected records.")
 if(kind==="epub"){
  if(texts.get("mimetype")!=="application/epub+zip"||entries[0].name!=="mimetype"||entries[0].method!==0)reject("EPUB mimetype must be its first uncompressed entry.")
  const parser=new XMLParser({ignoreAttributes:false,processEntities:false,removeNSPrefix:true}),container=texts.get("META-INF/container.xml")
  if(!container)reject("EPUB container is missing.")
  const roots=parser.parse(container!).container?.rootfiles?.rootfile,r=Array.isArray(roots)?roots[0]:roots,path=r?.["@_full-path"]
  if(typeof path!=="string"||!safePackagePath(path)||!texts.has(path))reject("EPUB root package is missing or unsafe.")
  const version=String(parser.parse(texts.get(path)!).package?.["@_version"]??"")
  if(!["2.0","3.0"].includes(version))reject("EPUB package version requires manual inspection.")
  manifest.classification=version==="3.0"?"epub_3_package_not_spec_revision_verified":"epub_2_package";manifest.rootfile=path
 }
 if(kind==="idml"&&!texts.has("designmap.xml"))reject("IDML design map is missing.")
 manifest.expandedBytes=expandedBytes
 if(Buffer.byteLength(JSON.stringify(manifest))>128*1024)reject("Package manifest exceeds the metadata budget.")
 return manifest
 }catch(e){if(e instanceof PackageInspectionError)throw e;throw new PackageInspectionError("The package is damaged, unsafe or exceeds inspection limits.")}
}
