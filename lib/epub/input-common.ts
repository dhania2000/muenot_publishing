import 'server-only'
import {createHash} from 'node:crypto'
import path from 'node:path'
import {XMLParser,XMLValidator,XMLBuilder} from 'fast-xml-parser'
import {readZipDirectory,readZipEntryBytes} from '@/lib/alt-text/document-validation'
import {inspectPackage,safePackagePath} from './package-inspection'
import {INPUT_MODEL_VERSION,type NormalizedInput,type InputReference,type InputNode,type InputNodeKind,type InputAsset} from './input-contract'
export const inputHash=(s:Buffer|string)=>createHash('sha256').update(s).digest('hex')
export class InputNormalizationError extends Error{constructor(readonly code:string,message:string){super(message)}}
export const failInput=(code:string,message:string):never=>{throw new InputNormalizationError(code,message)}
export function inputText(bytes:Buffer){try{const s=new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,'');if(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(s))throw Error();return s}catch{return failInput('ENCODING_UNSUPPORTED','Supply valid UTF-8 text without binary control characters.')}}
export function safeXml(text:string){
 if(text.length>4*1024*1024||/<!DOCTYPE|<!ENTITY/i.test(text)||XMLValidator.validate(text)!==true)failInput('XML_UNSAFE_OR_INVALID','Remove document declarations/entities and supply well-formed bounded XML.')
 let depth=0;for(const m of text.matchAll(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\/?[A-Za-z][^>]*>/g)){if(m[0].startsWith('<!'))continue;if(m[0].startsWith('</'))depth--;else if(!m[0].endsWith('/>'))depth++;if(depth>80)failInput('XML_DEPTH_LIMIT','Reduce excessive XML nesting.')}
 return new XMLParser({preserveOrder:true,ignoreAttributes:false,processEntities:false,trimValues:false,parseTagValue:false,parseAttributeValue:false}).parse(text) as any[]
}
export const xmlName=(n:any)=>Object.keys(n).find(k=>k!==':@'&&k!=='#text'&&!k.startsWith('?'))??''
export const localName=(n:any)=>xmlName(n).split(':').at(-1)??''
export const xmlChildren=(n:any):any[]=>Array.isArray(n[xmlName(n)])?n[xmlName(n)]:[]
export const xmlAttr=(n:any,key:string):string=>decodedXml(String(n[':@']?.['@_'+key]??Object.entries(n[':@']??{}).find(([k])=>k.split(':').at(-1)===key)?.[1]??''))
export const decodedXml=(s:string)=>s.replace(/&(amp|lt|gt|quot|apos|nbsp);/g,(_m,k)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:'\u00a0'} as Record<string,string>)[k]!).replace(/&#(x[\da-f]+|\d+);/gi,(_m,v)=>{const n=v[0].toLowerCase()==='x'?parseInt(v.slice(1),16):Number(v);return n>=32&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):'\uFFFD'})
export const xmlContent=(nodes:any[]):string=>nodes.map(n=>n['#text']!==undefined?decodedXml(String(n['#text'])):['br','tab','line-break','s'].includes(localName(n))?localName(n)==='tab'?'\t':'\n':xmlContent(xmlChildren(n))).join('')
export function descendants(nodes:any[],name:string):any[]{const found:any[]=[];for(const n of nodes){if(localName(n)===name)found.push(n);found.push(...descendants(xmlChildren(n),name))}return found}
export const xmlSerialized=(n:any)=>new XMLBuilder({preserveOrder:true,ignoreAttributes:false,processEntities:false}).build([n]) as string
export function localResource(part:string,target:string):string|null{try{target=decodeURIComponent(target);if(!target||target.startsWith('/')||/^[A-Za-z][\w+.-]*:|[\\\x00-\x1f?]/.test(target)||target.startsWith('//'))return null;const clean=target.split('#')[0],result=path.posix.normalize(path.posix.join(path.posix.dirname(part),clean));return safePackagePath(result)?result:null}catch{return null}}
export class InputPackage{
 readonly entries:ReturnType<typeof readZipDirectory>
 constructor(readonly bytes:Buffer,kind:'package'|'docx'|'epub'|'idml'='package'){inspectPackage(bytes,kind);this.entries=readZipDirectory(bytes)}
 bytesFor(part:string,cap=4*1024*1024){const e=this.entries.find(e=>e.name===part);return e?readZipEntryBytes(this.bytes,e,cap):null}
 xml(part:string){const body=this.bytesFor(part);return body?safeXml(inputText(body)):null}
 relationships(part:string){const file=path.posix.join(path.posix.dirname(part),'_rels',path.posix.basename(part)+'.rels'),out=new Map<string,{path:string|null;type:string;external:boolean}>();for(const rel of descendants(this.xml(file)??[],'Relationship'))out.set(xmlAttr(rel,'Id'),{path:xmlAttr(rel,'TargetMode')==='External'?null:localResource(part,xmlAttr(rel,'Target')),type:xmlAttr(rel,'Type'),external:xmlAttr(rel,'TargetMode')==='External'});return out}
}
export class InputBuilder{
 readonly result:NormalizedInput
 constructor(name:string,bytes:Buffer,adapter:string){this.result={modelVersion:INPUT_MODEL_VERSION,sourceName:name,sourceSha256:inputHash(bytes),adapter,status:'normalized',nodes:[],assets:[],findings:[],metadata:{},statistics:{nodes:0,characters:0,assets:0},releaseAuthorized:false}}
 ref(locator:string,extra:Partial<InputReference>={}):InputReference{return {locator,...extra}}
 node(kind:InputNodeKind,text:string,source:InputReference,attributes:InputNode['attributes']={},children:InputNode[]=[]):InputNode{
  const stats=this.result.statistics;stats.nodes++;stats.characters+=text.length;if(stats.nodes>20000||stats.characters>1000000||text.length>32000)failInput('CONTENT_LIMIT','Content exceeds bounded normalization limits; split the source and review separately.')
  return {id:'n_'+inputHash(this.result.sourceSha256+'\0'+source.locator+'\0'+stats.nodes).slice(0,24),kind,text,source,attributes,children}
 }
 finding(code:string,detail:string,source=this.ref('source'),blocking=false,owner='Production reviewer'){if(this.result.findings.length>=1000)failInput('FINDING_LIMIT','Too many unresolved input findings; repair the source first.');this.result.findings.push({code,severity:blocking?'error':'warning',detail,source,owner,blocking})}
 asset(resource:string,body:Buffer|null,mediaType:string,source:InputReference,properties:InputAsset['properties']={},blocked=false){const existing=this.result.assets.find(a=>a.path===resource);if(existing)return existing;const asset:InputAsset={id:'a_'+inputHash(this.result.sourceSha256+'\0'+resource).slice(0,24),path:resource,mediaType,size:body?.length??null,sha256:body?inputHash(body):null,availability:blocked?'blocked':body?'available':'missing',source,rights:'unverified',properties};this.result.assets.push(asset);if(this.result.assets.length>2000)failInput('ASSET_LIMIT','Too many input assets.');if(!body||blocked)this.finding(blocked?'RESOURCE_BLOCKED':'RESOURCE_MISSING',`Resource needs an authorized local replacement: ${resource.slice(0,240)}`,source,true);return asset}
 finish(){this.result.statistics.assets=this.result.assets.length;this.result.status=this.result.findings.some(f=>f.blocking)?'blocked':this.result.findings.length?'review_required':'normalized';if(Buffer.byteLength(JSON.stringify(this.result))>4*1024*1024)failInput('MODEL_LIMIT','Normalized evidence exceeds its storage budget.');return this.result}
}
