/** Bounded declarative rules for a named client. Never executable instructions, regex or factual evidence. */
export type ClientGuidelineSettings={enabled:boolean;clientName:string;requiredLiterals:string[];forbiddenLiterals:string[];requireLong:boolean}
export type SavedClientGuideline=ClientGuidelineSettings&{version:number}
export const DEFAULT_CLIENT_GUIDELINE:SavedClientGuideline={enabled:false,clientName:"",requiredLiterals:[],forbiddenLiterals:[],requireLong:false,version:0}
const keys=["enabled","clientName","requiredLiterals","forbiddenLiterals","requireLong"]
export function parseClientGuideline(raw:unknown):{ok:true;value:ClientGuidelineSettings}|{ok:false;error:string}{
 if(!raw||typeof raw!=="object"||Array.isArray(raw))return {ok:false,error:"Send a guideline object."}
 const r=raw as Record<string,unknown>,bad=(error:string)=>({ok:false as const,error})
 if(Object.keys(r).some(k=>!keys.includes(k)))return bad("Unexpected guideline fields.")
 if(typeof r.enabled!=="boolean"||typeof r.requireLong!=="boolean"||typeof r.clientName!=="string")return bad("Guideline name and flags are invalid.")
 const clean=(s:string)=>s.normalize("NFC").trim(),name=clean(r.clientName)
 if(!name.isWellFormed()||[...name].length>100||/[\p{Cc}\p{Cf}]/u.test(name))return bad("Client name must be at most 100 characters without control characters.")
 for(const key of ["requiredLiterals","forbiddenLiterals"]){const a=r[key];if(!Array.isArray(a)||a.length>10||a.some(s=>typeof s!=="string"||!s.isWellFormed()||!clean(s)||clean(s).length>80||/[\p{Cc}\p{Cf}]/u.test(s)))return bad("Use literal terms of 1–80 characters without control characters.")}
 const required=[...new Set((r.requiredLiterals as string[]).map(clean))],forbidden=[...new Set((r.forbiddenLiterals as string[]).map(clean))]
 if(required.some(s=>forbidden.some(t=>t.toLowerCase()===s.toLowerCase())))return bad("The same literal cannot be required and forbidden.")
 if(required.length+forbidden.length+(r.requireLong?1:0)>10)return bad("A guideline supports at most 10 rules in total, including the detailed-description rule.")
 if(r.enabled&&(!name||(!required.length&&!forbidden.length&&!r.requireLong)))return bad("An enabled guideline needs a client name and at least one rule.")
 return {ok:true,value:{enabled:r.enabled,clientName:name,requiredLiterals:required,forbiddenLiterals:forbidden,requireLong:r.requireLong}}
}
export function normalizeClientGuideline(raw:unknown):SavedClientGuideline{
 if(!raw||typeof raw!=="object"||Array.isArray(raw))return structuredClone(DEFAULT_CLIENT_GUIDELINE)
 const {version,...config}=raw as Record<string,unknown>,checked=parseClientGuideline(config)
 return checked.ok?{...checked.value,version:Number.isSafeInteger(version)&&Number(version)>=0?Number(version):0}:structuredClone(DEFAULT_CLIENT_GUIDELINE)
}
export function activeClientGuideline(raw:unknown):import("./advanced-quality-contract").QualityGuideline|null{
 const g=normalizeClientGuideline(raw)
 return g.enabled?{id:"tenant-client-guideline",version:String(g.version),rules:[...g.requiredLiterals.map(text=>({type:"required_literal" as const,text})),...g.forbiddenLiterals.map(text=>({type:"forbidden_literal" as const,text})),...(g.requireLong?[{type:"require_long" as const}]:[])]}:null
}
export function clientGuidelineWarnings(raw:unknown,short:string,long:string,decorative:boolean):string[]{
 return guidelineWarningsForPolicy(activeClientGuideline(raw),short,long,decorative)
}
export function guidelineWarningsForPolicy(g:import("./advanced-quality-contract").QualityGuideline|null,short:string,long:string,decorative:boolean):string[]{
 if(!g||decorative)return []
 const text=`${short}\n${long}`.normalize("NFC"),warnings:string[]=[]
 for(const rule of g.rules){if(rule.type==="require_long"){if(!long.trim())warnings.push("Client guideline requests a detailed description; review before approval.")}
 else if(rule.type==="required_literal"&&!text.includes(rule.text))warnings.push(`Client guideline literal is absent: ${rule.text}. Add it only if supported by the source; otherwise resolve with the reviewer.`)
 else if(rule.type==="forbidden_literal"&&text.includes(rule.text))warnings.push(`Client guideline flags a literal for review: ${rule.text}. Preserve source notation and resolve any conflict with the reviewer.`)}
 return warnings
}
