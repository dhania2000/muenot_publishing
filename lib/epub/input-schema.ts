import 'server-only'
import path from 'node:path'
import {spawn} from 'node:child_process'
import {inputText,inputHash,safeXml,descendants,xmlAttr,xmlChildren,localName,failInput} from './input-common'
export type InputSchemaResult={status:'passed'|'failed'|'unable_to_test'|'cancelled';issues:{line:number;code:number}[];schemaSha256:string;validator:'libxml2-wasm@0.7.2';externalResources:'denied';scope:'supplied_self_contained_xsd_only'}
export function inspectInputSchema(bytes:Buffer){
 if(bytes.length>256*1024)failInput('SCHEMA_LIMIT','Use a self-contained XSD up to 256 KiB; flatten authorized schema dependencies first.')
 const text=inputText(bytes),root=safeXml(text),schema=root.find(n=>localName(n)==='schema');if(!schema||xmlAttr(schema,'xmlns:xs')!=='http://www.w3.org/2001/XMLSchema'&&!Object.values(schema[':@']??{}).includes('http://www.w3.org/2001/XMLSchema'))failInput('SCHEMA_ROOT','Choose a valid XML Schema document.')
 const nodes=[...root];let count=0;while(nodes.length){const n=nodes.pop()!,name=localName(n);if(++count>4000)failInput('SCHEMA_LIMIT','Split or simplify excessively large schemas.');if(['include','import','redefine','override'].includes(name))failInput('SCHEMA_EXTERNAL_DEPENDENCY','External schema includes/imports are denied. Supply an authorized flattened self-contained XSD.');if(name==='pattern'&&xmlAttr(n,'value').length>256)failInput('SCHEMA_PATTERN_LIMIT','Use bounded schema patterns.');nodes.push(...xmlChildren(n))}
 return {text,sha256:inputHash(bytes)}
}
let validating=false
export async function validateInputSchema(xml:Buffer,schema:Buffer,signal:AbortSignal):Promise<InputSchemaResult>{
 const checked=inspectInputSchema(schema),source=inputText(xml);if(xml.length>1024*1024)failInput('SCHEMA_SOURCE_LIMIT','Split source XML above 1 MiB for bounded schema validation.');safeXml(source)
 const result=(status:InputSchemaResult['status'],issues:InputSchemaResult['issues']=[]):InputSchemaResult=>({status,issues,schemaSha256:checked.sha256,validator:'libxml2-wasm@0.7.2',externalResources:'denied',scope:'supplied_self_contained_xsd_only'})
 if(signal.aborted)return result('cancelled');if(process.env.EPUB_INPUT_XSD_DISABLED==='1')return result('unable_to_test');if(validating)failInput('SCHEMA_VALIDATOR_BUSY','Another bounded local schema check is running. Retry shortly.');validating=true
 try{return await new Promise<InputSchemaResult>(resolve=>{
  const worker=spawn(process.execPath,['--max-old-space-size=96','--wasm-max-mem-pages=2048',path.join(process.cwd(),'scripts','epub-xsd-worker.mjs')],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{NODE_ENV:'production',...(process.env.SystemRoot?{SystemRoot:process.env.SystemRoot}:{})}})
  let finished=false,stdout='',stderrBytes=0
  const finish=(status:InputSchemaResult['status'],issues:InputSchemaResult['issues']=[])=>{if(finished)return;finished=true;clearTimeout(timer);signal.removeEventListener('abort',abort);if(worker.exitCode===null)worker.kill();resolve(result(status,issues))},abort=()=>finish('cancelled'),timer=setTimeout(()=>finish('unable_to_test'),5000)
  signal.addEventListener('abort',abort,{once:true});worker.stdout.setEncoding('utf8');worker.stdout.on('data',chunk=>{stdout+=chunk;if(Buffer.byteLength(stdout)>8192)finish('unable_to_test')});worker.stderr.on('data',chunk=>{stderrBytes+=chunk.length;if(stderrBytes>8192)finish('unable_to_test')});worker.once('error',()=>finish('unable_to_test'));worker.stdin.on('error',()=>finish('unable_to_test'))
  worker.once('close',code=>{if(finished)return;try{const message=JSON.parse(stdout);if(code!==0||!['passed','failed','unable_to_test'].includes(message.status)||!Array.isArray(message.issues))throw Error();finish(message.status,message.issues.slice(0,20).map((i:any)=>({line:Number(i.line)||0,code:Number(i.code)||0})))}catch{finish('unable_to_test')}})
  worker.stdin.end(JSON.stringify({xml:source,schema:checked.text}));if(signal.aborted)abort()
 })}finally{validating=false}
}
