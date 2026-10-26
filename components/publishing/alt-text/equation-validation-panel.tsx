"use client"
import {useState} from "react"
import {Button} from "@/components/ui/button"
import type {MathEvidenceRecord} from "@/lib/alt-text/math-contract"
import {altTextImageUrl} from "@/lib/alt-text/client"
const tabs=["Source","Preview","MathML","Warnings"] as const
export function EquationValidationPanel({assetId,occurrenceId,record,canEdit,onSaved}:{assetId:number;occurrenceId:number|null;record:MathEvidenceRecord;canEdit:boolean;onSaved:()=>Promise<unknown>}){
 const [tab,setTab]=useState<(typeof tabs)[number]>("Source"),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null)
 const validation=record.validation?.result
 const source=record.result?.source,box=source?.pixelBox
 async function validate(){
  setBusy(true);setError(null)
  try{
   const response=await fetch(`/api/alt-text/assets/${assetId}/math/validation`,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({evidenceId:record.id,occurrenceId})})
   const body=await response.json()
   if(!response.ok){setError(body.error??"Validation failed.");return}
   await onSaved();setTab("Preview")
  }catch{setError("Validation could not be saved. Try again.")}finally{setBusy(false)}
 }
 async function copy(text:string){try{await navigator.clipboard.writeText(text)}catch{setError("Copy failed. Select the source text to copy it.")}}
 // A separate document with scripts, resources, forms and navigation disabled is a second boundary
 // around the server's allowlisted presentation MathML. Raw OCR source never enters this document.
 const preview=validation?.presentationMathml?`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'"></head><body>${validation.presentationMathml}</body></html>`:null
 return <div className="mt-3 grid gap-3 rounded border p-2 md:grid-cols-2">
  <div className="min-w-0"><p className="mb-2 font-medium">Original equation crop</p>{source&&box&&<svg viewBox={`${box.left} ${box.top} ${box.width} ${box.height}`} className="h-40 w-full rounded border bg-white" role="img" aria-label="Original equation region" preserveAspectRatio="xMidYMid meet"><image href={altTextImageUrl(assetId)} width={source.sourceWidth} height={source.sourceHeight}/></svg>}<p className="mt-1 text-muted-foreground">Region location is estimated. Compare every symbol.</p></div>
  <div className="flex min-w-0 flex-col gap-2">
  {validation?<p>LaTeX syntax: {validation.syntaxStatus} · Preview: {validation.renderStatus} · MathML: {validation.mathmlStatus}<br/><strong>Human verified: No · Source match: unverified</strong></p>:<p>No saved syntax validation.</p>}
  {canEdit&&record.result?.candidateLatex&&<Button size="sm" variant="outline" disabled={busy} onClick={validate}>{busy?"Validating…":validation?"Check saved candidate again":"Validate candidate"}</Button>}
  <div role="tablist" aria-label={`Equation version ${record.version} views`} className="flex flex-wrap gap-1">{tabs.map((name)=><button key={name} type="button" role="tab" aria-selected={tab===name} className={`rounded px-2 py-1 ${tab===name?"bg-muted font-medium":""}`} onClick={()=>setTab(name)}>{name}</button>)}</div>
  <div role="tabpanel" aria-label={tab}>
   {tab==="Source"&&<><pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all">{validation?.selectedLatex??record.result?.candidateLatex??record.result?.rawOutput}</pre>{validation&&<Button size="sm" variant="ghost" onClick={()=>copy(validation.selectedLatex)}>Copy saved LaTeX</Button>}</>}
   {tab==="Preview"&&(preview?<><iframe title={`Equation version ${record.version} presentation MathML preview`} sandbox="" srcDoc={preview} className="h-40 w-full rounded border bg-white"/><p className="mt-1 text-muted-foreground">Presentation preview; rendering does not prove mathematical correctness.</p></>:<p>Preview unavailable. Validate the candidate and check warnings.</p>)}
   {tab==="MathML"&&(validation?.presentationMathml?<><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all">{validation.presentationMathml}</pre><Button size="sm" variant="ghost" onClick={()=>copy(validation.presentationMathml!)}>Copy saved presentation MathML</Button><p>Presentation MathML; semantic Content MathML is not generated.</p></>:<p>No saved MathML conversion.</p>)}
   {tab==="Warnings"&&<ul className="list-disc space-y-1 pl-4">{validation?.issues.map((issue,i)=><li key={i}>{issue.severity}: {issue.message}{issue.position!=null?` (position ${issue.position+1})`:""}</li>)??<li>Validate the candidate to see parser results. Human source comparison is always required.</li>}</ul>}
  </div>
  {validation&&<p className="break-all text-muted-foreground">{validation.renderer.id} {validation.renderer.version} · validation version {record.validation!.version}</p>}
  {error&&<p role="alert" className="text-destructive">{error}</p>}
  </div>
 </div>
}
