import {parseGuidelineAttachments,GuidelineIngestionError} from "@/lib/epub/guideline-ingestion"
import {submitUploads} from "@/lib/epub/upload-store"
import {getSession} from "@/lib/auth"
import {checkRateLimit} from "@/lib/rate-limit"
import {readBody} from "@/lib/alt-text/document-extraction-run"
import {EPUB_INTAKE_BODY_LIMIT,EpubIntakeError,parseEpubIntake,createEpubIntake,listEpubIntakes} from "@/lib/epub/intake"
import {parseWorkbenchFilters} from "@/lib/epub/workbench-contract"
import {listWorkbench,listOperators} from "@/lib/epub/workbench-store"
export const runtime="nodejs"
export const dynamic="force-dynamic"
const response=(body:unknown,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"private, no-store"}})
let intakeBusy=false
export async function POST(req:Request){
 let acquired=false
 try{
  const actor=await getSession();if(!actor)return response({success:false,code:"UNAUTHENTICATED",error:"Sign in to submit a project."},401)
  if(req.headers.get("origin")!==new URL(req.url).origin)return response({success:false,code:"ORIGIN_DENIED",error:"Submit the project from this website."},403)
  const limited=await checkRateLimit(`epub-intake:${actor.tenantId}:${actor.userId}`,{max:12,windowMs:300000});if(!limited.allowed)return response({success:false,code:"RATE_LIMITED",error:"Too many project submissions. Please wait."},429)
  const contentType=req.headers.get("content-type")??""
  if(contentType.startsWith("application/json")){if(intakeBusy)return response({success:false,code:"INTAKE_BUSY",error:"Another submission is being received. Please retry shortly."},429);intakeBusy=true;acquired=true;const bytes=await readBody(req.body,64*1024);if(!bytes)return response({success:false,error:"The project request is too large."},413);let raw;try{raw=JSON.parse(bytes.toString("utf8"))}catch{return response({success:false,error:"The project request is invalid."},400)}const project=await submitUploads(raw,actor.userId);return response({success:true,project},project.created?201:200)}
  if(!contentType.startsWith("multipart/form-data;")||Number(req.headers.get("content-length"))>EPUB_INTAKE_BODY_LIMIT)return response({success:false,code:"INVALID_UPLOAD",error:"Send a bounded project upload."},413)
  if(intakeBusy)return response({success:false,code:"INTAKE_BUSY",error:"Another source upload is being received. Please retry shortly."},429)
  intakeBusy=true;acquired=true
  const bytes=await readBody(req.body,EPUB_INTAKE_BODY_LIMIT);if(!bytes)return response({success:false,code:"UPLOAD_LIMIT",error:"The source upload is empty or too large."},413)
  let form:FormData;try{form=await new Request(req.url,{method:"POST",headers:{"content-type":contentType},body:new Uint8Array(bytes)}).formData()}catch{return response({success:false,code:"INVALID_UPLOAD",error:"Could not read the upload. Choose the source files again."},400)}
  if(form.has("uploads")){if([...form.keys()].some(k=>!["plan","requestId","rightsConfirmed","uploads","guidelines"].includes(k))||["plan","requestId","rightsConfirmed","uploads"].some(k=>form.getAll(k).length!==1))throw new EpubIntakeError(422,"INVALID_REQUEST","Send one plan and completed source reference set.");let raw:any;try{raw={plan:JSON.parse(String(form.get("plan"))),requestId:form.get("requestId"),rightsConfirmed:form.get("rightsConfirmed")==="true",uploads:JSON.parse(String(form.get("uploads")))}}catch{throw new EpubIntakeError(422,"INVALID_REQUEST","The project metadata is invalid.")}const guidelines=await parseGuidelineAttachments(form.getAll("guidelines")),project=await submitUploads(raw,actor.userId,{guidelines});return response({success:true,project},project.created?201:200)}
  const input=await parseEpubIntake(form,actor.userId),project=await createEpubIntake(input,actor.userId)
  return response({success:true,project},project.created?201:200)
 }catch(e){if(e instanceof GuidelineIngestionError)return response({success:false,code:e.code,error:"Choose supported safe guideline files, up to 5 MiB each."},415);if(e instanceof EpubIntakeError)return response({success:false,code:e.code,error:e.message,...(e.details?{details:e.details}:{})},e.status);console.error("[epub/intake] failed",e instanceof Error?e.name:"unknown");return response({success:false,code:"INTAKE_UNAVAILABLE",error:"Project intake is temporarily unavailable. Retry with the same plan; no conversion charge was made."},503)}finally{if(acquired)intakeBusy=false}
}
export async function GET(req:Request){try{const actor=await getSession();if(!actor)return response({success:false,code:"UNAUTHENTICATED"},401);const limited=await checkRateLimit(`epub-project-list:${actor.tenantId}:${actor.userId}`,{max:120,windowMs:60000});if(!limited.allowed)return response({success:false,code:"RATE_LIMITED",error:"Please wait before refreshing projects."},429);const params=new URL(req.url).searchParams;if(params.get("view")==="operators")return response({success:true,items:await listOperators(actor)});if(params.get("view")==="workbench"){const filters=parseWorkbenchFilters(params);if(!filters)return response({success:false,code:"INVALID_FILTERS",error:"Choose valid search, page and status filters."},400);return response({success:true,...await listWorkbench(filters,actor)})}return response({success:true,items:await listEpubIntakes(actor.userId)})}catch(e){if(e instanceof EpubIntakeError)return response({success:false,code:e.code,error:e.message,...(e.details?{details:e.details}:{})},e.status);return response({success:false,code:"INTAKE_UNAVAILABLE",error:"Projects could not be loaded."},503)}}
