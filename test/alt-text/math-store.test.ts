import {beforeEach,describe,it,expect,vi} from "vitest"
const d=vi.hoisted(()=>({query:vi.fn(),conn:vi.fn(),enqueue:vi.fn()}))
vi.mock("@/lib/db",()=>({query:d.query,withTransaction:async(fn:any)=>fn({query:d.conn})}))
vi.mock("@/lib/tenant-scope",()=>({currentTenantId:()=>5}))
vi.mock("@/lib/alt-text/store",()=>({ensureAltTextSchema:async()=>{}}))
vi.mock("@/lib/background-jobs",()=>({ensureBackgroundJobSchema:async()=>{},enqueueBackgroundJobInTransaction:d.enqueue}))
const store=await import("@/lib/alt-text/math-store")
const input={assetId:1,occurrenceId:2,request:{requestId:"request123",regionId:"rgn_12345678",analysisId:"rga_12345678",occurrenceId:2,reprocess:false},source:{sourceSha256:"sha"},modelFingerprint:"pinned",analysisId:"rga_12345678",actorId:7} as any
beforeEach(()=>{vi.clearAllMocks();d.query.mockResolvedValue([]);d.enqueue.mockResolvedValue({jobId:11});d.conn.mockImplementation(async(sql:string)=>sql.startsWith("SELECT id FROM alt_text_assets")?[[{id:1}]]:sql.startsWith("INSERT")?[{insertId:9}]:[[]])})
describe("versioned mathematical evidence",()=>{
 it("atomically records evidence and an existing queue job with tenant scope",async()=>{
  const result=await store.enqueueMathEvidence(input);expect(result.created).toBe(true);expect(d.enqueue).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({tenantId:5,jobType:"alt_text.math_recognition",payload:{evidenceId:9},concurrencyLimit:1}))
  const lock=d.conn.mock.calls[0];expect(lock[0]).toContain("tenant_id=?");expect(lock[1]).toEqual([5,1])
 })
 it("rejects a conflicting request identity without scheduling another job",async()=>{
  d.conn.mockImplementation(async(sql:string)=>[sql.includes("request_key=?")?[{config_key:"different"}]:[{id:1}]])
  await expect(store.enqueueMathEvidence(input)).rejects.toThrow("MATH_REQUEST_CONFLICT");expect(d.enqueue).not.toHaveBeenCalled()
 })
 it("fences stale worker writes while preserving older results",async()=>{
  d.query.mockResolvedValue({affectedRows:0});await expect(store.writeMathState({id:11,tenant_id:5,worker_id:"old"} as any,9,"failed")).rejects.toThrow("MATH_LEASE_LOST")
  const [sql,params]=d.query.mock.calls.at(-1)!;expect(sql).toContain("lease_expires_at>UTC_TIMESTAMP()");expect(sql).toContain("IF(? IS NULL,e.result_json");expect(params).toContain("old")
 })
 it("reads only the requested tenant, asset and occurrence",async()=>{await store.listMathEvidence(1,2);expect(d.query.mock.calls.at(-1)?.[1]).toEqual([5,1,2])})
})
