"use client"
import {Input} from "@/components/ui/input"
import {Label} from "@/components/ui/label"
import {Textarea} from "@/components/ui/textarea"
import type {ClientGuidelineSettings} from "@/lib/alt-text/client-guideline"
export function ClientGuidelineEditor({value,onChange,readOnly}:{value:ClientGuidelineSettings;onChange:(value:ClientGuidelineSettings)=>void;readOnly:boolean}){
 return <fieldset disabled={readOnly} className="min-w-0 space-y-4"><legend className="mb-2 text-sm font-medium">Optional client policy</legend>
  <p className="text-sm text-muted-foreground">One named client policy can be applied as this tenant&apos;s default to new generation and QA. Existing descriptions and approvals are kept. Leave it off when processing work for other clients.</p>
  <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={value.enabled} onChange={e=>onChange({...value,enabled:e.target.checked})}/>Apply this client policy to new work</label>
  <div className="space-y-1"><Label htmlFor="guideline-client">Client name</Label><Input id="guideline-client" maxLength={100} value={value.clientName} onChange={e=>onChange({...value,clientName:e.target.value})}/></div>
  <div className="grid gap-4 sm:grid-cols-2">{(["requiredLiterals","forbiddenLiterals"] as const).map(key=><div key={key} className="min-w-0 space-y-1"><Label htmlFor={`guideline-${key}`}>{key==="requiredLiterals"?"Terms to check for":"Terms to flag for review"}</Label><Textarea id={`guideline-${key}`} rows={4} value={value[key].join("\n")} onChange={e=>onChange({...value,[key]:e.target.value.split("\n")})}/></div>)}</div>
  <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={value.requireLong} onChange={e=>onChange({...value,requireLong:e.target.checked})}/>Request a detailed description for non-decorative images</label>
  <p className="text-xs text-muted-foreground">One literal per line, up to 80 characters. Maximum 10 rules in total. Terms are checked as exact literal text, including letter case. No regex or custom instructions. Missing terms are review warnings; source labels, equations and units must never be invented or changed to satisfy a rule. Save using Save settings below.</p>
 </fieldset>
}
