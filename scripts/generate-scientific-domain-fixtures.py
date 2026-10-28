"""Source-labelled synthetic schematics; tests transcription/contracts, not scientific recognition accuracy."""
import json,os
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont,ImageFilter
root=Path(__file__).resolve().parent.parent/"test/fixtures/scientific-domain"
root.mkdir(parents=True,exist_ok=True)
font=ImageFont.truetype(str(Path(os.environ.get("WINDIR","C:/Windows"))/"Fonts/Nirmala.ttc"),26)
cases=[
 ("molecular-structure","chemistry","molecular_structure_candidate","H₂O","recognized_lexically"),
 ("reaction-scheme","chemistry","reactant_label_candidate","H₂ + O₂ → H₂O","reaction_notation_only"),
 ("atomic-model","chemistry","atomic_model_candidate","Na⁺","recognized_lexically"),
 ("circuit-crossing","physics","visible_wire_candidate","10 Ω",None),
 ("ray-optics","physics","ray_optics_candidate","30°",None),
 ("free-body","physics","force_arrow_candidate","10 N",None),
 ("cell-label","biology","cell_structure_candidate","नाभिक",None),
 ("anatomy-label","biology","anatomy_label_candidate","Liver",None),
 ("plant-label","biology","plant_structure_candidate","Leaf",None),
 ("geometry-markers","geometry","perpendicular_marker_candidate","AB ⊥ CD; ∠ABC = 90°",None),
 ("coordinate-label","geometry","coordinate_label_candidate","(−2, 3)",None),
 ("ambiguous-charge","chemistry","bond_drawing_candidate","Fe3+","ambiguous"),
 ("blurred-source","biology","anatomy_label_candidate","unreadable",None),
 ("hindi-english-symbols","physics","field_vector_candidate","बल = 10 N",None),
]
samples=[]
for name,subject,kind,text,status in cases:
 image=Image.new("RGB",(800,450),"white");draw=ImageDraw.Draw(image)
 draw.text((20,12),"Synthetic source evidence: "+name,font=font,fill="black")
 if subject=="chemistry":
  draw.text((150,200),"H",font=font,fill="black");draw.text((380,150),"O",font=font,fill="black");draw.text((620,200),"H",font=font,fill="black");draw.line([(180,215),(375,170)],fill="black",width=2);draw.line([(410,170),(615,215)],fill="black",width=2)
  if name=="atomic-model":draw.ellipse((270,110,530,300),outline="#2563eb",width=2);draw.ellipse((340,80,460,330),outline="#2563eb",width=2)
 elif subject=="biology":
  draw.ellipse((190,105,610,320),outline="#16a34a",width=3);draw.ellipse((335,165,465,255),outline="#2563eb",width=2);draw.line([(400,165),(510,100)],fill="black",width=2)
 elif subject=="geometry":
  draw.polygon([(200,300),(400,110),(600,300)],outline="#2563eb",width=3);draw.line([(400,110),(400,300)],fill="black",width=2);draw.line([(400,282),(417,282),(417,300)],fill="black",width=2)
 else:
  draw.rectangle((270,145,430,255),outline="#2563eb",width=3);draw.line([(100,200),(270,200)],fill="black",width=2);draw.line([(430,200),(670,200)],fill="black",width=2);draw.polygon([(670,200),(655,191),(655,209)],fill="black")
  if name=="circuit-crossing":draw.line([(510,90),(510,320)],fill="black",width=2)
 draw.text((70,355),text,font=font,fill="black")
 if name=="blurred-source":image=image.filter(ImageFilter.GaussianBlur(6))
 image.save(root/(name+".png"))
 samples.append({"id":name,"file":name+".png","subject":subject,"kind":kind,"sourceText":text,"expectedChemicalStatus":status,"readable":name!="blurred-source","scientificAccuracyVerified":False,"synthetic":True})
(root/"manifest.json").write_text(json.dumps({"purpose":"Known literal label text and supplied claim/reference contracts. No live domain/OCR/vision accuracy or scientific correctness measurement.","samples":samples},ensure_ascii=False,indent=2),encoding="utf-8")
print("Generated",len(samples),"scientific domain source fixtures")
