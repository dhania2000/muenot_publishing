"use client"
import {useCallback,useState} from "react"
import useSWR from "swr"
import {Button} from "@/components/ui/button"
import {altTextFetcher} from "@/lib/alt-text/client"
import {EVIDENCE_REVIEW_STATES,STRUCTURED_REVIEW_KINDS} from "@/lib/alt-text/structured-review-contract"
import type {StructuredQueueItem} from "@/lib/alt-text/structured-review-queue"
import {StructuredEvidenceReview} from "./structured-evidence-review"
export function StructuredReviewHistory({onDirtyChange}:{onDirtyChange:(v:boolean)=>void}){
 const [filters,setFilters]=useState({search:"",state:"pending",priority:"all",source:"all",reviewerId:"",kind:"all"}),[search,setSearch]=useState(""),[page,setPage]=useState(1),[current,setCurrent]=useState<StructuredQueueItem|null>(null),[dirty,setDirty]=useState(false),[revision,setRevision]=useState(0)
 const params=new URLSearchParams({page:String(page),pageSize:"25",...Object.fromEntries(Object.entries(filters).filter(([,v])=>v!==""))})
 const {data,error,mutate}=useSWR<{items:StructuredQueueItem[];total:number}>(`/api/alt-text/evidence-review?${params}`,altTextFetcher,{revalidateOnFocus:false})
 const changed=useCallback((d:boolean)=>{setDirty(d);onDirtyChange(d)},[onDirtyChange])
 function change(fn:()=>void){if(dirty&&!window.confirm("Discard unsaved evidence corrections?"))return;changed(false);setCurrent(null);fn()}
 function filter(k:string,v:string){change(()=>{setFilters(f=>({...f,[k]:v}));setPage(1)})}
 return <div className="space-y-3 overflow-auto">
  <form className="flex flex-wrap items-end gap-2" onSubmit={e=>{e.preventDefault();filter("search",search)}}>
   <label className="grid gap-1 text-xs">Search image name<input className="rounded border bg-background p-2" value={search} maxLength={160} onChange={e=>setSearch(e.target.value)}/></label><Button size="sm" type="submit" variant="outline">Search</Button>
   {([['state',['pending','all',...EVIDENCE_REVIEW_STATES]],['priority',['all','warnings','routine']],['source',['all','image','document']],['kind',['all',...STRUCTURED_REVIEW_KINDS]]] as [keyof typeof filters,string[]][]).map(([key,values])=><label key={key} className="grid gap-1 text-xs">{key}<select className="max-w-48 rounded border bg-background p-2" value={filters[key]} onChange={e=>filter(key,e.target.value)}>{values.map(v=><option key={v} value={v}>{v.replaceAll('_',' ')}</option>)}</select></label>)}
   <label className="grid gap-1 text-xs">Reviewer ID<input type="number" min="1" step="1" className="w-28 rounded border bg-background p-2" value={filters.reviewerId} onChange={e=>filter("reviewerId",e.target.value)}/></label>
  </form>
  <p className="text-xs">Priority groups use saved analysis warnings. They do not measure scientific accuracy. {data?.total??0} records.</p>
  {error?<p role="alert">Could not load the review queue.</p>:!data?<p role="status">Loading review queue…</p>:<ul className="divide-y rounded border">{data.items.map(r=><li key={r.evidenceId} className="flex flex-wrap items-center gap-3 p-2 text-xs"><div className="min-w-0 flex-1"><strong className="break-all">{r.label}</strong><p>{r.kind.replaceAll('_',' ')} · #{r.evidenceId} · {r.occurrenceId?`document occurrence #${r.occurrenceId}`:'image'} · {r.state.replaceAll('_',' ')} · {r.priority}</p><p>Reviewer {r.reviewerId??'unassigned'} · {r.updatedAt}</p></div><Button size="sm" variant="outline" aria-label={`Open evidence ${r.evidenceId} for ${r.label}`} onClick={()=>{if(dirty&&!window.confirm("Discard unsaved evidence corrections?"))return;changed(false);setRevision(v=>v+1);setCurrent(r)}}>Open</Button></li>)}{!data.items.length&&<li className="p-3 text-sm">No evidence matches these filters.</li>}</ul>}
  <nav className="flex items-center gap-3" aria-label="Structured review queue pagination"><Button size="sm" variant="outline" disabled={page===1} onClick={()=>change(()=>setPage(p=>p-1))}>Previous page</Button><span className="text-xs">Page {page}</span><Button size="sm" variant="outline" disabled={page*25>=(data?.total??0)} onClick={()=>change(()=>setPage(p=>p+1))}>Next page</Button><Button size="sm" variant="outline" onClick={()=>void mutate()}>Refresh queue</Button></nav>
  {current&&<StructuredEvidenceReview key={`${revision}:${current.evidenceId}`} assetId={current.assetId} occurrenceId={current.occurrenceId} kind={current.kind} evidenceId={current.evidenceId} onDirtyChange={changed}/>}
 </div>
}
