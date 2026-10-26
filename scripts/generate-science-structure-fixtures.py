"""Labelled generic structure schematics. No scientific/vision recognition accuracy claim."""
import json,os
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont,ImageFilter
root=Path(__file__).resolve().parent.parent/"test/fixtures/scientific-structure"
root.mkdir(parents=True,exist_ok=True)
font=ImageFont.truetype(str(Path(os.environ.get("WINDIR","C:/Windows"))/"Fonts/arial.ttf"),20)
names=["cell-diagram","organ-cross-section","mechanical-assembly","optical-ray","circuit-illustration","water-cycle","geological-layers","plant-structure","multi-panel-comparison","overlapping-arrows","ambiguous-labels","unreadable-text"]
samples=[]
for name in names:
    regions=[];elements=[]
    def region(id,type,kind,box,parent="diagram",role="unknown"):
        regions.append({"id":id,"primaryType":type,"parentId":parent,"box":dict(zip(["x","y","width","height"],box)),"locationStatus":"verified_frame"})
        elements.append({"regionId":id,"kind":kind,"visualRole":role,"uncertain":True})
    region("diagram","scientific_diagram_region","diagram",(0,0,1,1),None)
    panel=name=="multi-panel-comparison"
    if panel:
        region("panel1","diagram_group_region","region_group",(.02,.12,.45,.8),role="panel")
        region("panel2","diagram_group_region","region_group",(.52,.12,.45,.8),role="panel")
    region("a","scientific_component_region","component",(.12,.3,.22,.3),"panel1" if panel else "diagram",role="labelled_object")
    region("b","scientific_component_region","component",(.64,.3,.22,.3),"panel2" if panel else "diagram",role="unknown")
    region("label","text_region","label",(.12,.15,.22,.08),"panel1" if panel else "diagram")
    region("leader","diagram_connector_region","connector",(.22,.23,.015,.07),"panel1" if panel else "diagram")
    if not panel:region("arrow","diagram_arrow_region","arrow",(.34,.43,.30,.04))
    relationships=[] if panel or name in ["overlapping-arrows","ambiguous-labels","unreadable-text"] else [{"fromRegionId":"a","toRegionId":"b","type":"direction_of_flow","basis":"visual_connection","connectorRegionId":"arrow","arrowhead":"at_to"}]
    associations=[{"labelRegionId":"label","targetRegionIds":["a","b"] if name=="ambiguous-labels" else ["a"],"basis":"spatial_proximity" if name=="ambiguous-labels" else "leader_line","connectorRegionId":None if name=="ambiguous-labels" else "leader"}]
    warnings=["multiple_panels"] if panel else ["overlapping_connectors"] if name=="overlapping-arrows" else ["ambiguous_labels"] if name=="ambiguous-labels" else ["unreadable_labels"] if name=="unreadable-text" else []
    output={"schemaVersion":1,"elements":elements,"relationships":relationships,"labelAssociations":associations,"warnings":warnings}
    image=Image.new("RGB",(800,450),"white");draw=ImageDraw.Draw(image)
    draw.text((15,10),"Synthetic general structure: "+name,font=font,fill="black")
    for r in regions[1:]:
        b=r["box"];box=(round(b["x"]*800),round(b["y"]*450),round((b["x"]+b["width"])*800),round((b["y"]+b["height"])*450));kind=next(e["kind"] for e in elements if e["regionId"]==r["id"])
        if kind=="region_group":draw.rectangle(box,outline="#9ca3af",width=2)
        elif kind=="component":
            if name in ["cell-diagram","organ-cross-section","plant-structure","water-cycle"]:draw.ellipse(box,outline="#2563eb",width=3)
            elif name=="optical-ray":draw.polygon([(box[0],box[3]),((box[0]+box[2])/2,box[1]),(box[2],box[3])],outline="#2563eb",width=3)
            else:draw.rectangle(box,outline="#2563eb",width=3)
            draw.text((box[0]+10,box[1]+15),r["id"].upper(),font=font,fill="#2563eb")
        elif kind=="label":draw.text((box[0],box[1]),"Component A",font=font,fill="black")
        elif kind=="connector":draw.line([(box[0],box[1]),(box[0],box[3])],fill="black",width=2)
        elif kind=="arrow":
            y=(box[1]+box[3])//2;draw.line([(box[0],y),(box[2],y)],fill="black",width=2);draw.polygon([(box[2],y),(box[2]-10,y-6),(box[2]-10,y+6)],fill="black")
            if name=="overlapping-arrows":draw.line([(box[0],y-10),(box[2],y+10)],fill="#dc2626",width=2);draw.polygon([(box[0],y-10),(box[0]+12,y-13),(box[0]+10,y-2)],fill="#dc2626")
    if name=="unreadable-text":image=image.filter(ImageFilter.GaussianBlur(4))
    image.save(root/(name+".png"))
    samples.append({"id":name,"file":name+".png","regions":regions,"expected":output,"expectedElementIds":[e["regionId"] for e in elements],"expectedRelationshipPairs":[[r["fromRegionId"],r["toRegionId"],r["type"]] for r in relationships],"ocrText":"" if name=="unreadable-text" else "Component A","synthetic":True})
(root/"manifest.json").write_text(json.dumps({"purpose":"Rendered generic visual-structure fixtures with supplied region and relationship ground truth. Contract/node matching only; no live vision, OCR or scientific accuracy measured.","samples":samples},indent=2),encoding="utf-8")
print("Generated",len(samples),"generic scientific structure fixtures")
