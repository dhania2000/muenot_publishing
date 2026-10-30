import 'server-only'
import {InputBuilder,InputPackage,failInput,descendants,xmlAttr,xmlChildren,xmlContent,localResource,inputText} from './input-common'
import {markupNodes,checkCss} from './input-markup'
import {inspectPackage} from './package-inspection'
import type {InputOptions} from './input-contract'
import {rewriteZipEntries} from '@/lib/alt-text/ooxml-zip-rewrite'
export function normalizeExistingEpub(bytes:Buffer,b:InputBuilder,options:InputOptions){
 const manifest=inspectPackage(bytes,'epub'),pack=new InputPackage(bytes,'epub'),root=manifest.rootfile!,opf=pack.xml(root)!,items=new Map<string,{id:string;path:string|null;type:string;properties:string}>()
 if(pack.entries.some(e=>/^META-INF\/(?:encryption|rights)\.xml$/i.test(e.name)))failInput('PROTECTED_EPUB','Encryption/rights metadata requires an authorized unprotected source; DRM and font protection are not bypassed.')
 for(const item of descendants(opf,'item')){const id=xmlAttr(item,'id'),target=localResource(root,xmlAttr(item,'href'));if(!id||items.has(id))failInput('EPUB_DUPLICATE_ID','Repair duplicate or missing manifest IDs.');items.set(id,{id,path:target,type:xmlAttr(item,'media-type'),properties:xmlAttr(item,'properties')});const body=target?pack.bytesFor(target,16*1024*1024):null;b.asset(target??xmlAttr(item,'href'),body,xmlAttr(item,'media-type'),b.ref(root+'#'+id),{manifestId:id,properties:xmlAttr(item,'properties')},!target);if(body&&xmlAttr(item,'media-type')==='text/css')checkCss(inputText(body),b,b.ref(target!),target!,pack)}
 const seen=new Set<string>();for(const [i,spine] of descendants(opf,'itemref').entries()){const id=xmlAttr(spine,'idref'),item=items.get(id);if(!item||!item.path){b.finding('EPUB_SPINE_REFERENCE','Spine references an unavailable manifest resource.',b.ref(root+'#spine:'+i),true);continue}if(seen.has(id)){b.finding('EPUB_SPINE_DUPLICATE','Spine repeats a content item; confirm intended order.',b.ref(root+'#'+id));continue}seen.add(id);const body=pack.bytesFor(item.path);if(!body)continue
  if(item.type!=='application/xhtml+xml'&&item.type!=='text/html'){b.finding('EPUB_SPINE_TYPE','Unsupported spine media type needs an authorized XHTML alternative.',b.ref(item.path),true);continue}
  b.result.nodes.push(b.node('section','',b.ref(item.path,{part:item.path}),{manifestId:id,spineIndex:i,linear:xmlAttr(spine,'linear')!=='no'},markupNodes(inputText(body),b,options,item.path,'html',pack)))
 }
 if(!seen.size)failInput('EPUB_SPINE_MISSING','The source has no usable spine; repair the package.')
 const nav=[...items.values()].find(item=>item.properties.split(/\s+/).includes('nav'));b.result.metadata.navigationPart=nav?.path??null
 for(const ncx of [...items.values()].filter(item=>item.type==='application/x-dtbncx+xml'&&item.path)){const ncxRoot=pack.xml(ncx.path!)!;b.result.metadata.legacyNcx=ncx.path;for(const content of descendants(ncxRoot,'content')){const target=localResource(ncx.path!,xmlAttr(content,'src'));if(!target||!pack.bytesFor(target))b.finding('NCX_TARGET_MISSING','Legacy NCX points to an unavailable resource.',b.ref(ncx.path!),true)}}
 b.result.metadata.sourcePackageVersion=manifest.classification;b.result.metadata.packagePart=root
 // Ingestion round-trip only: reuse the shared lossless ZIP writer, with no content replacement.
 const preserved=rewriteZipEntries(bytes,new Map()),roundtrip=inspectPackage(preserved,'epub')
 if(JSON.stringify(roundtrip.entries)!==JSON.stringify(manifest.entries)||roundtrip.rootfile!==manifest.rootfile)failInput('EPUB_RESOURCE_ROUNDTRIP_CHANGED','Package resource identities changed during lossless source preservation.')
 b.result.metadata.sourcePackageRoundtrip='verified_resource_preservation_only; not_conversion_or_conformance'
 for(const key of ['title','language','identifier','publisher']){const value=descendants(opf,key)[0];if(value)b.result.metadata[key]=xmlContent(xmlChildren(value)).slice(0,1000)}
 b.finding('EPUB_ROUNDTRIP_REVIEW','Manifest, spine order, navigation and resource hashes are retained. Rebuild/round-trip validation, reader tests and exact EPUB specification revision remain later output gates.')
}
