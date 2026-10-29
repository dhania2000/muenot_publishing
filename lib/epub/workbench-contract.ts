import {parseEpubDraft,type EpubDraft,type EpubSelection} from "./intake-plan"
import {parseEpubConfiguration,type EpubConfiguration} from "./configuration"
export const PROJECT_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const PROJECT_STATES=["held","queued","running","failed","cancelled","in_review","approved","delivered"] as const
export type WorkbenchActor={userId:number;role:string}
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==="object"&&!Array.isArray(v)
const text=(v:unknown,max:number)=>typeof v==="string"&&v.trim().length>0&&v.length<=max&&v.isWellFormed()&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v)
export type WorkbenchAction=
 |{action:"settings";expectedRevision:number;plan:EpubDraft}
 |{action:"comment";expectedRevision:number;message:string;parentId:number|null;anchorKind:"project"|"issue"|"chapter";anchorRef:string}
 |{action:"decision";expectedRevision:number;kind:"request_changes"|"internal_approve"|"owner_accept";outputId:string|null;note:string;manualReviewed:boolean}
 |{action:"assign";expectedRevision:number;assigneeId:number|null;expectedAssigneeId:number|null}
export function parseWorkbenchAction(v:unknown):WorkbenchAction|null{
 if(!object(v)||!Number.isSafeInteger(v.expectedRevision)||v.expectedRevision<1||v.expectedRevision>1_000_000)return null
 const allowed:Record<string,string[]>={settings:["plan"],comment:["message","parentId","anchorKind","anchorRef"],decision:["kind","outputId","note","manualReviewed"],assign:["assigneeId","expectedAssigneeId"]}
 if(typeof v.action!=="string"||!Object.hasOwn(allowed,v.action)||Object.keys(v).some(k=>!["action","expectedRevision",...allowed[v.action]].includes(k)))return null
 if(v.action==="settings"){const plan=parseEpubDraft(v.plan);return plan&&plan.title.trim()?{action:v.action,expectedRevision:v.expectedRevision,plan}:null}
 if(v.action==="comment"&&text(v.message,4000)&&["project","issue","chapter"].includes(v.anchorKind)&&typeof v.anchorRef==="string"&&v.anchorRef.length<=160&&/^[A-Za-z0-9:_-]*$/.test(v.anchorRef)&&(v.parentId===null||Number.isSafeInteger(v.parentId)&&v.parentId>0))return {...v,message:v.message.trim()} as WorkbenchAction
 if(v.action==="decision"&&["request_changes","internal_approve","owner_accept"].includes(v.kind)&&(v.outputId===null||typeof v.outputId==="string"&&PROJECT_ID.test(v.outputId))&&text(v.note,2000)&&typeof v.manualReviewed==="boolean")return {...v,note:v.note.trim()} as WorkbenchAction
 if(v.action==="assign"&&[v.assigneeId,v.expectedAssigneeId].every(id=>id===null||Number.isSafeInteger(id)&&id>0))return v as WorkbenchAction
 return null
}
export type WorkbenchFilters={page:number;q:string;status:string;scope:"own"|"assigned"|"staff"}
export function parseWorkbenchFilters(params:URLSearchParams):WorkbenchFilters|null{
 const page=Number(params.get("page")??1),q=(params.get("q")??"").normalize("NFC").trim(),status=params.get("status")??"all",scope=params.get("scope")??"own"
 if(!Number.isSafeInteger(page)||page<1||page>1000||q.length>100||!q.isWellFormed()||!PROJECT_STATES.includes(status as any)&&status!=="all"||!["own","assigned","staff"].includes(scope))return null
 return {page,q,status,scope:scope as WorkbenchFilters["scope"]}
}
export function timelineState(projectStatus:string,jobs:{stage:string;status:string;attempts:number}[]){
 return ["upload","preflight","extraction","build","validation","qa","delivery"].map(stage=>{
  if(stage==="upload")return {stage,status:"received",attempts:1}
  const job=jobs.find(j=>j.stage===stage)
  return {stage,status:job?.status??(projectStatus==="held"&&stage==="preflight"?"blocked":"not_started"),attempts:job?.attempts??0}
 })
}
export type SettingPreset={name:string;selection:EpubSelection;configuration:EpubConfiguration}
export function parseSettingPreset(v:unknown):SettingPreset|null{
 if(!object(v)||Object.keys(v).sort().join()!=="configuration,name,selection"||!text(v.name,100))return null
 const configuration=parseEpubConfiguration(v.configuration),plan=parseEpubDraft({schemaVersion:1,title:"Template",author:"",guidelineNotes:"",selection:v.selection,configuration,step:0,sources:[]})
 if(!configuration||!plan)return null
 // Shared templates never publish a book's description, identifiers, publisher or rights notes.
 return {name:v.name.trim(),selection:plan.selection,configuration:{...configuration,metadata:{language:configuration.metadata.language,publisher:"",identifier:"",description:"",rights:""}}}
}
