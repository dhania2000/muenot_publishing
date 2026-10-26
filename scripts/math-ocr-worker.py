"""Task 8 local, offline, CPU-only formula recognition. One request per child process.

No HTTP service, pickle checkpoints, remote model code, shell execution or runtime downloads.
Model files must match the committed lock. The parent process owns timeout/cancellation.
"""
import argparse
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import time

os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1", TOKENIZERS_PARALLELISM="false", CUDA_VISIBLE_DEVICES="")

def execute():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--lock", required=True)
    parser.add_argument("--probe", action="store_true")
    args = parser.parse_args()
    lock = json.loads(Path(args.lock).read_text(encoding="utf-8-sig"))
    model_dir = Path(args.model_dir).resolve()
    for name, expected in lock["files"].items():
        if Path(name).name != name:
            raise ValueError("INVALID_MODEL_LOCK")
        file = model_dir / name
        if not file.is_file() or hashlib.sha256(file.read_bytes()).hexdigest() != expected:
            raise ValueError("MODEL_INTEGRITY_FAILED")
    import torch
    import transformers
    if torch.__version__ != "2.8.0+cpu" or transformers.__version__ != "4.56.2":
        raise ValueError("RUNTIME_VERSION_MISMATCH")
    from transformers import AutoTokenizer, AutoImageProcessor, VisionEncoderDecoderModel
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = 4_000_000
    torch.set_num_threads(2)
    tokenizer = AutoTokenizer.from_pretrained(str(model_dir), local_files_only=True, trust_remote_code=False, use_fast=False)
    processor = AutoImageProcessor.from_pretrained(str(model_dir), local_files_only=True, trust_remote_code=False, use_fast=False)
    model = VisionEncoderDecoderModel.from_pretrained(str(model_dir), local_files_only=True, use_safetensors=True, trust_remote_code=False).to("cpu").eval()
    if args.probe:
        # Readiness is produced by actual model initialization, never by a file-existence claim.
        print(json.dumps({"schemaVersion": 1, "status": "available", "preprocessingVersion":"white-fit-half-v1", "modelId": lock["modelId"], "revision": lock["revision"], "pythonExecutable": str(Path(sys.executable).resolve()), "platform": sys.platform, "torch": torch.__version__, "transformers": transformers.__version__, "weightsSha256": lock["files"]["model.safetensors"]}))
        return
    raw = sys.stdin.buffer.read(8_000_001)
    if len(raw) > 8_000_000:
        raise ValueError("INPUT_LIMIT")
    request = json.loads(raw)
    image_bytes = base64.b64decode(request["pngBase64"], validate=True)
    image = Image.open(io.BytesIO(image_bytes))
    if image.format != "PNG" or image.width * image.height > 4_000_000 or min(image.size) < 8:
        raise ValueError("INVALID_CROP")
    image.load()
    started = time.monotonic()
    # The model's 500x400 page-shaped training input must not stretch a tiny equation crop.
    # Keep aspect ratio, bound text scale, and record the crop-to-model transform explicitly.
    scale = min(0.5, 480 / image.width, 380 / image.height)
    content_size = (max(1,round(image.width*scale)),max(1,round(image.height*scale)))
    canvas = Image.new("RGB",(500,400),"white")
    canvas.paste(image.convert("RGB").resize(content_size,Image.Resampling.LANCZOS),(10,10))
    pixels = processor(images=canvas, return_tensors="pt").pixel_values
    with torch.inference_mode():
        generated = model.generate(pixels, max_new_tokens=384, num_beams=1, do_sample=False, return_dict_in_generate=True)
    text = tokenizer.decode(generated.sequences[0], skip_special_tokens=True)
    if len(text) > 12_000:
        raise ValueError("OUTPUT_LIMIT")
    print(json.dumps({"schemaVersion": 1, "rawOutput": text, "modelId": lock["modelId"], "revision": lock["revision"], "weightsSha256": lock["files"]["model.safetensors"], "confidence": None, "confidenceBasis": "not_reported", "durationMs": round((time.monotonic()-started)*1000), "preprocessing":{"version":"white-fit-half-v1","width":500,"height":400,"scale":scale,"offsetX":10,"offsetY":10}, "generation": {"maxNewTokens":384,"numBeams":1,"doSample":False,"truncated":generated.sequences[0,-1].item()!=tokenizer.eos_token_id}}, ensure_ascii=False))

if __name__ == "__main__":
    try:
        execute()
    except Exception as error:
        # No model text, image bytes, paths, credentials or document content in error output.
        print(json.dumps({"schemaVersion":1,"errorCode": str(error) if isinstance(error,ValueError) and str(error).isupper() else "MODEL_EXECUTION_FAILED"}))
        sys.exit(1)
