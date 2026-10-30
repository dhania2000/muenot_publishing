import 'server-only'
import {createHash} from 'node:crypto'
import {XMLParser} from 'fast-xml-parser'
import ExcelJS from 'exceljs'
import {inspectPackage} from './package-inspection'
import {readZipDirectory,readZipEntryBytes} from '@/lib/alt-text/document-validation'
import {readPdfPackage} from '@/lib/alt-text/pdf-package'
import {GUIDELINE_FILE_MAX,guidelineFormat,type GuidelineFileFact} from './guideline-selection'
import type {GuidelineExtraction,GuidelineSourceSegment} from './guidelines-contract'
export class GuidelineIngestionError extends Error{constructor(readonly code:string){super(code)}}
export type GuidelineInput=GuidelineFileFact&{bytes:Buffer;sha256:string}
const sha=(s:Buffer|string)=>createHash('sha256').update(s).digest('hex')
const text=(b:Buffer)=>{try{return new TextDecoder('utf-8',{fatal:true}).decode(b)}catch{throw new GuidelineIngestionError('GUIDELINE_ENCODING_UNSUPPORTED')}}
export function inspectGuidelineInput(name:string,bytes:Buffer):GuidelineInput{
 const format=guidelineFormat(name)
 if(!format||!name||name.length>255||!name.isWellFormed()||/[\x00-\x1f\x7f\\/]/.test(name)||bytes.length<1||bytes.length>GUIDELINE_FILE_MAX)throw new GuidelineIngestionError('GUIDELINE_FILE_LIMIT_OR_FORMAT')
 if(format==='pdf'){if(!bytes.subarray(0,1024).includes(Buffer.from('%PDF-'))||!bytes.subarray(-2048).includes(Buffer.from('%%EOF')))throw new GuidelineIngestionError('GUIDELINE_PDF_INVALID')}
 else if(format==='docx'||format==='xlsx'){
  let manifest:ReturnType<typeof inspectPackage>;try{manifest=inspectPackage(bytes,format==='docx'?'docx':'package')}catch{throw new GuidelineIngestionError('GUIDELINE_PACKAGE_UNSAFE')}
  if(manifest.expandedBytes>16*1024*1024||!manifest.entries.some(e=>e.path==='[Content_Types].xml')||format==='xlsx'&&!manifest.entries.some(e=>e.path==='xl/workbook.xml')||manifest.entries.some(e=>/\.(?:bin|xlsx|xlsm|pptx)$/i.test(e.path)||/externalLinks\//i.test(e.path)))throw new GuidelineIngestionError('GUIDELINE_PACKAGE_UNSUPPORTED')
  let cells=0,rows=0
  for(const entry of readZipDirectory(bytes).filter(e=>e.name.endsWith('.xml')||e.name.endsWith('.rels'))){const xml=text(readZipEntryBytes(bytes,entry,4*1024*1024));if(/<!DOCTYPE|<!ENTITY|TargetMode\s*=\s*["']External/i.test(xml))throw new GuidelineIngestionError('GUIDELINE_EXTERNAL_CONTENT');if(format==='xlsx'){cells+=(xml.match(/<c\b/g)??[]).length;rows+=(xml.match(/<row\b/g)??[]).length;if(cells>5000||rows>500||entry.name==='xl/sharedStrings.xml'&&xml.length>1024*1024)throw new GuidelineIngestionError('GUIDELINE_WORKBOOK_LIMIT')}}
 }else{const s=text(bytes);if(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(s))throw new GuidelineIngestionError('GUIDELINE_TEXT_INVALID');if(format==='json'&&bytes.length>256*1024)throw new GuidelineIngestionError('GUIDELINE_STRUCTURED_LIMIT')}
 return {name,size:bytes.length,format,bytes,sha256:sha(bytes)}
}
export async function parseGuidelineAttachments(files:FormDataEntryValue[]):Promise<GuidelineInput[]>{if(files.length>3)throw new GuidelineIngestionError('GUIDELINE_FILE_LIMIT_OR_FORMAT');const inputs:GuidelineInput[]=[];for(const f of files){if(typeof f==='string'||f.size<1||f.size>GUIDELINE_FILE_MAX)throw new GuidelineIngestionError('GUIDELINE_FILE_LIMIT_OR_FORMAT');const b=Buffer.from(await f.arrayBuffer());if(b.length!==f.size)throw new GuidelineIngestionError('GUIDELINE_SOURCE_CHANGED');inputs.push(inspectGuidelineInput(f.name,b))}return inputs}
const XML_ENTITIES:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}
const xmlText=(s:string)=>s.replace(/&(amp|lt|gt|quot|apos);/g,(_m,k:string)=>XML_ENTITIES[k]).replace(/&#(x[0-9a-f]+|\d+);/gi,(_m,n)=>{const v=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return v>=32&&v<=0x10ffff&&!(v>=0xd800&&v<=0xdfff)?String.fromCodePoint(v):'\uFFFD'})
/** Bounded local extraction. Callers retain the independent source security gate. No extracted text is approved. */
export async function extractGuidelineNative(input:GuidelineInput):Promise<GuidelineExtraction>{
 inspectGuidelineInput(input.name,input.bytes)
 const segments:GuidelineSourceSegment[]=[],warnings:string[]=[],ocrPages:number[]=[],ocrImages:string[]=[];let truncated=false,total=0
 const add=(location:string,content:string,table=false,ambiguous=false)=>{if(!content.trim())return;if(segments.length>=500||total>=200000){truncated=true;return}const t=content.slice(0,2000);if(t.length<content.length)truncated=true;total+=t.length;segments.push({id:sha(location+'\0'+t),location,text:t,method:'native',language:null,confidence:null,table,ambiguous})}
 if(input.format==='txt')text(input.bytes).replace(/^\uFEFF/,'').split(/\r?\n/).forEach((s,i)=>add(`line:${i+1}`,s))
 else if(input.format==='json'){
  let raw:any;try{raw=JSON.parse(text(input.bytes).replace(/^\uFEFF/,''))}catch{throw new GuidelineIngestionError('GUIDELINE_JSON_INVALID')}
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).sort().join()!=='rules'||!Array.isArray(raw.rules)||raw.rules.length>100||raw.rules.some((r:any)=>!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).some((k:string)=>!['id','text','key','operator','value','strength'].includes(k))||typeof r.text!=='string'||!r.text.trim()||r.text.length>2000||Object.values(r).some(v=>v!==null&&typeof v==='object')))throw new GuidelineIngestionError('GUIDELINE_JSON_SCHEMA')
  raw.rules.forEach((r:any,i:number)=>add(`/rules/${i}`,JSON.stringify(r)))
  warnings.push('Structured rules are unapproved candidates; validate interpretation, applicability and enforcement before publication.')
 }else if(input.format==='pdf'){
  try{const pdf=await readPdfPackage(input.bytes,{collectText:true});for(const page of pdf.text?.pages.slice(0,20)??[]){const content=page.runs.map(r=>r.text).join(' ');if(!content.trim())ocrPages.push(page.pageIndex+1);else add(`page:${page.pageIndex+1}`,content,false,page.undecodable>0)}if(pdf.totalPages>20||pdf.text?.truncated||pdf.report.limitations.length)truncated=true;if(!pdf.text?.pages.length)warnings.push('Native PDF text is unavailable; manual review or supported local OCR is required.')}catch{ return {status:'unsupported',segments:[],warnings:['PDF is encrypted, damaged or cannot be safely parsed. Supply an authorized unencrypted copy or enter rules manually.'],ocrPages:[],language:null,truncated:false}}
 }else if(input.format==='docx'){
  const entries=readZipDirectory(input.bytes),part=entries.find(e=>e.name==='word/document.xml');if(!part)throw new GuidelineIngestionError('GUIDELINE_DOCX_INVALID')
  const xml=text(readZipEntryBytes(input.bytes,part,4*1024*1024));if(/<w:(?:ins|del)\b/.test(xml))warnings.push('Tracked changes are present; a reviewer must resolve their interpretation.')
  const tree=new XMLParser({preserveOrder:true,ignoreAttributes:false,processEntities:false,trimValues:false}).parse(xml);let paragraph=0
  const content=(nodes:any[]):string=>nodes.map(n=>Object.entries(n).map(([k,v])=>k==='#text'?String(v):k==='w:tab'?'\t':k==='w:br'?'\n':Array.isArray(v)?content(v):'').join('')).join('')
  const walk=(nodes:any[],table=false)=>{for(const n of nodes)for(const [key,value] of Object.entries(n)){if(key==='w:p'&&Array.isArray(value))add(`word/document.xml/paragraph:${++paragraph}`,xmlText(content(value)),table,warnings.length>0);else if(Array.isArray(value))walk(value,table||key==='w:tbl')}}
  walk(tree);ocrImages.push(...entries.filter(e=>/^word\/media\/[^/]+\.(png|jpe?g)$/i.test(e.name)).map(e=>e.name).slice(0,5));if(ocrImages.length)warnings.push('Embedded images may contain instructions; image-only segments require review/OCR before approval.')
 }else{
  const workbook=new ExcelJS.Workbook();try{await workbook.xlsx.load(input.bytes as any)}catch{throw new GuidelineIngestionError('GUIDELINE_WORKBOOK_INVALID')}
  workbook.eachSheet(sheet=>sheet.eachRow((row)=>row.eachCell(cell=>{const v=cell.value;if(v&&typeof v==='object'&&('formula'in v||'sharedFormula'in v)){warnings.push(`Formula ${sheet.name}!${cell.address} is not evaluated; review its actual instruction.`);add(`${sheet.name}!${cell.address}`,'Formula cell: manual interpretation required.',true,true)}else add(`${sheet.name}!${cell.address}`,cell.text,true)})))
 }
 if(!segments.length)warnings.push('No usable native text was extracted. Manual validation is required.')
 if(truncated)warnings.push('Extraction reached a bounded limit. Remaining content requires manual review; it is not silently approved.')
 return {status:warnings.length||ocrPages.length||ocrImages.length?'review_required':'extracted',segments,warnings:[...new Set(warnings)].slice(0,100),ocrPages,ocrImages,language:null,truncated}
}
