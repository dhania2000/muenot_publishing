"use client"
import {useEffect,useRef,useState} from "react"
import useSWR,{useSWRConfig} from "swr"
import {advancedQualityUrl} from "@/lib/alt-text/advanced-quality-contract"
import {Button} from "@/components/ui/button"
import {altTextFetcher} from "@/lib/alt-text/client"
import type {OcrReviewSource,OcrReviewState,OcrReviewTarget,OcrReviewVersion} from "@/lib/alt-text/ocr-review-contract"
import {EquationMathmlPreview} from "./equation-validation-panel"
import {WorkbenchDrawer} from "./workbench"
type Detail={success:true;source:OcrReviewSource;history:OcrReviewVersion[];earlierHistory:OcrReviewVersion[]}
export function OcrEvidenceReviewButton({target}:{target:OcrReviewTarget}){
 const [open,setOpen]=useState(false),[dirty,setDirty]=useState(false)
 function close(next:boolean){if(!next&&dirty&&!window.confirm("Discard unsaved OCR corrections?"))return;setOpen(next);if(!next)setDirty(false)}
 return <><Button size="sm" variant="outline" onClick={()=>setOpen(true)}>Review / correct evidence</Button><WorkbenchDrawer open={open} onOpenChange={close} title="OCR evidence review" description="Corrections remain separate from raw OCR and final Alt Text approval." size="xl">{open&&<OcrEvidenceReview key={JSON.stringify(target)} target={target} onDirtyChange={setDirty}/>}</WorkbenchDrawer></>
}
export function OcrEvidenceReview({target,onDirtyChange}:{target:OcrReviewTarget;onDirtyChange?:(dirty:boolean)=>void}){
 const {mutate:mutateCache}=useSWRConfig()
 const url=`/api/alt-text/ocr-review?target=${encodeURIComponent(JSON.stringify(target))}`
 const {data,error,mutate}=useSWR<Detail>(url,altTextFetcher,{revalidateOnFocus:false,revalidateIfStale:false})
 const [text,setText]=useState(""),[comment,setComment]=useState(""),[view,setView]=useState("Correction"),[busy,setBusy]=useState(false),[message,setMessage]=useState<string|null>(null),[preview,setPreview]=useState(false),[confirmReprocess,setConfirmReprocess]=useState(false)
 const [baseline,setBaseline]=useState({text:"",comment:"",version:0}),loaded=useRef(false),pending=useRef<{key:string;id:string}|null>(null)
 const latest=data?.history[0],source=data?.source,dirty=text!==baseline.text||comment!==baseline.comment
 useEffect(()=>{if(data&&!loaded.current){loaded.current=true;const t=data.history[0]?.correctedText??data.source.rawText,c=data.history[0]?.comment??"";setText(t);setComment(c);setBaseline({text:t,comment:c,version:data.history[0]?.version??0})}},[data])
 useEffect(()=>{onDirtyChange?.(dirty);return()=>onDirtyChange?.(false)},[dirty,onDirtyChange])
 useEffect(()=>{const guard=(e:BeforeUnloadEvent)=>{if(dirty){e.preventDefault();e.returnValue=""}};window.addEventListener("beforeunload",guard);return()=>window.removeEventListener("beforeunload",guard)},[dirty])
 async function save(state:OcrReviewState){
  setBusy(true);setMessage(null)
  const key=JSON.stringify([text,comment,state,baseline.version]),id=pending.current?.key===key?pending.current.id:crypto.randomUUID();pending.current={key,id}
  try{
   const response=await fetch("/api/alt-text/ocr-review",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({target,expectedVersion:baseline.version,requestId:id,text,comment,state})}),body=await response.json()
   if(!response.ok){if(response.status<500)pending.current=null;setMessage(body.error??"Correction could not be saved.");return}
   pending.current=null;setBaseline({text,comment,version:body.record.version});await mutate();if(target.assetId!==null)void mutateCache(advancedQualityUrl(target.assetId,target.occurrenceId));setMessage("Evidence review saved. Final Alt Text approval is unchanged.")
  }catch{setMessage("Connection failed. Retry to check the same save request.")}finally{setBusy(false)}
 }
 async function reload(){if(dirty&&!window.confirm("Discard your unsaved edits and load the latest review?"))return;const fresh=await mutate();if(fresh){const t=fresh.history[0]?.correctedText??fresh.source.rawText,c=fresh.history[0]?.comment??"";setText(t);setComment(c);setBaseline({text:t,comment:c,version:fresh.history[0]?.version??0})}setMessage(null)}
 async function reprocess(){
  if(!source)return
  const saved=source.sourceSnapshot as any,requestId=crypto.randomUUID()
  const endpoint=target.kind==="page_ocr"?`/api/alt-text/documents/${target.documentId}/page-ocr`:`/api/alt-text/assets/${target.assetId}/${target.kind==="math_ocr"?"math":"ocr"}`
  const body=target.kind==="page_ocr"?{action:"recognize",mode:"reprocess",pages:[target.pageIndex],languageMode:saved.languageMode??"eng",dpi:saved.render?.dpi??200,segmentation:saved.segmentation??"auto",confirmReprocess:true}:target.kind==="math_ocr"?{requestId,occurrenceId:target.occurrenceId,analysisId:saved.source?.analysisId,regionId:saved.regionId,reprocess:true}:{requestId,occurrenceId:target.occurrenceId,regionId:saved.region?.regionId??null,languageMode:saved.languageMode??"eng",reprocess:true}
  setBusy(true);setMessage(null)
  try{const response=await fetch(endpoint,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}),result=await response.json();setMessage(response.ok?"Reprocessing requested through the existing OCR workflow. Saved corrections remain attached to their original recognition. Select the new result after processing finishes.":result.error??"Reprocessing could not start.");if(response.ok)setConfirmReprocess(false)}catch{setMessage("The reprocessing request could not be confirmed. Check the existing OCR status before trying again.")}finally{setBusy(false)}
 }
 if(error)return <p role="alert" className="text-sm text-destructive">Recognition evidence could not be loaded.</p>
 if(!source)return <p className="text-sm">Loading saved evidence…</p>
 const snapshot=source.sourceSnapshot as any,box=snapshot?.region?.crop??snapshot?.source?.pixelBox,w=snapshot?.source?.storedWidth??snapshot?.source?.sourceWidth,h=snapshot?.source?.storedHeight??snapshot?.source?.sourceHeight
 return <div className="flex min-h-0 flex-col gap-3">
  <div role="toolbar" aria-label="Evidence correction actions" className="flex flex-wrap items-center gap-2">
   <Button size="sm" disabled={busy||!source.canEdit} onClick={()=>save("corrected")}>Save correction</Button>
   <Button size="sm" variant="outline" disabled={busy||!source.canEdit} onClick={()=>save("in_review")}>In review</Button>
   <Button size="sm" variant="outline" disabled={busy||!source.canEdit||!source.canVerify||!text.trim()} onClick={()=>save("verified")}>Mark reviewed / verified</Button>
   <Button size="sm" variant="outline" disabled={busy||!source.canEdit} onClick={()=>save("rejected")}>Unusable</Button>
   <Button size="sm" variant="outline" disabled={busy||dirty||!source.canEdit||(target.kind==="math_ocr"&&!(source.sourceSnapshot as any)?.source?.analysisId)} onClick={()=>setConfirmReprocess(true)}>Request reprocessing</Button>
   <Button size="sm" variant="ghost" disabled={busy} onClick={reload}>Reload latest</Button>
   {dirty&&<span className="text-xs">Unsaved changes</span>}
  </div>
  <p className="text-xs text-muted-foreground">{latest?.state.replaceAll("_"," ")??"Needs review"} · correction version {baseline.version} · {source.confidence==null?"Confidence not reported; verification required":`Tesseract engine score ${source.confidence}/100; this is not an accuracy percentage`}</p>
  {message&&<p role="status" className="text-sm">{message}</p>}
  {confirmReprocess&&<div role="dialog" aria-label="Confirm OCR reprocessing" className="rounded border p-3 text-sm"><p>Run local recognition again for this exact source? Existing raw evidence and saved corrections remain separate. Save or discard edits before reprocessing.</p><div className="mt-2 flex gap-2"><Button size="sm" disabled={busy} onClick={reprocess}>Confirm local reprocessing</Button><Button size="sm" variant="outline" onClick={()=>setConfirmReprocess(false)}>Back</Button></div></div>}
  <div className="grid min-h-0 gap-4 lg:grid-cols-2">
   <section className="min-w-0 rounded border p-3" aria-label="Original recognition source"><h3 className="mb-2 text-sm font-medium">Original source</h3>
    {source.previewUrl&&(target.kind==="page_ocr"&&!preview?<Button size="sm" variant="outline" onClick={()=>setPreview(true)}>Load original PDF page preview</Button>:box&&w&&h?<svg viewBox={`${box.left} ${box.top} ${box.width} ${box.height}`} className="h-72 w-full bg-white" role="img" aria-label="Estimated original text region"><image href={source.previewUrl} width={w} height={h}/></svg>:<img src={source.previewUrl} className="max-h-[55vh] w-full object-contain" alt="Original source for OCR evidence review"/>)}
    <p className="mt-2 break-all text-xs text-muted-foreground">Source {source.analysisId} · version {source.sourceVersion}{source.regionId?` · region ${source.regionId}`:""}{target.pageIndex!=null?` · page ${target.pageIndex+1}`:""}</p>
   </section>
   <section className="flex min-w-0 flex-col gap-2 rounded border p-3" aria-label="Correction and history">
    <div className="flex flex-wrap gap-1">{["Correction","Raw OCR","Equation preview","History","Warnings"].filter((v)=>v!=="Equation preview"||target.kind==="math_ocr").map((v)=><Button key={v} size="sm" variant={v===view?"secondary":"ghost"} onClick={()=>setView(v)}>{v}</Button>)}</div>
    {view==="Correction"&&<><label className="text-xs">Corrected transcription<textarea className="mt-1 min-h-60 w-full resize-y rounded border bg-background p-2 text-sm" dir="auto" value={text} readOnly={!source.canEdit||busy} onChange={(e)=>setText(e.target.value)}/></label><label className="text-xs">Review comment<textarea className="mt-1 w-full rounded border bg-background p-2 text-sm" value={comment} readOnly={!source.canEdit||busy} onChange={(e)=>setComment(e.target.value)}/></label><p className="text-xs text-muted-foreground">Mark verified only after comparing the transcription with its source. Raw OCR and Alt Text approval remain separate.</p></>}
    {view==="Raw OCR"&&<pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap break-words text-sm">{source.rawText||"No recognized text."}</pre>}
    {view==="Equation preview"&&<><EquationMathmlPreview validation={latest?.validation} title="Saved corrected equation preview"/>{latest?.validation?.issues.map((i,n)=><p key={n} className="text-xs">{i.severity}: {i.message}</p>)}</>}
    {view==="Warnings"&&<ul className="list-disc space-y-1 pl-4 text-xs">{source.warnings.map((warning,n)=><li key={n}>{warning}</li>)}</ul>}
    {view==="History"&&<div className="max-h-[55vh] space-y-2 overflow-auto">{[...(data?.history??[]),...(data?.earlierHistory??[])].map((r)=><details key={r.id} className="rounded border p-2 text-xs"><summary>Version {r.version} · {r.state} · reviewer #{r.editorId} · {new Date(r.createdAt).toLocaleString()}{r.sourceRef!==source.sourceRef?" · earlier recognition":""}</summary><p className="break-all">{r.sourceRef}</p><pre className="my-2 whitespace-pre-wrap break-words">{r.correctedText}</pre><p>{r.comment}</p></details>)}</div>}
   </section>
  </div>
 </div>
}

