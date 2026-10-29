import {EPUB_CHUNK_BYTES} from "./upload-contract"
export type UploadReference={id:string;token:string}
type RecordFile=UploadReference&{requestId:string;name:string;size:number;sha256:string}
export type UploadProgress={index:number;name:string;status:string;receivedBytes:number;size:number}
type Store=Pick<Storage,"getItem"|"setItem">
export class EpubUploadClient{
 private abort:AbortController|null=null
 private active:RecordFile|null=null
 private stopped=false
 constructor(private key:string,private storage:Store,private request:typeof fetch=fetch){}
 private records():RecordFile[]{try{const v=JSON.parse(this.storage.getItem(this.key)??"[]");return Array.isArray(v)?v.filter(r=>r&&typeof r.id==="string"&&/^[a-f0-9-]{36}$/i.test(r.id)&&typeof r.token==="string"&&/^[A-Za-z0-9_-]{43}$/.test(r.token)&&typeof r.requestId==="string"&&typeof r.name==="string"&&typeof r.sha256==="string"&&/^[a-f0-9]{64}$/.test(r.sha256)&&Number.isSafeInteger(r.size)).slice(-20):[]}catch{return []}}
 private save(r:RecordFile){const existing=this.records().filter(x=>x.id!==r.id);this.storage.setItem(this.key,JSON.stringify([...existing,r].slice(-20)))}
 private async api(path:string,options:RequestInit={},signal?:AbortSignal){const response=await this.request('/api/conversion/epub/uploads'+path,{...options,cache:"no-store",signal}),body=await response.json();if(!response.ok||body.success===false)throw Object.assign(Error(body.error??"Upload could not continue."),{status:response.status});return body}
 private async digest(bytes:ArrayBuffer){return [...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(n=>n.toString(16).padStart(2,'0')).join('')}
 async prepare(files:File[],requestId:string,onProgress:(p:UploadProgress)=>void){
  if(!files.length||files.length>10||files.some(f=>f.size<1||f.size>25*1024*1024)||files.reduce((n,f)=>n+f.size,0)>100*1024*1024)throw Error("Choose up to 10 files, 25 MiB each and 100 MiB total.")
  this.stopped=false;const references:UploadReference[]=[]
  for(const [index,file]of files.entries()){
   if(this.stopped)throw Error("Upload paused. Resume with the same source files.")
   onProgress({index,name:file.name,status:"checking checksum",receivedBytes:0,size:file.size})
   const sha256=await this.digest(await file.arrayBuffer());if(this.stopped)throw Error("Upload paused. Resume with the same source files.")
   let record=this.records().find(r=>r.requestId===requestId&&r.name===file.name&&r.size===file.size&&r.sha256===sha256),state:any
   if(record){try{state=await this.api('/'+record.id,{headers:{'x-upload-token':record.token}})}catch(e){if(![404,410].includes((e as any).status))throw e;record=undefined}}
   if(state&&["cancelled","expired","rejected"].includes(state.status)){record=undefined;state=undefined}
   if(!record){const started=await this.api('',{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({requestId,name:file.name,size:file.size,sha256})});record={id:started.id,token:started.token,requestId,name:file.name,size:file.size,sha256};this.save(record);state={status:"open",received:[],receivedBytes:0}}
   this.active=record
   if(state.status==="paused")state=await this.api('/'+record.id,{method:"POST",headers:{'x-upload-token':record.token,'content-type':'application/json'},body:JSON.stringify({action:"resume"})})
   if(!["sealed","consumed"].includes(state.status)){
    const received=new Set<number>(state.received)
    for(let chunk=0;chunk<Math.ceil(file.size/EPUB_CHUNK_BYTES);chunk++){
     if(this.stopped)throw Error("Upload paused. Resume with the same source files.")
     if(received.has(chunk))continue
     const bytes=await file.slice(chunk*EPUB_CHUNK_BYTES,(chunk+1)*EPUB_CHUNK_BYTES).arrayBuffer(),checksum=await this.digest(bytes)
     if(this.stopped)throw Error("Upload paused. Resume with the same source files.")
     this.abort=new AbortController()
     try{state=await this.api('/'+record.id,{method:"PUT",headers:{'x-upload-token':record.token,'x-chunk-index':String(chunk),'x-chunk-sha256':checksum,'content-type':'application/octet-stream'},body:bytes},this.abort.signal)}catch(e){if(this.stopped)throw Error("Upload paused or cancelled. Server status will be checked when you resume.");throw e}finally{this.abort=null}
     onProgress({index,name:file.name,status:"uploading",receivedBytes:state.receivedBytes,size:file.size})
    }
    if(this.stopped)throw Error("Upload paused. Resume with the same source files.")
    onProgress({index,name:file.name,status:"verifying complete source",receivedBytes:file.size,size:file.size})
    state=await this.api('/'+record.id,{method:"POST",headers:{'x-upload-token':record.token,'content-type':'application/json'},body:JSON.stringify({action:"seal"})})
   }
   if(this.stopped)throw Error("Upload paused or cancelled. Resume to check server status.")
   onProgress({index,name:file.name,status:state.status==="consumed"?"submitted":"verified; security review pending",receivedBytes:file.size,size:file.size})
   references.push({id:record.id,token:record.token});this.active=null
  }
  return references
 }
 async pause(){this.stopped=true;this.abort?.abort();const r=this.active;if(r){try{await this.api('/'+r.id,{method:"POST",headers:{'x-upload-token':r.token,'content-type':'application/json'},body:JSON.stringify({action:"pause"})})}catch(e){if((e as any).status!==409)throw e}}}
 async cancel(requestId:string){this.stopped=true;this.abort?.abort();const records=this.records().filter(r=>r.requestId===requestId);const results=await Promise.allSettled(records.map(r=>this.api('/'+r.id,{method:"POST",headers:{'x-upload-token':r.token,'content-type':'application/json'},body:JSON.stringify({action:"cancel"})})));const failed=results.some(r=>r.status==="rejected"&&![404,410].includes((r.reason as any).status));if(failed)throw Error("Some sources could not be cancelled or already belong to a project. Retry for the submission receipt.")}
}
