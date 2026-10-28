import type {AdvancedEvidenceInput} from "@/lib/alt-text/advanced-evidence-store"
import type {IllustrationProviderOutput,IllustrationType} from "@/lib/alt-text/illustration-contract"
import type {ImageRegion} from "@/lib/alt-text/region-analysis"
export function illustrationFixture(type:IllustrationType="flowchart"){
 const rootId="rgn_12345678",region=(id:string,primaryType:ImageRegion["primaryType"],box={x:.1,y:.1,width:.2,height:.2},parentId:string|null=rootId)=>({id,primaryType,parentId,box,locationStatus:"verified_frame",sourceOrder:0} as ImageRegion)
 const source={analysisId:"rga_12345678",analysisVersion:1,regionId:rootId,normalizedBox:{x:0,y:0,width:1,height:1},pixelBox:{left:0,top:0,width:800,height:450},sourceWidth:800,sourceHeight:450,sourceSha256:"sha",coordinateSystem:"stored_pixels_top_left",locationIsEstimate:true}
 const rootType={flowchart:"flowchart_region",table:"table_region",map:"map_region",mixed:"mixed_content_region"} as const,regions=[region(rootId,rootType[type],{x:0,y:0,width:1,height:1},null)]
 const output:IllustrationProviderOutput={schemaVersion:1,contentType:type,nodes:[],edges:[],table:null,map:null,groups:[],proposedOrderRegionIds:[],warnings:[]}
 if(type==="flowchart"){
  regions.push(region("a","flowchart_node",{x:.1,y:.2,width:.2,height:.2}),region("b","flowchart_node",{x:.6,y:.2,width:.2,height:.2}),region("c","flowchart_node",{x:.6,y:.6,width:.2,height:.2}),region("arrow1","flowchart_connector",{x:.3,y:.28,width:.3,height:.04}),region("arrow2","flowchart_connector",{x:.3,y:.3,width:.3,height:.4}),region("arrow3","flowchart_connector",{x:.18,y:.06,width:.54,height:.18}))
  output.nodes=[{regionId:"a",role:"decision",labelRegionIds:["a"]},{regionId:"b",role:"start_end",labelRegionIds:[]},{regionId:"c",role:"process",labelRegionIds:[]}]
  output.edges=[{connectorRegionId:"arrow1",fromRegionId:"a",toRegionId:"b",direction:"from_to",arrowhead:"at_to",labelRegionIds:[]},{connectorRegionId:"arrow2",fromRegionId:"a",toRegionId:"c",direction:"from_to",arrowhead:"at_to",labelRegionIds:[]}];output.proposedOrderRegionIds=["a","b","c"]
 }else if(type==="table"){
  regions.push(region("r0","table_row_region",{x:.1,y:.1,width:.8,height:.2}),region("r1","table_row_region",{x:.1,y:.3,width:.8,height:.2}),region("col0","table_column_region",{x:.1,y:.1,width:.4,height:.4}),region("col1","table_column_region",{x:.5,y:.1,width:.4,height:.4}),region("cellA","table_cell_region",{x:.1,y:.1,width:.8,height:.2}),region("cellB","table_cell_region",{x:.1,y:.3,width:.4,height:.2}),region("cellC","table_cell_region",{x:.5,y:.3,width:.4,height:.2}))
  output.table={rowRegionIds:["r0","r1"],columnRegionIds:["col0","col1"],cells:[{regionId:"cellA",row:0,column:0,rowSpan:1,columnSpan:2,headerCandidate:"row"},{regionId:"cellB",row:1,column:0,rowSpan:1,columnSpan:1,headerCandidate:"none"},{regionId:"cellC",row:1,column:1,rowSpan:1,columnSpan:1,headerCandidate:"unknown"}],borders:"visible"};output.proposedOrderRegionIds=["cellA","cellB","cellC"]
 }else if(type==="map"){
  regions.push(region("title","heading_region",{x:.12,y:.04,width:.7,height:.08}),region("legend","legend_region",{x:.05,y:.75,width:.4,height:.18}),region("north","map_orientation_region",{x:.86,y:.1,width:.07,height:.2}),region("scale","text_region",{x:.5,y:.85,width:.35,height:.08}),region("route","map_route_region",{x:.2,y:.25,width:.5,height:.35}),region("area","map_area_region",{x:.1,y:.15,width:.6,height:.5}),region("landmark","map_landmark_region",{x:.6,y:.3,width:.12,height:.12}))
  output.map={mode:"schematic_candidate",titleRegionIds:["title"],legendRegionIds:["legend"],orientationRegionIds:["north"],scaleLabelRegionIds:["scale"],routeRegionIds:["route"],areaRegionIds:["area"],landmarkRegionIds:["landmark"],labelRegionIds:[]}
 }else{
  regions.push(region("panel1","diagram_group_region",{x:.05,y:.08,width:.42,height:.82}),region("panel2","diagram_group_region",{x:.53,y:.08,width:.42,height:.82}),region("chart","graph_region",{x:.1,y:.1,width:.3,height:.4},"panel1"),region("science","scientific_diagram_region",{x:.6,y:.1,width:.3,height:.4},"panel2"))
  output.nodes=[{regionId:"chart",role:"chart",labelRegionIds:[]},{regionId:"science",role:"diagram",labelRegionIds:[]}];output.groups=[{regionId:"panel1",memberRegionIds:["chart"]},{regionId:"panel2",memberRegionIds:["science"]}]
 }
 regions.forEach((r,i)=>{r.sourceOrder=i})
 const textRegion=type==="table"?"cellA":type==="flowchart"?"a":type==="map"?"scale":"chart",text=type==="table"?"नाम":type==="map"?"5 km":"Source text"
 const input={kind:"illustration_structure",assetId:1,occurrenceId:2,request:{requestId:"request123",analysisId:source.analysisId,regionId:rootId,occurrenceId:2,reprocess:false},source,actorId:7,modelId:"vision1",regions,regionParentId:null,complexity:"medium",support:{ocrEvidence:[{resultId:"ocr1",regionId:textRegion,version:1,text,verified:false,sourceDesignation:"raw_ocr"}],reviewEvidence:[{id:10,version:1,regionId:textRegion,sourceRef:"image:ocr1",state:"verified",text,sourceDesignation:"human_corrected_ocr"}]},regionRelationships:[],illustrationOptions:{enabledTypes:["flowchart","table","map","mixed"]},illustrationOrder:[]} as AdvancedEvidenceInput
 return {rootId,regions,output,input}
}
