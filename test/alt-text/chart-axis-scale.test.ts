import {describe,it,expect} from "vitest"
import {parseAxisScalar,deriveAxisScale} from "@/lib/alt-text/chart-axis-scale"
import {readFile} from "node:fs/promises"
const ticks=(texts:string[],positions=texts.map((_t,i)=>i*100))=>texts.map((text,i)=>({labelId:`label${i}`,text,position:positions[i],scalar:parseAxisScalar(text)}))
describe("reviewed tick notation",()=>{
 for(const [text,value,kind,unit] of [["-12.5",-12.5,"number",null],["−२.५",-2.5,"number",null],["२०%",20,"percentage","%"],["1e-3",.001,"scientific",null],["1.5×10^{-3} m",.0015,"scientific","m"],["10⁻²",.01,"scientific",null],["10 kg",10,"number","kg"],["1 l",1,"number","l"],["12:30",45000000,"time",null]] as const)
 it(`preserves and parses ${text}`,()=>expect(parseAxisScalar(text)).toMatchObject({raw:text,value,kind,unit}))
 for(const text of ["1,234","01/02/2026","1O","10^{2","10^}2{","1x10^3","0 10 20","10 20 kg","2026-02-30","25:00","1.2.3","1e-1000","10^-1000","NaN","Infinity","∞"])
 it(`leaves ambiguous/malformed ${text} unknown`,()=>expect(parseAxisScalar(text).kind).toBe("unknown"))
 it("preserves Hindi categorical labels and missing units",()=>{expect(parseAxisScalar("समय")).toMatchObject({kind:"category",raw:"समय",unit:null});expect(parseAxisScalar("10").unit).toBeNull()})
 it("preserves an explicitly printed Hindi unit with combining marks",()=>expect(parseAxisScalar("१० सेकंड")).toMatchObject({kind:"number",value:10,unit:"सेकंड",raw:"१० सेकंड"}))
})
describe("candidate scale models with no zero assumption",()=>{
 it("fits linear and non-zero-baseline ticks only within their observed interval",()=>{
  const scale=deriveAxisScale(ticks(["40","60","80"]));expect(scale.kind).toBe("linear_numeric");expect(scale.model).toMatchObject({pixelRange:[0,200],valueAtPixelRange:[40,80],slope:.2,intercept:40});expect(scale.usableForPixelExtraction).toBe(false)
 })
 it("retains reversed axes",()=>{const scale=deriveAxisScale(ticks(["80","60","40"]));expect(scale.kind).toBe("linear_numeric");expect(scale.direction).toBe("decreasing_with_pixel")})
 it("recognizes logarithmic spacing without forcing a linear fit",()=>{const scale=deriveAxisScale(ticks(["1","10","100","1000"]));expect(scale.kind).toBe("logarithmic");expect(scale.model?.transform).toBe("log10")})
 it("supports reviewed percentages, scientific notation and Hindi numerals",()=>{expect(deriveAxisScale(ticks(["0%","50%","100%"])).kind).toBe("percentage");expect(deriveAxisScale(ticks(["0","50","100"]),"%").kind).toBe("percentage");expect(deriveAxisScale(ticks(["1e-3","2e-3","3e-3"])).kind).toBe("scientific_notation");expect(deriveAxisScale(ticks(["०","१०","२०"])).kind).toBe("linear_numeric")})
 it("recognizes ISO calendar dates and clock labels without guessing ambiguous dates or midnight rollover",()=>{
  expect(deriveAxisScale(ticks(["2026-01-01","2026-01-02","2026-01-03"])).model?.transform).toBe("utc_milliseconds")
  expect(deriveAxisScale(ticks(["10:00","11:00","12:00"])).model?.transform).toBe("clock_milliseconds")
  expect(deriveAxisScale(ticks(["23:00","00:00","01:00"])).kind).toBe("unknown")
 })
 it("keeps categorical ordering separate from numeric calibration",()=>{const scale=deriveAxisScale(ticks(["A","B","C"]));expect(scale.kind).toBe("categorical");expect(scale.model).toBeNull()})
 for(const text of [["0","10"],["0","10","5"],["0","10","100"],["1 kg","2 s","3 kg"],["1,0","2,0","3,0"],["A","A","B"]])
 it(`rejects insufficient, broken, mixed or unsupported evidence ${text.join("/")}`,()=>expect(deriveAxisScale(ticks(text)).kind).toBe("unknown"))
 it("rejects repeated positions and inconsistent explicit units",()=>{expect(deriveAxisScale(ticks(["0","10","20"],[0,0,100])).kind).toBe("unknown");expect(deriveAxisScale(ticks(["1 kg","2 kg","3 kg"]),"g").kind).toBe("unknown")})
 it("matches all renderer-labelled synthetic scale cases without claiming OCR/data-extraction accuracy",async()=>{
  const manifest=JSON.parse(await readFile("test/fixtures/chart-axes/manifest.json","utf8"))
  for(const sample of manifest.samples){expect(deriveAxisScale(ticks(sample.ticks.map((t:any)=>t.text),sample.ticks.map((t:any)=>t.position))).kind,sample.id).toBe(sample.expectedScale);expect((await readFile(`test/fixtures/chart-axes/${sample.file}`)).length).toBeGreaterThan(100)}
 })
})
