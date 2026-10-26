"use client"
import {useRef,useState} from "react"
import useSWR from "swr"
import {Button} from "@/components/ui/button"
import {altTextFetcher,altTextImageUrl} from "@/lib/alt-text/client"
import type {ChartAxesResponse} from "@/lib/alt-text/chart-axis-service"
export function ChartAxisSection(props:{assetId:number;occurrenceId:number|null;parentId:number}){
 const [open,setOpen]=useState(false)
 return <details className="mt-3 rounded border p-2" onToggle={(e)=>setOpen(e.currentTarget.open)}><summary className="cursor-pointer font-medium">Axes, labels, legends and scale evidence</summary>{open&&<ChartAxisPanel {...props}/>}</details>
}
export function ChartAxisPanel({assetId,occurrenceId,parentId}:{assetId:number;occurrenceId:number|null;parentId:number}){
 const url=`/api/alt-text/assets/${assetId}/charts/${parentId}/axes${occurrenceId?`?occurrenceId=${occurrenceId}`:""}`
 const {data,error,mutate}=useSWR<ChartAxesResponse>(url,altTextFetcher,{revalidateOnFocus:false,refreshInterval:(d)=>d?.activeJobs?3000:0})
 const [busy,setBusy]=useState(false),[message,setMessage]=useState<string|null>(null),[selected,setSelected]=useState(""),[view,setView]=useState("Labels"),pending=useRef<{key:string;id:string}|null>(null)
 const latest=data?.results.find((r)=>r.result),result=latest?.result,axis=result?.axes.find((a)=>a.id===selected)??result?.axes[0]
 async function interpret(){
  const key=String(data?.results[0]?.id??0),requestId=pending.current?.key===key?pending.current.id:crypto.randomUUID();pending.current={key,id:requestId};setBusy(true);setMessage(null)
  try{const response=await fetch(url,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({requestId,reprocess:!!data?.results.length})}),body=await response.json();if(!response.ok){if(response.status<500)pending.current=null;setMessage(body.error??"Label interpretation could not start.");return}pending.current=null;await mutate()}catch{setMessage("Connection failed. Retry to check the same request.")}finally{setBusy(false)}
 }
 if(error)return <p role="alert" className="mt-2">Saved axis evidence could not be loaded.</p>
 if(!data)return <p className="mt-2">Loading saved axis evidence…</p>
 const parent=data.parentChart,s=parent.source
 return <div className="mt-3 flex flex-col gap-2 text-xs">
  <p>Local interpretation uses reviewer-verified OCR. Estimated positions and fitted scales still require review. No paid AI is called.</p>
  {data.policy.reason&&<p>{data.policy.reason}</p>}
  {data.canRun&&<Button size="sm" variant="outline" disabled={busy||!data.policy.enabled||data.activeJobs} onClick={interpret}>{data.activeJobs?"Interpretation queued or running…":busy?"Submitting…":data.results.length?"Interpret reviewed labels again":"Interpret reviewed labels"}</Button>}
  {message&&<p role="alert">{message}</p>}
  {data.results[0]?.errorCode&&<p role="status">Interpretation stopped ({data.results[0].errorCode}). Previous saved evidence is preserved.</p>}
  {result&&<>
   <p>Interpretation version {latest!.version} · chart structure version {result.parentChartVersion} · {result.labels.length} reviewed labels · review required</p>
   <svg viewBox={`${s.pixelBox.left} ${s.pixelBox.top} ${s.pixelBox.width} ${s.pixelBox.height}`} className="h-48 w-full rounded border bg-white" role="img" aria-label="Chart with estimated axis and legend overlays"><image href={altTextImageUrl(assetId)} width={s.sourceWidth} height={s.sourceHeight}/>{result.axes.map((a)=><rect key={a.id} x={a.box.x*s.sourceWidth} y={a.box.y*s.sourceHeight} width={a.box.width*s.sourceWidth} height={a.box.height*s.sourceHeight} fill="none" stroke={a.id===axis?.id?"#2563eb":"#64748b"} strokeWidth="1.5" strokeDasharray="4 2" vectorEffect="non-scaling-stroke"><title>{a.role} · estimated axis</title></rect>)}{parent.regionReferences.filter((r)=>result.legends.some((l)=>l.regionId===r.id)).map((r)=><rect key={r.id} x={r.box.x*s.sourceWidth} y={r.box.y*s.sourceHeight} width={r.box.width*s.sourceWidth} height={r.box.height*s.sourceHeight} fill="none" stroke="#7c3aed" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke"><title>Estimated legend region</title></rect>)}</svg>
   {!!result.axes.length&&<label>Selected axis<select className="ml-2 rounded border bg-background p-1" value={axis?.id} onChange={(e)=>setSelected(e.target.value)}>{result.axes.map((a,n)=><option key={a.id} value={a.id}>Axis {n+1} · {a.role} · {a.orientation}</option>)}</select></label>}
   <div className="flex flex-wrap gap-1">{["Labels","Scale","Legend","Warnings","History"].map((v)=><Button key={v} size="sm" variant={view===v?"secondary":"ghost"} onClick={()=>setView(v)}>{v}</Button>)}</div>
   {view==="Labels"&&<div className="max-h-52 space-y-2 overflow-auto">{result.labels.length?result.labels.map((l)=><p key={l.id}><strong>{l.text}</strong><br/><span className="break-all text-muted-foreground">OCR {l.sourceOcrId} v{l.sourceOcrVersion} · review #{l.reviewId} v{l.reviewVersion} · {l.geometryBasis.replaceAll("_"," ")}</span></p>):<p>No compatible reviewed OCR labels. Review the chart's OCR regions first.</p>}</div>}
   {view==="Scale"&&(axis?<><p>{axis.scale.kind.replaceAll("_"," ")} · {axis.scale.direction.replaceAll("_"," ")} · unit: {axis.unit??"not identified"}</p><p>Pixel extraction enabled: No. A zero baseline is never assumed.</p><div className="max-h-44 overflow-auto"><table className="w-full text-left"><caption className="text-left font-medium">Observed reviewed ticks</caption><thead><tr><th className="p-1">Source label</th><th>Interpreted value</th></tr></thead><tbody>{axis.ticks.map((t)=><tr key={t.labelId} className="border-t"><td className="p-1">{t.text}</td><td>{t.scalar.kind==="date"||t.scalar.kind==="time"?t.text:t.scalar.value??"not numeric"}</td></tr>)}</tbody></table></div><details><summary>Scale fit and source positions</summary><pre className="max-h-44 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify({ticks:axis.ticks,model:axis.scale.model},null,2)}</pre></details>{[...axis.warnings,...axis.scale.warnings].map((w,n)=><p key={n}>{w}</p>)}</>:<p>No supported visible axis references were available.</p>)}
   {view==="Legend"&&<>{result.legends.length?result.legends.map((l)=><div key={l.regionId}><p>Legend region {l.regionId}</p>{l.entries.map((e)=><p key={e.labelId}>{e.text} · series/color association unverified</p>)}</div>):<p>No reviewed legend evidence.</p>}</>}
   {view==="Warnings"&&<ul className="list-disc space-y-1 pl-4">{result.warnings.map((w,n)=><li key={n}>{w}</li>)}</ul>}
   {view==="History"&&data.results.map((r)=><details key={r.id} className="rounded border p-2"><summary>Version {r.version} · {r.status} · {r.createdAt}</summary><pre className="max-h-44 overflow-auto whitespace-pre-wrap break-all">{r.result?JSON.stringify(r.result,null,2):r.errorCode??"Processing has not produced a result."}</pre></details>)}
  </>}
 </div>
}
