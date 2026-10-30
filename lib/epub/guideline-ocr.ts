import 'server-only'
import {createHash} from 'node:crypto'
import {recognizeImage,OCR_ENGINE_VERSION} from '@/lib/alt-text/ocr-engine'
import {mapEngineLayout,meanWordConfidence,isOcrLanguageMode,type OcrLanguageMode} from '@/lib/alt-text/ocr-contract'
import {openPdfForRender} from '@/lib/alt-text/pdf-page-renderer'
import {readZipDirectory,readZipEntryBytes} from '@/lib/alt-text/document-validation'
import {readImageHeader} from '@/lib/alt-text/image-header'
import type {GuidelineInput} from './guideline-ingestion'
import type {GuidelineExtraction} from './guidelines-contract'
/** Shared, local-only OCR; callers must have a current trusted security verdict and source checksum. */
export async function extractGuidelineOcr(input:GuidelineInput,native:GuidelineExtraction,languageMode:OcrLanguageMode,security:{scanStatus:string;checksum:string},signal:AbortSignal):Promise<GuidelineExtraction>{
 if(security.scanStatus!=='clean'||security.checksum!==input.sha256||createHash('sha256').update(input.bytes).digest('hex')!==input.sha256)throw Error('GUIDELINE_SECURITY_PENDING')
 if(!isOcrLanguageMode(languageMode))throw Error('GUIDELINE_OCR_LANGUAGE_UNSUPPORTED')
 const result=structuredClone(native);if(!native.ocrPages.length&&!native.ocrImages?.length)return result
 const check=()=>{if(signal.aborted)throw Error('GUIDELINE_OCR_CANCELLED')}
 const recognize=async(bytes:Uint8Array,location:string,mediaType:string)=>{
  check();const header=readImageHeader(bytes,mediaType);if(!header||header.width*header.height>10000000||bytes.length>10*1024*1024)throw Error('GUIDELINE_OCR_IMAGE_LIMIT')
  const recognized=await recognizeImage({bytes,languageMode,timeoutMs:30000,segmentation:'auto'});check()
  const layout=mapEngineLayout(recognized.blocks,true),confidence=meanWordConfidence(layout),body=recognized.text.slice(0,2000).toWellFormed()
  if(body.trim())result.segments.push({id:createHash('sha256').update(location+'\0'+body).digest('hex'),location,text:body,method:'ocr',language:languageMode==='eng'?'en':languageMode==='hin'?'hi':null,confidence:confidence.mean===null?null:confidence.mean/100,table:false,ambiguous:confidence.mean===null||confidence.mean<85||layout.possibleColumns===true||layout.truncated})
  if(recognized.text.length>2000||result.segments.length>500){result.truncated=true;result.segments=result.segments.slice(0,500)}
  if(confidence.mean===null||confidence.mean<85||layout.possibleColumns||layout.truncated)result.warnings.push(`${location}: low-confidence or column/table structure requires human validation.`)
 }
 if(input.format==='pdf'){
  check();const pdf=await openPdfForRender(new Uint8Array(input.bytes));try{for(const page of native.ocrPages.slice(0,5)){if(page<1||page>pdf.numPages)throw Error('GUIDELINE_OCR_LOCATION_INVALID');check();const rendered=await pdf.renderPage(page,{targetDpi:120,timeoutMs:20000});await recognize(rendered.png,`page:${page}/ocr`,'image/png')}}finally{await pdf.destroy()}
  if(native.ocrPages.length>5){result.truncated=true;result.warnings.push('Only five scanned pages are processed per bounded OCR request. Remaining pages require manual validation.')}
 }else if(input.format==='docx'||input.format==='xlsx'){
  const entries=readZipDirectory(input.bytes);for(const part of native.ocrImages?.slice(0,5)??[]){check();const entry=entries.find(e=>e.name===part);if(!entry||!/\.(png|jpe?g)$/i.test(part))throw Error('GUIDELINE_OCR_LOCATION_INVALID');await recognize(readZipEntryBytes(input.bytes,entry,10*1024*1024),`${part}/ocr`,/\.png$/i.test(part)?'image/png':'image/jpeg')}
 }
 result.status='review_required';result.language=languageMode==='eng'?'en':languageMode==='hin'?'hi':null
 result.warnings=[...new Set([...result.warnings,`Local ${OCR_ENGINE_VERSION} recognition (${languageMode}) is unapproved; verify every interpreted instruction against its source.`])].slice(0,100)
 return result
}
