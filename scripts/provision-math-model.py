"""Explicit deployment provisioning. Downloads only pinned public model assets, verifies SHA256,
then initializes the offline production worker before atomically writing its readiness receipt.
Install the documented CPU runtime first. No downloads happen in web requests.
"""
import argparse,hashlib,json,os,subprocess,sys,urllib.request
from pathlib import Path
parser=argparse.ArgumentParser()
parser.add_argument("--model-dir",required=True)
args=parser.parse_args()
root=Path(__file__).resolve().parent.parent
lock_path=root/"models/math/model-lock.json"
lock=json.loads(lock_path.read_text(encoding="utf-8-sig"))
target=Path(args.model_dir).resolve()
target.mkdir(parents=True,exist_ok=True)
for name,expected in lock["files"].items():
    if Path(name).name!=name:raise RuntimeError("Invalid asset name")
    destination=target/name
    if destination.is_file() and hashlib.sha256(destination.read_bytes()).hexdigest()==expected:continue
    temporary=target/(name+".partial")
    url=f'https://huggingface.co/{lock["modelId"]}/resolve/{lock["revision"]}/{name}'
    digest=hashlib.sha256()
    try:
        with urllib.request.urlopen(url,timeout=90) as response,temporary.open("wb") as output:
            while chunk:=response.read(1024*1024):
                output.write(chunk);digest.update(chunk)
        if digest.hexdigest()!=expected:raise RuntimeError("Model integrity check failed")
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)
probe=subprocess.run([sys.executable,str(root/"scripts/math-ocr-worker.py"),"--model-dir",str(target),"--lock",str(lock_path),"--probe"],capture_output=True,text=True,timeout=90)
if probe.returncode:raise RuntimeError("Offline CPU model initialization failed")
receipt=json.loads(probe.stdout)
if receipt.get("status")!="available":raise RuntimeError("Invalid runtime receipt")
temporary=target/"runtime-health.json.partial"
temporary.write_text(json.dumps(receipt,indent=2),encoding="utf-8")
temporary.replace(target/"runtime-health.json")
print("Pinned model assets verified; offline CPU initialization passed.")
