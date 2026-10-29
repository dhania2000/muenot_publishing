import {beforeEach,expect,it,vi} from "vitest"
const d=vi.hoisted(()=>({gate:vi.fn(),doc:vi.fn(),record:vi.fn(),limit:vi.fn()}))
vi.mock("@/lib/alt-text/route-gate",()=>({gateAltTextHistory:d.gate,jsonOk:(v:unknown)=>Response.json(v),jsonError:(v:any)=>Response.json(v,{status:v.status}),unexpected:()=>new Response(null,{status:500})}))
vi.mock("@/lib/alt-text/document-store",()=>({getDocument:d.doc}))
vi.mock("@/lib/alt-text/document-service",()=>({ownerScopeFor:()=>({userId:7,scope:"added"})}))
vi.mock("@/lib/alt-text/document-extraction-run",()=>({readBody:vi.fn()}))
vi.mock("@/lib/tenant-scope",()=>({currentTenantIdOrNull:()=>5}))
vi.mock("@/lib/rate-limit",()=>({checkRateLimit:d.limit}))
vi.mock("@/lib/alt-text/docx-export-store",()=>({getExportByRef:d.record}))
import {GET} from "@/app/api/alt-text/documents/[uploadId]/exports/[outputId]/provenance/route"
const uuid="12345678-1234-1234-1234-123456789abc"
const run=(query="",uploadId="51",outputId=uuid)=>GET(new Request(`http://localhost/provenance${query}`),{params:Promise.resolve({uploadId,outputId})})
beforeEach(()=>{vi.clearAllMocks();d.gate.mockResolvedValue({ok:true,actor:{userId:7,viewScope:"all",exportScope:"added"}});d.doc.mockResolvedValue({id:51});d.limit.mockResolvedValue({allowed:true});d.record.mockResolvedValue({status:"completed",format:"pptx",objectKey:"private/tenant-secret",report:{summary:{},items:Array.from({length:12},(_,i)=>({occurrenceId:i+1,sourceLocator:`slide:${i+1}`,approvedVersionId:90+i,approvedVersion:2,assetId:11,status:"updated",privateText:"DO NOT RETURN"}))}})})
it("requires export permission and paginates explicit metadata without storage keys or arbitrary report fields",async()=>{
 const response=await run("?page=2&pageSize=10"),body=await response.json()
 expect(response.status).toBe(200);expect(d.gate).toHaveBeenCalledWith({export:true});expect(body.items.map((i:any)=>i.occurrenceId)).toEqual([11,12]);expect(body.total).toBe(12)
 expect(JSON.stringify(body)).not.toContain("tenant-secret");expect(JSON.stringify(body)).not.toContain("DO NOT RETURN");expect(body.conformance).toBe("not_verified")
 expect(d.doc).toHaveBeenCalledWith(51,{userId:7,scope:"added"});expect(d.record).toHaveBeenCalledWith(51,uuid)
})
it("does not read exports when the document is outside the authorized scope",async()=>{d.doc.mockResolvedValue(null);expect((await run()).status).toBe(404);expect(d.record).not.toHaveBeenCalled()})
it("does not expose pending exports or malformed identifiers",async()=>{d.record.mockResolvedValue({status:"processing"});expect((await run()).status).toBe(404);d.record.mockClear();expect((await run("","51","bad")).status).toBe(404);expect(d.record).not.toHaveBeenCalled()})
it("enforces bounded paging, rate limit and the original denied gate",async()=>{
 expect((await run("?pageSize=5000")).status).toBe(400);d.limit.mockResolvedValue({allowed:false,retryAfter:60});expect((await run()).status).toBe(429)
 d.gate.mockResolvedValue({ok:false,response:new Response(null,{status:403})});expect((await run()).status).toBe(403)
})
