import {beforeEach,it,expect,vi} from "vitest"
const d=vi.hoisted(()=>({gate:vi.fn(),source:vi.fn(),save:vi.fn(),read:vi.fn(),queue:vi.fn()}))
vi.mock("@/lib/alt-text/route-gate",()=>({gateAltTextHistory:d.gate,jsonOk:(b:any)=>Response.json(b),jsonError:(b:any)=>Response.json(b,{status:b.status}),unexpected:()=>Response.json({},{status:500})}))
vi.mock("@/lib/alt-text/ocr-review-source",()=>({resolveOcrReviewSource:d.source,OcrReviewError:class extends Error{constructor(public status:number,public code:string,message:string){super(message)}}}))
vi.mock("@/lib/alt-text/ocr-review-store",()=>({readOcrReviews:d.read,readEarlierOcrReviews:async()=>[],saveOcrReview:d.save}))
vi.mock("@/lib/alt-text/ocr-review-queue",()=>({listOcrReviewQueue:d.queue}))
vi.mock("@/lib/alt-text/document-review-route",()=>({rateLimited:async()=>null,parsePaging:()=>({ok:true,page:1,pageSize:25})}))
const route=await import("@/app/api/alt-text/ocr-review/route")
const target={kind:"image_ocr",sourceId:"ocr_1",assetId:1,occurrenceId:null,documentId:null,pageIndex:null}
const body={target,expectedVersion:0,requestId:"request_123",text:"सही",state:"corrected",comment:"Checked"}
const post=(b:any=body)=>route.POST(new Request("http://localhost/review",{method:"POST",body:JSON.stringify(b)}))
beforeEach(()=>{vi.clearAllMocks();d.gate.mockResolvedValue({ok:true,actor:{userId:7},permissions:{canEdit:false,canReview:false}});d.source.mockResolvedValue({target,canEdit:true});d.read.mockResolvedValue([]);d.save.mockResolvedValue({record:{id:1}})})
it("denies failed permissions before resolving or saving a correction",async()=>{d.gate.mockResolvedValue({ok:false,response:Response.json({},{status:403})});expect((await post()).status).toBe(403);expect(d.source).not.toHaveBeenCalled();expect(d.save).not.toHaveBeenCalled()})
it("requires a separate reviewer gate for verification",async()=>{d.gate.mockResolvedValueOnce({ok:true,actor:{userId:7}}).mockResolvedValueOnce({ok:false,response:Response.json({},{status:403})});expect((await post({...body,state:"verified"})).status).toBe(403);expect(d.save).not.toHaveBeenCalled()})
it("reads saved versions without saving or running recognition",async()=>{expect((await route.GET(new Request(`http://localhost/review?target=${encodeURIComponent(JSON.stringify(target))}`))).status).toBe(200);expect(d.read).toHaveBeenCalled();expect(d.save).not.toHaveBeenCalled()})
it("rejects a client-supplied original text or editor identity",async()=>{expect((await post({...body,originalText:"invented",editorId:99})).status).toBe(400);expect(d.save).not.toHaveBeenCalled()})
it("passes the trusted actor and server-resolved source into versioned persistence",async()=>{expect((await post()).status).toBe(200);expect(d.save).toHaveBeenCalledWith({target,canEdit:true},body,7)})
