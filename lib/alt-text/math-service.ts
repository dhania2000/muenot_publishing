import "server-only"
import {createHash} from "node:crypto"
import {getAsset,getLatestRegionAnalysis,getSettingsRecord,occurrenceBelongsToAsset} from "./store"
import {withinScope,type HistoryActor} from "./history"
import {toAnalysisView} from "./region-service"
import {resolveEffectiveAccessibilitySettings} from "./accessibility-settings"
import {checkMathReadiness,MATH_MODEL} from "./math-engine"
import {readImageBytes} from "./generate"
import {openAltTextImage,type PreviewActor} from "./preview"
import {readImageHeader} from "./image-header"
import {equationCrop,MATH_LIMITS,parseMathRequest,type MathCrop,type MathRequest,type MathResponse} from "./math-contract"
import {enqueueMathEvidence,listMathEvidence} from "./math-store"
import {currentTenantId} from "@/lib/tenant-scope"
import {query} from "@/lib/db"
import {getScope} from "@/lib/permission-store"
import {readEquationValidations} from "./math-validation-store"

export class MathRequestError extends Error{constructor(readonly status:number,readonly code:string,message:string){super(message);this.name="MathRequestError"}}
export async function authorizeMathWorker(assetId:number,occurrenceId:number|null,userId:number,tenantId:number){
 const [user]=await query<any[]>("SELECT role FROM users WHERE tenant_id=? AND id=? AND status='active' LIMIT 1",[tenantId,userId])
 if(!user||tenantId!==currentTenantId())throw new MathRequestError(403,"ACTOR_UNAVAILABLE","The requesting user is no longer active in this tenant.")
 const role=user.role==="admin"?"admin":"employee",[viewScope,updateScope]=await Promise.all([getScope(userId,role,"publishing.alt_text","view"),getScope(userId,role,"publishing.alt_text","update")]),actor={userId,viewScope,updateScope}
 await authorize(assetId,occurrenceId,actor,true)
 const document=await (await import("./document-generation")).resolveDocumentPromptContext(assetId,actor,occurrenceId)
 if(document.kind==="ineligible")throw new MathRequestError(404,"NOT_FOUND","The source document occurrence is no longer accessible.")
 return actor
}
export async function mathPolicy(){
 const [health,record]=await Promise.all([checkMathReadiness(),getSettingsRecord()])
 const settings=resolveEffectiveAccessibilitySettings({storedAccessibility:record.accessibility,revision:record.revision,tenant:record.settings,backend:{implemented:["math_analysis","math_ocr"],visionModelAvailable:null,ocrLanguagePacks:[],disabledByPolicy:process.env.ALT_TEXT_MATH_DISABLED==="1"?["math_analysis","math_ocr"]:[],mathReady:health.available,mathIssue:health.reason}})
 const enabled=health.available&&settings.effective.math.equationRecognition===true
 return {available:health.available,enabled,reason:!health.available?health.reason:!enabled?"Enable equation recognition in Accessibility Settings before starting mathematical OCR.":null}
}
async function authorize(assetId:number,occurrenceId:number|null,actor:HistoryActor,edit=false){
 const asset=await getAsset(assetId)
 if(!asset||!withinScope(actor.viewScope,actor.userId,asset)||occurrenceId!=null&&!(await occurrenceBelongsToAsset(assetId,occurrenceId)))throw new MathRequestError(404,"NOT_FOUND","Image not found.")
 if(edit&&(!actor.updateScope||!withinScope(actor.updateScope,actor.userId,asset)))throw new MathRequestError(403,"FORBIDDEN","You do not have permission to analyze this image.")
 return asset
}
export async function resolveEquationSource(assetId:number,occurrenceId:number|null,request:Pick<MathRequest,"regionId"|"analysisId">,actor:PreviewActor):Promise<{source:MathCrop;bytes:Uint8Array}>{
 if(occurrenceId!=null&&!(await occurrenceBelongsToAsset(assetId,occurrenceId)))throw new MathRequestError(404,"NOT_FOUND","Image occurrence not found.")
 const analysisRow=await getLatestRegionAnalysis(assetId,occurrenceId),analysis=analysisRow?toAnalysisView(analysisRow):null
 const region=analysis?.regions.find((r)=>r.id===request.regionId)
 if(!analysis||analysis.analysisId!==request.analysisId||!region)throw new MathRequestError(409,"MATH_REGION_CHANGED","The equation region changed. Refresh the detected regions.")
 const image=await openAltTextImage(assetId,actor)
 if(!image.ok)throw new MathRequestError(image.status,image.code,image.error)
 const bytes=await readImageBytes(image.body,20*1024*1024)
 if(!bytes)throw new MathRequestError(413,"MATH_SOURCE_LIMIT","The source image exceeds the recognition limit.")
 const header=readImageHeader(bytes,image.contentType)
 if(!header||header.orientation!==1||header.orientationUnknown||header.width*header.height>MATH_LIMITS.sourcePixels)throw new MathRequestError(422,"MATH_SOURCE_FRAME","The image dimensions or orientation cannot be used safely for this region.")
 const crop=equationCrop(region,analysis,header.width,header.height)
 if(!crop)throw new MathRequestError(422,"MATH_REGION_INELIGIBLE","Choose an equation region with a verified coordinate frame within the crop limits.")
 return {bytes,source:{analysisId:analysis.analysisId,analysisVersion:analysis.version,regionId:region.id,normalizedBox:region.box,pixelBox:crop,sourceWidth:header.width,sourceHeight:header.height,sourceSha256:createHash("sha256").update(bytes).digest("hex"),coordinateSystem:"stored_pixels_top_left",locationIsEstimate:true}}
}
export async function readMathResults(assetId:number,occurrenceId:number|null,actor:HistoryActor):Promise<MathResponse>{
 const asset=await authorize(assetId,occurrenceId,actor)
 const [policy,row,records,validations]=await Promise.all([mathPolicy(),getLatestRegionAnalysis(assetId,occurrenceId),listMathEvidence(assetId,occurrenceId),readEquationValidations(assetId,occurrenceId)])
 const results=records.map((r)=>({...r,validation:validations.find((v)=>v.result.sourceEvidenceId===r.id)??null}))
 const analysis=row?toAnalysisView(row):null
 return {success:true,assetId,occurrenceId,...policy,canRun:!!actor.updateScope&&withinScope(actor.updateScope,actor.userId,asset),
  regions:(analysis?.regions??[]).filter((r)=>r.primaryType==="equation_region").map((r,i)=>({id:r.id,analysisId:analysis!.analysisId,label:`Equation region ${i+1}${r.needsReview?" · review position":""}`,box:r.box,sourceWidth:analysis!.source.storedWidth,sourceHeight:analysis!.source.storedHeight,eligible:r.locationStatus==="verified_frame"&&analysis!.source.orientation===1&&!analysis!.source.orientationUnknown})),results,activeJobs:results.some((r)=>["queued","recognizing"].includes(r.status))}
}
export async function startMathRecognition(assetId:number,body:unknown,actor:HistoryActor){
 const request=parseMathRequest(body)
 if(!request)throw new MathRequestError(400,"INVALID_REQUEST","Choose an equation region and a valid request identity.")
 await authorize(assetId,request.occurrenceId,actor,true)
 const policy=await mathPolicy()
 if(!policy.enabled)throw new MathRequestError(409,"MATH_UNAVAILABLE",policy.reason??"Mathematical OCR is unavailable.")
 const {source}=await resolveEquationSource(assetId,request.occurrenceId,request,{userId:actor.userId,tenantId:currentTenantId(),scope:actor.viewScope})
 return enqueueMathEvidence({assetId,occurrenceId:request.occurrenceId,request,source,modelFingerprint:JSON.stringify(MATH_MODEL),analysisId:source.analysisId,actorId:actor.userId})
}
