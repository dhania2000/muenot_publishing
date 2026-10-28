import {it,expect,vi} from "vitest"
const query=vi.hoisted(()=>vi.fn().mockResolvedValue([]))
vi.mock("@/lib/db",()=>({query}))
vi.mock("@/lib/tenant-scope",()=>({currentTenantId:()=>5}))
vi.mock("@/lib/alt-text/math-store",()=>({ensureEvidenceSchema:async()=>{}}))
vi.mock("@/lib/alt-text/ocr-review-store",()=>({ensureOcrReviewSchema:async()=>{}}))
import {parseStructuredQueue,listStructuredReviewQueue} from "@/lib/alt-text/structured-review-queue"
it.each(["page=0","pageSize=51","state=approved","reviewerId=-1","priority=critical","source=other","kind=ocr_review"])("rejects unsupported/unbounded filter %s",s=>expect(parseStructuredQueue(new URLSearchParams(s))).toBeNull())
it("parameterizes search/filter values and paginates metadata without loading raw JSON",async()=>{query.mockClear();const f=parseStructuredQueue(new URLSearchParams({page:"2",pageSize:"10",search:"20%_!",state:"corrected",priority:"warnings",source:"document",reviewerId:"9",kind:"chart_data"}))!;await listStructuredReviewQueue({userId:7,viewScope:"added"},f);expect(query).toHaveBeenCalledTimes(2);const [sql,params]=query.mock.calls[1];expect(params).toEqual([5,7,7,"%20!%!_!!%","corrected","warnings",9,"chart_data",10,10]);expect(sql).toContain("a.created_by=?");expect(sql).toContain("d.uploaded_by=?");expect(sql).toContain("d.security_scan_status='clean'");expect(sql).toContain("n.tenant_id=r.tenant_id");expect(sql).not.toMatch(/SELECT\s+e\.result_json/);expect(sql).not.toContain("SELECT e.*");expect(sql).not.toContain("20%_!");expect(sql).toContain("LIMIT ? OFFSET ?")})
