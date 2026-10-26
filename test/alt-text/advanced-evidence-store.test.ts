import {beforeEach,it,expect,vi} from "vitest"
const d=vi.hoisted(()=>({query:vi.fn(),conn:vi.fn(),enqueue:vi.fn()}))
vi.mock("@/lib/db",()=>({query:d.query,withTransaction:async(fn:any)=>fn({query:d.conn})}))
vi.mock("@/lib/tenant-scope",()=>({currentTenantId:()=>5}))
vi.mock("@/lib/alt-text/math-store",()=>({ensureEvidenceSchema:async()=>{}}))
vi.mock("@/lib/background-jobs",()=>({ensureBackgroundJobSchema:async()=>{},enqueueBackgroundJobInTransaction:d.enqueue}))
const store=await import("@/lib/alt-text/advanced-evidence-store")
const input={kind:"chart_structure",assetId:1,occurrenceId:2,request:{requestId:"request123",regionId:"rgn_chart123",reprocess:false},source:{sourceSha256:"sha"},modelId:"vision1",support:{},actorId:7} as any
beforeEach(()=>{vi.clearAllMocks();d.query.mockResolvedValue([]);d.enqueue.mockResolvedValue({jobId:11});d.conn.mockImplementation(async(sql:string)=>sql.startsWith("SELECT id FROM alt_text_assets")?[[{id:1}]]:sql.startsWith("INSERT")?[{insertId:8}]:[[]])})
it("atomically enqueues existing durable work after its scoped asset lock",async()=>{const result=await store.enqueueAdvancedEvidence(input);expect(result.created).toBe(true);expect(d.conn.mock.calls[0][1]).toEqual([5,1]);expect(d.enqueue).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({tenantId:5,jobType:"alt_text.advanced_analysis",payload:{evidenceId:8}}))})
it("rejects a conflicting identity without charging or scheduling a second job",async()=>{d.conn.mockImplementation(async(sql:string)=>[sql.includes("request_key=?")?[{config_key:"other"}]:[{id:1}]]);await expect(store.enqueueAdvancedEvidence(input)).rejects.toThrow("ADVANCED_REQUEST_CONFLICT");expect(d.enqueue).not.toHaveBeenCalled()})
it("fences stale writes without deleting received evidence",async()=>{d.query.mockResolvedValue({affectedRows:0});await expect(store.writeAdvancedEvidence({id:11,tenant_id:5,worker_id:"stale"} as any,8,"failed")).rejects.toThrow("ADVANCED_LEASE_LOST");expect(d.query.mock.calls.at(-1)?.[0]).toContain("IF(? IS NULL,e.result_json");expect(d.query.mock.calls.at(-1)?.[1]).toContain("stale")})
it("reads only one tenant/asset/occurrence/kind",async()=>{await store.listAdvancedEvidence(1,2,"chart_structure");expect(d.query.mock.calls[0][1]).toEqual([5,1,2,"chart_structure"])})
