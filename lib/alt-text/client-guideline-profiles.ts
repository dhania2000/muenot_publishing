import {parseClientGuideline,type SavedClientGuideline} from "./client-guideline"
export const CLIENT_GUIDELINE_ID=/^[A-Za-z0-9_-]{8,48}$/
export type ClientGuidelineProfile=SavedClientGuideline&{id:string;archived:boolean;updatedAt:string}
export type SelectedClientGuideline=import("./advanced-quality-contract").QualityGuideline&{clientName:string}
export type ClientProfileMutation={action:"create"|"update"|"archive"|"restore";id?:string;expectedVersion?:number;policy?:Omit<SavedClientGuideline,"version">}
export function parseClientProfileMutation(raw:unknown):ClientProfileMutation|null{
 if(!raw||typeof raw!=="object"||Array.isArray(raw))return null
 const b=raw as Record<string,unknown>
 if(Object.keys(b).some(k=>!["action","id","expectedVersion","policy"].includes(k))||!["create","update","archive","restore"].includes(String(b.action)))return null
 const action=b.action as ClientProfileMutation["action"]
 if(action==="create"&&(b.id!==undefined||b.expectedVersion!==undefined))return null
 if(action!=="create"&&(typeof b.id!=="string"||!CLIENT_GUIDELINE_ID.test(b.id)||!Number.isSafeInteger(b.expectedVersion)||Number(b.expectedVersion)<1||Number(b.expectedVersion)>1_000_000))return null
 let policy:ClientProfileMutation["policy"]
 if(action==="create"||action==="update"){
  const p=parseClientGuideline(b.policy)
  if(!p.ok||!p.value.enabled)return null
  policy=p.value
 }else if(b.policy!==undefined)return null
 return {action,...typeof b.id==="string"?{id:b.id,expectedVersion:Number(b.expectedVersion)}:{},...policy?{policy}:{}}
}
export function profilePolicy(profile:Pick<ClientGuidelineProfile,"id"|"version"|"clientName"|"requiredLiterals"|"forbiddenLiterals"|"requireLong">):SelectedClientGuideline{
 return {id:profile.id,version:String(profile.version),clientName:profile.clientName,rules:[...profile.requiredLiterals.map(text=>({type:"required_literal" as const,text})),...profile.forbiddenLiterals.map(text=>({type:"forbidden_literal" as const,text})),...profile.requireLong?[{type:"require_long" as const}]:[]]}
}
