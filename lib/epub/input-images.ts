import 'server-only'
import {decodeInputTiff} from './input-tiff'
import {createCanvas,loadImage} from '@napi-rs/canvas'
import {readImageHeader} from '@/lib/alt-text/image-header'
import {InputBuilder,inputHash,inputText,safeXml,descendants,xmlAttr,localName,xmlChildren,xmlSerialized,failInput} from './input-common'
export function imageMediaType(name:string){return /\.png$/i.test(name)?'image/png':/\.jpe?g$/i.test(name)?'image/jpeg':/\.webp$/i.test(name)?'image/webp':/\.svg$/i.test(name)?'image/svg+xml':/\.tiff?$/i.test(name)?'image/tiff':'image/unknown'}
export function inspectSvg(bytes:Buffer){
 const text=inputText(bytes),root=safeXml(text);if(localName(root.find(n=>localName(n))??{})!=='svg')failInput('SVG_ROOT','Supply a valid SVG root.')
 const allowed=new Set(['svg','g','path','rect','circle','ellipse','line','polyline','polygon','text','tspan','defs','clipPath','linearGradient','radialGradient','stop','title','desc','use']),stack=[...root];let nodes=0
 while(stack.length){const n=stack.pop()!,name=localName(n);if(++nodes>10000)failInput('SVG_COMPLEXITY','Split overly complex vectors into bounded safe assets.');if(name&&!allowed.has(name))failInput('SVG_ACTIVE_OR_UNSUPPORTED',`SVG element ${name} requires a safe static export.`)
  for(const [key,value] of Object.entries(n[':@']??{})){const k=key.slice(2).split(':').at(-1)!,v=String(value);if(/^on/i.test(k)||/^(?:href|src)$/i.test(k)&&!/^#[A-Za-z_][\w:.-]*$/.test(v)||/javascript\s*:|expression\s*\(|@import|[\\]/i.test(v)||/url\(/i.test(v)&&!/^(?:[^;]*url\(\s*#[\w:.-]+\s*\)[^;]*;?)+$/.test(v))failInput('SVG_ACTIVE_OR_UNSUPPORTED','SVG external resources, event handlers and active/ambiguous styles are unsupported.')}
  stack.push(...xmlChildren(n))
 }
 const svg=root.find(n=>localName(n)==='svg')!,width=Number(xmlAttr(svg,'width').replace(/px$/,'')),height=Number(xmlAttr(svg,'height').replace(/px$/,'')),view=xmlAttr(svg,'viewBox').split(/[\s,]+/).map(Number),w=width||view[2],h=height||view[3]
 if(!Number.isFinite(w)||!Number.isFinite(h)||w<1||h<1||w*h>20000000||w>20000||h>20000)failInput('IMAGE_DIMENSION_LIMIT','SVG needs bounded explicit dimensions or viewBox, at most 20 megapixels.')
 return {svg:xmlSerialized(svg),width:w,height:h,title:descendants(root,'title').map(n=>xmlChildren(n).map(c=>c['#text']??'').join('')).join(''),description:descendants(root,'desc').map(n=>xmlChildren(n).map(c=>c['#text']??'').join('')).join('')}
}
export async function decodeInputRaster(bytes:Buffer,mime:string){
 const info=readImageHeader(bytes,mime);if(!info||info.width*info.height>20000000)return failInput('IMAGE_DIMENSION_OR_FORMAT','Supply a valid JPEG, PNG or WebP within 20 megapixels; export unsupported raster codecs to PNG.')
 let image:Awaited<ReturnType<typeof loadImage>>;try{image=await loadImage(bytes)}catch{return failInput('IMAGE_DECODE_FAILED','The image could not be decoded; supply a valid static export.')}
 if(image.width*image.height>20000000||image.width<1||image.height<1)failInput('IMAGE_DIMENSION_LIMIT','Decoded pixels exceed the image budget.')
 // Canvas loadImage applies EXIF orientation. Verify its oriented dimensions before independent encoding.
 const swapped=[5,6,7,8].includes(info.orientation),expectedWidth=swapped?info.height:info.width,expectedHeight=swapped?info.width:info.height
 if(image.width!==expectedWidth||image.height!==expectedHeight)failInput('IMAGE_ORIENTATION_REVIEW','Decoder dimensions do not match the inspected orientation; supply a reviewed PNG export.')
 const surface=createCanvas(image.width,image.height);surface.getContext('2d').drawImage(image,0,0);const png=await surface.encode('png');if(png.length>25*1024*1024)failInput('IMAGE_ENCODE_LIMIT','The normalized raster exceeds the asset budget.')
 return {png,width:image.width,height:image.height,originalOrientation:info.orientation,orientationUnknown:info.orientationUnknown,normalizedSha256:inputHash(png)}
}
export async function normalizeImage(bytes:Buffer,b:InputBuilder){
 const mime=imageMediaType(b.result.sourceName),ref=b.ref('image')
 if(mime==='image/svg+xml'){const svg=inspectSvg(bytes),asset=b.asset(b.result.sourceName,bytes,mime,ref,{width:svg.width,height:svg.height,sanitizedSha256:inputHash(svg.svg)});b.result.nodes.push(b.node('image','',ref,{assetId:asset.id,alt:svg.description||svg.title}));b.finding('SVG_RENDER_REVIEW','Safe static SVG subset is retained; verify text/font fidelity and alternatives in the target reader.',ref);return}
 if(mime==='image/tiff'){const pages=await decodeInputTiff(bytes);for(const page of pages){const source=b.ref('image/page:'+page.sourcePage,{page:page.sourcePage}),asset=b.asset(b.result.sourceName+'#page='+page.sourcePage,bytes,mime,source,{width:page.width,height:page.height,orientation:page.orientation,sourceDirectory:page.sourceDirectory,sourcePage:page.sourcePage,normalizedPngSha256:page.normalizedSha256,iccPresent:page.iccPresent});b.result.nodes.push(b.node('image','',source,{assetId:asset.id,ocrStatus:'not_requested',altStatus:'not_reviewed'}))}b.result.metadata.pages=pages.length;b.finding('TIFF_PAGE_REVIEW','Classic strip TIFF subset is decoded with page order and orientation. Verify source resolution, any ICC/color fidelity, text/OCR, rights and contextual alternatives.',ref);return}
 const raster=await decodeInputRaster(bytes,mime),asset=b.asset(b.result.sourceName,bytes,mime,ref,{width:raster.width,height:raster.height,originalOrientation:raster.originalOrientation,orientationUnknown:raster.orientationUnknown,normalizedPngSha256:raster.normalizedSha256})
 b.result.nodes.push(b.node('image','',ref,{assetId:asset.id,ocrStatus:'not_requested',altStatus:'not_reviewed'}));b.finding('IMAGE_TEXT_AND_ALT_REVIEW','Image import is separate from OCR and contextual alt text. Verify rights, any text and the chosen output layout.',ref)
}
