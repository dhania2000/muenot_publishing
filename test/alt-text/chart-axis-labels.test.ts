import {it,expect,vi} from "vitest"
vi.mock("@/lib/db",()=>({query:vi.fn()}))
vi.mock("@/lib/alt-text/math-store",()=>({ensureEvidenceSchema:async()=>{}}))
const {reviewedChartLabelsFromRows}=await import("@/lib/alt-text/chart-axis-labels")
const chart={assetId:1,occurrenceId:2,chartRegionId:"graph",source:{sourceWidth:1000,sourceHeight:500,sourceSha256:"hash",pixelBox:{left:0,top:0,width:1000,height:500}},output:{titleRegionIds:[]},regionReferences:[{id:"axis",primaryType:"axis_region",locationStatus:"verified_frame",box:{x:0,y:.8,width:1,height:.2}}]} as any
function row(overrides:any={}){
 const text="० १० २०"
 return {id:10,version:2,input_json:{target:{kind:"image_ocr",assetId:1,occurrenceId:2},sourceRef:"image:ocr1",regionId:"axis",analysisId:"ocr1",sourceVersion:1,sourceSnapshot:{inputSha256:"hash",source:{storedWidth:1000,storedHeight:500,orientation:1,orientationUnknown:false},layout:{frame:"stored_pixels",drawable:true,lines:[{text,box:{left:100,top:420,width:620,height:20},words:["०","१०","२०"].map((text,i)=>({text,box:{left:100+i*300,top:420,width:20,height:20}}))}]}}},result_json:{state:"verified",correctedText:text,originalText:text},...overrides}
}
it("preserves Hindi tick strings and actual OCR word boxes with reviewer/source versions",()=>{
 const result=reviewedChartLabelsFromRows([row()],chart)
 expect(result.map((l)=>l.text)).toEqual(["०","१०","२०"]);expect(result[1]).toMatchObject({reviewId:10,reviewVersion:2,sourceOcrId:"ocr1",sourceOcrVersion:1,sourceRegionId:"axis",geometryBasis:"ocr_word",box:{left:400,top:420,width:20,height:20}})
})
it("never treats an edited block as verified alignment to old token positions",()=>{
 const item=row();item.result_json.correctedText="० १२ २०"
 const result=reviewedChartLabelsFromRows([item],chart);expect(result).toHaveLength(1);expect(result[0]).toMatchObject({text:"० १२ २०",box:null,geometryBasis:"unmapped"})
})
it("ignores unreviewed OCR, revoked review states and stale source hashes",()=>{
 const unverified=row();unverified.result_json.state="corrected";expect(reviewedChartLabelsFromRows([unverified,row()],chart)).toEqual([])
 const changed=row();changed.input_json.sourceSnapshot.inputSha256="other";expect(reviewedChartLabelsFromRows([changed],chart)).toEqual([])
})
it("keeps repeated binaries in another occurrence or asset out of the selected chart",()=>{
 const other=row();other.input_json.target.occurrenceId=3;expect(reviewedChartLabelsFromRows([other],chart)).toEqual([])
 const foreign=row();foreign.input_json.target.assetId=9;expect(reviewedChartLabelsFromRows([foreign],chart)).toEqual([])
})
it("uses whole-image reviewed OCR only where actual positioned words belong to this chart",()=>{
 const full=row();full.input_json.regionId=null;expect(reviewedChartLabelsFromRows([full],chart).map((l)=>l.sourceRegionId)).toEqual([null,null,null])
 const selected={...chart,source:{...chart.source,pixelBox:{left:0,top:0,width:300,height:500}}};expect(reviewedChartLabelsFromRows([full],selected).map((l)=>l.text)).toEqual(["०"])
})
