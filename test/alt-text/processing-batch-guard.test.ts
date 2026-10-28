import {beforeEach,it,expect,vi} from "vitest"
const d=vi.hoisted(()=>({query:vi.fn()}))
vi.mock("@/lib/db",()=>({query:d.query}))
vi.mock("@/lib/tenant-scope",()=>({currentTenantId:()=>5}))
import {guardProcessingBatchAsset} from "@/lib/alt-text/processing-batch-guard"
import {JobCancelledError,JobDeferredError} from "@/lib/job-retry-policy"
beforeEach(()=>vi.clearAllMocks())
it.each(["pause_requested","paused"])("parks an existing image/analysis before dispatch when its batch is %s",async status=>{d.query.mockResolvedValue([{status}]);await expect(guardProcessingBatchAsset(7)).rejects.toBeInstanceOf(JobDeferredError);expect(d.query.mock.calls[0][1]).toEqual([5,7])})
it.each(["cancel_requested","cancelled"])("cancels remaining image stages when its batch is %s",async status=>{d.query.mockResolvedValue([{status}]);await expect(guardProcessingBatchAsset(7)).rejects.toBeInstanceOf(JobCancelledError)})
it("allows resumed batches and independent standalone images without manufacturing a document page job",async()=>{d.query.mockResolvedValueOnce([{status:"processing"}]).mockResolvedValueOnce([]);await expect(guardProcessingBatchAsset(7)).resolves.toBeUndefined();await expect(guardProcessingBatchAsset(8)).resolves.toBeUndefined();expect(d.query.mock.calls[0][0]).not.toContain("document_page")})
