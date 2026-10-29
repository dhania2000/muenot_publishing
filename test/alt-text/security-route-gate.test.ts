import {beforeEach,it,expect,vi} from "vitest"
const d=vi.hoisted(()=>({view:"all",update:"added",approve:"owned",export:"added",feature:vi.fn()}))
vi.mock("@/lib/api-auth",()=>({requireFeatureInModule:d.feature}))
vi.mock("@/lib/permission-store",()=>({getScope:async(_u:any,_r:any,_m:any,action:string)=>action==="view"?d.view:d.update,getActionScope:async(_u:any,_r:any,_m:any,action:string)=>action==="approve"?d.approve:d.export}))
vi.mock("@/lib/tenant-scope",()=>({currentTenantIdOrNull:()=>5}))
import {gateAltTextHistory} from "@/lib/alt-text/route-gate"
beforeEach(()=>{vi.clearAllMocks();Object.assign(d,{view:"all",update:"added",approve:"owned",export:"added"});d.feature.mockResolvedValue({ok:true,session:{userId:7,role:"employee"}})})
it("carries record action scopes rather than reducing them to booleans",async()=>{expect(await gateAltTextHistory({export:true,withPermissions:true})).toMatchObject({ok:true,actor:{userId:7,viewScope:"all",exportScope:"added",approveScope:"owned",updateScope:"added"}})})
it("includes the required actual update scope on review-only routes",async()=>{expect(await gateAltTextHistory({review:true})).toMatchObject({ok:true,actor:{approveScope:"owned",updateScope:"added"}})})
it("denies missing export, update or approval actions before a service can use a target ID",async()=>{d.export="none";const exportGate=await gateAltTextHistory({export:true});expect(exportGate.ok).toBe(false);d.update="none";expect((await gateAltTextHistory({review:true})).ok).toBe(false);d.update="all";d.approve="none";expect((await gateAltTextHistory({review:true})).ok).toBe(false)})
it("does not resolve action permissions for an unauthenticated request",async()=>{d.feature.mockResolvedValue({ok:false,status:401,error:"Unauthenticated"});const result=await gateAltTextHistory({export:true});expect(result.ok).toBe(false);if(!result.ok)expect(result.response.status).toBe(401)})
