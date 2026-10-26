import {it,expect} from "vitest"
import {analyzeChartAxes} from "@/lib/alt-text/chart-axis-analysis"
import {chartPrompt} from "@/lib/alt-text/chart-contract"
const axis=(id:string,box:any)=>({id,parentId:"graph",primaryType:"axis_region",locationStatus:"verified_frame",box})
const parent={id:8,version:1,result:{assetId:1,occurrenceId:2,chartRegionId:"graph",regionAnalysisId:"rga1",source:{sourceWidth:1000,sourceHeight:500,sourceSha256:"hash"},output:{...JSON.parse(chartPrompt([],"graph",[]).prompt).schema,axisRegionIds:["x","left","right"],plotRegionIds:["plot"],legendRegionIds:["legend"]},regionReferences:[axis("x",{x:.1,y:.8,width:.8,height:.1}),axis("left",{x:0,y:.1,width:.1,height:.7}),axis("right",{x:.9,y:.1,width:.1,height:.7}),{id:"plot",primaryType:"plot_area",box:{x:.1,y:.1,width:.8,height:.7}},{id:"legend",primaryType:"legend_region",box:{x:.5,y:0,width:.2,height:.1}}]}} as any
const label=(id:string,regionId:string,text:string,left:number,top:number)=>({id,regionId,sourceRegionId:regionId,text,box:{left,top,width:20,height:16},geometryBasis:"ocr_line",reviewId:10,reviewVersion:1,sourceOcrId:"ocr1",sourceOcrVersion:1,sourceRef:"image:ocr1",verifiedText:true} as const)
const labels=[label("x1","x","40",100,420),label("x2","x","60",400,420),label("x3","x","80",700,420),label("y1","left","20",30,60),label("y2","left","10",30,200),label("y3","left","0",30,340),label("r1","right","0%",940,60),label("r2","right","50%",940,200),label("r3","right","100%",940,340),label("legendA","legend","Series A",520,20)]
const options={axisLabels:true,axisScale:true,legend:true,dataLabels:true}
it("keeps dual axes, different units, reversed direction and non-zero baseline separate",()=>{
 const result=analyzeChartAxes(parent,labels,options)
 expect(result.axes.map((a)=>a.role)).toEqual(["x_candidate","y_left_candidate","y_right_candidate"])
 expect(result.axes[0].scale.model?.valueAtPixelRange).toEqual([40,80]);expect(result.axes[1].scale.direction).toBe("decreasing_with_pixel");expect(result.axes[2].unit).toBe("%")
 expect(result.numericalDataExtracted).toBe(false);expect(result.axes.every((a)=>!a.scale.usableForPixelExtraction)).toBe(true)
})
it("does not invent legend-to-series or similar-color associations",()=>{
 const result=analyzeChartAxes(parent,labels,options);expect(result.legends[0].entries[0]).toMatchObject({text:"Series A",color:null,linePattern:null,candidateSeriesIds:[],association:"unverified"})
})
it("preserves unknown when reviewed labels, legend or visible axes are absent",()=>{
 const result=analyzeChartAxes({...parent,result:{...parent.result,output:{...parent.result.output,axisRegionIds:[],legendRegionIds:[]}}},[],options)
 expect(result.axes).toEqual([]);expect(result.legends).toEqual([]);expect(result.warnings.join(" ")).toContain("No invisible axes")
})
it("does not calibrate corrected text whose token positions are unmapped",()=>{
 const result=analyzeChartAxes(parent,labels.map((l)=>({...l,box:null,geometryBasis:"unmapped"})),options)
 expect(result.axes.every((a)=>a.scale.kind==="unknown")).toBe(true)
})
it("honors disabled scale and legend options while preserving provenance",()=>{
 const result=analyzeChartAxes(parent,labels,{...options,axisScale:false,legend:false})
 expect(result.legends).toEqual([]);expect(result.axes.every((a)=>a.scale.model===null)).toBe(true);expect(result.parentChartEvidenceId).toBe(8)
})
it("preserves a reviewed Hindi axis title and its explicit unit without translating it",()=>{
 const result=analyzeChartAxes(parent,[...labels,label("titleHindi","x","समय (सेकंड)",400,450)],options)
 expect(result.axes[0].titleLabelIds).toContain("titleHindi");expect(result.axes[0].unit).toBe("सेकंड")
})
