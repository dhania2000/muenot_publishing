"""Labelled axis fixtures with renderer-known tick positions; test-only, no OCR/model claims."""
import json,os
from pathlib import Path
root=Path(__file__).resolve().parent.parent/"test/fixtures/chart-axes"
os.environ.setdefault("MPLCONFIGDIR",str(Path(os.environ.get("TEMP","."))/"muenot-axis-fixtures"))
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from PIL import Image,ImageDraw,ImageFont
root.mkdir(parents=True,exist_ok=True)
font=Path(os.environ.get("MUENOT_FIXTURE_DEVANAGARI_FONT",str(Path(os.environ.get("WINDIR","C:/Windows"))/"Fonts/Nirmala.ttc")))
cases=[
 ("linear",[0,10,20],["0","10","20"],"linear_numeric",False),
 ("non-zero",[40,60,80],["40","60","80"],"linear_numeric",False),
 ("reversed",[80,60,40],["80","60","40"],"linear_numeric",False),
 ("logarithmic",[1,10,100,1000],["1","10","100","1000"],"logarithmic",True),
 ("percentage",[0,50,100],["0%","50%","100%"],"percentage",False),
 ("scientific",[.001,.002,.003],["1e-3","2e-3","3e-3"],"scientific_notation",False),
 ("date",[0,1,2],["2026-01-01","2026-01-02","2026-01-03"],"date_time",False),
 ("clock",[0,1,2],["10:00","11:00","12:00"],"date_time",False),
 ("categorical",[0,1,2],["A","B","C"],"categorical",False),
 ("hindi-digits",[0,10,20],["०","१०","२०"],"linear_numeric",False),
 ("unsupported-spacing",[0,1,2],["0","10","100"],"unknown",False),
 ("ocr-confusable",[0,1,2],["0","1O","20"],"unknown",False),
]
samples=[]
for name,values,labels,kind,log in cases:
    fig,ax=plt.subplots(figsize=(7,4),dpi=100)
    if log:ax.set_xscale("log")
    ax.plot(values,list(range(len(values))),marker="o")
    ax.set_xticks(values,[""]*len(labels) if name=="hindi-digits" else labels)
    if name=="reversed":ax.invert_xaxis()
    ax.set_title("Labelled synthetic axis: "+name)
    ax.set_xlabel("Reviewed tick labels; not an OCR accuracy benchmark",labelpad=25 if name=="hindi-digits" else 4)
    fig.tight_layout();fig.canvas.draw()
    ticks=[{"text":label,"position":float(ax.transData.transform((value,0))[0])} for value,label in zip(values,labels)]
    tick_y=400-float(ax.transAxes.transform((0,0))[1])+8
    fig.savefig(root/(name+".png"),dpi=100);plt.close(fig)
    if name=="hindi-digits":
        if not font.exists():raise RuntimeError("Set MUENOT_FIXTURE_DEVANAGARI_FONT to a Devanagari font before generating Hindi fixtures.")
        image=Image.open(root/(name+".png")).convert("RGB");draw=ImageDraw.Draw(image)
        for tick in ticks:draw.text((tick["position"],tick_y),tick["text"],font=ImageFont.truetype(str(font),16),fill="black",anchor="mt")
        image.save(root/(name+".png"))
    samples.append({"id":name,"file":name+".png","expectedScale":kind,"ticks":ticks,"synthetic":True})
fig,ax=plt.subplots(figsize=(7,4),dpi=100);ax.plot([0,1,2],[0,10,20],color="red",label="Series A");right=ax.twinx();right.plot([0,1,2],[0,50,100],color="red",linestyle="--",label="Series B");ax.set_ylabel("Left (kg)");right.set_ylabel("Right (%)");ax.legend(loc="upper left");right.legend(loc="lower right");fig.tight_layout();fig.savefig(root/"dual-axis-similar-colors.png");plt.close(fig)
fig,ax=plt.subplots(figsize=(7,4),dpi=100);ax.plot([0,1,2],[1,2,3]);ax.set_xticks([0,1,2],["2026-01-01","2026-01-02","2026-01-03"],rotation=45);fig.tight_layout();fig.savefig(root/"rotated-labels-missing-legend.png");plt.close(fig)
if font.exists():
    image=Image.open(root/"hindi-digits.png").convert("RGB");draw=ImageDraw.Draw(image);draw.rectangle((0,image.height-32,image.width,image.height),fill="white");draw.text((image.width/2,image.height-30),"समय (सेकंड)",font=ImageFont.truetype(str(font),22),fill="black",anchor="mt");image.save(root/"hindi-title.png")
(root/"manifest.json").write_text(json.dumps({"purpose":"Renderer-labelled synthetic tick/scale validation. Text recognition and data-extraction accuracy are not measured.","samples":samples,"additionalFigures":["dual-axis-similar-colors.png","rotated-labels-missing-legend.png","hindi-title.png"]},ensure_ascii=False,indent=2),encoding="utf-8")
print("Generated",len(samples),"labelled axis cases plus edge figures")
