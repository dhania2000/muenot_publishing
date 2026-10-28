"use client"
import {useCallback,useState} from "react"
import useSWR from "swr"
import {Button} from "@/components/ui/button"
import {altTextFetcher} from "@/lib/alt-text/client"
import type {StructuredReviewKind} from "@/lib/alt-text/structured-review-contract"
import type {OcrReviewTarget} from "@/lib/alt-text/ocr-review-contract"
import {StructuredEvidenceReview} from "./structured-evidence-review"
import {OcrEvidenceReview} from "./ocr-evidence-review"
type Source={id:number;kind:StructuredReviewKind;version:number;regionId:string}
const titles:Record<StructuredReviewKind,string>={chart_axes:"Graph axes / labels",chart_data:"Graph data",scientific_structure:"Scientific components",illustration_structure:"Flowchart / table / map"}
export function EvidenceReviewWorkbench({assetId,occurrenceId=null,onDirtyChange}:{assetId:number;occurrenceId?:number|null;onDirtyChange?:(v:boolean)=>void}){
 const {data,error,mutate}=useSWR<{items:Source[];recognition:OcrReviewTarget[]}>(`/api/alt-text/assets/${assetId}/evidence-review?list=1${occurrenceId?`&occurrenceId=${occurrenceId}`:""}`,altTextFetcher,{revalidateOnFocus:false})
 const [selected,setSelected]=useState(""),[dirty,setDirty]=useState(false),[revision,setRevision]=useState(0)
 const changed=useCallback((d:boolean)=>{setDirty(d);onDirtyChange?.(d)},[onDirtyChange])
 const sources=[...(data?.recognition??[]).map(t=>({key:`${t.kind}:${t.sourceId}`,label:`${t.kind==="math_ocr"?"Mathematics":"OCR text"} #${t.sourceId}`,target:t})),...(data?.items??[]).map(s=>({key:`${s.kind}:${s.id}`,label:`${titles[s.kind]} #${s.id} · ${s.regionId} · v${s.version}`,source:s}))]
 const current=sources.find(s=>s.key===selected)??sources[0]
 return <section className="space-y-3 rounded border p-3" aria-label="Advanced evidence review">
  <h3 className="text-sm font-semibold">Evidence review & corrections</h3><p className="text-xs text-muted-foreground">Inspect saved analysis and record human corrections. Description editing, quality warnings and final approval remain in this image’s existing review controls.</p><Button size="sm" variant="outline" onClick={()=>{if(dirty&&!window.confirm("Discard unsaved evidence corrections and refresh saved sources?"))return;changed(false);setSelected("");setRevision(r=>r+1);void mutate()}}>Refresh saved sources</Button>
  {error?<p role="alert">Saved evidence could not be loaded.</p>:!data?<p role="status">Loading saved evidence…</p>:!sources.length?<p className="text-sm">No saved OCR, mathematics or structured evidence is available for this source occurrence. Use the analysis tools to create evidence first.</p>:<>
   <label className="grid gap-1 text-xs">Evidence type and source<select className="max-w-full rounded border bg-background p-2" value={current?.key??""} onChange={e=>{if(dirty&&!window.confirm("Discard unsaved evidence corrections?"))return;changed(false);setRevision(r=>r+1);setSelected(e.target.value)}}>{sources.map(s=><option key={s.key} value={s.key}>{s.label}</option>)}</select></label>
   {current&&("target" in current?<OcrEvidenceReview key={`${revision}:${current.key}`} target={current.target} onDirtyChange={changed}/>:<StructuredEvidenceReview key={`${revision}:${current.key}`} assetId={assetId} occurrenceId={occurrenceId} kind={current.source.kind} evidenceId={current.source.id} onDirtyChange={changed}/>)}
  </>}
 </section>
}
