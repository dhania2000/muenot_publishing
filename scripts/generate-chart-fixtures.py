"""Deterministic synthetic chart fixtures. Test-only Matplotlib 3.10.6; no production model calls."""
import json,os
from pathlib import Path
root=Path(__file__).resolve().parent.parent/"test/fixtures/charts"
os.environ.setdefault("MPLCONFIGDIR",str(Path(os.environ.get("TEMP","."))/"muenot-chart-fixtures"))
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from PIL import Image
root.mkdir(parents=True,exist_ok=True)
types=["line","bar","column","grouped_bar","stacked_bar","stacked_100_percent","pie","doughnut","scatter","bubble","area","histogram","box_whisker","heatmap","waterfall","time_series","multi_axis","combination","unknown"]
manifest=[]
x=np.arange(4);y=np.array([2,4,3,5])
def finish(fig,name,label,notes=""):
    fig.savefig(root/(name+".png"),dpi=100,facecolor="white")
    plt.close(fig)
    manifest.append({"id":name,"file":name+".png","expectedType":label,"synthetic":True,"notes":notes})
for kind in types:
    fig,ax=plt.subplots(figsize=(6,4));ax.set_title("Synthetic "+kind.replace("_"," "))
    if kind=="line":ax.plot(x,y,marker="o")
    elif kind=="bar":ax.barh(x,y)
    elif kind=="column":ax.bar(x,y)
    elif kind=="grouped_bar":ax.bar(x-.18,y,width=.35,label="A");ax.bar(x+.18,y+1,width=.35,label="B");ax.legend()
    elif kind in ["stacked_bar","stacked_100_percent"]:
        a=y if kind=="stacked_bar" else y/(2*y+1)*100;b=y+1 if kind=="stacked_bar" else (y+1)/(2*y+1)*100
        ax.bar(x,a,label="A");ax.bar(x,b,bottom=a,label="B");ax.legend()
    elif kind in ["pie","doughnut"]:ax.pie(y,labels=["A","B","C","D"],wedgeprops={"width":.4} if kind=="doughnut" else {})
    elif kind in ["scatter","bubble"]:ax.scatter(x,y,s=(y*90 if kind=="bubble" else 50))
    elif kind=="area":ax.fill_between(x,y,alpha=.5);ax.plot(x,y)
    elif kind=="histogram":ax.hist([1,1,2,2,2,3,4,4,5],bins=5)
    elif kind=="box_whisker":ax.boxplot([[1,2,3,4,7],[2,4,5,6,9]])
    elif kind=="heatmap":fig.colorbar(ax.imshow([[1,2,5],[2,3,4],[6,2,1]]),ax=ax)
    elif kind=="waterfall":ax.bar(x,[2,3,-1,4],bottom=[0,2,5,4],color=["green","green","red","green"])
    elif kind=="time_series":ax.plot(np.array(["2026-01-01","2026-02-01","2026-03-01","2026-04-01"],dtype="datetime64[D]"),y);fig.autofmt_xdate()
    elif kind=="multi_axis":ax.plot(x,y,color="blue");ax.twinx().plot(x,y*20,color="red");ax.set_ylabel("Left")
    elif kind=="combination":ax.bar(x,y,alpha=.4);ax.twinx().plot(x,y*10,color="red",marker="o")
    else:ax.axis("off");ax.text(.3,.5,"Ambiguous visual marks ?",transform=ax.transAxes)
    if kind not in ["pie","doughnut","unknown"]:ax.set_xlabel("Synthetic category");ax.set_ylabel("Synthetic value")
    fig.tight_layout();finish(fig,kind,kind)
fig,axes=plt.subplots(1,2,figsize=(8,3));axes[0].plot(x,y);axes[1].bar(x,y);finish(fig,"multi-panel","mixed","Two graph regions must be analyzed separately.")
fig,ax=plt.subplots(figsize=(6,4));ax.plot(x,y);fig.text(.1,.01,"This synthetic paragraph is outside the plot.",fontsize=10);finish(fig,"surrounding-paragraph","line")
fig,ax=plt.subplots(figsize=(6,4));ax.axis("off");ax.annotate("Component B",xy=(.8,.5),xytext=(.1,.5),arrowprops={"arrowstyle":"->"});finish(fig,"scientific-diagram","not_chart")
fig,ax=plt.subplots(figsize=(6,4));ax.plot(x,y);ax.spines[["top","right","bottom"]].set_visible(False);ax.set_xticks([]);finish(fig,"incomplete-axes","line")
Image.open(root/"line.png").resize((120,80)).save(root/"low-resolution.png")
manifest.append({"id":"low-resolution","file":"low-resolution.png","expectedType":"line","synthetic":True,"notes":"Degraded resolution; no measured recognition accuracy."})
photo=root/"photograph.jpg"
if photo.exists():manifest.append({"id":"photograph","file":"photograph.jpg","expectedType":"not_chart","synthetic":False,"credit":"Scott Somershoe/USFWS","source":"https://www.fws.gov/media/grasshoppersparrow1jpg","publisherLicense":"Public Domain"})
(root/"manifest.json").write_text(json.dumps({"purpose":"Labelled fixtures, not measured model accuracy. No paid AI is invoked by generation or tests.","samples":manifest},indent=2),encoding="utf-8")
print("Generated",len(manifest),"chart/negative fixtures")
