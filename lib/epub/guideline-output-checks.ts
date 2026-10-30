import 'server-only'
import {createHash} from 'node:crypto'
import {XMLParser} from 'fast-xml-parser'
import {inspectPackage} from './package-inspection'
import {readZipDirectory,readZipEntryBytes,resolvePartTarget} from '@/lib/alt-text/document-validation'
import {readImageHeader} from '@/lib/alt-text/image-header'
import {guidelineChecklist,type EpubGuidelineRule,type GuidelineCheck} from './guidelines-contract'
import type {EpubDraft} from './intake-plan'
export const GUIDELINE_CHECKER_VERSION='muenot-epub-guideline-checks@1'
const list=(v:any):any[]=>v===undefined?[]:Array.isArray(v)?v:[v]
const scalar=(v:any):string=>typeof v==='string'||typeof v==='number'?String(v):v&&typeof v==='object'?String(v['#text']??''):''
/** Actual bounded archive checks. This is not EPUBCheck, a rendering engine or a conformance certificate. */
export function checkGuidelineOutput(bytes:Buffer,plan:EpubDraft,rules:EpubGuidelineRule[]){
 const outputSha256=createHash('sha256').update(bytes).digest('hex'),checks=guidelineChecklist(plan,rules),securityFailures:string[]=[]
 const finish=()=>({tool:GUIDELINE_CHECKER_VERSION,outputSha256,checks,securityFailures,releaseBlocked:securityFailures.length>0||checks.some(c=>c.strength==='MUST'&&c.applicable&&!['passed','not_applicable'].includes(c.result))})
 if(bytes.length>25*1024*1024){securityFailures.push('Output exceeds the bounded inspection limit.');for(const c of checks.filter(c=>c.applicable)){c.result='unable_to_test';c.verificationStatus='review-required'}return finish()}
 try{
  const manifest=inspectPackage(bytes,'epub'),entries=readZipDirectory(bytes),byName=new Map(entries.map(e=>[e.name.toLowerCase(),e]))
  const read=(path:string)=>{const e=byName.get(path.toLowerCase());if(!e)throw Error('Missing output part');return readZipEntryBytes(bytes,e,4*1024*1024)}
  const xml=new XMLParser({ignoreAttributes:false,removeNSPrefix:true,processEntities:true}),pkg=xml.parse(read(manifest.rootfile!).toString('utf8')).package,metadata=pkg?.metadata??{},root=manifest.rootfile!.split('/').slice(0,-1).join('/'),items=list(pkg?.manifest?.item),spine=list(pkg?.spine?.itemref)
  const docs:{path:string;body:string}[]=[],imageParts:{path:string;type:string}[]=[]
  for(const item of items){const path=resolvePartTarget(root,String(item['@_href']??''));if(!path||!byName.has(path))throw Error('Invalid manifest resource');if(String(item['@_media-type']).startsWith('image/'))imageParts.push({path,type:String(item['@_media-type'])})}
  for(const ref of spine){const item=items.find(i=>i['@_id']===ref['@_idref']);if(!item)throw Error('Invalid spine resource');if(item['@_media-type']==='application/xhtml+xml'){const path=resolvePartTarget(root,String(item['@_href']));if(!path)throw Error('Invalid spine resource');docs.push({path,body:read(path).toString('utf8')})}}
  if(!docs.length)throw Error('No readable spine document')
  let headingBad=false,headingCount=0,inlineSvg=0;const images:any[]=[],inlineCss:string[]=[]
  for(const doc of docs){let previous=0;const tree=new XMLParser({preserveOrder:true,ignoreAttributes:false,processEntities:true,removeNSPrefix:true}).parse(doc.body)
   const walk=(nodes:any[])=>{for(const node of nodes){const attrs=node[':@']??{};if(typeof attrs['@_style']==='string')inlineCss.push(attrs['@_style']);for(const [tag,value]of Object.entries(node)){if(/^h[1-6]$/.test(tag)){headingCount++;const level=Number(tag[1]);if(previous&&level>previous+1)headingBad=true;previous=level}if(tag==='img')images.push(attrs);if(tag==='svg')inlineSvg++;if(tag==='style'&&Array.isArray(value))inlineCss.push(value.map(n=>n['#text']??'').join(''));if(Array.isArray(value))walk(value)}}};walk(tree)
  }
  const css=entries.filter(e=>e.name.toLowerCase().endsWith('.css')).map(e=>({path:e.name,body:read(e.name).toString('utf8')})),cssBodies=[...css,...inlineCss.map(body=>({path:manifest.rootfile!,body}))]
  let cssSafe=true,cssUnknown=false
  for(const sheet of cssBodies){const body=sheet.body.replace(/\/\*[\s\S]*?\*\//g,'');if(body.includes('\\')||body.includes('/*'))cssUnknown=true;if(/@import\b|expression\s*\(|-moz-binding|behavior\s*:/i.test(body))cssSafe=false;const urls=[...body.matchAll(/url\(\s*(['"]?)([^)]*?)\1\s*\)/gi)];if((body.match(/url\s*\(/gi)??[]).length!==urls.length)cssUnknown=true;for(const u of urls){const target=resolvePartTarget(sheet.path.split('/').slice(0,-1).join('/'),u[2].trim());if(!target||!byName.has(target)||/^[a-z][a-z0-9+.-]*:|^\/\//i.test(u[2].trim()))cssSafe=false}}
  const property=(name:string)=>list(metadata.meta).filter(m=>m?.['@_property']===name).map(scalar)
  const set=(c:GuidelineCheck,result:GuidelineCheck['result'],detail:string)=>{c.result=result;c.verificationStatus=result==='passed'?'passed':result==='failed'?'failed':'review-required';c.evidence={outputSha256,tool:GUIDELINE_CHECKER_VERSION,method:c.method,detail}}
  for(const c of checks){if(!c.applicable)continue;const r=rules.find(r=>r.id===c.ruleId)!
   if(c.method==='manual'||r.operator==='manual'){set(c,'unable_to_test','A qualified reviewer must record manual evidence against this exact output.');continue}
   if(r.key.startsWith('metadata.')){const key=r.key.split('.')[1],actual=list(metadata[key==='isbn'?'identifier':key]).map(scalar),expected=String(r.value??'');if(!['equals','required','forbidden'].includes(r.operator)){set(c,'unable_to_test','This metadata comparison operator requires review.');continue}const pass=r.operator==='required'?actual.some(Boolean):r.operator==='forbidden'?!actual.includes(expected):actual.includes(expected);set(c,pass?'passed':'failed',`Package ${key} ${pass?'matches':'does not match'} the requested test.`)}
   else if(r.key==='layout.version'){const declared=String(pkg?.['@_version']??'');set(c,r.value==='2.0.1-legacy'&&declared!=='2.0'||r.value!=='2.0.1-legacy'&&declared!=='3.0'?'failed':'unable_to_test','Package version alone cannot verify an exact EPUB specification revision; use a compatible pinned validator.')}
   else if(r.key==='layout.mode'){const declared=property('rendition:layout'),expected=r.value==='fixed'?'pre-paginated':r.value==='reflowable'?'reflowable':null;set(c,!expected||!declared.length?'unable_to_test':declared.every(v=>v===expected)?'passed':'failed','Explicit rendition layout metadata was inspected; target-reader rendering remains separate.')}
   else if(r.key==='structure.headings')set(c,!(r.operator==='required'&&r.value===null||r.operator==='equals'&&r.value==='ordered')||!headingCount?'unable_to_test':headingBad?'failed':'passed','Checked heading jumps within each actual spine XHTML document. Heading meaning and cross-chapter hierarchy require human review.')
   else if(r.key==='css.safety')set(c,!(r.operator==='required'&&r.value===null||r.operator==='equals'&&r.value===true)?'unable_to_test':!cssSafe?'failed':cssUnknown?'unable_to_test':'passed','Inspected packaged and inline CSS for external resources, imports, escapes and executable expressions; this is a bounded safety test.')
   else if(r.key==='images.alt'){const svg=inlineSvg>0||imageParts.some(p=>p.type==='image/svg+xml');set(c,!(r.operator==='required'&&r.value===null||r.operator==='equals'&&r.value==='present')||svg||imageParts.length&&!images.length?'unable_to_test':images.some(i=>typeof i['@_alt']!=='string')?'failed':'passed','Checked HTML image alt attributes only. Decorative classification, wording and SVG alternatives require review.')}
   else if(r.key==='images.maxWidth'){const dimensions=imageParts.map(i=>readImageHeader(read(i.path),i.type));if(dimensions.some(d=>!d)||typeof r.value!=='number'||!['max','equals','min'].includes(r.operator))set(c,'unable_to_test','Image format or dimension comparison is unsupported.');else{const pass=dimensions.every(d=>r.operator==='max'?d!.width<=Number(r.value):r.operator==='min'?d!.width>=Number(r.value):d!.width===r.value);set(c,pass?'passed':'failed','Checked intrinsic width of every packaged image using its actual file header.')}}
   else if(r.key==='a11y.metadata'){if(r.operator!=='required'||typeof r.value!=='string'||!/^schema:[A-Za-z][A-Za-z0-9]{1,60}$/.test(r.value))set(c,'unable_to_test','Choose a supported schema accessibility metadata property and required operator.');else set(c,property(r.value).some(Boolean)?'passed':'failed','Checked property presence only; declarations do not establish accessibility conformance.')}
   else set(c,'unable_to_test','No installed automated validator implements this exact requirement.')
  }
 }catch{securityFailures.push('The output archive is invalid, unsafe or outside the supported inspection profile.');for(const c of checks.filter(c=>c.applicable)){c.result='unable_to_test';c.verificationStatus='review-required'}}
 return finish()
}
