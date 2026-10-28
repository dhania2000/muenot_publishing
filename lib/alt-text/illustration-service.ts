import "server-only"
import {getSettingsRecord,getLatestRegionAnalysis} from "./store"
import {resolveEffectiveAccessibilitySettings} from "./accessibility-settings"
import {scientificStructurePolicy} from "./scientific-structure-service"
import {toAnalysisView} from "./region-service"
import {authorizeAdvancedAsset,advancedRegionSource,parseAdvancedRegionRequest,AdvancedEvidenceError} from "./advanced-evidence-source"
import {enqueueAdvancedEvidence,listAdvancedEvidence} from "./advanced-evidence-store"
import {ILLUSTRATION_ROOTS,illustrationType,type IllustrationOptions,type IllustrationType} from "./illustration-contract"
import {illustrationSupport} from "./illustration-support"
import {withinScope,type HistoryActor} from "./history"
export const ILLUSTRATION_ROOT_TYPES=Object.keys(ILLUSTRATION_ROOTS) as (keyof typeof ILLUSTRATION_ROOTS)[]
const engineIds=["flowchart_analysis","table_image_analysis","map_geometry_analysis","mixed_complex_analysis"] as const
export async function illustrationPolicy(role:"admin"|"employee"){
 const [base,record]=await Promise.all([scientificStructurePolicy(role),getSettingsRecord()]),disabled=process.env.ALT_TEXT_ADVANCED_DISABLED==="1",settings=resolveEffectiveAccessibilitySettings({storedAccessibility:record.accessibility,tenant:record.settings,revision:record.revision,backend:{implemented:[...engineIds],visionModelAvailable:base.available,ocrLanguagePacks:[],disabledByPolicy:disabled?[...engineIds]:[]}}),selected=settings.effective.general.analysisTypes
 const mapping={flowchart:"flowchart",table:"table",map:"map_geometry",mixed:"mixed_complex"} as const,options:IllustrationOptions={enabledTypes:(Object.keys(mapping) as IllustrationType[]).filter((t)=>selected.includes(mapping[t]))}
 const enabled=!disabled&&base.available&&options.enabledTypes.length>0
 return {available:!disabled&&base.available,enabled,options,model:base.model,reason:disabled?"Advanced analysis is disabled by deployment policy.":!base.available?base.reason:!options.enabledTypes.length?"Enable flowchart, table, map/geometry or mixed-complex analysis in Accessibility Settings.":null}
}
export async function readIllustration(assetId:number,occurrenceId:number|null,actor:HistoryActor,role:"admin"|"employee"){
 const asset=await authorizeAdvancedAsset(assetId,occurrenceId,actor),[policy,row,all]=await Promise.all([illustrationPolicy(role),getLatestRegionAnalysis(assetId,occurrenceId),listAdvancedEvidence(assetId,occurrenceId,"illustration_structure")]),analysis=row?toAnalysisView(row):null
 const roots=(analysis?.regions??[]).filter((r)=>illustrationType(r)),first=roots.find((r)=>r.locationStatus==="verified_frame");let currentSha:string|null=null
 if(first&&analysis&&all.some((r)=>r.result)){try{currentSha=(await advancedRegionSource(assetId,{requestId:"source_check",occurrenceId,analysisId:analysis.analysisId,regionId:first.id,reprocess:false},actor,ILLUSTRATION_ROOT_TYPES,false)).source.sourceSha256}catch(error){if(!(error instanceof AdvancedEvidenceError))throw error}}
 const {model:_model,...publicPolicy}=policy
 return {success:true as const,assetId,occurrenceId,policy:publicPolicy,canRun:withinScope(actor.updateScope,actor.userId,asset),regions:roots.map((r)=>({id:r.id,type:illustrationType(r)!,parentId:r.parentId,analysisId:analysis!.analysisId,box:r.box,sourceWidth:analysis!.source.storedWidth,sourceHeight:analysis!.source.storedHeight,eligible:r.locationStatus==="verified_frame"&&analysis!.source.orientation===1&&!analysis!.source.orientationUnknown})),results:all.map((r)=>({...r,sourceMatchesCurrent:!!r.result&&r.result.regionAnalysisId===analysis?.analysisId&&r.result.source.sourceSha256===currentSha})),activeJobs:all.some((r)=>["queued","running","received"].includes(r.status))}
}
export async function startIllustration(assetId:number,body:unknown,actor:HistoryActor,role:"admin"|"employee"){
 const request=parseAdvancedRegionRequest(body);if(!request)throw new AdvancedEvidenceError(400,"INVALID_REQUEST","Choose a current illustration region and valid request identity.")
 await authorizeAdvancedAsset(assetId,request.occurrenceId,actor,true)
 const policy=await illustrationPolicy(role)
 if(!policy.enabled||!policy.model)throw new AdvancedEvidenceError(409,"ILLUSTRATION_UNAVAILABLE",policy.reason??"Illustration analysis is unavailable.")
 const current=await advancedRegionSource(assetId,request,actor,ILLUSTRATION_ROOT_TYPES),type=illustrationType(current.region)
 if(!type||!policy.options.enabledTypes.includes(type))throw new AdvancedEvidenceError(409,"ILLUSTRATION_TYPE_DISABLED","This illustration type is disabled in Accessibility Settings.")
 const evidence=await illustrationSupport(assetId,request.occurrenceId,current.regions,current.source)
 return enqueueAdvancedEvidence({kind:"illustration_structure",assetId,occurrenceId:request.occurrenceId,request,source:current.source,actorId:actor.userId,modelId:policy.model.id,regions:current.regions,regionParentId:current.region.parentId,complexity:current.complexity,support:evidence.support,regionRelationships:current.relationships,illustrationOptions:policy.options,illustrationOrder:evidence.ocrOrder})
}
export type IllustrationResponse=Awaited<ReturnType<typeof readIllustration>>
