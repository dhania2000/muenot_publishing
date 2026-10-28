"use client"
import {useCallback,useState} from "react"
import useSWR from "swr"
import {Button} from "@/components/ui/button"
import {altTextFetcher} from "@/lib/alt-text/client"
import type {AltTextAssetView} from "@/lib/alt-text/history"
import type {OcrReviewQueueItem} from "@/lib/alt-text/ocr-review-queue"
import {AltTextHistory} from "./alt-text-history"
import {OcrEvidenceReview} from "./ocr-evidence-review"
import {StructuredReviewHistory} from "./structured-review-history"
export function OcrReviewHistory({onOpenInEditor,onDirtyChange}:{onOpenInEditor:(asset:AltTextAssetView)=>void;onDirtyChange:(dirty:boolean)=>void}){
 const [view,setView]=useState("generations"),[page,setPage]=useState(1),[all,setAll]=useState(false),[index,setIndex]=useState(0),[dirty,setDirty]=useState(false)
 const [revision,setRevision]=useState(0)
 const dirtyChanged=useCallback((value:boolean)=>{setDirty(value);onDirtyChange(value)},[onDirtyChange])
 const {data,error}=useSWR<{items:OcrReviewQueueItem[];total:number}>(view==="review"?`/api/alt-text/ocr-review?page=${page}&pageSize=25${all?"&all=1":""}`:null,altTextFetcher,{revalidateOnFocus:false})
 const current=data?.items[index]
 function change(action:()=>void){if(dirty&&!window.confirm("Discard unsaved evidence corrections?"))return;setDirty(false);onDirtyChange(false);setRevision((n)=>n+1);action()}
 return <div className="flex h-full min-h-0 flex-col gap-3">
  <div className="flex shrink-0 flex-wrap gap-2"><Button size="sm" variant={view==="generations"?"secondary":"outline"} onClick={()=>change(()=>setView("generations"))}>Saved generations</Button><Button size="sm" variant={view==="review"?"secondary":"outline"} onClick={()=>change(()=>setView("review"))}>OCR evidence review</Button><Button size="sm" variant={view==="structured"?"secondary":"outline"} onClick={()=>change(()=>setView("structured"))}>Structured evidence review</Button></div>
  {view==="generations"?<AltTextHistory onOpenInEditor={onOpenInEditor}/>:view==="structured"?<StructuredReviewHistory onDirtyChange={dirtyChanged}/>:<div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
   <div className="flex flex-wrap items-center gap-3"><label className="text-xs"><input type="checkbox" checked={all} onChange={(e)=>change(()=>{setAll(e.target.checked);setPage(1);setIndex(0)})}/> Include all recognition for manual selection</label><span className="text-xs">{data?.total??0} records</span></div>
   {error?<p role="alert">The review queue could not be loaded.</p>:!data?<p>Loading review records…</p>:!data.items.length?<p>No recognition evidence needs review in this selection.</p>:<>
    <div className="flex flex-wrap items-center gap-2"><label className="min-w-0 flex-1 text-xs">Recognition source<select className="ml-2 max-w-full rounded border bg-background p-2" value={index} onChange={(e)=>change(()=>setIndex(Number(e.target.value)))}>{data.items.map((item,n)=><option key={`${item.target.kind}:${item.target.sourceId}:${n}`} value={n}>{item.label}{item.target.pageIndex!=null?` · page ${item.target.pageIndex+1}`:""} · {item.target.kind.replaceAll("_"," ")} · {item.recognitionStatus}</option>)}</select></label><Button size="sm" variant="outline" disabled={!index} onClick={()=>change(()=>setIndex(index-1))}>Previous record</Button><Button size="sm" variant="outline" disabled={index+1>=data.items.length} onClick={()=>change(()=>setIndex(index+1))}>Next record</Button></div>
    {current&&<><p className="text-xs text-muted-foreground">{current.reason}</p><OcrEvidenceReview key={`${revision}:${JSON.stringify(current.target)}`} target={current.target} onDirtyChange={dirtyChanged}/></>}
   </>}
   <nav aria-label="OCR review queue pagination" className="flex items-center gap-3"><Button size="sm" variant="outline" disabled={page===1} onClick={()=>change(()=>{setPage(page-1);setIndex(0)})}>Previous page</Button><span className="text-xs">Page {page}</span><Button size="sm" variant="outline" disabled={page*25>=(data?.total??0)} onClick={()=>change(()=>{setPage(page+1);setIndex(0)})}>Next page</Button></nav>
  </div>}
 </div>
}
