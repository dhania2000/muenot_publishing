import {readFileSync} from "node:fs"
import {it,expect} from "vitest"
import {extractChartLabelData,chartDataCandidates} from "@/lib/alt-text/chart-data-analysis"
import {parseChartLabelDecision,type ChartDataParent,type ChartLabelDecision} from "@/lib/alt-text/chart-data-contract"
import {chartDataCsv} from "@/lib/alt-text/chart-data-export"
import {toCsv} from "@/lib/alt-text/core"
export function dataFixture(values=["-10","0","20"]):ChartDataParent{
 const label=(id:string,text:string,left=200,top=200)=>({id,regionId:"plot",text,box:{left,top,width:24,height:16},geometryBasis:"ocr_line",verifiedText:true,reviewId:10,reviewVersion:1})
 const categories=values.map((_,i)=>label(`c${i}`,String(40+i*20),150+i*100,450)),data=values.map((v,i)=>label(`d${i}`,v,150+i*100,200)),legend=label("legend","Series A",500,20)
 const axes={assetId:1,occurrenceId:2,chartRegionId:"graph",parentChartEvidenceId:8,parentChartVersion:1,sourceSha256:"sha",sourceWidth:1000,sourceHeight:500,labels:[...categories,...data,legend],axes:[{id:"x",orientation:"horizontal",role:"x_candidate",unit:null,titleLabelIds:[],ticks:categories.map((l)=>({labelId:l.id,text:l.text})),scale:{kind:"linear_numeric"}},{id:"y",orientation:"vertical",role:"y_left_candidate",unit:null,titleLabelIds:[],ticks:[],scale:{kind:"unknown"}}],plotBounds:[{box:{x:.1,y:.1,width:.8,height:.7}}],titles:[],captions:[],legends:[{entries:[{labelId:"legend",text:legend.text}]}]}
 return {axes:{id:9,version:2,result:axes},chart:{id:8,version:1,result:{source:{pixelBox:{left:0,top:0,width:1000,height:500}}}}} as unknown as ChartDataParent
}
const confirm=(n=3):ChartLabelDecision[]=>Array.from({length:n},(_,i)=>({id:20+i,version:1,sourceLabelId:`d${i}`,state:"confirmed_label",seriesLabelId:"legend",categoryLabelId:`c${i}`,axisId:"y",comment:"",editorId:7,createdAt:"2026-10-26"}))
it("keeps unconfirmed annotation numbers unknown and excludes ticks and legend",()=>{
 const result=extractChartLabelData(dataFixture());expect(result.points).toHaveLength(3);expect(result.points.every((p)=>p.classification==="unknown"&&p.value===null)).toBe(true);expect(result.trends).toEqual([])
})
it.each([["-10","0","20"],["40","60","80"],["1e-3","2e-3","3e-3"],["10%","20%","30%"],["१०","२०","३०"]])("preserves verified printed values with no numerical estimation: %j",(...values)=>{
 const parent=dataFixture(values),before=JSON.stringify(parent),result=extractChartLabelData(parent,confirm())
 expect(result.points.every((p)=>p.classification==="label_exact"&&p.visualMark===null&&p.precision.rounding==="none")).toBe(true);expect(result.trends.some((t)=>t.kind==="increasing")).toBe(true);expect(JSON.stringify(parent)).toBe(before);expect(result.capabilities).toEqual({labelExact:true,nativeSourceExact:false,imageEstimated:false});expect(result.datasetApproved).toBe(false)
})
it("does not assign series/categories or infer trends when those mappings are absent",()=>{const result=extractChartLabelData(dataFixture(),confirm().map((d)=>({...d,seriesLabelId:null,categoryLabelId:null})));expect(result.trends).toEqual([]);expect(result.points.every((p)=>p.seriesId===null&&p.category===null)).toBe(true)})
it("rejects malformed, ambiguous or unpositioned labels rather than reconstructing missing values",()=>{const parent=dataFixture(["1,200","1O","NaN"]);expect(chartDataCandidates(parent)).toEqual([]);parent.axes.result.labels.push({...parent.axes.result.labels[0],id:"blurred",text:"80",box:null,geometryBasis:"unmapped"});expect(chartDataCandidates(parent)).toEqual([])})
it("leaves units that disagree with the selected axis unknown",()=>{const parent=dataFixture(["20%"]);parent.axes.result.axes[1].unit="kg";const result=extractChartLabelData(parent,confirm(1));expect(result.points[0]).toMatchObject({classification:"unknown",value:null});expect(result.points[0].warnings.join(" ")).toContain("units disagree")})
it("preserves duplicate candidates but excludes them from comparisons",()=>{const parent=dataFixture(["20","20"]);parent.axes.result.labels.find((l)=>l.id==="d1")!.box={...parent.axes.result.labels.find((l)=>l.id==="d0")!.box!};const result=extractChartLabelData(parent,confirm(2));expect(result.points).toHaveLength(2);expect(result.trends).toEqual([]);expect(result.points[0].warnings.join(" ")).toContain("duplicate")})
it("does not merge series or differing value axes",()=>{const result=extractChartLabelData(dataFixture(),confirm().map((d,i)=>({...d,axisId:i===1?"x":"y"})));expect(result.trends.every((t)=>!t.pointIds.includes("label:d1"))).toBe(true)})
it("reports only visible local extrema and printed stability without a statistical claim",()=>{const result=extractChartLabelData(dataFixture(["10","30","20"]),confirm());expect(result.trends.find((t)=>t.kind==="local_peak")?.pointIds).toEqual(["label:d1"]);expect(extractChartLabelData(dataFixture(["10","10","10"]),confirm()).trends.some((t)=>t.kind==="stable_at_printed_precision")).toBe(true)})
it("does not numerically order Hindi categories or ambiguous time labels",()=>{const parent=dataFixture();parent.axes.result.axes[0].ticks.forEach((t,i)=>t.text=["जनवरी","फ़रवरी","मार्च"][i]);const result=extractChartLabelData(parent,confirm());expect(result.points[0].category).toBe("जनवरी");expect(result.trends.map((t)=>t.kind)).toEqual(["visible_ranking"])})
it("retains rejected values as unknown with their review reference",()=>{const result=extractChartLabelData(dataFixture(),confirm().map((d)=>({...d,state:"rejected"})));expect(result.points.every((p)=>p.value===null&&p.reviewState==="rejected"&&p.reviewReference?.editorId===7)).toBe(true)})
it("rejects client numbers, invented reviewers, invalid Unicode and malformed requests",()=>{const valid={sourceLabelId:"d0",state:"confirmed_label",seriesLabelId:null,categoryLabelId:null,axisId:null,comment:"ठीक है",expectedVersion:0,requestId:"request123"};expect(parseChartLabelDecision(valid)).toEqual(valid);for(const invalid of [{...valid,value:99},{...valid,editorId:1},{...valid,comment:"\ud800"},{...valid,expectedVersion:-1},{...valid,requestId:"x"}])expect(parseChartLabelDecision(invalid)).toBeNull()})
it("exports provenance, blanks for unknown values, and neutralizes whitespace/BOM formulas",()=>{const result=extractChartLabelData(dataFixture());const csv=chartDataCsv(result,3);expect(csv).toContain("candidate_value");expect(csv).toContain("dataset_approved");expect(csv).toContain("unknown");expect(csv[0]).toBe("\uFEFF");for(const text of ["=1+1","  =1+1","\uFEFF@SUM(A1)","\tformula","\n+cmd","-10"]){const safe=toCsv([{text}],{columns:["text"]});expect(safe).toContain("'")}})

it("measures zero numeric interpretation error against 39 supplied reviewed labels in 14 rendered fixtures",()=>{
 const manifest=JSON.parse(readFileSync(new URL("../fixtures/chart-data/manifest.json",import.meta.url),"utf8"));let count=0,maxError=0,sumError=0
 for(const sample of manifest.samples){
  const parent=dataFixture(sample.labels.map((l:any)=>l.text))
  for(const label of parent.axes.result.labels.filter((l)=>l.id.startsWith("d"))){const fixture=sample.labels.find((l:any)=>l.id===label.id);label.box=fixture.box;label.verifiedText=fixture.reviewed}
  const result=extractChartLabelData(parent,confirm(sample.labels.length))
  if(sample.id==="blurred-labels"){expect(result.points).toHaveLength(0);continue}
  expect(result.points).toHaveLength(sample.labels.length)
  for(const point of result.points){const truth=sample.labels.find((l:any)=>l.id===point.sourceLabelId).groundTruth;expect(point.classification).toBe("label_exact");const error=Math.abs(point.value!-truth);expect(error).toBeLessThanOrEqual(manifest.tolerance);maxError=Math.max(maxError,error);sumError+=error;count++}
  expect(result.capabilities.imageEstimated).toBe(false)
 }
 expect(count).toBe(39);expect(maxError).toBe(0);expect(sumError/count).toBe(0)
 console.log(JSON.stringify({benchmark:"supplied synthetic reviewed visible label interpretation",renderedFixtures:14,reviewedValues:count,maximumAbsoluteError:maxError,meanAbsoluteError:sumError/count,tolerance:0,ocrAccuracyMeasured:false,pixelDigitizationMeasured:false}))
})

it("honors disabled trend descriptions while preserving exact reviewed labels",()=>{const result=extractChartLabelData(dataFixture(),confirm(),false);expect(result.trends).toEqual([]);expect(result.trendsEnabled).toBe(false);expect(result.points.every((p)=>p.classification==="label_exact")).toBe(true)})
