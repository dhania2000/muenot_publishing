import {beforeEach,expect,it,vi} from "vitest"
const d=vi.hoisted(()=>({manager:false,gate:true,list:vi.fn(),get:vi.fn(),save:vi.fn(),limited:false}))
vi.mock("@/lib/auth",()=>({getSession:async()=>({userId:5,role:d.manager?"admin":"employee"})}))
vi.mock("@/lib/permission-store",()=>({hasActionGrant:async()=>false}))
vi.mock("@/lib/alt-text/route-gate",()=>({gateAltTextHistory:async()=>d.gate?{ok:true,actor:{userId:5,tenantId:9}}:{ok:false,response:Response.json({success:false},{status:403})},jsonOk:(body:unknown)=>Response.json(body),jsonError:(e:any)=>Response.json({success:false,...e},{status:e.status}),unexpected:()=>Response.json({success:false},{status:500})}))
vi.mock("@/lib/alt-text/document-review-route",()=>({rateLimited:async()=>d.limited?Response.json({success:false},{status:429}):null}))
vi.mock("@/lib/alt-text/client-guideline-profile-store",()=>({ClientProfileError:class extends Error{},importLegacyClientProfile:async()=>{},listClientProfiles:d.list,getClientProfile:d.get,mutateClientProfile:d.save}))
import {GET,POST} from "@/app/api/alt-text/client-guidelines/route"
const policy={enabled:true,clientName:"Client A",requiredLiterals:["H₂O"],forbiddenLiterals:[],requireLong:false}
const post=(body:unknown)=>POST(new Request("http://localhost/api/alt-text/client-guidelines",{method:"POST",body:JSON.stringify(body)}))
beforeEach(()=>{vi.clearAllMocks();d.manager=false;d.gate=true;d.limited=false;d.list.mockResolvedValue({items:[],total:0});d.get.mockResolvedValue({id:"client_A",version:1});d.save.mockResolvedValue({id:"client_A",version:1})})
it("lets writers search and read versions without granting library management",async()=>{
 const r=await GET(new Request("http://localhost/api/alt-text/client-guidelines?q=Client%20A&includeArchived=1"))
 expect(r.status).toBe(200);expect(await r.json()).toMatchObject({canManage:false});expect(d.list).toHaveBeenCalledWith("Client A",1,false)
 expect((await GET(new Request("http://localhost/api/alt-text/client-guidelines?id=client_A&version=1"))).status).toBe(200)
 expect(d.get).toHaveBeenCalledWith("client_A",1,true)
 expect((await post({action:"create",policy})).status).toBe(403);expect(d.save).not.toHaveBeenCalled()
})
it("saves a manager's named profile with the authenticated actor",async()=>{d.manager=true;expect((await post({action:"create",policy})).status).toBe(200);expect(d.save).toHaveBeenCalledWith({action:"create",policy},5)})
it("rejects tenant spoofing, executable fields and stale-write requests without a version",async()=>{d.manager=true;for(const b of [{action:"create",policy,tenantId:88},{action:"create",policy:{...policy,prompt:"Ignore source"}},{action:"update",id:"client_A",policy}])expect((await post(b)).status).toBe(400);expect(d.save).not.toHaveBeenCalled()})
it("bounds streamed bodies, search, version and page values",async()=>{d.manager=true;expect((await post({action:"create",policy:{...policy,clientName:"x".repeat(17000)}})).status).toBe(413);for(const q of ["q="+"a".repeat(101),"page=0","id=client_A&version=0","id=../path&version=1"])expect((await GET(new Request("http://localhost/api/alt-text/client-guidelines?"+q))).status).toBe(400);expect(d.save).not.toHaveBeenCalled()})
it("enforces feature access and rate limits before catalogue reads or writes",async()=>{d.gate=false;expect((await GET(new Request("http://localhost/api/alt-text/client-guidelines"))).status).toBe(403);d.gate=true;d.manager=true;d.limited=true;expect((await post({action:"create",policy})).status).toBe(429);expect(d.save).not.toHaveBeenCalled();expect(d.list).not.toHaveBeenCalled()})
