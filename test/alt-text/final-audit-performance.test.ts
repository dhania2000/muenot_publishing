import {afterAll,expect,it,vi} from "vitest"
import {createHash} from "node:crypto"
import {readFile,writeFile} from "node:fs/promises"
import {performance} from "node:perf_hooks"
vi.mock("@/lib/background-jobs",()=>({isBackgroundJobCancelRequested:vi.fn()}))
vi.mock("@/lib/alt-text/processing-pipeline-store",()=>({loadProcessingWork:vi.fn(),checkpointProcessing:vi.fn()}))
vi.mock("@/lib/alt-text/processing-pipeline-source",()=>({loadProcessingActor:vi.fn(),processingSourceFingerprint:vi.fn()}))
vi.mock("@/lib/alt-text/processing-pipeline-execute",()=>({executeProcessingNode:vi.fn(),currentProcessingRegions:vi.fn()}))
vi.mock("@/lib/alt-text/processing-batch-guard",()=>({guardProcessingBatchAsset:vi.fn()}))
import {runProcessingPipelineJob} from "@/lib/alt-text/processing-pipeline-job"
import {initialProcessingProgress} from "@/lib/alt-text/processing-pipeline-plan"
import {normalizeGenerationSettings} from "@/lib/alt-text/core"
import {runAdvancedQuality} from "@/lib/alt-text/advanced-quality"
import {probeOcrEngine,recognizeImage,shutdownOcrEngine} from "@/lib/alt-text/ocr-engine"
import {JobDeferredError} from "@/lib/job-retry-policy"
import {errorRates} from "./ocr-metrics"
import type {QualityInput} from "@/lib/alt-text/advanced-quality-contract"
const metrics:any={synthetic:true,scope:"Local orchestration with mocked provider/source/storage/checkpoints and actual QA, plus real offline OCR. Not database, paid-provider, API or production throughput.",node:process.version,platform:process.platform,workloads:[],ocr:[]}
const round=(n:number)=>Math.round(n*1000)/1000
const actor={tenantId:5,userId:7,role:"admin",viewScope:"all",updateScope:"all"} as any
const input=(id:number):QualityInput=>({assetId:id,occurrenceId:null,contentVersion:1,sourceSha256:"a".repeat(64),classification:"photograph",description:{shortAlt:"A person holds a book.",longDescription:"",extractedText:"",language:"en",approved:false,decorative:false},policy:{requireLong:false,shortTarget:125,guideline:null},coverage:{complete:true,staleSources:0,notes:[]},ocr:[],math:[],charts:[],science:[],illustrations:[],reviewReferences:[]})
it("handles bounded 5/100/500/1000-image orchestration workloads with actual QA and no duplicate mocked generation after checkpoint resume",async()=>{
 for(const size of [5,100,500,1000]){
  const started=performance.now(),operations=new Set<string>();let checkpoints=0,qaMs=0
  for(let id=1;id<=size;id++){
   const selection={version:1,stages:["generation","qa"],settings:normalizeGenerationSettings({}),billableConfirmed:true,ocrLanguageMode:null} as any
   let run:any={id,assetId:id,createdBy:7,occurrenceId:null,sourceSha256:"a".repeat(64),selection,progress:initialProcessingProgress(id,selection,"a".repeat(64))}
   const deps:any={load:async()=>run,actor:async()=>actor,source:async()=>({sourceSha256:run.sourceSha256}),regions:async()=>null,cancelled:async()=>false,batch:async()=>{},checkpoint:async()=>{checkpoints++;run.progress.revision++},execute:async(_r:any,n:any)=>{if(n.stage==="generation"){expect(operations.has(n.requestId)).toBe(false);operations.add(n.requestId)}else{const start=performance.now(),qa=runAdvancedQuality(input(id));qaMs+=performance.now()-start;expect(qa.checks.length).toBeGreaterThan(30)}n.state="completed"}}
   const ctx={job:{id,tenant_id:5,worker_id:"synthetic_worker"} as any,signal:new AbortController().signal}
   await expect(runProcessingPipelineJob({pipelineId:id},ctx,deps)).rejects.toBeInstanceOf(JobDeferredError)
   run=JSON.parse(JSON.stringify(run)) // Simulated process/browser loss after persisted checkpoint.
   expect(await runProcessingPipelineJob({pipelineId:id},ctx,deps)).toMatchObject({status:"ready_for_review",counts:{completed:2}})
   await runProcessingPipelineJob({pipelineId:id},ctx,deps) // Duplicate completed delivery must do no leaf work.
  }
  expect(operations.size).toBe(size)
  const elapsed=performance.now()-started
  metrics.workloads.push({images:size,elapsedMs:round(elapsed),qaTotalMs:round(qaMs),qaMeanMs:round(qaMs/size),orchestrationImagesPerSecond:round(size*1000/elapsed),mockedGenerationCalls:operations.size,mockedCheckpoints:checkpoints,sampledNodeRssBytes:process.memoryUsage().rss})
 }
},60_000)
it("measures actual offline OCR initialization and English/Hindi/bilingual cold/warm recognition with unchanged inputs",async()=>{
 const start=performance.now(),health=await probeOcrEngine();metrics.ocrInitializationMs=round(performance.now()-start);expect(health.status).toBe("available")
 const root="test/fixtures/ocr/multilingual",manifest=JSON.parse(await readFile(`${root}/manifest.json`,"utf8"))
 for(const mode of ["eng","hin","eng_hin"] as const){
  const sample=manifest.samples.find((s:any)=>s.mode===mode&&s.category.startsWith("clean"))??manifest.samples.find((s:any)=>s.mode===mode)
  const bytes=await readFile(`${root}/${sample.file}`),before=createHash("sha256").update(bytes).digest("hex")
  for(const attempt of [1,2]){const started=performance.now(),result=await recognizeImage({bytes,languageMode:mode}),rates=errorRates(sample.expected,result.text)
   metrics.ocr.push({sample:sample.id,mode,attempt,wallMs:round(performance.now()-started),engineDurationMs:result.durationMs,loadedLanguages:result.loadedLanguages,cer:round(rates.cer),wer:round(rates.wer),sampledNodeRssBytes:process.memoryUsage().rss})
   expect(result.loadedLanguages).toBe(mode==="eng_hin"?"hin+eng":mode)
  }
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(before)
 }
},120_000)
afterAll(async()=>{await shutdownOcrEngine();if(process.env.ALT_TEXT_AUDIT_OUTPUT){metrics.generatedAt=new Date().toISOString();metrics.sampledFinalNodeRssBytes=process.memoryUsage().rss;await writeFile(process.env.ALT_TEXT_AUDIT_OUTPUT,JSON.stringify(metrics,null,2)+"\n")}})
