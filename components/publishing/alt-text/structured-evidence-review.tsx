"use client"
import {useEffect,useId,useRef,useState} from "react"
import useSWR from "swr"
import {Button} from "@/components/ui/button"
import {altTextFetcher} from "@/lib/alt-text/client"
import {isValidNormalizedBox} from "@/lib/alt-text/region-analysis"
import {EVIDENCE_REVIEW_STATES,validateStructuredCorrections,type StructuredReviewKind,type StructuredTarget,type StructuredCorrection,type StructuredReviewInput,type StructuredReviewVersion} from "@/lib/alt-text/structured-review-contract"

export type StructuredReviewDetail={success:true;assetId:number;occurrenceId:number|null;kind:StructuredReviewKind;evidenceId:number;sourceVersion:number;sourceRegionId:string;sourceFingerprint:string;sourceCurrent:boolean;canEdit:boolean;canVerify:boolean;targets:StructuredTarget[];warnings:string[];location:string|null;previewUrl:string;history:StructuredReviewVersion[]}
const control="w-full rounded border bg-background p-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
const label=(s:string)=>s.replaceAll("_"," ")
function initialValue(t:StructuredTarget):StructuredCorrection["value"]{
 if(t.kind==="axis")return {label:"",unit:null}
 if(t.kind==="point")return {value:null,unit:null,seriesId:null,classification:"unknown",precisionNote:""}
 if(t.kind==="relationship")return {from:null,to:null,relationship:"unknown",direction:"unknown"}
 if(t.kind==="association")return {targetIds:[],designation:"unknown"}
 return {text:"",designation:"human_correction"}
}
function CorrectionFields({target,value,onChange,disabled,id}:{target:StructuredTarget;value:StructuredCorrection["value"];onChange:(v:StructuredCorrection["value"])=>void;disabled:boolean;id:string}){
 const v=value as any,patch=(p:object)=>onChange({...v,...p})
 const field=(name:string,title:string,props:React.InputHTMLAttributes<HTMLInputElement>={})=><label className="grid gap-1 text-xs" key={name} htmlFor={`${id}-${name}`}>{title}<input {...props} id={`${id}-${name}`} className={control} disabled={disabled} value={v[name]??""} onChange={e=>patch({[name]:name==="unit"?e.target.value||null:e.target.value})}/></label>
 if(target.kind==="axis")return <>{field("label","Corrected axis label",{maxLength:600})}{field("unit","Printed or reviewed unit (empty = unknown)",{maxLength:40})}</>
 if(target.kind==="point")return <>
  <label className="grid gap-1 text-xs">Value provenance<select className={control} disabled={disabled} value={v.classification} onChange={e=>patch({classification:e.target.value,...(e.target.value==="unknown"?{value:null}:{})})}>{["unknown","human_source_transcription","manual_estimate"].map(s=><option key={s} value={s}>{label(s)}</option>)}</select></label>
  <label className="grid gap-1 text-xs">Corrected number (empty = unknown)<input className={control} type="number" step="any" disabled={disabled||v.classification==="unknown"} value={v.value??""} onChange={e=>patch({value:e.target.value===""?null:Number(e.target.value)})}/></label>
  {field("unit","Unit",{maxLength:40})}{field("precisionNote","Precision / uncertainty note",{maxLength:200})}
  <label className="grid gap-1 text-xs">Series<select className={control} disabled={disabled} value={v.seriesId??""} onChange={e=>patch({seriesId:e.target.value||null})}><option value="">Unknown</option>{target.seriesIds?.map(s=><option key={s}>{s}</option>)}</select></label>
 </>
 if(target.kind==="relationship")return <>
  {["from","to"].map(k=><label key={k} className="grid gap-1 text-xs">{k==="from"?"From element":"To element"}<select className={control} disabled={disabled} value={v[k]??""} onChange={e=>patch({[k]:e.target.value||null})}><option value="">Unknown</option>{target.members?.map(m=><option key={m.id}>{m.id}</option>)}</select></label>)}
  {[["relationship",["connected_to","points_to","part_of","contains","spatial","unknown"]],["direction",["from_to","to_from","both","unknown"]]].map(([k,values])=><label key={String(k)} className="grid gap-1 text-xs">{label(String(k))}<select className={control} disabled={disabled} value={v[String(k)]} onChange={e=>patch({[String(k)]:e.target.value})}>{(values as string[]).map(s=><option key={s}>{s}</option>)}</select></label>)}
 </>
 if(target.kind==="association")return <><p className="text-xs">Choose existing targets for this label. Empty selection means unknown.</p>{target.members?.map(m=><label key={m.id} className="flex gap-2 text-xs"><input type="checkbox" disabled={disabled} checked={v.targetIds.includes(m.id)} onChange={e=>{const ids=e.target.checked?[...v.targetIds,m.id]:v.targetIds.filter((i:string)=>i!==m.id);patch({targetIds:ids,designation:ids.length?"human_correction":"unknown"})}}/>{m.id}</label>)}</>
 return <><label className="grid gap-1 text-xs" htmlFor={`${id}-text`}>Human correction / terminology<textarea id={`${id}-text`} className={control} rows={6} maxLength={2000} disabled={disabled||v.designation==="unknown"} value={v.text} onChange={e=>patch({text:e.target.value})}/></label><label className="flex gap-2 text-xs"><input type="checkbox" disabled={disabled} checked={v.designation==="unknown"} onChange={e=>patch({designation:e.target.checked?"unknown":"human_correction",...(e.target.checked?{text:""}:{})})}/>Unknown / unreadable</label></>
}
export function StructuredEvidenceReview({assetId,occurrenceId=null,kind,evidenceId,onDirtyChange}:{assetId:number;occurrenceId?:number|null;kind:StructuredReviewKind;evidenceId:number;onDirtyChange?:(v:boolean)=>void}){
 const url=`/api/alt-text/assets/${assetId}/evidence-review?kind=${kind}&evidenceId=${evidenceId}${occurrenceId?`&occurrenceId=${occurrenceId}`:""}`
 const {data,error,mutate}=useSWR<StructuredReviewDetail>(url,altTextFetcher,{revalidateOnFocus:false,revalidateIfStale:false})
 const [draft,setDraft]=useState<StructuredCorrection[]>([]),[comment,setComment]=useState(""),[state,setState]=useState<StructuredReviewInput["state"]>("needs_review"),[version,setVersion]=useState(0),[baseline,setBaseline]=useState(""),[selected,setSelected]=useState(""),[mobile,setMobile]=useState("editor"),[busy,setBusy]=useState(false),[message,setMessage]=useState("")
 const loaded=useRef(false),pending=useRef<{key:string;id:string}|null>(null),targetSelect=useRef<HTMLSelectElement>(null),uid=useId()
 const snapshot=JSON.stringify([draft,comment,state]),dirty=baseline!==""&&snapshot!==baseline
 function adopt(fresh:StructuredReviewDetail){const previous=fresh.history[0],latest=previous?.sourceFingerprint===fresh.sourceFingerprint?previous:undefined,corrections=latest?.corrections??[],reason=latest?.comment??"",status=latest?.state??"needs_review";setDraft(corrections);setComment(reason);setState(status);setVersion(previous?.version??0);setBaseline(JSON.stringify([corrections,reason,status]))}
 useEffect(()=>{if(data&&!loaded.current){loaded.current=true;adopt(data);setSelected(data.targets[0]?.id??"")}},[data])
 useEffect(()=>{onDirtyChange?.(dirty);return()=>onDirtyChange?.(false)},[dirty,onDirtyChange])
 useEffect(()=>{if(!dirty)return;const guard=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue=""};window.addEventListener("beforeunload",guard);return()=>window.removeEventListener("beforeunload",guard)},[dirty])
 const target=data?.targets.find(t=>t.id===selected),correction=draft.find(c=>c.targetId===selected),value=correction?.value??(target?initialValue(target):{text:"",designation:"unknown" as const})
 function change(v:StructuredCorrection["value"]){setDraft(old=>[...old.filter(c=>c.targetId!==selected),{targetId:selected,value:v}])}
 async function reload(){if(dirty&&!window.confirm("Discard unsaved evidence corrections and load the latest version?"))return;const fresh=await mutate();if(fresh)adopt(fresh);setMessage("")}
 async function save(){
  if(!data||busy)return
  const input:StructuredReviewInput={kind,evidenceId,occurrenceId,sourceFingerprint:data.sourceFingerprint,expectedVersion:version,requestId:"pending_save",state,comment,corrections:draft},invalid=validateStructuredCorrections(input,data.targets)
  if(invalid){setMessage(invalid);return}
  const key=JSON.stringify(input),requestId=pending.current?.key===key?pending.current.id:crypto.randomUUID();pending.current={key,id:requestId};setBusy(true);setMessage("")
  try{const response=await fetch(`/api/alt-text/assets/${assetId}/evidence-review`,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({...input,requestId})}),body=await response.json();if(!response.ok){if(response.status<500)pending.current=null;setMessage(body.error??"Correction could not be saved.");return}pending.current=null;setVersion(body.record.version);setBaseline(snapshot);await mutate();setMessage("Evidence review saved. Final description approval is unchanged.")}
  catch{setMessage("Connection failed. Retry to check the same save request.")}finally{setBusy(false)}
 }
 if(error)return <p role="alert">Evidence could not be loaded. Check access and the selected source occurrence.</p>
 if(!data)return <p role="status">Loading selected evidence…</p>
 const disabled=!data.canEdit||busy
 return <section className="space-y-3" aria-label="Evidence correction workspace">
  <div className="flex flex-wrap items-center gap-2 text-xs"><strong>{label(kind)} #{evidenceId}</strong><span>Source v{data.sourceVersion} · review v{version} · {data.location??"Standalone image"}</span>{dirty&&<span role="status">Unsaved corrections</span>}<Button size="sm" variant="outline" disabled={busy} onClick={()=>void reload()}>Reload latest review</Button></div>
  <div className="flex gap-2 lg:hidden" role="group" aria-label="Review workspace sections">{["image","editor","inspector"].map(tab=><Button size="sm" key={tab} aria-pressed={mobile===tab} variant={mobile===tab?"secondary":"outline"} onClick={()=>setMobile(tab)}>{label(tab)}</Button>)}</div>
  <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,.85fr)]">
   <div className={`${mobile==="image"?"block":"hidden"} min-w-0 space-y-2 lg:block`}>
    <h4 className="text-sm font-semibold">Source image · selectable evidence</h4>
    <div className="relative w-full"><img src={data.previewUrl} alt="Original source image for evidence review; use the named region controls to select evidence." className="block h-auto w-full rounded border"/>{data.targets.filter(t=>t.box&&isValidNormalizedBox(t.box)).map(t=><button key={t.id} type="button" aria-label={`Select ${t.label}`} aria-pressed={selected===t.id} onClick={()=>{setSelected(t.id);setMobile("editor");requestAnimationFrame(()=>targetSelect.current?.focus())}} className={`absolute border-2 ${selected===t.id?"border-blue-700 bg-blue-100/30":"border-slate-600"} focus-visible:outline focus-visible:outline-4 focus-visible:outline-ring`} style={{left:`${t.box!.x*100}%`,top:`${t.box!.y*100}%`,width:`${t.box!.width*100}%`,height:`${t.box!.height*100}%`}}><span className="sr-only">{t.label}</span></button>)}</div>
    <p className="text-xs text-muted-foreground">Region positions are estimates. Keyboard users can select the same targets from the editor list.</p>
   </div>
   <div className={`${mobile==="editor"?"block":"hidden"} min-w-0 space-y-3 lg:block`}>
    <label className="grid gap-1 text-xs">Selected evidence<select ref={targetSelect} className={control} value={selected} onChange={e=>setSelected(e.target.value)}>{data.targets.map(t=><option key={t.id} value={t.id}>{t.label}{draft.some(c=>c.targetId===t.id)?" · corrected":""}</option>)}</select></label>
    {target?<><CorrectionFields id={uid} target={target} value={value} disabled={disabled} onChange={change}/><Button size="sm" variant="outline" disabled={disabled} onClick={()=>setDraft(old=>old.filter(c=>c.targetId!==selected))}>Remove selected correction</Button></>:<p>No editable targets in this source.</p>}
    <label className="grid gap-1 text-xs">Review status<select className={control} disabled={disabled} value={state} onChange={e=>setState(e.target.value as typeof state)}>{EVIDENCE_REVIEW_STATES.map(s=><option key={s} value={s} disabled={s==="verified"&&!data.canVerify}>{label(s)}</option>)}</select></label>
    <label className="grid gap-1 text-xs">Reason / review comment<textarea className={control} rows={3} maxLength={1000} disabled={disabled} value={comment} onChange={e=>setComment(e.target.value)}/></label>
    <Button size="sm" disabled={disabled||!dirty} onClick={()=>void save()}>{busy?"Saving…":"Save evidence review"}</Button>
    {!data.sourceCurrent&&<p role="alert" className="text-sm">Historical source is read-only. Refresh its analysis before making corrections.</p>}
    {message&&<p role="status" className="text-sm">{message}</p>}
   </div>
   <aside className={`${mobile==="inspector"?"block":"hidden"} min-w-0 space-y-3 lg:block`} aria-label="Raw evidence, warnings and review versions">
    <h4 className="text-sm font-semibold">Immutable raw evidence</h4><pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded border bg-muted/30 p-2 text-xs">{JSON.stringify(target?.raw??null,null,2)}</pre>
    {target?.reviewContext!=null&&<details className="rounded border p-2 text-xs"><summary className="cursor-pointer">Current label-role review (separate from original)</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(target.reviewContext,null,2)}</pre></details>}<h4 className="text-sm font-semibold">Quality warnings</h4><ul className="list-disc space-y-1 pl-4 text-xs">{data.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul>
    <h4 className="text-sm font-semibold">Review versions</h4>{data.history.length?data.history.map(r=><details key={r.id} className="rounded border p-2 text-xs"><summary className="cursor-pointer">v{r.version} · {label(r.state)} · reviewer #{r.reviewerId}{r.sourceFingerprint!==data.sourceFingerprint?" · historical source":""}</summary><p>{r.createdAt}</p><p className="whitespace-pre-wrap">{r.comment}</p><pre className="max-h-44 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(r.corrections,null,2)}</pre></details>):<p className="text-xs">No review saved.</p>}
   </aside>
  </div>
 </section>
}
