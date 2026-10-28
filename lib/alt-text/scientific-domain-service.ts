import "server-only"
import {isDeepStrictEqual as evidenceEqual} from "node:util"
import {getSettingsRecord} from "./store"
import {resolveEffectiveAccessibilitySettings} from "./accessibility-settings"
import {scientificStructurePolicy} from "./scientific-structure-service"
import {getCompletedAdvancedEvidence,listAdvancedEvidence,enqueueAdvancedEvidence} from "./advanced-evidence-store"
import {authorizeAdvancedAsset,advancedRegionSource,chartOcrEvidence,AdvancedEvidenceError} from "./advanced-evidence-source"
import {SCIENCE_ROOT_TYPES} from "./scientific-structure-contract"
import {loadDomainSupport,loadDomainDocumentContext} from "./scientific-domain-support"
import type {DomainOptions,DomainParent,ScienceSubject} from "./scientific-domain-contract"
import {withinScope,type HistoryActor} from "./history"
export async function scientificDomainPolicy(role:"admin"|"employee"){
 const [base,record]=await Promise.all([scientificStructurePolicy(role),getSettingsRecord()]),resolved=resolveEffectiveAccessibilitySettings({storedAccessibility:record.accessibility,tenant:record.settings,revision:record.revision,backend:{implemented:["scientific_domain_analysis"],visionModelAvailable:base.available,ocrLanguagePacks:[],disabledByPolicy:process.env.ALT_TEXT_ADVANCED_DISABLED==="1"?["scientific_domain_analysis"]:[]}}),science=resolved.effective.science
 const subjects=(["chemistry","physics","biology","geometry"] as ScienceSubject[]).filter((s)=>science.subjects.includes(s==="geometry"?"mathematics":s))
 const options:DomainOptions={subjects,notation:science.notation===true,units:science.units===true,chemicalSymbols:science.chemicalSymbols===true,terminology:science.terminology===true,labels:base.options?.labels===true,directions:base.options?.directions===true,structure:base.options?.structure===true}
 const enabled=base.enabled&&subjects.length>0
 return {available:base.available,enabled,options,model:base.model,reason:base.reason??(!subjects.length?"Select chemistry, physics, biology or mathematics in Scientific Diagram settings.":null)}
}
export async function authorizedDomainParent(assetId:number,occurrenceId:number|null,parentId:number,actor:HistoryActor,edit=false){
 const asset=await authorizeAdvancedAsset(assetId,occurrenceId,actor,edit),record=await getCompletedAdvancedEvidence(assetId,occurrenceId,"scientific_structure",parentId)
 if(!record?.result)throw new AdvancedEvidenceError(404,"STRUCTURE_NOT_FOUND","Completed scientific structure evidence not found.")
 return {asset,parent:{id:record.id,version:record.version,result:record.result} satisfies DomainParent}
}
export async function assertDomainSourceCurrent(parent:DomainParent,actor:HistoryActor,edit=true){
 const p=parent.result,current=await advancedRegionSource(p.assetId,{requestId:"source_check",occurrenceId:p.occurrenceId,analysisId:p.regionAnalysisId,regionId:p.diagramRegionId,reprocess:false},actor,[...SCIENCE_ROOT_TYPES],edit)
 if(!evidenceEqual(current.source,p.source)||!evidenceEqual(await chartOcrEvidence(p.assetId,p.occurrenceId,current.regions),{ocrEvidence:p.ocrEvidence,reviewEvidence:p.reviewEvidence}))throw new AdvancedEvidenceError(409,"DOMAIN_SOURCE_CHANGED","Image, region or OCR evidence changed. Refresh scientific structure first.")
 return current
}
export async function readScientificDomain(assetId:number,occurrenceId:number|null,parentId:number,actor:HistoryActor,role:"admin"|"employee"){
 const {asset,parent}=await authorizedDomainParent(assetId,occurrenceId,parentId,actor)
 const [policy,all]=await Promise.all([scientificDomainPolicy(role),listAdvancedEvidence(assetId,occurrenceId,"scientific_domain")]),records=all.filter((r)=>r.parentEvidenceId===parentId)
 let sourceMatchesCurrent=true
 try{await assertDomainSourceCurrent(parent,actor,false)}catch(error){if(!(error instanceof AdvancedEvidenceError))throw error;sourceMatchesCurrent=false}
 const currentContext=records.some((r)=>r.result?.support.context)?await loadDomainDocumentContext(parent,actor):null
 const visible=records.map((r)=>{const saved=r.result?.support.context;if(!r.result||!saved||currentContext?.documentId===saved.documentId&&currentContext.occurrenceId===saved.occurrenceId)return r;return {...r,result:{...r.result,support:{...r.result.support,context:null},warnings:[...r.result.warnings,"Saved document context is unavailable under the current document permissions or source status."]}}})
 const {model:_model,...publicPolicy}=policy
 return {success:true as const,parent,policy:publicPolicy,sourceMatchesCurrent,canRun:withinScope(actor.updateScope,actor.userId,asset),results:visible,activeJobs:records.some((r)=>["queued","running","received"].includes(r.status))}
}
export async function startScientificDomain(assetId:number,occurrenceId:number|null,parentId:number,body:unknown,actor:HistoryActor,role:"admin"|"employee"){
 const r=body as Record<string,unknown>|null
 if(!r||typeof r!=="object"||Array.isArray(r)||Object.keys(r).some((k)=>!["requestId","reprocess"].includes(k))||typeof r.requestId!=="string"||!/^[A-Za-z0-9_-]{8,48}$/.test(r.requestId)||r.reprocess!=null&&typeof r.reprocess!=="boolean")throw new AdvancedEvidenceError(400,"INVALID_REQUEST","Choose a saved scientific structure and valid request identity.")
 const {parent}=await authorizedDomainParent(assetId,occurrenceId,parentId,actor,true),policy=await scientificDomainPolicy(role)
 if(!policy.enabled||!policy.model)throw new AdvancedEvidenceError(409,"DOMAIN_UNAVAILABLE",policy.reason??"Scientific domain analysis is unavailable.")
 const current=await assertDomainSourceCurrent(parent,actor),domainSupport=await loadDomainSupport(parent,actor),p=parent.result
 return enqueueAdvancedEvidence({kind:"scientific_domain",assetId,occurrenceId,request:{requestId:r.requestId,occurrenceId,analysisId:p.regionAnalysisId,regionId:p.diagramRegionId,reprocess:r.reprocess===true},source:current.source,actorId:actor.userId,modelId:policy.model.id,regions:current.regions,regionParentId:current.region.parentId,complexity:current.complexity,support:{ocrEvidence:p.ocrEvidence,reviewEvidence:p.reviewEvidence},domainParent:parent,domainSupport,domainOptions:policy.options})
}
export type ScientificDomainResponse=Awaited<ReturnType<typeof readScientificDomain>>
