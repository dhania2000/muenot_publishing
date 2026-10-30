import 'server-only'
import {decodeInputTiff} from './input-tiff'
import {inspectInputSchema,validateInputSchema} from './input-schema'
import {InputBuilder,InputPackage,inputHash,inputText,InputNormalizationError,failInput} from './input-common'
import {parseInputOptions,type InputOptions,type NormalizedInput} from './input-contract'
import {inspectEpubSource} from './source-inspection'
import {normalizeDocx,normalizeOdt,unsupportedOffice} from './input-office'
import {normalizeHtml,normalizeXml,normalizePlain,normalizeLatex,checkCss} from './input-markup'
import {normalizePdf,normalizePptx,normalizeIdml} from './input-layout'
import {normalizeXlsx,normalizeCsv} from './input-tables'
import {normalizeImage,inspectSvg,imageMediaType,decodeInputRaster} from './input-images'
import {normalizeMedia,normalizeTiming} from './input-media'
import {normalizeExistingEpub} from './input-epub'
export type NormalizationSource={name:string;bytes:Buffer;sha256:string;scanStatus:string;checksum:string}
/** All adapters are local, bounded and nonexecuting. A source scan is independent of parsing. */
export async function normalizeEpubInput(source:NormalizationSource,rawOptions:unknown,signal:AbortSignal,resources:Map<string,NormalizationSource>=new Map()):Promise<NormalizedInput>{
 const options=parseInputOptions(rawOptions);if(!options)failInput('INVALID_INPUT_OPTIONS','Choose supported bounded source-import options.');if(signal.aborted)failInput('CANCELLED','Source inspection was cancelled.');if(source.scanStatus!=='clean'||source.checksum!==source.sha256||inputHash(source.bytes)!==source.sha256)failInput('SOURCE_SECURITY_PENDING','Input normalization requires the exact current security-cleared source bytes.')
 const ext=source.name.toLowerCase().split('.').at(-1)??'',b=new InputBuilder(source.name,source.bytes,ext)
 try{
  // Proprietary/legacy types have actionable reports, never guessed binary decoders.
  if(['doc','rtf','ppt','xls','qxp','qxd','indd'].includes(ext)){unsupportedOffice(source.name,b);if(['qxp','qxd','indd'].includes(ext))b.result.findings[0].detail='No licensed native QuarkXPress/InDesign adapter is configured. Export authorized IDML, EPUB, structured HTML/XML or PDF with original page order, font licences and linked assets; compare fidelity before reconstruction.';return b.finish()}
  inspectEpubSource(source.name,source.bytes)
  if(ext==='docx')normalizeDocx(source.bytes,b,options!)
  else if(ext==='odt')normalizeOdt(source.bytes,b,options!)
  else if(ext==='pdf')await normalizePdf(source.bytes,b,options!,signal)
  else if(ext==='pptx')normalizePptx(source.bytes,b,options!)
  else if(ext==='xlsx')await normalizeXlsx(source.bytes,b,options!)
  else if(ext==='csv')normalizeCsv(source.bytes,b,options!)
  else if(['png','jpg','jpeg','webp','svg','tif','tiff'].includes(ext))await normalizeImage(source.bytes,b)
  else if(['html','htm','xhtml'].includes(ext))normalizeHtml(source.bytes,b,options!)
  else if(ext==='xsd'){const schema=inspectInputSchema(source.bytes);b.result.metadata={dependencyOnly:true,role:'supplied_reference_schema',schemaSha256:schema.sha256};}
  else if(['xml','jats','bits','nlm','dbk','tei','dita','ditamap'].includes(ext))normalizeXml(source.bytes,b,options!)
  else if(['txt','md','markdown'].includes(ext))normalizePlain(source.bytes,b,ext!=='txt')
  else if(ext==='tex')normalizeLatex(source.bytes,b)
  else if(ext==='idml')normalizeIdml(source.bytes,b)
  else if(ext==='epub')normalizeExistingEpub(source.bytes,b,options!)
  else if(['srt','vtt','smil'].includes(ext))normalizeTiming(source.bytes,b,ext as any)
  else if(['mp3','wav','mp4','m4a','aac','ogg','webm'].includes(ext))normalizeMedia(source.bytes,b,ext)
  else if(ext==='css'){checkCss(inputText(source.bytes),b,b.ref('source'),source.name);b.result.metadata.dependencyOnly=true}
  else if(ext==='zip')b.finding('PACKAGE_MAPPING_REQUIRED','Package manifest is safe to inspect; choose an explicit document entry point and asset/dependency map instead of guessing file order.',b.ref('package'),true)
  else failInput('ADAPTER_UNAVAILABLE','Export a supported authorized source format.')
  const requestedSchema=options!.schemas.find(s=>s.sourceName===source.name)
  if(requestedSchema){const schema=resources.get(requestedSchema.schemaName);if(!schema||schema.scanStatus!=='clean'||schema.checksum!==schema.sha256||inputHash(schema.bytes)!==schema.sha256)failInput('SCHEMA_SOURCE_UNAVAILABLE','Choose the exact security-cleared XSD reference from this publication.');const proof=await validateInputSchema(source.bytes,schema!.bytes,signal);b.result.metadata.sourceSchemaValidation=proof.status;b.result.metadata.schemaEvidence=JSON.stringify({...proof,schemaName:schema!.name});b.asset(schema!.name,schema!.bytes,'application/xml',b.ref('schema-validation'),{referenceOnly:true,role:'supplied_xsd'});for(const note of b.result.findings.filter(f=>f.code==='XML_SCHEMA_REVIEW'))note.detail='Full supplied self-contained XSD was requested. Check the recorded result and independently verify its authorized publisher/schema version and source fidelity.';if(proof.status!=='passed')b.finding('XSD_'+proof.status.toUpperCase(),'The supplied XSD check is '+proof.status.replaceAll('_',' ')+(proof.issues.length?'; source lines: '+proof.issues.map(i=>i.line).join(', '):'')+'. This is not a schema pass; repair the source/schema or complete a supported review.',b.ref('schema-validation'),true,'XML reviewer')}
  // Embedded images use the same safe independent decoder; assets remain bound to original parts.
  if(['docx','odt','pptx','epub','idml'].includes(ext)&&b.result.assets.some(a=>a.availability==='available'&&imageMediaType(a.path)!=='image/unknown')){
   const pack=new InputPackage(source.bytes);for(const asset of b.result.assets){if(signal.aborted)failInput('CANCELLED','Source inspection was cancelled.');const mime=imageMediaType(asset.path);if(asset.availability!=='available'||mime==='image/unknown')continue;const bytes=pack.bytesFor(asset.path,16*1024*1024);if(!bytes)continue
    try{if(mime==='image/svg+xml'){const svg=inspectSvg(bytes);Object.assign(asset.properties,{width:svg.width,height:svg.height,sanitizedSha256:inputHash(svg.svg)})}else if(mime==='image/tiff'){const pages=await decodeInputTiff(bytes);asset.properties.tiffPages=JSON.stringify(pages.map(({png,...p})=>p));if(pages.length>1)b.finding('EMBEDDED_TIFF_PAGE_SELECTION','Embedded TIFF contains multiple pages; verify intended selection and order before output.',asset.source,true);}else{const image=await decodeInputRaster(bytes,mime);Object.assign(asset.properties,{width:image.width,height:image.height,originalOrientation:image.originalOrientation,normalizedPngSha256:image.normalizedSha256})}}
    catch{asset.availability='blocked';b.finding('EMBEDDED_IMAGE_UNSAFE_OR_UNSUPPORTED','The embedded image cannot be safely decoded; supply a valid static replacement.',asset.source,true)}
   }
  }
  if(signal.aborted)failInput('CANCELLED','Source inspection was cancelled.')
  return b.finish()
 }catch(e){if(signal.aborted)failInput('CANCELLED','Source inspection was cancelled.');b.result.nodes=[];b.result.assets=[];b.result.statistics={nodes:0,characters:0,assets:0};b.finding(e instanceof InputNormalizationError?e.code:'INPUT_UNSUPPORTED_OR_DAMAGED',e instanceof InputNormalizationError?e.message:'The source could not be safely normalized. Supply a corrected supported export; no complete-content or conversion claim is made.',b.ref('source'),true);return b.finish()}
}
export function inputDependencyReport(documents:NormalizedInput[]){
 const local=new Map(documents.map(d=>[d.sourceName,d])),dependencies=documents.flatMap(d=>d.assets.map(a=>({sourceName:d.sourceName,sourceSha256:d.sourceSha256,...a})))
 for(const dep of dependencies){const target=local.get(dep.path);if(dep.availability==='missing'&&target&&target.status!=='blocked'){dep.availability='available';dep.sha256=target.sourceSha256;dep.properties={...dep.properties,suppliedAsIndependentSource:true};const owner=documents.find(d=>d.sourceName===dep.sourceName)!,asset=owner.assets.find(a=>a.id===dep.id)!;Object.assign(asset,{availability:'available',sha256:target.sourceSha256,properties:dep.properties});for(const finding of owner.findings)if(finding.code==='RESOURCE_MISSING'&&finding.source.locator===dep.source.locator&&finding.detail==='Resource needs an authorized local replacement: '+dep.path.slice(0,240))Object.assign(finding,{code:'RESOURCE_RESOLVED_FROM_SOURCE',detail:'Dependency resolved from another inspected private publication source: '+dep.path.slice(0,240),severity:'info',blocking:false});owner.status=owner.findings.some(f=>f.blocking)?'blocked':owner.findings.length?'review_required':'normalized'}}
 return {modelVersion:documents[0]?.modelVersion??'',sources:documents.map(d=>({name:d.sourceName,sha256:d.sourceSha256,adapter:d.adapter,status:d.status,statistics:d.statistics})),dependencies,missing:dependencies.filter(a=>a.availability!=='available').map(a=>({sourceName:a.sourceName,path:a.path,source:a.source})),capabilityLosses:documents.flatMap(d=>d.findings.map(f=>({sourceName:d.sourceName,...f}))),sourceToModel:documents.flatMap(d=>{const refs:any[]=[];function walk(nodes:NormalizedInput['nodes']){for(const n of nodes){refs.push({sourceName:d.sourceName,sourceSha256:d.sourceSha256,nodeId:n.id,kind:n.kind,source:n.source});walk(n.children)}}walk(d.nodes);return refs}),conversionPerformed:false,releaseAuthorized:false}
}
