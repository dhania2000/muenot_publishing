"use client"
import {useRef,useState} from "react"
import useSWR from "swr"
import {Button} from "@/components/ui/button"
import {altTextFetcher,altTextImageUrl} from "@/lib/alt-text/client"
import type {MathResponse} from "@/lib/alt-text/math-contract"

/** Read saved evidence on mount; inference requires an explicit action for one equation region. */
export function MathRecognitionPanel({assetId,occurrenceId=null}:{assetId:number;occurrenceId?:number|null}){
 const url=`/api/alt-text/assets/${assetId}/math${occurrenceId?`?occurrenceId=${occurrenceId}`:""}`
 const {data,error,mutate}=useSWR<MathResponse>(url,altTextFetcher,{revalidateOnFocus:false,refreshInterval:(d)=>d?.activeJobs?3000:0})
 const [selected,setSelected]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState<string|null>(null)
 const pending=useRef(new Map<string,string>())
 const region=data?.regions.find((r)=>r.id===selected)??data?.regions[0]
 async function run(reprocess:boolean){
  if(!region)return
  const key=`${region.analysisId}:${region.id}:${reprocess}`,requestId=pending.current.get(key)??crypto.randomUUID()
  pending.current.set(key,requestId);setBusy(true);setMessage(null)
  try{
   const response=await fetch(url,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({requestId,occurrenceId,regionId:region.id,analysisId:region.analysisId,reprocess})})
   const body=await response.json()
   if(!response.ok){if(response.status<500)pending.current.delete(key);setMessage(body.error??"Recognition could not start.");return}
   pending.current.delete(key);await mutate()
  }catch{setMessage("Connection failed. Retry to check the same request.")}finally{setBusy(false)}
 }
 const latest=data?.results.find((r)=>r.regionId===region?.id)
 return <section className="flex flex-col gap-3 border-t pt-4" aria-label="Mathematical equation recognition">
  <h3 className="text-sm font-semibold">Mathematical equations</h3>
  <p className="text-xs text-muted-foreground">Local recognition produces an unverified LaTeX candidate. Compare every symbol with the source before using it.</p>
  {error?<p role="alert" className="text-sm text-destructive">Could not load equation evidence.</p>:!data?<p className="text-sm">Loading saved evidence…</p>:<>
   {data.reason&&<p className="text-xs text-muted-foreground">{data.reason}</p>}
   {!data.regions.length?<p className="text-sm">Run image region detection to identify an equation first.</p>:<>
    <label className="flex flex-col gap-1 text-xs">Equation region
     <select className="rounded border bg-background p-2" value={region?.id??""} onChange={(e)=>setSelected(e.target.value)}>{data.regions.map((r)=><option key={r.id} value={r.id}>{r.label}</option>)}</select>
    </label>
    {region&&<svg viewBox={`${region.box.x} ${region.box.y} ${region.box.width} ${region.box.height}`} className="h-32 w-full rounded border bg-white" role="img" aria-label="Estimated equation crop from source image" preserveAspectRatio="xMidYMid meet"><image href={altTextImageUrl(assetId)} x="0" y="0" width="1" height="1" preserveAspectRatio="none" /></svg>}
    <p className="text-xs text-muted-foreground">Estimated source crop · confidence is not reported by this recognizer.</p>
    {data.canRun&&<Button size="sm" variant="outline" disabled={busy||data.activeJobs||!data.enabled||!region?.eligible} onClick={()=>run(!!latest)}>{busy?"Submitting…":data.activeJobs?"Recognition queued or running…":latest?"Recognize again":"Recognize equation"}</Button>}
   </>}
   {message&&<p role="alert" className="text-sm text-destructive">{message}</p>}
   <div className="flex flex-col gap-3" aria-live="polite">{data.results.filter((r)=>!region||r.regionId===region.id).map((record)=><article key={record.id} className="rounded border p-3 text-xs">
    <p className="font-medium">Version {record.version} · {record.status.replaceAll("_"," ")} · unverified</p>
    {record.errorCode&&<p className="text-destructive">Recognition could not finish ({record.errorCode}).</p>}
    {record.result&&<><p className="mt-2 break-all text-muted-foreground">{record.result.modelId} · {record.result.modelRevision.slice(0,12)}</p>
     <p className="mt-2 font-medium">{record.result.candidateLatex?"LaTeX candidate / raw recognizer output":"Raw recognizer output"}</p>
     <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2">{record.result.rawOutput||"No expression returned."}</pre>
     {record.result.candidateLatex&&<Button size="sm" variant="ghost" onClick={()=>navigator.clipboard.writeText(record.result!.candidateLatex!).then(()=>setMessage("Candidate copied; review it before use.")).catch(()=>setMessage("Copy failed. Select the text to copy it."))}>Copy candidate</Button>}
     {record.result.warnings.map((warning)=><p key={warning} className="mt-1 text-muted-foreground">{warning}</p>)}</>}
   </article>)}</div>
  </>}
 </section>
}
