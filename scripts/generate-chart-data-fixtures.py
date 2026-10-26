"""Synthetic printed-label benchmark, not an OCR or pixel-digitization accuracy benchmark."""
import json, os
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter
root=Path(__file__).resolve().parent.parent/"test/fixtures/chart-data"
root.mkdir(parents=True,exist_ok=True)
font_path=Path(os.environ.get("MUENOT_FIXTURE_DEVANAGARI_FONT",str(Path(os.environ.get("WINDIR","C:/Windows"))/"Fonts/Nirmala.ttc")))
font=ImageFont.truetype(str(font_path),22)
cases=[("positive-negative-line","line",[-10,0,20]),("non-zero-baseline","bar",[40,60,80]),("linear","line",[10,20,30]),("logarithmic","line",[1,10,100]),("multi-series","line",[12,18,15]),("scatter","scatter",[4,9,7]),("stacked-bars","stacked_bar",[10,20,30]),("labelled-pie","pie",[20,30,50]),("missing-ticks","line",[5,10,15]),("dual-axis","line",[10,20,30]),("blurred-labels","line",[10,20,30]),("hindi-categories","bar",[10,20,30]),("overlapping-marks","scatter",[20,20,30]),("ambiguous-scale","line",[10,20,30])]
samples=[]
for name,family,values in cases:
    image=Image.new("RGB",(900,500),"white");draw=ImageDraw.Draw(image)
    draw.text((25,12),"Synthetic chart: "+name,font=font,fill="black")
    draw.line([(80,70),(80,410),(830,410)],fill="black",width=2)
    labels=[]
    positions=[(220,290),(440,200),(660,120)]
    if name=="overlapping-marks":positions[1]=positions[0]
    if family=="pie":
        start=0
        for value,color in zip(values,["#60a5fa","#fb923c","#86efac"]):
            draw.pieslice((230,80,650,400),start,start+value*3.6,fill=color,outline="black");start+=value*3.6
        positions=[(560,210),(420,320),(330,170)]
    elif family=="line":draw.line(positions,fill="#2563eb",width=3)
    for i,(value,(x,y)) in enumerate(zip(values,positions)):
        if family in ["bar","stacked_bar"]:
            draw.rectangle((x-30,y,x+30,409),fill="#60a5fa",outline="#2563eb")
            if family=="stacked_bar":draw.rectangle((x-30,(y+409)//2,x+30,409),fill="#fb923c",outline="#2563eb")
        elif family!="pie":draw.ellipse((x-5,y-5,x+5,y+5),fill="#2563eb")
        text=str(value);left=x-18;top=y-32
        draw.text((left,top),text,font=font,fill="black")
        bounds=draw.textbbox((left,top),text,font=font)
        labels.append({"id":f"d{i}","text":text,"groundTruth":value,"box":{"left":bounds[0],"top":bounds[1],"width":bounds[2]-bounds[0],"height":bounds[3]-bounds[1]},"reviewed":name!="blurred-labels"})
        category=["जनवरी","फ़रवरी","मार्च"][i] if name=="hindi-categories" else str(40+i*20)
        draw.text((x-18,430),category,font=font,fill="black")
    if name=="dual-axis":draw.line([(840,70),(840,410)],fill="black",width=2);draw.text((790,75),"%",font=font,fill="black")
    if name=="multi-series":draw.line([(220,120),(440,300),(660,220)],fill="#f97316",width=3);draw.text((680,60),"Series B",font=font,fill="#f97316")
    if name=="blurred-labels":image=image.filter(ImageFilter.GaussianBlur(5))
    image.save(root/f"{name}.png")
    samples.append({"id":name,"family":family,"file":name+".png","labels":labels,"synthetic":True,"nativeDataLinked":False,"pixelCalibrationVerified":False})
(root/"manifest.json").write_text(json.dumps({"purpose":"Exact numeric interpretation of supplied synthetic reviewed visible labels only. Does not measure OCR, label-role recognition, pixel calibration or mark association.","tolerance":0,"samples":samples},ensure_ascii=False,indent=2),encoding="utf-8")
print("Generated",len(samples),"synthetic printed-label fixtures")
