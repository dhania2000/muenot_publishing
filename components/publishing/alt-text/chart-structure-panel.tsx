"use client"
import {useRef,useState} from "react"
import useSWR from "swr"
import {Button} from "@/components/ui/button"
import {altTextFetcher,altTextImageUrl} from "@/lib/alt-text/client"
import type {ChartResponse} from "@/lib/alt-text/chart-service"
export function ChartStructurePanel({assetId,occurrenceId=null}:{assetId:number;occurrenceId?:number|null}){
 const url=`/api/alt-text/assets/${assetId}/charts${occurrenceId?`?occurrenceId=${occurrenceId}`:""}`
 const {data,error,mutate}=useSWR<ChartResponse>(url,altTextFetcher,{revalidateOnFocus:false,refreshInterval:(d)=>d?.activeJobs?3000:0})
 const [selected,setSelected]=useState(""),[confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState<string|null>(null),pending=useRef(new Map<string,string>())
 const region=data?.regions.find((r)=>r.id===selected)??data?.regions[0],latest=data?.results.find((r)=>r.regionId===region?.id)
 async function analyze(){
  if(!region)return
  const key=`${region.analysisId}:${region.id}:${latest?.id??0}`,requestId=pending.current.get(key)??crypto.randomUUID();pending.current.set(key,requestId);setBusy(true);setMessage(null)
  try{
   const response=await fetch(url,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({requestId,occurrenceId,regionId:region.id,analysisId:region.analysisId,reprocess:!!latest})}),body=await response.json()
   if(!response.ok){if(response.status<500)pending.current.delete(key);setMessage(body.error??"Chart analysis could not start.");return}
   pending.current.delete(key);setConfirm(false);await mutate()
  }catch{setMessage("Connection failed. Retry to check the same request.")}finally{setBusy(false)}
 }
 return <section aria-label="Chart structure analysis" className="flex flex-col gap-3 border-t pt-4">
  <h3 className="text-sm font-semibold">Graph and chart structure</h3>
  <p className="text-xs text-muted-foreground">Chart families and structural hints are unverified vision evidence. No numerical dataset is extracted here.</p>
  {error?<p role="alert">Chart evidence could not be loaded.</p>:!data?<p className="text-xs">Loading saved chart evidence…</p>:<>
   {data.reason&&<p className="text-xs">{data.reason}</p>}
   {data.regions.length?<><label className="text-xs">Chart region<select className="ml-2 rounded border bg-background p-2" value={region?.id} disabled={busy} onChange={(e)=>{setSelected(e.target.value);setConfirm(false)}}>{data.regions.map((r,n)=><option key={r.id} value={r.id}>Chart {n+1}{r.parentId?" · nested region":""}</option>)}</select></label>
    {region&&<svg viewBox={`${region.box.x*region.sourceWidth} ${region.box.y*region.sourceHeight} ${region.box.width*region.sourceWidth} ${region.box.height*region.sourceHeight}`} className="h-40 w-full rounded border bg-white" role="img" aria-label="Selected estimated chart region and referenced plot areas"><image href={altTextImageUrl(assetId)} width={region.sourceWidth} height={region.sourceHeight}/>{latest?.result?.regionAnalysisId===region.analysisId&&latest.result.regionReferences.filter((r)=>latest.result!.output.plotRegionIds.includes(r.id)).map((r)=><rect key={r.id} x={r.box.x*region.sourceWidth} y={r.box.y*region.sourceHeight} width={r.box.width*region.sourceWidth} height={r.box.height*region.sourceHeight} fill="none" stroke="#2563eb" strokeWidth="1.5" strokeDasharray="4 2" vectorEffect="non-scaling-stroke"><title>Estimated plot region {r.id}</title></rect>)}</svg>}
    {data.canRun&&<Button size="sm" variant="outline" disabled={busy||!data.enabled||!region?.eligible||data.activeJobs} onClick={()=>setConfirm(true)}>{data.activeJobs?"Chart analysis queued or running…":latest?"Analyze chart again":"Analyze chart structure"}</Button>}
   </>:<p className="text-xs">Run image region detection and choose an individual graph region first.</p>}
   {confirm&&<div role="dialog" aria-label="Confirm chart analysis" className="rounded border p-3 text-sm"><p>This explicit request sends the selected crop to your authorized vision provider and may use AI credits. It recognizes structure, without numerical extraction.</p><div className="mt-2 flex gap-2"><Button size="sm" disabled={busy} onClick={analyze}>{busy?"Submitting…":"Confirm analysis"}</Button><Button size="sm" variant="outline" onClick={()=>setConfirm(false)}>Back</Button></div></div>}
   {message&&<p role="alert" className="text-xs">{message}</p>}
   {data.results.filter((r)=>!region||r.regionId===region.id).map((r)=><article key={r.id} className="rounded border p-3 text-xs"><p className="font-medium">Version {r.version} · {r.status.replaceAll("_"," ")}</p>{r.errorCode&&<p>{r.errorCode==="PAID_RESULT_UNAVAILABLE"?"A billed result needs administrator reconciliation. This request will not automatically call the provider again.":`Analysis could not finish (${r.errorCode}).`}</p>}
    {r.result&&<><p className="mt-2">Chart type: <strong>{r.result.output.chartType.replaceAll("_"," ")}</strong> · {r.result.output.subtype} · review required</p><p>Visible series hint: {r.result.output.series.approximateCount??"unknown"} · {r.result.output.series.grouping} · {r.result.output.series.appearance}</p><p>Existing complexity: {r.result.complexity.level}</p>
     <details className="mt-2"><summary>Referenced plot, axis, title and legend regions</summary><pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify({plot:r.result.output.plotRegionIds,title:r.result.output.titleRegionIds,axes:r.result.output.axisRegionIds,legends:r.result.output.legendRegionIds,labels:r.result.output.labelRegionIds,series:r.result.output.series,complexitySignals:r.result.output.complexitySignals},null,2)}</pre></details>
     {r.result.warnings.map((w)=><p key={w} className="mt-1 text-muted-foreground">{w}</p>)}{r.result.output.warnings.map((w)=><p key={w}>{w.replaceAll("_"," ")}</p>)}<p className="mt-2 break-all text-muted-foreground">{r.result.modelId} · {r.result.createdAt}</p><p className="mt-1 text-muted-foreground">Axis interpretation and numerical extraction become available in later tasks.</p></>}
   </article>)}
  </>}
 </section>
}
