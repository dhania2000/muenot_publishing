import {beforeEach,expect,it,vi} from "vitest"
const d=vi.hoisted(()=>({tenant:5,current:{} as any,writes:[] as any[],query:vi.fn()}))
vi.mock("@/lib/tenant-scope",()=>({currentTenantId:()=>d.tenant}))
vi.mock("@/lib/db",()=>({query:d.query,withTransaction:async(fn:any)=>fn({query:async(sql:string,p:any[])=>{if(sql.startsWith("SELECT settings")){expect(p).toEqual([d.tenant]);return [[{settings:JSON.stringify(d.current)}]]}d.writes.push(p);return [{affectedRows:1}]}})}))
import {getSettingsRecord,saveSettingsRecord} from "@/lib/alt-text/store"
import {DEFAULT_SETTINGS} from "@/lib/alt-text/core"
const config={enabled:true,clientName:"Client A",requiredLiterals:["H₂O"],forbiddenLiterals:[],requireLong:false}
beforeEach(()=>{vi.clearAllMocks();d.current={revision:4,accessibility:{ocr:{enabled:true}},clientGuideline:{...config,version:2}};d.writes=[];d.tenant=5;d.query.mockImplementation(async(sql:string,p:any[])=>sql.startsWith("SELECT settings, updated")?(p[0]===5?[{settings:JSON.stringify(d.current)}]:[]):[])})
it("reads the current tenant's guideline and never a guessed tenant's row",async()=>{expect((await getSettingsRecord()).clientGuideline).toMatchObject({version:2,clientName:"Client A"});d.tenant=6;expect((await getSettingsRecord()).clientGuideline?.enabled).toBe(false)})
it("preserves policy/version during ordinary settings writes",async()=>{await saveSettingsRecord({settings:DEFAULT_SETTINGS,expectedRevision:4},7);const next=JSON.parse(d.writes[0][1]);expect(next.clientGuideline).toEqual({...config,version:2});expect(next.accessibility).toEqual(d.current.accessibility)})
it("versions only guideline changes and keeps actor/tenant audit identity",async()=>{await saveSettingsRecord({settings:DEFAULT_SETTINGS,clientGuideline:{...config,requireLong:true},expectedRevision:4},7);expect(d.writes[0][0]).toBe(5);expect(d.writes[0][2]).toBe(7);expect(JSON.parse(d.writes[0][1]).clientGuideline).toMatchObject({version:3,requireLong:true})})
it("does not overwrite a concurrent settings revision",async()=>{expect(await saveSettingsRecord({settings:DEFAULT_SETTINGS,clientGuideline:config,expectedRevision:3},7)).toEqual({ok:false,reason:"conflict",revision:4});expect(d.writes).toEqual([])})
