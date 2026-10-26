import {beforeEach,it,expect,vi} from "vitest"
const d=vi.hoisted(()=>({asset:vi.fn(),occurrence:vi.fn(),analysis:vi.fn(),open:vi.fn(),ocr:vi.fn(),query:vi.fn()}))
vi.mock("@/lib/alt-text/store",()=>({getAsset:d.asset,occurrenceBelongsToAsset:d.occurrence,getLatestRegionAnalysis:d.analysis,listOcrResults:d.ocr}))
vi.mock("@/lib/alt-text/region-service",()=>({toAnalysisView:(r:any)=>r}))
vi.mock("@/lib/alt-text/preview",()=>({openAltTextImage:d.open}))
vi.mock("@/lib/alt-text/ocr-service",()=>({toOcrView:(r:any)=>r.result}))
vi.mock("@/lib/db",()=>({query:d.query}))
vi.mock("@/lib/tenant-scope",()=>({currentTenantId:()=>5}))
vi.mock("@/lib/alt-text/math-store",()=>({ensureEvidenceSchema:async()=>{}}))
const {advancedRegionSource,chartOcrEvidence,parseAdvancedRegionRequest}=await import("@/lib/alt-text/advanced-evidence-source")
const {readFile}=await import("node:fs/promises")
const actor={userId:7,viewScope:"added",updateScope:"added"} as const
const request={requestId:"request_123",regionId:"rgn_12345678",analysisId:"rga_12345678",occurrenceId:2,reprocess:false}
const graph={id:request.regionId,primaryType:"graph_region",parentId:null,box:{x:0,y:0,width:1,height:1},locationStatus:"verified_frame"}
beforeEach(async()=>{vi.clearAllMocks();d.asset.mockResolvedValue({id:1,createdBy:7,reviewerId:null});d.occurrence.mockResolvedValue(true);d.analysis.mockResolvedValue({analysisId:request.analysisId,version:1,source:{storedWidth:600,storedHeight:400,orientation:1,orientationUnknown:false},regions:[graph],relationships:[],complexityAtAnalysis:"unknown"});d.open.mockResolvedValue({ok:true,contentType:"image/png",body:await readFile("test/fixtures/charts/line.png")});d.ocr.mockResolvedValue([]);d.query.mockResolvedValue([])})
it("denies absent tenant/foreign occurrence before opening source bytes",async()=>{d.asset.mockResolvedValueOnce(null);await expect(advancedRegionSource(1,request,actor,["graph_region"])).rejects.toMatchObject({status:404});d.occurrence.mockResolvedValue(false);await expect(advancedRegionSource(1,request,actor,["graph_region"])).rejects.toMatchObject({status:404});expect(d.open).not.toHaveBeenCalled()})
it("does not force a photograph or scientific diagram region into a chart",async()=>{for(const primaryType of ["image_region","scientific_diagram_region"]){d.analysis.mockResolvedValueOnce({analysisId:request.analysisId,regions:[{...graph,primaryType}]});await expect(advancedRegionSource(1,request,actor,["graph_region"])).rejects.toMatchObject({code:"REGION_CHANGED"})}expect(d.open).not.toHaveBeenCalled()})
it("preserves nested chart identity while excluding its internal plot from the parent's chart",async()=>{
 const nested={...graph,id:"rgn_nested12",parentId:graph.id},inner={...graph,id:"rgn_inner123",primaryType:"plot_area",parentId:nested.id},outside={...graph,id:"rgn_other123",parentId:null}
 d.analysis.mockResolvedValue({analysisId:request.analysisId,version:1,source:{storedWidth:600,storedHeight:400,orientation:1,orientationUnknown:false},regions:[graph,nested,inner,outside],relationships:[],complexityAtAnalysis:"high"})
 const result=await advancedRegionSource(1,request,actor,["graph_region"])
 expect(result.regions.map((r:any)=>r.id)).toEqual([graph.id,nested.id]);expect(result.source.sourceSha256).toMatch(/^[a-f0-9]{64}$/)
})
it("does not mix full-image OCR or a sibling chart's text into a chart crop",async()=>{
 d.ocr.mockResolvedValue([{result:{resultId:"full",rawText:"whole slide text",region:null}},{result:{resultId:"other",rawText:"other chart",region:{regionId:"rgn_other123"}}},{result:{resultId:"own",version:2,rawText:"Axis title",region:{regionId:graph.id}}}])
 expect((await chartOcrEvidence(1,2,[graph as any])).ocrEvidence).toEqual([{resultId:"own",version:2,regionId:graph.id,text:"Axis title",verified:false,sourceDesignation:"raw_ocr"}]);expect(d.ocr).toHaveBeenCalledWith(1,2)
})
it("rejects client frame/model/tenant overrides",()=>{expect(parseAdvancedRegionRequest(request)).toEqual(request);for(const extra of [{tenantId:8},{box:graph.box},{modelId:"fake"}])expect(parseAdvancedRegionRequest({...request,...extra})).toBeNull()})
