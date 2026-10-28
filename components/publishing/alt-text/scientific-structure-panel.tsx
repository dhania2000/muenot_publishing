"use client"
import {ScientificDomainSection} from "./scientific-domain-panel"
import {useRef,useState} from "react"
import useSWR from "swr"
import {Button} from "@/components/ui/button"
import {altTextFetcher,altTextImageUrl} from "@/lib/alt-text/client"
import type {ScientificStructureResponse} from "@/lib/alt-text/scientific-structure-service"
export function ScientificStructureSection(props:{assetId:number;occurrenceId?:number|null}){
 const [open,setOpen]=useState(false)
 return <details className="border-t pt-3" onToggle={(e)=>setOpen(e.currentTarget.open)}><summary className="cursor-pointer text-sm font-semibold">Scientific diagram components and connections</summary>{open&&<ScientificStructurePanel {...props}/>}</details>
}
export function ScientificStructurePanel({assetId,occurrenceId=null}:{assetId:number;occurrenceId?:number|null}){
 const url=`/api/alt-text/assets/${assetId}/scientific-structure${occurrenceId?`?occurrenceId=${occurrenceId}`:""}`
 const {data,error,mutate}=useSWR<ScientificStructureResponse>(url,altTextFetcher,{revalidateOnFocus:false,refreshInterval:(d)=>d?.activeJobs?3000:0})
 const [selected,setSelected]=useState(""),[version,setVersion]=useState(""),[element,setElement]=useState(""),[tab,setTab]=useState("Component"),[confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState<string|null>(null),pending=useRef(new Map<string,string>())
 const region=data?.regions.find((r)=>r.id===selected)??data?.regions[0],history=data?.results.filter((r)=>r.regionId===region?.id)??[],record=history.find((r)=>String(r.id)===version)??history[0],result=record?.result,node=result?.elements.find((e)=>e.id===element)??result?.elements[0],sameFrame=record?.sourceMatchesCurrent===true&&result?.regionAnalysisId===region?.analysisId
 async function analyze(){if(!region)return;const key=`${region.analysisId}:${region.id}:${history[0]?.id??0}`,requestId=pending.current.get(key)??crypto.randomUUID();pending.current.set(key,requestId);setBusy(true);setMessage(null)
  try{const response=await fetch(url,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({requestId,occurrenceId,analysisId:region.analysisId,regionId:region.id,reprocess:!!history.length})}),body=await response.json();if(!response.ok){if(response.status<500)pending.current.delete(key);setMessage(body.error??"Diagram analysis could not start.");return}pending.current.delete(key);setConfirm(false);setVersion("");await mutate()}catch{setMessage("Connection failed. Retry to check the same request.")}finally{setBusy(false)}
 }
 if(error)return <p role="alert" className="text-xs">Scientific structure evidence could not be loaded.</p>
 if(!data)return <p className="text-xs">Loading saved diagram evidence…</p>
 return <section className="mt-3 space-y-3 text-xs" aria-label="Scientific diagram structure inspector">
  <p>General visual components and candidate relationships need review. Scientific identities and accuracy are unverified.</p>
  {data.reason&&<p>{data.reason}</p>}
  {data.regions.length?<label>Diagram region<select className="ml-2 max-w-full rounded border bg-background p-1" value={region?.id} disabled={busy} onChange={(e)=>{setSelected(e.target.value);setVersion("");setElement("");setConfirm(false)}}>{data.regions.map((r,i)=><option key={r.id} value={r.id}>Diagram {i+1}{r.parentId?" · nested":""}</option>)}</select></label>:<p>Run region detection to locate an individual scientific diagram and its components, text and connectors first.</p>}
  {!result&&region&&<svg className="h-40 w-full rounded border bg-white" viewBox={`${region.box.x*region.sourceWidth} ${region.box.y*region.sourceHeight} ${region.box.width*region.sourceWidth} ${region.box.height*region.sourceHeight}`} role="img" aria-label="Selected scientific diagram crop"><image href={altTextImageUrl(assetId)} width={region.sourceWidth} height={region.sourceHeight}/></svg>}
  {data.canRun&&region&&<Button size="sm" variant="outline" disabled={busy||data.activeJobs||!data.enabled||!region.eligible} onClick={()=>setConfirm(true)}>{data.activeJobs?"Diagram analysis queued or running…":"Analyze diagram structure"}</Button>}
  {confirm&&<div role="dialog" aria-label="Confirm scientific diagram analysis" className="rounded border p-3"><p>This explicit request sends the selected crop and associated OCR evidence to your authorized vision provider and may use AI credits. Results require review.</p><div className="mt-2 flex gap-2"><Button size="sm" disabled={busy} onClick={analyze}>{busy?"Submitting…":"Confirm diagram analysis"}</Button><Button size="sm" variant="outline" disabled={busy} onClick={()=>setConfirm(false)}>Back</Button></div></div>}
  {message&&<p role="alert">{message}</p>}
  {!!history.length&&<label>Analysis history<select className="ml-2 max-w-full rounded border bg-background p-1" value={record?.id} onChange={(e)=>{setVersion(e.target.value);setElement("")}}>{history.map((r)=><option key={r.id} value={r.id}>Version {r.version} · {r.status}</option>)}</select></label>}
  {record?.errorCode&&<p role="alert">{record.errorCode==="PAID_RESULT_UNAVAILABLE"?"A billed result requires administrator reconciliation; it will not be automatically billed again.":`Analysis stopped: ${record.errorCode}`}</p>}
  {result&&<>
   <p>{result.elements.length} elements · {result.relationships.length} candidate relationships · source analysis {result.regionAnalysisId} · review required</p>
   <div className="grid gap-3 md:grid-cols-2">
    <div>{sameFrame?<svg className="h-64 w-full rounded border bg-white" viewBox={`${result.source.pixelBox.left} ${result.source.pixelBox.top} ${result.source.pixelBox.width} ${result.source.pixelBox.height}`} role="img" aria-label="Scientific diagram with estimated component regions"><image href={altTextImageUrl(assetId)} width={result.source.sourceWidth} height={result.source.sourceHeight}/>{result.elements.filter((e)=>e.kind!=="diagram").map((e)=><rect key={e.id} x={e.box.x*result.source.sourceWidth} y={e.box.y*result.source.sourceHeight} width={e.box.width*result.source.sourceWidth} height={e.box.height*result.source.sourceHeight} fill="none" stroke={e.id===node?.id?"#2563eb":"#64748b"} strokeWidth={e.id===node?.id?2:1} strokeDasharray="4 2" vectorEffect="non-scaling-stroke"><title>{e.kind} · estimated position · {e.regionId}</title></rect>)}</svg>:<p role="alert">Historical region analysis. Refresh the diagram's region evidence before comparing overlays with the current image.</p>}<p className="mt-1">Boxes are estimated regions. Arrow endpoints and scientific identities are not verified.</p></div>
    <div className="max-h-80 space-y-2 overflow-auto rounded border p-2">
     <label>Selected element<select className="mt-1 w-full rounded border bg-background p-1" value={node?.id} onChange={(e)=>setElement(e.target.value)}>{result.elements.map((e,i)=><option key={e.id} value={e.id}>{i+1} · {e.kind.replaceAll("_"," ")} · {e.sourceText[0]?.text.slice(0,60)??e.visualRole.replaceAll("_"," ")}</option>)}</select></label>
     <div className="flex flex-wrap gap-1">{["Component","Labels","Relationships","Warnings"].map((t)=><Button size="sm" key={t} variant={tab===t?"secondary":"ghost"} onClick={()=>setTab(t)}>{t}</Button>)}</div>
     {tab==="Component"&&node&&<><p>{node.kind.replaceAll("_"," ")} · visual role: {node.visualRole.replaceAll("_"," ")}</p><p>Scientific identity: unknown. Human review required.</p><p className="break-all">Source region: {node.regionId}<br/>Panel: {node.panelRegionId}<br/>Parent element: {node.parentElementId??"none in selected diagram"}</p>{node.sourceText.map((t,i)=><p key={i} className="whitespace-pre-wrap break-words">{t.text}<br/><span className="text-muted-foreground">{t.designation.replaceAll("_"," ")} #{t.id} v{t.version} · {t.state}</span></p>)}</>}
     {tab==="Labels"&&(result.labelAssociations.filter((a)=>a.labelElementId===node?.id||a.candidateElementIds.includes(node?.id??"")).map((a)=><p key={a.id} className="break-all">Label {a.labelRegionId} → candidates: {a.targetRegionIds.join(", ")}<br/>Evidence: {a.basis.replaceAll("_"," ")}{a.connectorRegionId?` · connector ${a.connectorRegionId}`:""} · uncertain, review required</p>))}
     {tab==="Relationships"&&result.relationships.filter((r)=>r.fromElementId===node?.id||r.toElementId===node?.id).map((r)=><p key={r.id} className="break-all">{r.fromRegionId} → {r.toRegionId}: {r.type.replaceAll("_"," ")}<br/>{r.basis.replaceAll("_"," ")} · arrowhead: {r.arrowhead.replaceAll("_"," ")} · unverified visual relationship</p>)}
     {tab==="Warnings"&&result.warnings.map((w,i)=><p key={i}>{w}</p>)}
    </div>
   </div>
   <ScientificDomainSection key={record!.id} assetId={assetId} occurrenceId={occurrenceId} parentId={record!.id} onSelectElement={setElement}/>
   <p className="break-all text-muted-foreground">{result.modelId} · {result.createdAt} · original document unchanged</p>
  </>}
 </section>
}
