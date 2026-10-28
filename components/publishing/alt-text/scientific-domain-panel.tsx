"use client"
import {useRef,useState} from "react"
import useSWR from "swr"
import {Button} from "@/components/ui/button"
import {altTextFetcher} from "@/lib/alt-text/client"
import type {DomainNotation} from "@/lib/alt-text/scientific-domain-contract"
import type {ScientificDomainResponse} from "@/lib/alt-text/scientific-domain-service"
export function ScientificDomainSection(props:{assetId:number;occurrenceId:number|null;parentId:number;onSelectElement?:(id:string)=>void}){
 const [open,setOpen]=useState(false)
 return <details className="mt-3 rounded border p-2" onToggle={(e)=>setOpen(e.currentTarget.open)}><summary className="cursor-pointer font-medium">Chemistry, physics, biology and geometry evidence</summary>{open&&<ScientificDomainPanel {...props}/>}</details>
}
export function ScientificDomainPanel({assetId,occurrenceId,parentId,onSelectElement}:{assetId:number;occurrenceId:number|null;parentId:number;onSelectElement?:(id:string)=>void}){
 const url=`/api/alt-text/assets/${assetId}/scientific-structure/${parentId}/domain${occurrenceId?`?occurrenceId=${occurrenceId}`:""}`
 const {data,error,mutate}=useSWR<ScientificDomainResponse>(url,altTextFetcher,{revalidateOnFocus:false,refreshInterval:(d)=>d?.activeJobs?3000:0})
 const [version,setVersion]=useState(""),[selected,setSelected]=useState(""),[tab,setTab]=useState("Evidence"),[confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState<string|null>(null),pending=useRef<{key:string;id:string}|null>(null)
 const record=data?.results.find((r)=>String(r.id)===version)??data?.results[0],result=record?.result,observation=result?.observations.find((o)=>o.id===selected)??result?.observations[0]
 async function analyze(){const key=String(data?.results[0]?.id??0);pending.current=pending.current?.key===key?pending.current:{key,id:crypto.randomUUID()};setBusy(true);setMessage(null)
  try{const response=await fetch(url,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({requestId:pending.current.id,reprocess:!!data?.results.length})}),body=await response.json();if(!response.ok){if(response.status<500)pending.current=null;setMessage(body.error??"Subject analysis could not start.");return}pending.current=null;setConfirm(false);setVersion("");await mutate()}catch{setMessage("Connection failed. Retry to check the same request.")}finally{setBusy(false)}
 }
 if(error)return <p role="alert">Scientific subject evidence could not be loaded.</p>
 if(!data)return <p>Loading saved subject evidence…</p>
 return <section aria-label="Scientific subject evidence inspector" className="mt-3 space-y-2 text-xs">
  <p>Subject-specific visual hints and literal notation need review. This does not solve questions, validate chemistry, simulate circuits, diagnose disease or prove geometry.</p>
  <p>Enabled subjects: {data.policy.options.subjects.join(", ")||"none"}</p>
  {data.policy.reason&&<p>{data.policy.reason}</p>}
  {!data.sourceMatchesCurrent&&<p role="alert">Historical image, region or OCR evidence. Refresh scientific structure before submitting another analysis.</p>}
  {data.canRun&&<Button size="sm" variant="outline" disabled={busy||!data.policy.enabled||!data.sourceMatchesCurrent||data.activeJobs} onClick={()=>setConfirm(true)}>{data.activeJobs?"Subject analysis queued or running…":"Analyze subject evidence"}</Button>}
  {confirm&&<div role="dialog" aria-label="Confirm scientific subject analysis" className="rounded border p-3"><p>The selected diagram crop, associated source labels, saved equations and eligible document context will be sent to your authorized vision provider. This may use AI credits. All scientific claims remain unverified.</p><div className="mt-2 flex gap-2"><Button size="sm" disabled={busy} onClick={analyze}>{busy?"Submitting…":"Confirm subject analysis"}</Button><Button size="sm" variant="outline" disabled={busy} onClick={()=>setConfirm(false)}>Back</Button></div></div>}
  {message&&<p role="alert">{message}</p>}
  {data.results.length>0&&<label>Subject analysis history<select className="ml-2 max-w-full rounded border bg-background p-1" value={record?.id} onChange={(e)=>{setVersion(e.target.value);setSelected("")}}>{data.results.map((r)=><option key={r.id} value={r.id}>Version {r.version} · {r.status}</option>)}</select></label>}
  {record?.errorCode&&<p role="alert">{record.errorCode==="PAID_RESULT_UNAVAILABLE"?"A billed result needs administrator reconciliation; another provider request will not run automatically.":`Analysis stopped: ${record.errorCode}`}</p>}
  {result&&<>
   <p>Subject candidates: {result.detectedSubjects.join(", ")||"unknown"}{result.ambiguousSubjects?" · ambiguous":""} · {result.observations.length} visual/inference candidates · scientific accuracy unverified</p>
   {!!result.observations.length&&<label>Selected claim<select className="mt-1 w-full rounded border bg-background p-1" value={observation?.id} onChange={(e)=>setSelected(e.target.value)}>{result.observations.map((o,i)=><option key={o.id} value={o.id}>{i+1} · {o.subject} · {o.kind.replaceAll("_"," ")}</option>)}</select></label>}
   <div className="flex flex-wrap gap-1">{["Evidence","Notation","Equations","Warnings"].map((t)=><Button size="sm" key={t} variant={tab===t?"secondary":"ghost"} onClick={()=>setTab(t)}>{t}</Button>)}</div>
   <div className="max-h-72 space-y-2 overflow-auto rounded border p-2">
    {tab==="Evidence"&&(observation?<><p>{observation.basis.replaceAll("_"," ")} · review required · no calibrated confidence</p>{onSelectElement&&<Button size="sm" variant="outline" onClick={()=>onSelectElement(observation.elementIds[0])}>Locate source component</Button>}<p className="break-all">Components: {observation.elementIds.join(", ")}<br/>Relationships: {observation.relationshipIds.join(", ")||"none"}<br/>Equation evidence: {observation.equationIds.join(", ")||"none"}</p>{observation.sourceLabels.map((l)=><p key={l.key} className="whitespace-pre-wrap break-words">{l.text}<br/><span className="text-muted-foreground">{l.designation.replaceAll("_"," ")} #{l.sourceId} v{l.version} · {l.sourceTextVerified?"text transcription verified; scientific claim unverified":l.reviewState}</span></p>)}{observation.warnings.map((w,i)=><p key={i}>{w}</p>)}<details><summary>Saved document context and category hints</summary><p>Category: {result.support.classification?.primaryCategory??"unavailable"} · {result.support.classification?.basis??"no classification"}</p>{result.support.context?.items.map((c,i)=><p key={i} className="whitespace-pre-wrap break-words">{c.text}<br/>{c.provenance} · {c.sourceKind} · {c.sourceRef}</p>)??<p>No eligible document context. Guidelines are optional.</p>}</details></>:<p>No compatible subject claims were resolved. Source labels and equations remain separate evidence.</p>)}
    {tab==="Notation"&&(result.notations.length?result.notations.map((n,i)=><details key={i} open={result.notations.length===1}><summary>{n.subject} · {n.kind.replaceAll("_"," ")} · {n.originalText}</summary><NotationDetails notation={n}/>{n.warnings.map((w,j)=><p key={j}>{w}</p>)}<p>Text transcription: {n.sourceTextVerified?"verified":"unverified"}. Scientific correctness: unverified.</p></details>):<p>No supported source notation was associated with the saved claims.</p>)}
    {tab==="Equations"&&(result.support.equations.length?result.support.equations.map((e)=><div key={e.id}><p>Equation #{e.id} v{e.version} · region {e.regionId} · syntax: {e.syntaxStatus??"not validated"} · review: {e.reviewState??"not reviewed"}</p><pre className="whitespace-pre-wrap break-all">{e.originalLatex}</pre>{e.reviewedLatex!=null&&<><p>Saved human correction #{e.reviewId} v{e.reviewVersion} · {e.reviewState}</p><pre className="whitespace-pre-wrap break-all">{e.reviewedLatex}</pre></>}<p>Scientific correctness remains unverified.</p></div>):<p>No saved equations match this exact image, region analysis and occurrence. Run equation OCR/validation separately when needed.</p>)}
    {tab==="Warnings"&&result.warnings.map((w,i)=><p key={i}>{w}</p>)}
   </div>
   <p className="break-all text-muted-foreground">Structure evidence #{result.parentStructureEvidenceId} v{result.parentStructureVersion} · {result.modelId} · {result.createdAt}</p>
  </>}
 </section>
}

function NotationDetails({notation}:{notation:DomainNotation}){
 const d=notation.details
 if(notation.kind==="chemical_notation"){
  const tokens=(d.tokens??[]) as {symbol:string;count:number;raw:string}[],charge=d.charge as {raw:string;magnitude:number|null;sign:string;ambiguous:boolean}|null,arrows=(d.arrows??[]) as {raw:string}[]
  return <div className="space-y-1"><p>Symbol/count check: {d.status==="recognized_lexically"?"supported spelling and notation":d.status==="ambiguous"?"ambiguous charge/count placement — review required":d.status==="reaction_notation_only"?"printed reaction notation only":"unsupported notation — review required"}</p>{d.status==="recognized_lexically"&&<p>Printed tokens: {tokens.map((t)=>`${t.raw} (${t.symbol}, count ${t.count})`).join("; ")}. Counts within grouped formulas are not expanded.</p>}{charge&&<p>Charge marker: {charge.raw} · magnitude {charge.magnitude??"unresolved"} · sign {charge.sign}. Chemical validity remains unverified.</p>}{!!arrows.length&&<p>Printed arrows: {arrows.map((a)=>a.raw).join(" ")}. No reaction balancing or product identity was inferred.</p>}</div>
 }
 if(notation.kind==="measurement_notation"){
  const scalar=d.scalar as {value:number|null;unit:string|null;kind:string}
  return <p>Numeric label: {scalar.value??"unresolved"} · unit text: {scalar.unit??"unresolved"}. Unit validity and physical measurement are unverified.</p>
 }
 if(notation.kind==="geometry_notation"){
  const markers=(d.literalMarkers??[]) as {raw:string}[],coordinate=d.coordinate as {raw:string}|null
  return <p>Printed markers: {markers.map((m)=>m.raw).join(" ")||"none identified"}{coordinate?` · coordinate label: ${coordinate.raw}`:""}. No proof or unmarked equality is inferred.</p>
 }
 return <p>Literal source label only; scientific identity and function remain unverified.</p>
}
