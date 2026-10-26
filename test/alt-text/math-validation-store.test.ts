import {beforeEach,describe,it,expect,vi} from "vitest"
const d=vi.hoisted(()=>({query:vi.fn(),conn:vi.fn()}))
vi.mock("@/lib/db",()=>({query:d.query,withTransaction:async(fn:any)=>fn({query:d.conn})}))
vi.mock("@/lib/tenant-scope",()=>({currentTenantId:()=>5}))
vi.mock("@/lib/alt-text/math-store",()=>({ensureEvidenceSchema:async()=>{}}))
const store=await import("@/lib/alt-text/math-validation-store")
const source={id:8,regionId:"rgn_12345678",result:{candidateLatex:String.raw`\frac{a}{b}`,analysisId:"math_123",source:{regionId:"rgn_12345678"}}} as any
beforeEach(()=>{vi.clearAllMocks();d.query.mockResolvedValue([]);d.conn.mockImplementation(async(sql:string)=>{
 if(sql.includes("FROM alt_text_assets"))return [[{id:1}]]
 if(sql.includes("kind='math_recognition'"))return [[{result_json:{candidateLatex:source.result.candidateLatex}}]]
 if(sql.startsWith("INSERT"))return [{insertId:10}]
 return [[]]
})})
describe("validation evidence persistence",()=>{
 it("adds a new evidence kind referencing its original candidate without altering recognition",async()=>{
  const result=await store.saveEquationValidation(1,2,source,7)
  expect(result.record.result.originalCandidate).toBe(source.result.candidateLatex)
  expect(result.record.result.sourceEvidenceId).toBe(8);expect(result.record.result.mathmlStatus).toBe("generated")
  expect(d.conn.mock.calls.some(([sql])=>/^(UPDATE|DELETE)\b/.test(sql))).toBe(false)
  expect(d.conn.mock.calls.find(([sql])=>sql.startsWith("INSERT"))?.[1]).toContain(5)
 })
 it("does not persist against a parent absent from this tenant/occurrence",async()=>{
  d.conn.mockImplementation(async(sql:string)=>sql.includes("FROM alt_text_assets")?[[{id:1}]]:[[]])
  await expect(store.saveEquationValidation(1,2,source,7)).rejects.toThrow("MATH_SOURCE_CHANGED")
  expect(d.conn.mock.calls.some(([sql])=>sql.startsWith("INSERT"))).toBe(false)
 })
 it("reuses an identical parser/policy validation",async()=>{
  d.conn.mockImplementation(async(sql:string)=>{
   if(sql.includes("config_key=?"))return [[{id:9,version:2,result_json:{sourceEvidenceId:8}}]]
   if(sql.includes("kind='math_recognition'"))return [[{result_json:{candidateLatex:source.result.candidateLatex}}]]
   return [[{id:1}]]
  })
  expect(await store.saveEquationValidation(1,2,source,7)).toMatchObject({replayed:true,record:{id:9}})
  expect(d.conn.mock.calls.some(([sql])=>sql.startsWith("INSERT"))).toBe(false)
 })
 it("reads only this tenant, asset and occurrence",async()=>{await store.readEquationValidations(1,2);expect(d.query.mock.calls[0][1]).toEqual([5,1,2])})
})

