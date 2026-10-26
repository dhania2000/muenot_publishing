from pathlib import Path
import json
import os
root = Path(__file__).resolve().parent.parent / "test/fixtures/math"
os.environ.setdefault("MPLCONFIGDIR", str(Path(os.environ.get("TEMP", ".")) / "muenot-math-fixtures"))
import matplotlib
matplotlib.use("Agg")
from matplotlib.mathtext import math_to_image
from matplotlib.font_manager import FontProperties
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import io


root.mkdir(parents=True, exist_ok=True)
samples = [
    ("limit", r"\lim_{x\to 0}\frac{\sin x}{x}=1"),
    ("double-integral", r"\int\int f(x,y)\,dx\,dy"),
    ("vector", r"\vec{a}\cdot\vec{b}=0"),
    ("arithmetic", r"1+2=3"),
    ("algebra", r"x^2+y^2=z^2"),
    ("fraction", r"\frac{a+b}{c}"),
    ("nested-fraction", r"\frac{1}{1+\frac{1}{x}}"),
    ("radical", r"\sqrt{x^2+1}"),
    ("integral", r"\int_0^1 x^2\,dx=\frac{1}{3}"),
    ("summation", r"\sum_{i=1}^{n}i=\frac{n(n+1)}{2}"),
    ("greek", r"\alpha+\beta=\gamma"),
    ("subscript", r"a_{n+1}=a_n+1"),
    ("derivative", r"\frac{\partial f}{\partial x}=2x"),
    ("trigonometry", r"\sin^2 x+\cos^2 x=1"),
    ("logarithm", r"\log(ab)=\log a+\log b"),
    ("inequality", r"x\leq y"),
    ("set", r"A\cup B"),
    ("probability", r"P(A\mid B)=\frac{P(A\cap B)}{P(B)}"),
]
manifest = []
for name, latex in samples:
    math_to_image("$"+latex+"$", root/(name+".png"), prop=FontProperties(size=22), dpi=200, format="png", color="black")
    manifest.append({"id":name,"file":name+".png","expected":latex,"renderer":"matplotlib.mathtext"})
def composite(name, latex, lines):
    parts=[]
    for line in lines:
        output=io.BytesIO()
        math_to_image("$"+line+"$",output,prop=FontProperties(size=22),dpi=200,format="png",color="black")
        parts.append(Image.open(io.BytesIO(output.getvalue())).convert("RGB"))
    canvas=Image.new("RGB",(max(p.width for p in parts)+40,sum(p.height+16 for p in parts)+20),"white")
    y=10
    for part in parts:canvas.paste(part,(20,y));y+=part.height+16
    canvas.save(root/(name+".png"))
    manifest.append({"id":name,"file":name+".png","expected":latex,"renderer":"matplotlib.mathtext + Pillow composition"})
composite("matrix",r"\begin{bmatrix}1&2\\3&4\end{bmatrix}",[r"[\,1\quad2",r"\quad3\quad4\,]"])
composite("multiline",r"\begin{aligned}x+y&=3\\x-y&=1\end{aligned}",[r"x+y=3",r"x-y=1"])
composite("multiple-equations",r"x=1\qquad y=2",[r"x=1\qquad y=2"])
for name,transform in [("rotated",lambda p:p.rotate(15,expand=True,fillcolor="white")),("poor-quality",lambda p:p.filter(ImageFilter.GaussianBlur(2)))]:
    transform(Image.open(root/"algebra.png").convert("RGB")).save(root/(name+".png"))
    manifest.append({"id":name,"file":name+".png","expected":r"x^2+y^2=z^2","renderer":"Pillow perturbation"})
font_path=Path(os.environ.get("WINDIR","C:/Windows"))/"Fonts/Nirmala.ttc"
if font_path.is_file():
    equation=Image.open(root/"arithmetic.png").convert("RGB")
    canvas=Image.new("RGB",(600,200),"white")
    ImageDraw.Draw(canvas).text((12,8),"Equation / समीकरण",font=ImageFont.truetype(str(font_path),26),fill="black")
    canvas.paste(equation,(12,60));canvas.save(root/"surrounding-english-hindi.png")
    manifest.append({"id":"surrounding-english-hindi","file":"surrounding-english-hindi.png","expected":"1+2=3","renderer":"Pillow Nirmala font; surrounding prose is a distractor"})
(root/"manifest.json").write_text(json.dumps({"synthetic":True,"samples":manifest},ensure_ascii=False,indent=2),encoding="utf-8")
print(f"Generated {len(manifest)} synthetic equation fixtures")


