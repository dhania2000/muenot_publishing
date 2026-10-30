export type EpubServiceRequest={requestedDate:string;timeZone:string;priority:"standard"|"expedited-review";contractReference:string;deliveryChannel:"portal"|"secure-link";notes:string}
export const DEFAULT_SERVICE_REQUEST:EpubServiceRequest={requestedDate:"",timeZone:"Asia/Kolkata",priority:"standard",contractReference:"",deliveryChannel:"portal",notes:""}
export function parseServiceRequest(raw:unknown):EpubServiceRequest|null{
 if(raw===undefined)return structuredClone(DEFAULT_SERVICE_REQUEST)
 if(!raw||typeof raw!=="object"||Array.isArray(raw))return null
 const r=raw as any;if(Object.keys(r).sort().join()!=="contractReference,deliveryChannel,notes,priority,requestedDate,timeZone"||typeof r.requestedDate!=="string"||typeof r.timeZone!=="string"||r.timeZone.length>80||!["standard","expedited-review"].includes(r.priority)||!["portal","secure-link"].includes(r.deliveryChannel))return null
 try{new Intl.DateTimeFormat('en',{timeZone:r.timeZone}).format()}catch{return null}
 if(r.requestedDate&&(!/^20\d{2}-\d{2}-\d{2}$/.test(r.requestedDate)||!Number.isFinite(Date.parse(r.requestedDate+"T00:00:00Z"))||new Date(r.requestedDate+"T00:00:00Z").toISOString().slice(0,10)!==r.requestedDate))return null
 for(const [key,max] of [["contractReference",120],["notes",500]] as const)if(typeof r[key]!=="string"||r[key].length>max||!r[key].isWellFormed()||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(r[key]))return null
 return {requestedDate:r.requestedDate,timeZone:r.timeZone,priority:r.priority,contractReference:r.contractReference.trim(),deliveryChannel:r.deliveryChannel,notes:r.notes}
}
function localDate(utc:number,timeZone:string){const p=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(utc),part=(t:string)=>p.find(v=>v.type===t)!.value;return `${part('year')}-${part('month')}-${part('day')}`}
/** End of the requested civil date, with the selected IANA zone and its actual UTC offset. */
export function requestedDateEndUtc(date:string,timeZone:string):string|null{if(!date)return null;const center=Date.parse(date+'T12:00:00Z');let low=center-48*3600000,high=center+48*3600000;while(low<high){const middle=Math.floor((low+high)/2);if(localDate(middle,timeZone)<=date)low=middle+1;else high=middle}return localDate(low-1,timeZone)===date?new Date(low-1).toISOString():null}
export function serviceRequestAssessment(request:EpubServiceRequest,now=new Date(),minimumLeadDays=0){
 const today=localDate(now.getTime(),request.timeZone),end=requestedDateEndUtc(request.requestedDate,request.timeZone),days=request.requestedDate?(Date.parse(request.requestedDate)-Date.parse(today))/86400000:null,warnings:string[]=["Operational capacity and contract/SLA have not been verified. Requested dates are nonbinding."]
 if(request.requestedDate&&!end)warnings.push("The requested civil date does not exist in the selected timezone.")
 if(days!==null&&days<0)warnings.push("Requested completion date has already passed in the selected timezone.")
 if(days!==null&&days>=0&&days<minimumLeadDays)warnings.push("Requested date is earlier than the configured planning lead time; capacity review is required.")
 if(request.priority==='expedited-review')warnings.push("Expedited handling was requested; queue priority and service entitlement are unchanged until authorized capacity review.")
 if(request.contractReference)warnings.push("Contract reference was supplied, but its SLA terms have not been verified.")
 return {requestedEndAtUtc:end,requestedDateStatus:days===null?'not_requested':days<0?'requested_date_passed':'requested',contractStatus:'not_verified' as const,queuePriority:5,warnings}
}
