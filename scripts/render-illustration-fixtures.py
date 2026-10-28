"""Render the supplied source schematics and bind actual PNG hashes in the fixture manifest."""
import os,json,hashlib,math
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont,ImageFilter
root=Path(__file__).resolve().parent.parent/"test/fixtures/illustration-structure"
manifest=json.loads((root/"manifest.json").read_text(encoding="utf-8"))
font_path=os.environ.get("MUENOT_FIXTURE_DEVANAGARI_FONT",str(Path(os.environ.get("WINDIR","C:/Windows"))/"Fonts/Nirmala.ttc"))
font=ImageFont.truetype(font_path,20);W,H=800,450
for sample in manifest["samples"]:
 image=Image.new("RGB",(W,H),"white");draw=ImageDraw.Draw(image);regions={r["id"]:r for r in sample["input"]["regions"]};output=sample["expected"]
 def box(id):
  b=regions[id]["box"];return (int(b["x"]*W),int(b["y"]*H),int((b["x"]+b["width"])*W),int((b["y"]+b["height"])*H))
 if output["contentType"]=="flowchart":
  for n in output["nodes"]:
   b=box(n["regionId"])
   if n["role"]=="decision":draw.polygon([((b[0]+b[2])/2,b[1]),(b[2],(b[1]+b[3])/2),((b[0]+b[2])/2,b[3]),(b[0],(b[1]+b[3])/2)],outline="#2563eb",width=2)
   else:draw.rounded_rectangle(b,radius=12 if n["role"]=="start_end" else 0,outline="#2563eb",width=2)
   label=next((o["text"] for o in sample["input"]["support"]["ocrEvidence"] if o["regionId"]==n["regionId"]),n["regionId"].upper());draw.text((b[0]+15,b[1]+20),label,font=font,fill="black")
  for e in output["edges"]:
   a=box(e["fromRegionId"] or "a");b=box(e["toRegionId"] or "b")
   if e["connectorRegionId"]=="arrow3":points=[((a[0]+a[2])/2,a[1]),(.7*W,.06*H),(.2*W,.06*H),((b[0]+b[2])/2,b[1])]
   else:points=[(a[2],(a[1]+a[3])/2),(b[0],(b[1]+b[3])/2)]
   if e["direction"]=="unknown":points[-1]=(.5*W,.3*H)
   draw.line(points,fill="black",width=2)
   if e["direction"]!="unknown":
    x,y=points[-1];px,py=points[-2];angle=math.atan2(y-py,x-px);draw.polygon([(x,y),(x-12*math.cos(angle-.5),y-12*math.sin(angle-.5)),(x-12*math.cos(angle+.5),y-12*math.sin(angle+.5))],fill="black")
   xs=[p[0] for p in points];ys=[p[1] for p in points];regions[e["connectorRegionId"]]["box"]={"x":max(0,(min(xs)-8)/W),"y":max(0,(min(ys)-8)/H),"width":(max(xs)-min(xs)+16)/W,"height":(max(ys)-min(ys)+16)/H}
 elif output["contentType"]=="table":
  for c in output["table"]["cells"]:
   b=box(c["regionId"])
   if sample["id"]!="missing-borders":draw.rectangle(b,outline="black",width=2)
   text={"cellA":"नाम","cellB":"10","cellC":""}[c["regionId"]];draw.text((b[0]+15,b[1]+15),text,font=font,fill="black")
 elif output["contentType"]=="map":
  draw.rectangle(box("area"),fill="#dcfce7",outline="#16a34a",width=2);r=box("route");draw.line([(r[0],r[1]),(r[2],r[3])],fill="#2563eb",width=4);draw.ellipse(box("landmark"),outline="#dc2626",width=2)
  for id,text in [("title","Schematic source map"),("legend","Blue: printed route"),("north","N ↑"),("scale","5 km")]:
   b=box(id);draw.text((b[0],b[1]),text,font=font,fill="black")
 else:
  for g in output["groups"]:draw.rectangle(box(g["regionId"]),outline="#9ca3af",width=2)
  for n in output["nodes"]:
   b=box(n["regionId"]);draw.rectangle(b,outline="#2563eb",width=2);label=next((o["text"] for o in sample["input"]["support"]["ocrEvidence"] if o["regionId"]==n["regionId"]),n["role"]);draw.text((b[0]+10,b[1]+15),label,font=font,fill="black")
 draw.text((15,H-25),"Synthetic source fixture: "+sample["id"],font=font,fill="black")
 if sample["id"]=="unreadable-labels":image=image.filter(ImageFilter.GaussianBlur(6))
 path=root/sample["file"];image.save(path);sample["input"]["source"]["sourceSha256"]=hashlib.sha256(path.read_bytes()).hexdigest()
(root/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding="utf-8")
print("Rendered",len(manifest["samples"]),"source-labelled illustration fixtures")
