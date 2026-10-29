import {beforeEach,expect,it,vi} from "vitest"
const d=vi.hoisted(()=>({tenant:5,profiles:new Map<string,any>(),versions:new Map<string,any>(),legacy:new Map<number,any>(),calls:[] as any[],transaction:Promise.resolve() as Promise<any>}))
const key=(t:number,id:string)=>`${t}:${id}`
async function sql(text:string,p:any[]=[]):Promise<any>{
 d.calls.push([text,p]);if(text.startsWith("CREATE"))return []
 if(text.includes("SELECT tenant_id FROM alt_text_settings"))return [{tenant_id:p[0]}]
 if(text.startsWith("INSERT IGNORE INTO alt_text_settings"))return {affectedRows:0}
 if(text.startsWith("SELECT id FROM alt_text_client_guideline_profiles")){
  if(text.includes("client_name=?"))return [...d.profiles.values()].filter(r=>r.tenant===p[0]&&r.client_name.toLowerCase()===p[1].toLowerCase()&&r.id!==p[2]).map(r=>({id:r.id}))
  const r=d.profiles.get(key(p[0],"tenant-client-guideline"));return r?[{id:r.id}]:[]
 }
 if(text.includes("COUNT(*) AS n"))return [{n:[...d.profiles.values()].filter(r=>r.tenant===p[0]&&(!text.includes("archived=0")||!r.archived)&&(!text.includes("LOCATE")||r.client_name.toLowerCase().includes(p[1]))).length}]
 if(text.startsWith("INSERT")&&text.includes("INTO alt_text_client_guideline_profiles")){
  const legacy=text.includes("'tenant-client-guideline'"),tenant=p[0],id=legacy?"tenant-client-guideline":p[1]
  if(!d.profiles.has(key(tenant,id)))d.profiles.set(key(tenant,id),{tenant,id,client_name:p[legacy?1:2],current_version:p[legacy?2:3],archived:0,updated_at:"2026-10-29T12:00:00Z"})
  return {affectedRows:1}
 }
 if(text.startsWith("UPDATE alt_text_client_guideline_profiles")){const r=d.profiles.get(key(p[4],p[5]));if(r)Object.assign(r,{client_name:p[0],current_version:p[1],archived:p[2]});return {affectedRows:r?1:0}}
 if(text.startsWith("INSERT")&&text.includes("INTO alt_text_client_guideline_versions")){
  const legacy=text.includes("'tenant-client-guideline'"),tenant=p[0],id=legacy?"tenant-client-guideline":p[1],version=p[legacy?1:2],k=`${key(tenant,id)}:${version}`
  if(!d.versions.has(k))d.versions.set(k,{version,client_name:p[legacy?2:3],policy_json:p[legacy?3:4]})
  return {affectedRows:1}
 }
 if(text.startsWith("SELECT p.id")){
  if(text.includes("LOCATE"))return [...d.profiles.values()].filter(r=>r.tenant===p[0]&&(!text.includes("archived=0")||!r.archived)&&r.client_name.toLowerCase().includes(p[1])).sort((a,b)=>a.client_name.localeCompare(b.client_name)).slice(p[2],p[2]+20).map(r=>({...r,...d.versions.get(`${key(r.tenant,r.id)}:${r.current_version}`)}))
  const r=d.profiles.get(key(p[0],p[1]));if(!r||text.includes("AND p.archived=0")&&r.archived)return []
  const v=d.versions.get(`${key(p[0],p[1])}:${text.includes("v.version=p.current_version")?r.current_version:p[2]}`);return v?[{...r,...v}]:[]
 }
 throw new Error(`Unmodelled query: ${text}`)
}
vi.mock("@/lib/db",()=>({query:(s:string,p:any[])=>sql(s,p),withTransaction:(fn:any)=>{const run=d.transaction.then(()=>fn({query:async(s:string,p:any[])=>[await sql(s,p)]}));d.transaction=run.catch(()=>{});return run}}))
vi.mock("@/lib/tenant-scope",()=>({currentTenantId:()=>d.tenant}))
vi.mock("@/lib/alt-text/store",()=>({ensureAltTextSchema:async()=>{},getSettingsRecord:async()=>d.legacy.get(d.tenant)??{clientGuideline:null}}))
import {getClientProfile,importLegacyClientProfile,listClientProfiles,mutateClientProfile,resolveSelectedClientGuideline} from "@/lib/alt-text/client-guideline-profile-store"
import {parseClientProfileMutation} from "@/lib/alt-text/client-guideline-profiles"
const policy=(name:string,term=name)=>({enabled:true,clientName:name,requiredLiterals:[term],forbiddenLiterals:[],requireLong:false})
const create=(name:string)=>mutateClientProfile({action:"create",policy:policy(name)},7)
beforeEach(()=>{d.tenant=5;d.profiles.clear();d.versions.clear();d.legacy.clear();d.calls=[];d.transaction=Promise.resolve()})
it("keeps several named clients searchable without a globally active client",async()=>{await create("Client A");await create("Client D");expect((await listClientProfiles("client d",1,false)).items.map(p=>p.clientName)).toEqual(["Client D"]);expect(await resolveSelectedClientGuideline({})).toBeNull()})
it("lets two writers resolve A and D independently while editing A creates a new immutable version",async()=>{
 const a=await create("Client A"),b=await create("Client D"),aSelection={clientGuidelineId:a.id,clientGuidelineVersion:1},dSelection={clientGuidelineId:b.id,clientGuidelineVersion:1}
 const [expertA,expertB]=await Promise.all([resolveSelectedClientGuideline(aSelection),resolveSelectedClientGuideline(dSelection)])
 await mutateClientProfile({action:"update",id:a.id,expectedVersion:1,policy:policy("Client A","new rule A")},8)
 expect(expertA).toMatchObject({id:a.id,clientName:"Client A",version:"1",rules:[{text:"Client A"}]});expect(expertB).toMatchObject({id:b.id,clientName:"Client D",version:"1",rules:[{text:"Client D"}]})
 expect((await resolveSelectedClientGuideline(aSelection))?.rules).toEqual(expertA?.rules);expect((await getClientProfile(a.id,2))?.requiredLiterals).toEqual(["new rule A"])
})
it("rejects another tenant's guessed profile/version and does not expose its name in search",async()=>{const a=await create("Tenant 5 private client");d.tenant=6;expect(await getClientProfile(a.id,1,true)).toBeNull();expect((await listClientProfiles("",1,true)).items).toEqual([]);await expect(resolveSelectedClientGuideline({clientGuidelineId:a.id,clientGuidelineVersion:1})).rejects.toMatchObject({status:409,code:"CLIENT_GUIDELINE_UNAVAILABLE"});await expect(mutateClientProfile({action:"archive",id:a.id,expectedVersion:1},9)).rejects.toMatchObject({status:404})})
it("does not overwrite concurrent edits to one client",async()=>{const a=await create("Client A");const results=await Promise.allSettled([mutateClientProfile({action:"update",id:a.id,expectedVersion:1,policy:policy("Client A","first edit")},7),mutateClientProfile({action:"update",id:a.id,expectedVersion:1,policy:policy("Client A","stale edit")},8)]);expect(results.map(r=>r.status)).toEqual(["fulfilled","rejected"]);expect((results[1] as PromiseRejectedResult).reason).toMatchObject({code:"CLIENT_GUIDELINE_CONFLICT"});expect((await getClientProfile(a.id,1))?.requiredLiterals).toEqual(["Client A"])})
it("archives new-generation availability while retaining old rules for QA/history, and supports restore",async()=>{const a=await create("Client A");await mutateClientProfile({action:"archive",id:a.id,expectedVersion:1},7);await expect(resolveSelectedClientGuideline({clientGuidelineId:a.id,clientGuidelineVersion:1})).rejects.toMatchObject({status:409});expect(await getClientProfile(a.id,1,true)).toMatchObject({archived:true,version:1});await mutateClientProfile({action:"restore",id:a.id,expectedVersion:2},7);expect((await resolveSelectedClientGuideline({clientGuidelineId:a.id,clientGuidelineVersion:1}))?.version).toBe("1")})
it("migrates each tenant's previous saved policy once without selecting it for any writer",async()=>{d.legacy.set(5,{clientGuideline:{...policy("Old Client"),version:4},updatedBy:8});await importLegacyClientProfile(7);await importLegacyClientProfile(9);expect((await listClientProfiles("",1,false)).items).toMatchObject([{id:"tenant-client-guideline",clientName:"Old Client",version:4}]);expect(await resolveSelectedClientGuideline({})).toBeNull();expect([...d.versions.keys()]).toHaveLength(1);d.tenant=6;expect(await getClientProfile("tenant-client-guideline",4,true)).toBeNull()})
it("uses bounded server paging and literal parameterized search, including SQL-like names",async()=>{for(let i=0;i<24;i++)await create(`Client ${String(i).padStart(2,"0")}`);expect((await listClientProfiles("",1,false)).items).toHaveLength(20);expect((await listClientProfiles("",2,false)).items).toHaveLength(4);await listClientProfiles("%' or 1=1",1,false);const call=d.calls.filter(([s])=>s.includes("LOCATE")).at(-1);expect(call[0]).not.toContain("or 1=1");expect(call[1]).toContain("%' or 1=1")})
it("requires distinct client names and exact saved version contracts",async()=>{await create("Client A");await expect(create("client a")).rejects.toMatchObject({code:"CLIENT_NAME_EXISTS"});expect(parseClientProfileMutation({action:"create",policy:policy("New"),tenantId:6})).toBeNull();expect(parseClientProfileMutation({action:"update",id:"client_A",expectedVersion:0,policy:policy("New")})).toBeNull();expect(parseClientProfileMutation({action:"create",id:"forged_id",policy:policy("New")})).toBeNull();expect(parseClientProfileMutation({action:"archive",id:"client_A",expectedVersion:1,policy:policy("New")})).toBeNull()})
