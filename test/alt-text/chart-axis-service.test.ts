import {beforeEach,it,expect,vi} from "vitest"
const d=vi.hoisted(()=>({authorize:vi.fn(),parent:vi.fn(),settings:vi.fn(),source:vi.fn(),labels:vi.fn(),enqueue:vi.fn(),list:vi.fn()}))
vi.mock("@/lib/alt-text/store",()=>({getSettingsRecord:d.settings}))
vi.mock("@/lib/alt-text/accessibility-settings",()=>({resolveEffectiveAccessibilitySettings:()=>({effective:{graphs:{axisLabels:true,axisScale:true,legend:true,dataLabels:false}}})}))
vi.mock("@/lib/alt-text/advanced-evidence-source",()=>({authorizeAdvancedAsset:d.authorize,advancedRegionSource:d.source,AdvancedEvidenceError:class extends Error{constructor(public status:number,public code:string,message:string){super(message)}}}))
vi.mock("@/lib/alt-text/advanced-evidence-store",()=>({getCompletedAdvancedEvidence:d.parent,listAdvancedEvidence:d.list,enqueueAdvancedEvidence:d.enqueue}))
vi.mock("@/lib/alt-text/chart-axis-labels",()=>({loadReviewedChartLabels:d.labels}))
const service=await import("@/lib/alt-text/chart-axis-service")
const actor={userId:7,viewScope:"added",updateScope:"added"} as const
const source={sourceSha256:"hash"},parent={id:8,version:1,result:{source,regionAnalysisId:"rga_12345678",chartRegionId:"rgn_12345678"}}
beforeEach(()=>{vi.clearAllMocks();d.authorize.mockResolvedValue({id:1,createdBy:7,reviewerId:null});d.parent.mockResolvedValue(parent);d.settings.mockResolvedValue({settings:{},accessibility:{},revision:1});d.source.mockResolvedValue({source,regions:[],region:{parentId:null},complexity:"unknown"});d.labels.mockResolvedValue([]);d.list.mockResolvedValue([]);d.enqueue.mockResolvedValue({created:true})})
it("does not accept a chart from another asset, occurrence or evidence kind",async()=>{d.parent.mockResolvedValue(null);await expect(service.authorizedParentChart(1,2,8,actor)).rejects.toMatchObject({status:404});expect(d.parent).toHaveBeenCalledWith(1,2,"chart_structure",8)})
it("rejects stale source mapping and client-supplied labels before enqueue",async()=>{
 await expect(service.startChartAxes(1,2,8,{requestId:"request123",labels:["fake"]},actor)).rejects.toMatchObject({status:400});d.source.mockResolvedValue({source:{sourceSha256:"changed"}});await expect(service.startChartAxes(1,2,8,{requestId:"request123"},actor)).rejects.toMatchObject({code:"CHART_SOURCE_CHANGED"});expect(d.enqueue).not.toHaveBeenCalled()
})
it("enqueues only server-derived local inputs tied to the exact parent and reviewed labels",async()=>{await service.startChartAxes(1,2,8,{requestId:"request123"},actor);expect(d.enqueue).toHaveBeenCalledWith(expect.objectContaining({kind:"chart_axes",modelId:"local_reviewed_ocr_geometry_v1",parentEvidence:{id:8,version:1,result:parent.result},reviewedLabels:[],actorId:7}));expect(d.authorize).toHaveBeenCalledWith(1,2,actor,true)})
it("reads saved evidence with no new work and keeps parent versions separate",async()=>{d.list.mockResolvedValue([{parentEvidenceId:8,id:9,status:"completed"},{parentEvidenceId:10,id:11,status:"queued"}]);const result=await service.readChartAxes(1,2,8,actor);expect(result.results).toHaveLength(1);expect(result.activeJobs).toBe(false);expect(d.enqueue).not.toHaveBeenCalled()})
