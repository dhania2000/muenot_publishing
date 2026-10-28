import {domainFixture} from "./domain-fixtures"
import {beforeEach,it,expect,vi} from "vitest"
import type {BackgroundJob} from "@/lib/background-jobs"
const d=vi.hoisted(()=>({query:vi.fn(),work:vi.fn(),write:vi.fn(),cancel:vi.fn(),policy:vi.fn(),authorize:vi.fn(),source:vi.fn(),support:vi.fn(),meter:vi.fn(),vision:vi.fn(),axes:vi.fn(),data:vi.fn(),science:vi.fn(),domain:vi.fn(),domainParent:vi.fn(),domainSupport:vi.fn()}))
vi.mock("@/lib/db",()=>({query:d.query}))
vi.mock("@/lib/background-jobs",()=>({isBackgroundJobCancelRequested:d.cancel}))
vi.mock("@/lib/permission-store",()=>({getScope:async()=>"all"}))
vi.mock("@/lib/alt-text/advanced-evidence-store",()=>({getAdvancedEvidenceWork:d.work,writeAdvancedEvidence:d.write}))
vi.mock("@/lib/alt-text/scientific-domain-service",()=>({scientificDomainPolicy:d.domain,authorizedDomainParent:d.domainParent}))
vi.mock("@/lib/alt-text/scientific-domain-support",()=>({loadDomainSupport:d.domainSupport}))
vi.mock("@/lib/alt-text/scientific-structure-service",()=>({scientificStructurePolicy:d.science}))
vi.mock("@/lib/alt-text/chart-service",()=>({chartPolicy:d.policy}))
vi.mock("@/lib/alt-text/advanced-evidence-source",()=>({advancedRegionSource:d.source,authorizeAdvancedAsset:d.authorize,chartOcrEvidence:d.support,AdvancedEvidenceError:class extends Error{constructor(public status:number,public code:string,message:string){super(message)}}}))
vi.mock("@/lib/alt-text/vision-service",()=>({analyzeVisionEvidence:d.vision}))
vi.mock("@/lib/alt-text/credit-service",()=>({estimateVisionReservation:()=>({promptChars:1}),runMeteredVisionCall:d.meter}))
vi.mock("@/lib/alt-text/region-image-crop",()=>({cropRegionImage:async()=>new Uint8Array([1])}))
vi.mock("@/lib/alt-text/chart-axis-job",()=>({runChartAxisDelivery:d.axes}))
vi.mock("@/lib/alt-text/chart-data-job",()=>({runChartDataDelivery:d.data}))
const {runAdvancedEvidenceJob}=await import("@/lib/alt-text/advanced-evidence-job")
const {chartPrompt}=await import("@/lib/alt-text/chart-contract")
const source={analysisId:"rga_12345678",regionId:"rgn_12345678",sourceSha256:"sha",normalizedBox:{x:0,y:0,width:1,height:1},pixelBox:{left:0,top:0,width:600,height:400}}
const input={kind:"chart_structure",assetId:1,occurrenceId:2,request:{regionId:source.regionId,analysisId:source.analysisId},source,actorId:7,modelId:"vision1",regions:[],regionParentId:null,complexity:"unknown",support:{ocrEvidence:[],reviewEvidence:[]}}
const receipt={raw:JSON.parse(chartPrompt([],source.regionId,[]).prompt).schema,modelId:"vision1",provider:"test",usage:{},latencyMs:1}
const job={id:11,tenant_id:5,worker_id:"worker1"} as BackgroundJob
const run=()=>runAdvancedEvidenceJob({evidenceId:8},{job,signal:new AbortController().signal})
beforeEach(()=>{vi.clearAllMocks();d.work.mockResolvedValue({row:{status:"queued"},input,saved:null});d.query.mockImplementation(async(sql:string)=>sql.includes("FROM users")?[{role:"employee"}]:[{id:11}]);d.cancel.mockResolvedValue(false);d.write.mockResolvedValue(undefined);d.policy.mockResolvedValue({enabled:true,model:{id:"vision1"}});d.authorize.mockResolvedValue({});d.source.mockResolvedValue({source,bytes:new Uint8Array([1])});d.support.mockResolvedValue(input.support);d.vision.mockResolvedValue(receipt);d.meter.mockImplementation(async(_input,call)=>({status:"generated",result:await call()}))})
it("replays completed evidence without contacting a provider",async()=>{d.work.mockResolvedValue({row:{status:"completed"},input});expect(await run()).toEqual({replayed:true});expect(d.vision).not.toHaveBeenCalled()})
it("denies missing tenant work or expired worker ownership before source access",async()=>{d.work.mockResolvedValueOnce(null);expect(await run()).toEqual({superseded:true});d.query.mockResolvedValue([]);await expect(run()).rejects.toThrow("ADVANCED_LEASE_LOST");expect(d.source).not.toHaveBeenCalled()})
it("rejects changed image/region snapshots before metering or a paid call",async()=>{d.source.mockResolvedValue({source:{...source,sourceSha256:"changed"},bytes:new Uint8Array()});await expect(run()).rejects.toThrow("SOURCE_CHANGED");expect(d.meter).not.toHaveBeenCalled();expect(d.vision).not.toHaveBeenCalled()})
it("uses existing metering once and persists a replayable receipt before final result",async()=>{
 await run();expect(d.meter).toHaveBeenCalledTimes(1);expect(d.meter.mock.calls[0][0]).toMatchObject({tenantId:5,userId:7,operationId:"chart8",feature:"publishing.alt_text.chart_structure"})
 expect(d.write).toHaveBeenNthCalledWith(2,job,8,"received",{providerReceipt:receipt});expect(d.write).toHaveBeenLastCalledWith(job,8,"completed",expect.objectContaining({needsReview:true,numericalDataExtracted:false,sourceMatchVerified:false}))
})
it("finishes a persisted receipt after interruption without another paid request",async()=>{d.work.mockResolvedValue({row:{status:"received"},input,saved:{providerReceipt:receipt}});await run();expect(d.meter).not.toHaveBeenCalled();expect(d.vision).not.toHaveBeenCalled();expect(d.write).toHaveBeenLastCalledWith(job,8,"completed",expect.anything())})
it("reports reconciliation when a prior billed delivery has no saved receipt",async()=>{d.meter.mockResolvedValue({status:"replayed",credits:{}});expect(await run()).toMatchObject({status:"needs_reconciliation"});expect(d.vision).not.toHaveBeenCalled();expect(d.write).toHaveBeenLastCalledWith(job,8,"needs_reconciliation",null,"PAID_RESULT_UNAVAILABLE")})
it("does not start vision after user cancellation or revoked policy",async()=>{d.cancel.mockResolvedValueOnce(true);await expect(run()).rejects.toThrow("ADVANCED_CANCELLED");d.policy.mockResolvedValue({enabled:false});await expect(run()).rejects.toThrow("CHART_UNAVAILABLE");expect(d.vision).not.toHaveBeenCalled()})
it("routes local axis interpretation without model selection, metering or vision",async()=>{
 d.work.mockResolvedValue({row:{status:"queued"},input:{...input,kind:"chart_axes"}});d.axes.mockResolvedValue({status:"completed"});await run();expect(d.axes).toHaveBeenCalledOnce();expect(d.policy).not.toHaveBeenCalled();expect(d.meter).not.toHaveBeenCalled();expect(d.vision).not.toHaveBeenCalled()
})

it("routes local chart data without metering or provider calls",async()=>{d.work.mockResolvedValue({row:{status:"queued"},input:{...input,kind:"chart_data"}});d.data.mockResolvedValue({status:"completed"});await run();expect(d.data).toHaveBeenCalledOnce();expect(d.policy).not.toHaveBeenCalled();expect(d.meter).not.toHaveBeenCalled();expect(d.vision).not.toHaveBeenCalled()})

it("meters scientific structure through the same queue and persisted receipt protocol",async()=>{
 const scienceOptions={components:true,labels:true,directions:true,structure:true,subjects:["biology"]},scienceInput={...input,kind:"scientific_structure",scienceOptions,regions:[{id:source.regionId,primaryType:"scientific_diagram_region",parentId:null,box:input.source.normalizedBox,locationStatus:"verified_frame"}]}
 const raw={schemaVersion:1,elements:[{regionId:source.regionId,kind:"diagram",visualRole:"unknown",uncertain:true}],relationships:[],labelAssociations:[],warnings:["incomplete_structure"]}
 d.work.mockResolvedValue({row:{status:"queued"},input:scienceInput,saved:null});d.science.mockResolvedValue({enabled:true,model:{id:"vision1"},options:scienceOptions});d.vision.mockResolvedValue({...receipt,raw});await run()
 expect(d.policy).not.toHaveBeenCalled();expect(d.meter.mock.calls[0][0]).toMatchObject({operationId:"science8",feature:"publishing.alt_text.scientific_structure"});expect(d.write).toHaveBeenLastCalledWith(job,8,"completed",expect.objectContaining({kind:"scientific_structure",scientificAccuracyVerified:false,needsReview:true}));expect(d.write).toHaveBeenNthCalledWith(2,job,8,"received",{providerReceipt:{...receipt,raw}})
})
it("stops scientific requests after settings change before a paid provider call",async()=>{
 d.work.mockResolvedValue({row:{status:"queued"},input:{...input,kind:"scientific_structure",scienceOptions:{components:true}}});d.science.mockResolvedValue({enabled:true,model:{id:"vision1"},options:{components:false}});await expect(run()).rejects.toThrow("SCIENCE_SETTINGS_CHANGED");expect(d.meter).not.toHaveBeenCalled();expect(d.vision).not.toHaveBeenCalled()
})

function domainWork(saved:any=null){const f=domainFixture(),domainInput={...input,kind:"scientific_domain",domainParent:f.parent,domainSupport:f.support,domainOptions:f.options};d.work.mockResolvedValue({row:{status:saved?"received":"queued"},input:domainInput,saved});d.domain.mockResolvedValue({enabled:true,model:{id:"vision1"},options:f.options});d.domainParent.mockResolvedValue({parent:f.parent});d.domainSupport.mockResolvedValue(f.support);d.vision.mockResolvedValue({...receipt,raw:f.output});return f}
it("uses existing metering and receipt checkpoints for bounded domain evidence",async()=>{domainWork();await run();expect(d.policy).not.toHaveBeenCalled();expect(d.meter.mock.calls[0][0]).toMatchObject({operationId:"domain8",feature:"publishing.alt_text.scientific_domain"});expect(d.write).toHaveBeenNthCalledWith(2,job,8,"received",expect.objectContaining({providerReceipt:expect.anything()}));expect(d.write).toHaveBeenLastCalledWith(job,8,"completed",expect.objectContaining({kind:"scientific_domain",scientificAccuracyVerified:false}))})
it("rejects changed domain context/equation support before metering",async()=>{domainWork();d.domainSupport.mockResolvedValue({changed:true});await expect(run()).rejects.toThrow("DOMAIN_SUPPORT_CHANGED");expect(d.meter).not.toHaveBeenCalled();expect(d.vision).not.toHaveBeenCalled()})
it("rejects changed domain parent, subject settings and image before a paid call",async()=>{domainWork();d.domainParent.mockResolvedValue({parent:{changed:true}});await expect(run()).rejects.toThrow("DOMAIN_PARENT_CHANGED");domainWork();d.domain.mockResolvedValue({enabled:true,model:{id:"vision1"},options:{subjects:[]}});await expect(run()).rejects.toThrow("DOMAIN_SETTINGS_CHANGED");domainWork();d.source.mockResolvedValue({source:{changed:true}});await expect(run()).rejects.toThrow("SOURCE_CHANGED");expect(d.meter).not.toHaveBeenCalled()})
it("finishes a saved domain receipt without selecting or calling a provider again",async()=>{const f=domainFixture();domainWork({providerReceipt:{...receipt,raw:f.output}});await run();expect(d.domain).not.toHaveBeenCalled();expect(d.meter).not.toHaveBeenCalled();expect(d.vision).not.toHaveBeenCalled();expect(d.write).toHaveBeenLastCalledWith(job,8,"completed",expect.objectContaining({kind:"scientific_domain"}))})

it("accepts recursively reordered persisted JSON keys while still guarding real source changes",async()=>{const f=domainWork(),reorder=(v:any):any=>Array.isArray(v)?v.map(reorder):v&&typeof v==="object"?Object.fromEntries(Object.entries(v).reverse().map(([k,x])=>[k,reorder(x)])):v;d.work.mockResolvedValue({row:{status:"queued"},input:reorder({...input,kind:"scientific_domain",domainParent:f.parent,domainSupport:f.support,domainOptions:f.options}),saved:null});await expect(run()).resolves.toMatchObject({status:"completed"});expect(d.meter).toHaveBeenCalledOnce()})
