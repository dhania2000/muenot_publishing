import {beforeEach,it,expect,vi} from "vitest"
const d=vi.hoisted(()=>({asset:vi.fn(),occurrence:vi.fn(),ocr:vi.fn(),math:vi.fn(),doc:vi.fn(),pages:vi.fn()}))
vi.mock("@/lib/alt-text/store",()=>({getAsset:d.asset,occurrenceBelongsToAsset:d.occurrence,listOcrResults:d.ocr}))
vi.mock("@/lib/alt-text/math-store",()=>({listMathEvidence:d.math}))
vi.mock("@/lib/alt-text/document-store",()=>({getDocument:d.doc}))
vi.mock("@/lib/alt-text/pdf-page-ocr-store",()=>({readOcrPages:d.pages}))
vi.mock("@/lib/alt-text/ocr-service",()=>({toOcrView:(r:any)=>r.result}))
vi.mock("@/lib/alt-text/document-service",()=>({ownerScopeFor:(a:any)=>a.viewScope==="all"?null:{uploadedBy:a.userId}}))
vi.mock("@/lib/tenant-scope",()=>({currentTenantId:()=>5}))
const source=await import("@/lib/alt-text/ocr-review-source")
const actor={userId:7,viewScope:"added",updateScope:"added"} as const
const target={kind:"image_ocr",assetId:1,occurrenceId:2,documentId:null,pageIndex:null,sourceId:"ocr_1"} as const
beforeEach(()=>{vi.clearAllMocks();d.asset.mockResolvedValue({id:1,createdBy:7,reviewerId:null});d.occurrence.mockResolvedValue(true);d.ocr.mockResolvedValue([{resultId:"ocr_1",result:{resultId:"ocr_1",rawText:"मूल पाठ",version:1,warnings:[],meanConfidence:45,region:{regionId:"rgn_1"}}}]);d.math.mockResolvedValue([]);d.doc.mockResolvedValue(null)})
it("does not reveal another tenant's absent source or foreign occurrence",async()=>{d.asset.mockResolvedValueOnce(null);await expect(source.resolveOcrReviewSource(target,actor)).rejects.toMatchObject({status:404});d.occurrence.mockResolvedValue(false);await expect(source.resolveOcrReviewSource(target,actor)).rejects.toMatchObject({status:404});expect(d.ocr).not.toHaveBeenCalled()})
it("derives raw provenance, region and real engine confidence from the scoped source",async()=>{const result=await source.resolveOcrReviewSource(target,actor);expect(result).toMatchObject({rawText:"मूल पाठ",regionId:"rgn_1",confidence:45,confidenceScale:"tesseract_0_100",canEdit:true});expect(d.ocr).toHaveBeenCalledWith(1,2)})
it("resolves edit scope independently from broader view access",async()=>{d.asset.mockResolvedValue({id:1,createdBy:8,reviewerId:null});expect((await source.resolveOcrReviewSource(target,{...actor,viewScope:"all"})).canEdit).toBe(false)})
it("requires an authorized clean document before reading page text",async()=>{const t={kind:"page_ocr",assetId:null,occurrenceId:null,documentId:3,pageIndex:0,sourceId:"hash"} as const;await expect(source.resolveOcrReviewSource(t,actor)).rejects.toMatchObject({status:404});expect(d.doc).toHaveBeenCalledWith(3,{uploadedBy:7});expect(d.pages).not.toHaveBeenCalled()})
it("binds a page correction to its exact existing run and rejects changed source at save time",async()=>{
 const conn={query:vi.fn().mockResolvedValue([[{result_json:{identity:"same",runId:9,rawText:"text"}}]])}
 await expect(source.assertReviewSourceUnchanged(conn,{target:{kind:"page_ocr",documentId:3,pageIndex:0,sourceId:"same"},rawText:"text",sourceVersion:8} as any)).rejects.toMatchObject({code:"SOURCE_CHANGED"})
 expect(conn.query.mock.calls[0][1]).toEqual([5,3,0])
})
