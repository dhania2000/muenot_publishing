"use client"
import {useEffect,useId,useState} from "react"
import useSWR from "swr"
import {Button} from "@/components/ui/button"
import {Input} from "@/components/ui/input"
import {Label} from "@/components/ui/label"
import {altTextFetcher} from "@/lib/alt-text/client"
import type {GenerationSettings} from "@/lib/alt-text/core"
import type {ClientGuidelineProfile} from "@/lib/alt-text/client-guideline-profiles"
export function ClientGuidelineSelector({settings,onChange}:{settings:GenerationSettings;onChange:(value:GenerationSettings)=>void}){
 const inputId=useId(),[search,setSearch]=useState(""),[debounced,setDebounced]=useState(""),[open,setOpen]=useState(false),[page,setPage]=useState(1)
 useEffect(()=>{const timer=setTimeout(()=>{setDebounced(search);setPage(1)},250);return()=>clearTimeout(timer)},[search])
 const {data,error}=useSWR<{items:ClientGuidelineProfile[];total:number}>(open?`/api/alt-text/client-guidelines?q=${encodeURIComponent(debounced)}&page=${page}`:null,altTextFetcher,{revalidateOnFocus:false})
 const selected=settings.clientGuidelineId&&settings.clientGuidelineVersion?`/api/alt-text/client-guidelines?id=${encodeURIComponent(settings.clientGuidelineId)}&version=${settings.clientGuidelineVersion}`:null
 const {data:current,error:currentError}=useSWR<{profile:ClientGuidelineProfile}>(selected,altTextFetcher,{revalidateOnFocus:false})
 return <section className="min-w-0 space-y-2 rounded-md border p-3" aria-label="Client guideline selection">
  <p className="text-sm font-medium">Client guidelines <span className="font-normal text-muted-foreground">(optional)</span></p>
  <p className="break-words text-sm" role="status">{selected?currentError?"Selected client could not be loaded. Choose a client again.":current?`${current.profile.clientName} · v${settings.clientGuidelineVersion}${current.profile.archived?" · archived; select another client for new work":""}`:"Loading selected client…":"No client selected — standard settings apply."}</p>
  <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" aria-expanded={open} onClick={()=>setOpen(v=>!v)}>{open?"Close client search":"Search / change client"}</Button>{selected&&<Button type="button" variant="ghost" size="sm" onClick={()=>onChange({...settings,clientGuidelineId:null,clientGuidelineVersion:null})}>Clear client</Button>}</div>
  {open&&<div className="space-y-2"><Label htmlFor={inputId}>Search client name</Label><Input id={inputId} type="search" maxLength={100} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Type Client A, Client D…"/>
   {error?<p role="alert" className="text-xs">Client guidelines could not be loaded.</p>:!data?<p role="status" className="text-xs">Loading clients…</p>:<><ul className="max-h-48 space-y-1 overflow-y-auto" aria-label="Matching clients">{data.items.map(profile=><li key={profile.id}><Button type="button" variant="ghost" className="h-auto w-full justify-start whitespace-normal text-left" onClick={()=>{onChange({...settings,clientGuidelineId:profile.id,clientGuidelineVersion:profile.version});setOpen(false)}}>{profile.clientName} · v{profile.version}</Button></li>)}</ul>{!data.items.length&&<p className="text-xs">No matching clients. A settings manager can add one in Settings → Client Guidelines.</p>}<div className="flex items-center gap-2"><Button type="button" size="sm" variant="outline" disabled={page===1} onClick={()=>setPage(p=>p-1)}>Previous clients</Button><span className="text-xs">Page {page}</span><Button type="button" size="sm" variant="outline" disabled={page*20>=data.total} onClick={()=>setPage(p=>p+1)}>Next clients</Button></div></>}
  </div>}
  <p className="text-xs text-muted-foreground">This selection belongs to this work only. Other writers keep their own selections. The saved guideline version is retained with the result.</p>
 </section>
}
