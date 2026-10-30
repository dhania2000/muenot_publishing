import 'server-only'
import path from 'node:path'
import {InputPackage,InputBuilder,failInput,xmlName,localName,xmlChildren,xmlAttr,xmlContent,descendants,xmlSerialized} from './input-common'
import type {InputOptions,InputNode} from './input-contract'
const mediaType=(p:string)=>/\.png$/i.test(p)?'image/png':/\.jpe?g$/i.test(p)?'image/jpeg':/\.svg$/i.test(p)?'image/svg+xml':/\.(woff2?|ttf|otf)$/i.test(p)?'font/unknown':'application/octet-stream'
export function normalizeDocx(bytes:Buffer,b:InputBuilder,options:InputOptions){
 const pack=new InputPackage(bytes,'docx'),main=pack.xml('word/document.xml');if(!main)failInput('DOCX_DOCUMENT_MISSING','Supply a DOCX containing word/document.xml.')
 const styles=new Map<string,string>();for(const style of descendants(pack.xml('word/styles.xml')??[],'style'))styles.set(xmlAttr(style,'styleId'),xmlAttr(descendants(xmlChildren(style),'name')[0]??{},'val'))
 const relationships=pack.relationships('word/document.xml');let ordinal=0
 function walk(nodes:any[],part='word/document.xml'):InputNode[]{const result:InputNode[]=[];for(const n of nodes){const tag=localName(n),ref=b.ref(`${part}/${tag}:${++ordinal}`,{part}),children=xmlChildren(n)
  if(tag==='del'){b.finding('TRACKED_DELETION_EXCLUDED','Deleted revision text is excluded; reconcile the authorized final manuscript.',ref);continue}
  if(tag==='commentRangeStart'||tag==='commentReference'){b.finding('COMMENTS_POLICY','Comments are excluded from publication unless explicitly selected for reviewer material.',ref);continue}
  if(tag==='p'){
   const properties=children.find(c=>localName(c)==='pPr'),styleId=xmlAttr(descendants(properties?[properties]:[],'pStyle')[0]??{},'val'),style=styles.get(styleId)??styleId,heading=/heading\s*([1-6])/i.exec(style),numbering=descendants(properties?[properties]:[],'numPr')[0]
   const content=walk(children.filter(c=>localName(c)!=='pPr'),part),text=content.map(c=>c.text).join(''),nested=content
   if(text.trim()||nested.length)result.push(b.node(heading?'heading':numbering?'list_item':'paragraph',text,ref,{styleId,style,level:heading?Number(heading[1]):null,numId:numbering?xmlAttr(descendants([numbering],'numId')[0]??{},'val'):null,listLevel:numbering?xmlAttr(descendants([numbering],'ilvl')[0]??{},'val'):null},nested));continue
  }
  if(tag==='r'){const properties=children.find(c=>localName(c)==='rPr'),nested=walk(children.filter(c=>localName(c)!=='rPr'),part),props=properties?[properties]:[];result.push(b.node('text',nested.map(c=>c.text).join(''),ref,{bold:descendants(props,'b').some(c=>xmlAttr(c,'val')!=='0'&&xmlAttr(c,'val')!=='false'),italic:descendants(props,'i').some(c=>xmlAttr(c,'val')!=='0'&&xmlAttr(c,'val')!=='false'),fontFamily:xmlAttr(descendants(props,'rFonts')[0]??{},'ascii')||null,fontSizeHalfPoints:xmlAttr(descendants(props,'sz')[0]??{},'val')||null,language:xmlAttr(descendants(props,'lang')[0]??{},'val')||null},nested));continue}
  if(['hyperlink','ins','sdt','sdtContent','smartTag','fldSimple'].includes(tag)){if(tag==='ins')b.finding('TRACKED_INSERTION_INCLUDED','Inserted revision text is retained and needs editorial reconciliation.',ref);const nested=walk(children,part);if(tag==='hyperlink'){const rel=relationships.get(xmlAttr(n,'r:id'));result.push(b.node('link',nested.map(c=>c.text).join(''),ref,{target:rel?.path??xmlAttr(n,'anchor')??'',external:!!rel?.external},nested));if(rel?.external)b.finding('EXTERNAL_HYPERLINK_REVIEW','External hyperlink target is not fetched or trusted; revalidate during link QA.',ref)}else result.push(...nested);continue}
  if(tag==='t'){result.push(b.node('text',xmlContent(children),ref));continue}
  if(tag==='tab'||tag==='br'){result.push(b.node('text',tag==='tab'?'\t':'\n',ref));continue}
  if(['oMath','oMathPara'].includes(tag)){result.push(b.node('math',xmlContent(children),ref,{notation:'OMML',sourceXml:xmlSerialized(n)}));b.finding('MATH_CONVERSION_REQUIRED','OMML is retained with source XML; accessible MathML conversion needs expert verification.',ref);continue}
  if(tag==='tbl'){result.push(b.node('table','',ref,{},walk(children,part)));b.finding('TABLE_HEADER_REVIEW','Verify table headers, spans and reading order against the source.',ref);continue}
  if(tag==='tr'){result.push(b.node('row','',ref,{},walk(children,part)));continue}
  if(tag==='tc'){const span=descendants(children,'gridSpan')[0],merge=descendants(children,'vMerge')[0];result.push(b.node('cell','',ref,{colspan:span?xmlAttr(span,'val'):'1',verticalMerge:merge?xmlAttr(merge,'val')||'continue':null},walk(children.filter(c=>localName(c)!=='tcPr'),part)));continue}
  if(tag==='drawing'||tag==='pict'){
   const relId=xmlAttr(descendants(children,'blip')[0]??{},'r:embed')||xmlAttr(descendants(children,'imagedata')[0]??{},'r:id'),rel=relationships.get(relId),target=rel?.path??`unresolved:${relId||ordinal}`,body=rel?.path?pack.bytesFor(rel.path,16*1024*1024):null,asset=b.asset(target,body,mediaType(target),ref,{},!!rel?.external),descr=descendants(children,'docPr')[0]
   result.push(b.node('image','',ref,{assetId:asset.id,alt:xmlAttr(descr??{},'descr'),name:xmlAttr(descr??{},'name')}));b.finding('IMAGE_ALT_REVIEW','Retain author alternatives but verify contextual accuracy and rights.',ref);continue
  }
  if(tag==='footnoteReference'||tag==='endnoteReference'){result.push(b.node('link','',ref,{noteId:xmlAttr(n,'id'),noteKind:tag}));continue}
  if(tag==='object'||tag==='altChunk'){b.finding('EMBEDDED_OBJECT_UNSUPPORTED','Export the embedded object to accessible text/images; it is not executed.',ref,true);continue}
  if(!['pPr','rPr','tblPr','trPr','tcPr','sectPr','tblGrid'].includes(tag))result.push(...walk(children,part))
 }return result}
 b.result.nodes=walk(main!)
 for(const name of ['footnotes','endnotes'])for(const note of descendants(pack.xml(`word/${name}.xml`)??[],name==='footnotes'?'footnote':'endnote')){const id=xmlAttr(note,'id');if(Number(id)<0)continue;b.result.nodes.push(b.node('note','',b.ref(`word/${name}.xml#${id}`,{part:`word/${name}.xml`}),{noteId:id,noteKind:name},walk(xmlChildren(note),`word/${name}.xml`)))}
 if(pack.entries.some(e=>e.name==='word/comments.xml')){if(options.comments==='review')for(const comment of descendants(pack.xml('word/comments.xml')??[],'comment'))b.result.nodes.push(b.node('note',xmlContent(xmlChildren(comment)),b.ref('word/comments.xml#'+xmlAttr(comment,'id')),{editorialOnly:true,commentId:xmlAttr(comment,'id')}));b.finding('COMMENTS_NOT_PUBLICATION','Document comments are '+(options.comments==='review'?'retained only as reviewer material.':'excluded under the selected policy.'))}
 if(descendants(pack.xml('word/numbering.xml')??[],'abstractNum').length)b.finding('NUMBERING_DEFINITIONS_RETAINED','List IDs and levels are retained; reconcile bullets/restarts against numbering definitions.')
 for(const e of pack.entries.filter(e=>/\.(?:ttf|otf|woff2?|odttf)$/i.test(e.name))){b.asset(e.name,pack.bytesFor(e.name,16*1024*1024),'font/unknown',b.ref(e.name));b.finding('FONT_LICENCE_UNVERIFIED','Embedded font rights and any obfuscation require documented review.',b.ref(e.name))}
 if(!b.result.nodes.length)failInput('NO_DOCUMENT_CONTENT','No supported Word content was found.')
}
export function normalizeOdt(bytes:Buffer,b:InputBuilder,options:InputOptions){
 const pack=new InputPackage(bytes),mime=pack.bytesFor('mimetype')?.toString();if(mime!=='application/vnd.oasis.opendocument.text')failInput('ODT_SIGNATURE','Supply a valid unencrypted ODT text package.')
 const manifest=pack.bytesFor('META-INF/manifest.xml')?.toString()??'';if(/encryption-data/.test(manifest))failInput('ENCRYPTED_INPUT','Supply an authorized unencrypted export; protected content is not bypassed.')
 const root=pack.xml('content.xml');if(!root)failInput('ODT_CONTENT_MISSING','The ODT content part is missing.');let i=0
 const special=new Set(['annotation','note','math','image']),inline=(nodes:any[]):string=>nodes.map(n=>special.has(localName(n))?'':n['#text']!==undefined?xmlContent([n]):inline(xmlChildren(n))).join(''),embedded=(nodes:any[]):any[]=>nodes.flatMap(n=>special.has(localName(n))?[n]:embedded(xmlChildren(n)))
 const walk=(nodes:any[]):InputNode[]=>nodes.flatMap(n=>{const tag=localName(n),children=xmlChildren(n),ref=b.ref(`content.xml/${tag}:${++i}`,{part:'content.xml'});if(tag==='annotation'){b.finding('COMMENTS_NOT_PUBLICATION','ODT annotations follow the reviewer-comments policy.',ref);return options.comments==='review'?[b.node('note',xmlContent(children),ref,{editorialOnly:true})]:[]}
  if(['p','h'].includes(tag))return [b.node(tag==='h'?'heading':'paragraph',inline(children),ref,{level:tag==='h'?Number(xmlAttr(n,'outline-level'))||1:null,style:xmlAttr(n,'style-name')},walk(embedded(children)))];if(['table','table-row','table-cell','list','list-item','note'].includes(tag))return [b.node(({table:'table','table-row':'row','table-cell':'cell',list:'list','list-item':'list_item',note:'note'} as const)[tag as 'table'], '',ref,{colspan:xmlAttr(n,'number-columns-spanned')||'1',rowspan:xmlAttr(n,'number-rows-spanned')||'1',repeated:xmlAttr(n,'number-columns-repeated')||'1',noteId:tag==='note'?xmlAttr(n,'id'):null},walk(children))]
  if(tag==='image'){const target=xmlAttr(n,'href'),body=pack.bytesFor(target,16*1024*1024),asset=b.asset(target,body,mediaType(target),ref);return [b.node('image','',ref,{assetId:asset.id})]}
  if(tag==='math')return [b.node('math',xmlContent(children),ref,{notation:'MathML',sourceXml:xmlSerialized(n)})]
  return walk(children)})
 b.result.nodes=walk(root!);b.finding('ODT_STYLE_FIDELITY_REVIEW','ODT style names/spans are retained; pagination and complex fields need source comparison.')
}
export function unsupportedOffice(name:string,b:InputBuilder){const ext=path.extname(name).slice(1).toUpperCase();b.finding('OFFICE_ADAPTER_UNAVAILABLE',`${ext} is not decoded by an installed licensed adapter. Export an authorized DOCX or ODT with fonts, media and equations; review conversion loss.`,b.ref('source'),true)}
