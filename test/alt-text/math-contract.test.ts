import {describe,it,expect} from "vitest"
import {equationCrop,parseMathRequest,parseMathEngineOutput} from "@/lib/alt-text/math-contract"
import type {ImageRegion,RegionAnalysis} from "@/lib/alt-text/region-analysis"
const region={primaryType:"equation_region",locationStatus:"verified_frame",box:{x:.2,y:.1,width:.5,height:.4}} as ImageRegion
const analysis={source:{orientation:1,orientationUnknown:false,storedWidth:1000,storedHeight:500}} as RegionAnalysis
const request={requestId:"request_123",regionId:"rgn_12345678",analysisId:"rga_12345678"}
describe("equation source boundaries",()=>{
 it("uses the original region frame for a bounded pixel crop",()=>expect(equationCrop(region,analysis,1000,500)).toEqual({left:200,top:50,width:500,height:200}))
 it("rejects chemical, ordinary text, stale dimensions and uncertain frames",()=>{
  for(const primaryType of ["text_region","chemical_structure_region"] as ImageRegion["primaryType"][])expect(equationCrop({...region,primaryType},analysis,1000,500)).toBeNull()
  expect(equationCrop(region,analysis,500,1000)).toBeNull()
  expect(equationCrop({...region,locationStatus:"unverified"},analysis,1000,500)).toBeNull()
  expect(equationCrop(region,{source:{...analysis.source,orientation:6}},1000,500)).toBeNull()
 })
 it("rejects invalid or oversized crops",()=>{
  for(const box of [{x:-.1,y:0,width:.5,height:.5},{x:0,y:0,width:Infinity,height:.5},{x:.9,y:0,width:.5,height:.5}])expect(equationCrop({...region,box},analysis,1000,500)).toBeNull()
  expect(equationCrop({...region,box:{x:0,y:0,width:1,height:1}},{source:{...analysis.source,storedWidth:3000,storedHeight:3000}},3000,3000)).toBeNull()
 })
 it("accepts stable region identities and rejects client paths, boxes and tenant identities",()=>{
  expect(parseMathRequest(request)).toMatchObject({occurrenceId:null,reprocess:false})
  for(const extra of [{tenantId:2},{box:region.box},{modelDir:"/tmp"},{occurrenceId:0},{regionId:"0"},{analysisId:"bad"}])expect(parseMathRequest({...request,...extra})).toBeNull()
 })
})
describe("untrusted worker output",()=>{
 const model={modelId:"test",revision:"abc",weightsSha256:"sha"}
 const result={schemaVersion:1,rawOutput:"\\frac{a}{b}",...model,confidence:null,confidenceBasis:"not_reported",durationMs:20,preprocessing:{version:"white-fit-half-v1",width:500,height:400,scale:.5,offsetX:10,offsetY:10},generation:{maxNewTokens:384,numBeams:1,doSample:false,truncated:false}}
 it("retains raw transcription without fabricating confidence",()=>expect(parseMathEngineOutput(result,model)).toEqual(result))
 it("rejects substituted models, fake confidence and unbounded output",()=>{
  for(const extra of [{revision:"other"},{weightsSha256:"wrong"},{confidence:.99},{durationMs:NaN},{rawOutput:"x".repeat(12001)},{preprocessing:{...result.preprocessing,scale:2}},{generation:{...result.generation,truncated:undefined}}])expect(parseMathEngineOutput({...result,...extra},model)).toBeNull()
 })
})
