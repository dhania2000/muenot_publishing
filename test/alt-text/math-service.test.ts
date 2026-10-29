import "server-only"
vi.mock("@/lib/alt-text/evidence-document-authorization",()=>({evidenceDocumentAllowed:async()=>true}))
import {beforeEach,describe,it,expect,vi} from "vitest"
const d=vi.hoisted(()=>({asset:vi.fn(),occurrence:vi.fn(),analysis:vi.fn(),settings:vi.fn(),health:vi.fn(),open:vi.fn(),enqueue:vi.fn(),list:vi.fn()}))
vi.mock("@/lib/alt-text/store",()=>({getAsset:d.asset,occurrenceBelongsToAsset:d.occurrence,getLatestRegionAnalysis:d.analysis,getSettingsRecord:d.settings}))
vi.mock("@/lib/alt-text/math-engine",()=>({checkMathReadiness:d.health,MATH_MODEL:{revision:"pinned"}}))
vi.mock("@/lib/alt-text/preview",()=>({openAltTextImage:d.open}))
vi.mock("@/lib/alt-text/math-store",()=>({enqueueMathEvidence:d.enqueue,listMathEvidence:d.list}))
vi.mock("@/lib/alt-text/math-validation-store",()=>({readEquationValidations:async()=>[]}))
const {runForTenant}=await import("@/lib/tenant-scope")
const service=await import("@/lib/alt-text/math-service")
const actor={userId:7,viewScope:"added",updateScope:"added"} as const
const request={requestId:"request_123",regionId:"rgn_12345678",analysisId:"rga_12345678",occurrenceId:2}
const run=()=>runForTenant({tenantId:5},()=>service.startMathRecognition(1,request,actor))
beforeEach(()=>{vi.clearAllMocks();d.asset.mockResolvedValue({id:1,createdBy:7});d.occurrence.mockResolvedValue(true);d.analysis.mockResolvedValue(null);d.settings.mockResolvedValue({settings:{},accessibility:{},revision:1});d.health.mockResolvedValue({available:false,reason:"not provisioned"});d.list.mockResolvedValue([])})
describe("math ownership and read-only behavior",()=>{
 it("hides assets missing from the tenant and denies foreign occurrences before image access",async()=>{
  d.asset.mockResolvedValueOnce(null);await expect(run()).rejects.toMatchObject({status:404})
  d.occurrence.mockResolvedValue(false);await expect(run()).rejects.toMatchObject({status:404});expect(d.open).not.toHaveBeenCalled();expect(d.enqueue).not.toHaveBeenCalled()
 })
 it("enforces update-own independently of broader view access",async()=>{
  d.asset.mockResolvedValue({id:1,createdBy:8});await expect(runForTenant({tenantId:5},()=>service.startMathRecognition(1,request,{...actor,viewScope:"all"}))).rejects.toMatchObject({status:403});expect(d.open).not.toHaveBeenCalled()
 })
 it("fails closed when the runtime is unavailable",async()=>{await expect(run()).rejects.toMatchObject({code:"MATH_UNAVAILABLE"});expect(d.enqueue).not.toHaveBeenCalled()})
 it("reads saved evidence without opening the image or starting a job",async()=>{
  const response=await runForTenant({tenantId:5},()=>service.readMathResults(1,2,actor));expect(response.available).toBe(false);expect(response.results).toEqual([]);expect(d.open).not.toHaveBeenCalled();expect(d.enqueue).not.toHaveBeenCalled()
 })
 it("rejects stale equation identities before opening an image",async()=>{await expect(runForTenant({tenantId:5},()=>service.resolveEquationSource(1,2,request,{userId:7,tenantId:5,scope:"added"}))).rejects.toMatchObject({code:"MATH_REGION_CHANGED"});expect(d.open).not.toHaveBeenCalled()})
})

