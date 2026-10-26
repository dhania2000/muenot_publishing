"use client"
import {useRef,useState} from "react"
import useSWR from "swr"
import {Button} from "@/components/ui/button"
import {altTextFetcher,altTextImageUrl} from "@/lib/alt-text/client"
import type {ChartDataResponse} from "@/lib/alt-text/chart-data-service"
import type {ChartDataPoint,ChartDataResult} from "@/lib/alt-text/chart-data-contract"
type Reviewed={sourceCurrent:boolean;result:ChartDataResult;analysisVersion:number;canReview:boolean;mappings:ChartDataResponse["mappings"]}
export function ChartDataSection(props:{assetId:number;occurrenceId:number|null;chartId:number;axesId:number}){
 const [open,setOpen]=useState(false)
 return <details className="mt-3 rounded border p-2" onToggle={(e)=>setOpen(e.currentTarget.open)}><summary className="cursor-pointer font-medium">Chart data labels and export</summary>{open&&<ChartDataPanel {...props}/>}</details>
}
export function ChartDataPanel({assetId,occurrenceId,chartId,axesId}:{assetId:number;occurrenceId:number|null;chartId:number;axesId:number}){
 const suffix=occurrenceId?`?occurrenceId=${occurrenceId}`:"",url=`/api/alt-text/assets/${assetId}/charts/${chartId}/axes/${axesId}/data${suffix}`
 const {data,error,mutate}=useSWR<ChartDataResponse>(url,altTextFetcher,{revalidateOnFocus:false,refreshInterval:(d)=>d?.activeJobs?3000:0})
 const latest=data?.results.find((r)=>r.result),detailUrl=latest?`/api/alt-text/assets/${assetId}/chart-data/${latest.id}${suffix}`:null
 const detail=useSWR<Reviewed>(detailUrl,altTextFetcher,{revalidateOnFocus:false})
 const [busy,setBusy]=useState(false),[message,setMessage]=useState<string|null>(null),[selected,setSelected]=useState<string>(""),pending=useRef<string|null>(null)
 async function extract(){setBusy(true);setMessage(null);pending.current??=crypto.randomUUID()
  try{const response=await fetch(url,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({requestId:pending.current,reprocess:!!data?.results.length})}),body=await response.json();if(!response.ok){if(response.status<500)pending.current=null;throw new Error(body.error??"Extraction could not start.")}pending.current=null;await mutate()}catch(e){setMessage(e instanceof Error?e.message:"Connection failed. Retry the same request.")}finally{setBusy(false)}
 }
 async function exportCsv(copy=false){if(!detailUrl)return;setMessage(null);try{const response=await fetch(`${detailUrl}${suffix?"&":"?"}format=csv`,{credentials:"same-origin"});if(!response.ok){const body=await response.json();throw new Error(body.error??"Export unavailable.")}const csv=await response.text();if(copy){await navigator.clipboard.writeText(csv);setMessage("Copied CSV with provenance and review warnings.")}else{const href=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"})),a=document.createElement("a");a.href=href;a.download=`chart-data-${latest!.id}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(href),1000)}}catch(e){setMessage(e instanceof Error?e.message:"Export failed.")}}
 if(error)return <p role="alert">Chart data evidence could not be loaded.</p>
 if(!data)return <p>Loading saved chart data…</p>
 const result=detail.data?.result,point=result?.points.find((p)=>p.id===selected)??result?.points[0],source=data.parent.chart.result.source
 return <div className="mt-3 space-y-3 text-xs">
  <p>Only visible labels explicitly confirmed as data values become Label Exact. Native source values and image estimates are unavailable. Dataset approval remains separate.</p>
  {data.policy.reason&&<p>{data.policy.reason}</p>}
  {data.canRun&&<Button size="sm" variant="outline" disabled={busy||data.activeJobs||!data.policy.enabled} onClick={extract}>{data.activeJobs?"Extraction queued or running…":busy?"Submitting…":"Extract reviewed label candidates"}</Button>}
  {data.results[0]?.errorCode&&<p role="alert">Extraction stopped: {data.results[0].errorCode}. Earlier versions remain available.</p>}
  {message&&<p role="status">{message}</p>}
  {detail.error&&<p role="alert">Reviewed data could not be loaded.</p>}
  {result&&<>
   <p>Analysis version {detail.data!.analysisVersion} · {result.points.length} candidates · needs review · dataset unapproved</p>
   {detail.data?.sourceCurrent?<svg role="img" aria-label="Original chart with selected data-label position; visual mark association unknown" viewBox={`${source.pixelBox.left} ${source.pixelBox.top} ${source.pixelBox.width} ${source.pixelBox.height}`} className="h-48 w-full rounded border bg-white"><image href={altTextImageUrl(assetId)} width={source.sourceWidth} height={source.sourceHeight}/>{point?.labelBox&&<rect x={point.labelBox.left} y={point.labelBox.top} width={point.labelBox.width} height={point.labelBox.height} fill="none" stroke="#2563eb" strokeWidth="2" vectorEffect="non-scaling-stroke"><title>Selected label: {point.sourceText}. This box is not a point/mark coordinate.</title></rect>}</svg>:<p role="alert">Historical evidence: source or reviewed labels changed. Refresh chart analysis; image overlay is hidden.</p>}
   <div className="max-h-60 overflow-auto"><table className="w-full text-left"><caption className="text-left">Visible label candidates; no missing values reconstructed</caption><thead><tr><th>Source label</th><th>Value</th><th>Series / category</th><th>Provenance</th></tr></thead><tbody>{result.points.map((p)=><tr key={p.id} className="border-t"><td><Button size="sm" variant={p.id===point?.id?"secondary":"ghost"} onClick={()=>setSelected(p.id)}>{p.sourceText}</Button></td><td>{p.value??"Unknown"} {p.unit}</td><td>{p.seriesName??"Unassigned"} / {p.category??"Unassigned"}</td><td>{p.classification.replaceAll("_"," ")} · {p.reviewState.replaceAll("_"," ")}</td></tr>)}</tbody></table></div>
   {point&&<><p>Candidate interpretation: {point.candidateValue} · OCR review #{point.sourceReview.id} v{point.sourceReview.version} · visual mark unknown · rounding: none</p>{point.warnings.map((w,i)=><p key={i}>{w}</p>)}{detail.data?.canReview&&detail.data.sourceCurrent&&<LabelDecision key={`${latest!.id}:${point.id}:${point.reviewReference?.version??0}`} point={point} mappings={detail.data.mappings} url={detailUrl!} saved={()=>detail.mutate()}/>}</>}
   <div className="flex gap-2"><Button size="sm" variant="outline" onClick={()=>exportCsv()}>Download CSV</Button><Button size="sm" variant="outline" onClick={()=>exportCsv(true)}>Copy CSV</Button></div>
   <details><summary>Warnings and grounded comparisons</summary>{result.warnings.map((w,i)=><p key={i}>{w}</p>)}{result.trends.map((t,i)=><p key={i}>{t.kind.replaceAll("_"," ")} · reviewed label values only · {t.pointIds.join(", ")}</p>)}</details>
  </>}
  <details><summary>Extraction history</summary>{data.results.map((r)=><details key={r.id}><summary>Version {r.version} · {r.status}</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(r.result??{error:r.errorCode},null,2)}</pre><p>Immutable extraction snapshot. Later label decisions are shown separately in the review view.</p></details>)}</details>
 </div>
}
function LabelDecision({point,mappings,url,saved}:{point:ChartDataPoint;mappings:Reviewed["mappings"];url:string;saved:()=>Promise<unknown>}){
 const [series,setSeries]=useState(point.seriesId?.replace(/^legend:/,"")??""),[category,setCategory]=useState(point.categoryLabelId??""),[axis,setAxis]=useState(point.axisId??""),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),pending=useRef<{body:string;id:string}|null>(null)
 async function decide(state:"confirmed_label"|"rejected"){
  const body={sourceLabelId:point.sourceLabelId,state,seriesLabelId:series||null,categoryLabelId:category||null,axisId:axis||null,comment:"",expectedVersion:point.reviewReference?.version??0},key=JSON.stringify(body)
  pending.current=pending.current?.body===key?pending.current:{body:key,id:crypto.randomUUID()};setBusy(true);setError(null)
  try{const response=await fetch(url,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({...body,requestId:pending.current.id})}),result=await response.json();if(!response.ok){if(response.status<500)pending.current=null;throw new Error(result.error??"Review could not be saved.")}pending.current=null;await saved()}catch(e){setError(e instanceof Error?e.message:"Save failed. Retry the same request.")}finally{setBusy(false)}
 }
 return <div className="space-y-2 rounded border p-2"><p>Select existing chart references, then confirm that this text is a visible data value. Number corrections must be made in OCR review first.</p>{([{name:"Series",value:series,set:setSeries,options:mappings.seriesLabels},{name:"Category",value:category,set:setCategory,options:mappings.categories},{name:"Value axis",value:axis,set:setAxis,options:mappings.axes.map((a)=>({id:a.id,text:`${a.role} (${a.unit??"unknown unit"})`}))}]).map((field)=><label key={field.name} className="block">{field.name}<select disabled={busy} className="ml-2 max-w-full rounded border bg-background p-1" value={field.value} onChange={(e)=>field.set(e.target.value)}><option value="">Unknown / unassigned</option>{field.options.map((o)=><option key={o.id} value={o.id}>{o.text}</option>)}</select></label>)}<p>Selections are saved only when a decision button is pressed.</p><div className="flex gap-2"><Button size="sm" disabled={busy} onClick={()=>decide("confirmed_label")}>Confirm visible data label</Button><Button size="sm" variant="outline" disabled={busy} onClick={()=>decide("rejected")}>Reject as data label</Button></div>{error&&<p role="alert">{error}</p>}</div>
}
