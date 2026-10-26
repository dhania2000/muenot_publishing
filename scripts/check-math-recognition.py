"""Explicit offline smoke/accuracy check; never called by the application viewer.
Runs the actual isolated production worker per labelled fixture. No normalized accuracy claims.
"""
import argparse, base64, hashlib, json, os, subprocess, sys
from pathlib import Path

def distance(a,b):
    row=list(range(len(b)+1))
    for i,x in enumerate(a,1):
        nxt=[i]
        for j,y in enumerate(b,1):
            nxt.append(min(row[j]+1,nxt[-1]+1,row[j-1]+(x!=y)))
        row=nxt
    return row[-1]

parser=argparse.ArgumentParser()
parser.add_argument("--model-dir",required=True)
parser.add_argument("--output",required=True)
args=parser.parse_args()
root=Path(__file__).resolve().parent.parent
fixture_dir=root/"test/fixtures/math"
manifest=json.loads((fixture_dir/"manifest.json").read_text(encoding="utf-8"))
rows=[]
for item in manifest["samples"]:
    source=(fixture_dir/item["file"]).read_bytes()
    before=hashlib.sha256(source).hexdigest()
    completed=subprocess.run([sys.executable,str(root/"scripts/math-ocr-worker.py"),"--model-dir",args.model_dir,"--lock",str(root/"models/math/model-lock.json")],input=json.dumps({"pngBase64":base64.b64encode(source).decode()}),text=True,capture_output=True,timeout=110)
    result=json.loads(completed.stdout)
    raw=result.get("rawOutput","")
    rows.append({**item,"sourceSha256":before,"originalUnchanged":before==hashlib.sha256((fixture_dir/item["file"]).read_bytes()).hexdigest(),"exitCode":completed.returncode,"output":result,"rawExactMatch":raw==item["expected"],"rawCharacterErrorRate":distance(item["expected"],raw)/max(1,len(item["expected"]))})
    Path(args.output).write_text(json.dumps({"synthetic":True,"metric":"Raw LaTeX character edit distance / ground-truth length; formatting counts as errors, can exceed 1. No semantic accuracy claim.","samples":rows},ensure_ascii=False,indent=2),encoding="utf-8")
    print(item["id"],completed.returncode,"exact",rows[-1]["rawExactMatch"],"CER",round(rows[-1]["rawCharacterErrorRate"],3),flush=True)
