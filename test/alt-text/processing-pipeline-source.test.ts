import {beforeEach,it,expect,vi} from "vitest"
import {createHash} from "node:crypto"
const d=vi.hoisted(()=>({authorize:vi.fn(),preview:vi.fn(),bytes:vi.fn(),query:vi.fn(),scope:vi.fn()}))
vi.mock("@/lib/tenant-scope",()=>({currentTenantId:()=>5}))
vi.mock("@/lib/db",()=>({query:d.query}))
vi.mock("@/lib/permission-store",()=>({getScope:d.scope,hasActionGrant:async()=>true}))
vi.mock("@/lib/alt-text/advanced-quality-source",()=>({authorizeQualitySource:d.authorize}))
vi.mock("@/lib/alt-text/preview",()=>({openAltTextImage:d.preview}))
vi.mock("@/lib/alt-text/generate",()=>({readImageBytes:d.bytes}))
import {processingSourceMetadata,processingSourceFingerprint,loadProcessingActor} from "@/lib/alt-text/processing-pipeline-source"
const actor={tenantId:5,userId:7,role:"employee",viewScope:"all",updateScope:"added"} as const
beforeEach(()=>{vi.clearAllMocks();d.authorize.mockResolvedValue({asset:{id:1,createdBy:7,reviewerId:null},document:{kind:"standalone"}});d.preview.mockResolvedValue({ok:true,body:Buffer.from("private source")});d.bytes.mockImplementation(async(v:any)=>v);d.query.mockResolvedValue([{id:7,role:"employee",status:"active"}]);d.scope.mockResolvedValue("added")})
it("rejects another tenant's actor before any asset/document lookup",async()=>{await expect(processingSourceMetadata(1,42,{...actor,tenantId:6})).rejects.toMatchObject({status:403,code:"TENANT_MISMATCH"});expect(d.authorize).not.toHaveBeenCalled();expect(d.preview).not.toHaveBeenCalled()})
it("honors exact document/occurrence revocation before opening private image bytes",async()=>{d.authorize.mockRejectedValue(new Error("document occurrence revoked"));await expect(processingSourceFingerprint(1,42,actor)).rejects.toThrow("document occurrence revoked");expect(d.preview).not.toHaveBeenCalled()})
it("requires image-level update scope in addition to document visibility",async()=>{d.authorize.mockResolvedValue({asset:{createdBy:8,reviewerId:null},document:{kind:"standalone"}});await expect(processingSourceFingerprint(1,null,actor)).rejects.toMatchObject({status:403});expect(d.preview).not.toHaveBeenCalled()})
it("hashes bounded scan-cleared bytes and carries exact document location metadata",async()=>{d.authorize.mockResolvedValue({asset:{createdBy:7,reviewerId:null},document:{kind:"document",document:{documentId:9,imageOccurrenceId:42,locationLabel:"Page 3"}}});const result=await processingSourceFingerprint(1,42,actor);expect(result).toMatchObject({sourceSha256:createHash("sha256").update("private source").digest("hex"),documentId:9,locationLabel:"Page 3"});expect(d.bytes.mock.calls[0][1]).toBe(20*1024*1024);expect(d.preview.mock.calls[0]).toEqual([1,{tenantId:5,userId:7,scope:"all"}])})
it("does not process unsafe or oversized private sources",async()=>{d.preview.mockResolvedValueOnce({ok:false,status:423,code:"SCAN_PENDING",error:"scan pending"});await expect(processingSourceFingerprint(1,null,actor)).rejects.toMatchObject({code:"SCAN_PENDING"});d.bytes.mockResolvedValue(null);await expect(processingSourceFingerprint(1,null,actor)).rejects.toMatchObject({status:413,code:"PIPELINE_SOURCE_LIMIT"})})
it("loads the worker submitter from its tenant with current permissions",async()=>{expect(await loadProcessingActor(5,7)).toMatchObject({tenantId:5,userId:7,viewScope:"added",updateScope:"added"});expect(d.query.mock.calls[0][1]).toEqual([5,7]);expect(d.scope).toHaveBeenCalledWith(7,"employee","publishing.alt_text","update")})
it("does not continue for inactive users or revoked update permissions",async()=>{d.query.mockResolvedValueOnce([{status:"inactive"}]);expect(await loadProcessingActor(5,7)).toBeNull();expect(d.scope).not.toHaveBeenCalled();d.scope.mockResolvedValueOnce("all").mockResolvedValueOnce("none");expect(await loadProcessingActor(5,7)).toBeNull()})
