import {beforeEach,it,expect,vi} from "vitest"
const d=vi.hoisted(()=>({parent:vi.fn(),policy:vi.fn(),source:vi.fn(),labels:vi.fn(),write:vi.fn(),guard:vi.fn()}))
vi.mock("@/lib/alt-text/advanced-evidence-store",()=>({writeAdvancedEvidence:d.write}))
vi.mock("@/lib/alt-text/advanced-evidence-source",()=>({advancedRegionSource:d.source,AdvancedEvidenceError:class extends Error{constructor(public status:number,public code:string,message:string){super(message)}}}))
vi.mock("@/lib/alt-text/chart-axis-service",()=>({authorizedParentChart:d.parent,chartAxisPolicy:d.policy,CHART_AXIS_ENGINE:"local_reviewed_ocr_geometry_v1"}))
vi.mock("@/lib/alt-text/chart-axis-labels",()=>({loadReviewedChartLabels:d.labels}))
const {runChartAxisDelivery}=await import("@/lib/alt-text/chart-axis-job")
const {chartPrompt}=await import("@/lib/alt-text/chart-contract")
const source={sourceWidth:1000,sourceHeight:500,sourceSha256:"hash"},parent={id:8,version:1,result:{assetId:1,occurrenceId:2,chartRegionId:"graph",regionAnalysisId:"rga1",source,regionReferences:[],output:JSON.parse(chartPrompt([],"graph",[]).prompt).schema}}
const options={axisLabels:true,axisScale:true,legend:true,dataLabels:false},input={kind:"chart_axes",assetId:1,occurrenceId:2,parentEvidence:parent,reviewedLabels:[],axisOptions:options,modelId:"local_reviewed_ocr_geometry_v1",request:{regionId:"graph"},source} as any
const job={id:11,tenant_id:5} as any,actor={userId:7,viewScope:"all",updateScope:"all"} as const
beforeEach(()=>{vi.clearAllMocks();d.parent.mockResolvedValue({parent});d.policy.mockResolvedValue({enabled:true,options});d.source.mockResolvedValue({source});d.labels.mockResolvedValue([]);d.guard.mockResolvedValue(undefined)})
it("persists honest unknown axes when no reviewed labels exist",async()=>{expect(await runChartAxisDelivery(input,job,9,actor,d.guard)).toEqual({evidenceId:9,status:"completed"});expect(d.write).toHaveBeenLastCalledWith(job,9,"completed",expect.objectContaining({axes:[],needsReview:true,numericalDataExtracted:false}))})
it("rejects changed OCR/reviewer snapshots instead of silently reassigning labels",async()=>{d.labels.mockResolvedValue([{id:"new"}]);await expect(runChartAxisDelivery(input,job,9,actor,d.guard)).rejects.toMatchObject({code:"REVIEWED_LABELS_CHANGED"});expect(d.write).not.toHaveBeenCalled()})
it("rejects a changed chart parent or source coordinate frame",async()=>{d.parent.mockResolvedValueOnce({parent:{...parent,version:2}});await expect(runChartAxisDelivery(input,job,9,actor,d.guard)).rejects.toMatchObject({code:"CHART_PARENT_CHANGED"});d.source.mockResolvedValue({source:{...source,sourceSha256:"changed"}});await expect(runChartAxisDelivery(input,job,9,actor,d.guard)).rejects.toMatchObject({code:"SOURCE_CHANGED"})})
it("honors newly disabled policy and lease/cancellation guards",async()=>{d.policy.mockResolvedValueOnce({enabled:false,options});await expect(runChartAxisDelivery(input,job,9,actor,d.guard)).rejects.toMatchObject({code:"AXIS_POLICY_CHANGED"});d.guard.mockRejectedValue(new Error("LEASE_LOST"));await expect(runChartAxisDelivery(input,job,9,actor,d.guard)).rejects.toThrow("LEASE_LOST");expect(d.write).not.toHaveBeenCalled()})
