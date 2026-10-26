import "server-only"
import {spawn} from "node:child_process"
import {createHash} from "node:crypto"
import {createReadStream} from "node:fs"
import {readFile,stat} from "node:fs/promises"
import path from "node:path"
import lock from "../../models/math/model-lock.json"
import {MATH_LIMITS,parseMathEngineOutput,type MathEngineOutput} from "./math-contract"

export const MATH_MODEL={modelId:lock.modelId,revision:lock.revision,weightsSha256:lock.files["model.safetensors"],preprocessingVersion:"white-fit-half-v1"}
export class MathEngineError extends Error {constructor(readonly code:string){super(code);this.name="MathEngineError"}}
type Health={available:boolean;reason:string|null}
let healthCache:{key:string;until:number;promise:Promise<Health>}|null=null
async function hashFile(file:string){const hash=createHash("sha256");for await (const chunk of createReadStream(file))hash.update(chunk);return hash.digest("hex")}
/** Provisioning writes a receipt after a real offline initialization. Viewing saved results never
 * starts inference or downloads a model; every pinned asset is rechecked on the health cache cycle. */
export async function checkMathReadiness():Promise<Health>{
  const python=process.env.ALT_TEXT_MATH_PYTHON,dir=process.env.ALT_TEXT_MATH_MODEL_DIR
  if(process.env.ALT_TEXT_MATH_DISABLED==="1")return {available:false,reason:"Mathematical OCR is disabled by deployment policy."}
  if(!python||!dir||!path.isAbsolute(python)||!path.isAbsolute(dir))return {available:false,reason:"A local CPU math worker and its verified model have not been provisioned."}
  const key=JSON.stringify([python,dir])
  if(healthCache?.key===key&&Date.now()<healthCache.until)return healthCache.promise
  const promise=(async()=>{
    try{
      if(!(await stat(python)).isFile())throw new Error()
      for(const [name,hash] of Object.entries(lock.files))if(await hashFile(path.join(dir,name))!==hash)throw new Error()
      const health=JSON.parse(await readFile(path.join(dir,"runtime-health.json"),"utf8"))
      if(health.status!=="available"||health.preprocessingVersion!==MATH_MODEL.preprocessingVersion||health.revision!==MATH_MODEL.revision||health.weightsSha256!==MATH_MODEL.weightsSha256||health.platform!==process.platform||path.resolve(health.pythonExecutable)!==path.resolve(python)||health.torch!=="2.8.0+cpu"||health.transformers!=="4.56.2")throw new Error()
      return {available:true,reason:null}
    }catch{return {available:false,reason:"The math model, runtime receipt or integrity check is missing or incompatible. Run the offline provisioning check."}}
  })()
  healthCache={key,until:Date.now()+60_000,promise}
  return promise
}
let running=false
export async function recognizeMath(png:Uint8Array,signal?:AbortSignal):Promise<MathEngineOutput>{
  if(!(await checkMathReadiness()).available)throw new MathEngineError("MATH_UNAVAILABLE")
  if(running)throw new MathEngineError("MATH_BUSY")
  if(png.length>MATH_LIMITS.cropBytes)throw new MathEngineError("MATH_CROP_LIMIT")
  if(signal?.aborted)throw new MathEngineError("MATH_CANCELLED")
  running=true
  try{return await new Promise<MathEngineOutput>((resolve,reject)=>{
    const env:NodeJS.ProcessEnv={NODE_ENV:process.env.NODE_ENV,PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,TEMP:process.env.TEMP,TMP:process.env.TMP,
      PYTHONPATH:process.env.ALT_TEXT_MATH_PYTHONPATH,PYTHONNOUSERSITE:"1",PYTHONIOENCODING:"utf-8",HF_HUB_OFFLINE:"1",TRANSFORMERS_OFFLINE:"1",HF_HUB_DISABLE_TELEMETRY:"1",CUDA_VISIBLE_DEVICES:"",OMP_NUM_THREADS:"2"}
    const child=spawn(process.env.ALT_TEXT_MATH_PYTHON!,[path.join(process.cwd(),"scripts/math-ocr-worker.py"),"--model-dir",process.env.ALT_TEXT_MATH_MODEL_DIR!,"--lock",path.join(process.cwd(),"models/math/model-lock.json")],{shell:false,windowsHide:true,env,stdio:["pipe","pipe","pipe"]})
    let stdout="",overflow=false,stopped:string|null=null,settled=false
    const kill=(code:string)=>{stopped=code;child.kill("SIGKILL")}
    const abort=()=>kill("MATH_CANCELLED")
    const timer=setTimeout(()=>kill("MATH_TIMEOUT"),MATH_LIMITS.timeoutMs)
    signal?.addEventListener("abort",abort,{once:true})
    const finish=(error:MathEngineError|null,value?:MathEngineOutput)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener("abort",abort);error?reject(error):resolve(value!)}
    child.stdout.on("data",(data:Buffer)=>{stdout+=data.toString("utf8");if(Buffer.byteLength(stdout)>64_000){overflow=true;kill("MATH_OUTPUT_LIMIT")}})
    child.stderr.resume() // Never log recognizer stderr or private document contents.
    child.on("error",()=>finish(new MathEngineError("MATH_WORKER_FAILED")))
    child.stdin.on("error",()=>{})
    child.on("close",(code)=>{
      if(stopped||overflow)return finish(new MathEngineError(stopped??"MATH_OUTPUT_LIMIT"))
      try{const parsed=code===0?parseMathEngineOutput(JSON.parse(stdout),MATH_MODEL):null;finish(parsed?null:new MathEngineError("MATH_WORKER_FAILED"),parsed??undefined)}catch{finish(new MathEngineError("MATH_OUTPUT_INVALID"))}
    })
    child.stdin.end(JSON.stringify({pngBase64:Buffer.from(png).toString("base64")}))
  })}finally{running=false}
}
