# Task 8: local mathematical recognition

Implemented a bounded local CPU recognizer for one existing equation region per explicit request. The existing region detector supplies the region ID and frame; mathematical OCR does not localize equations independently. Saved raw output and a candidate are unverified evidence, never approved Alt Text. Recognition is disabled unless an administrator enables equation recognition and the deployment provisions a verified worker.

## Engine and license audit

The pinned model is [MixTex/ZhEn-Latex-OCR](https://huggingface.co/MixTex/ZhEn-Latex-OCR/tree/37da0497956ac97f0a81f4da001f000d5295b77c), revision `37da0497956ac97f0a81f4da001f000d5295b77c`. Its publisher's model card declares Apache-2.0. The committed `models/math/model-lock.json` pins every downloaded asset with SHA256, including the 172,074,974-byte safetensors checkpoint. No weights are committed. Keep the pinned model card with deployment assets for attribution and license provenance.

The separate [MixTeX GUI repository](https://github.com/RQLuo/MixTeX-Latex-OCR) uses AGPL-3.0. No code from that GUI is imported or copied. The worker uses the standard Hugging Face Transformers VisionEncoderDecoderModel (Apache-2.0), PyTorch CPU (BSD-style), safetensors (Apache-2.0), NumPy (BSD-3-Clause) and Pillow (HPND). Python's standard library provides the provisioning script. Frontend and crop code reuse installed application packages. Runtime versions are pinned in `scripts/requirements-math-cpu.txt`; production checks require torch 2.8.0+cpu and Transformers 4.56.2. This records publisher license declarations and the selected integration, not a legal certification of the training data.

[Pix2tex releases](https://github.com/lukas-blecher/LaTeX-OCR/releases) distinguish MIT application code from CC BY-NC-SA weights. Those weights were not selected for this commercial publishing application. No Mathpix, paid API, Tesseract math substitution, pickle checkpoint or remote model code is used.

## Deployment

Use a dedicated Python 3.12 environment on the target host. Install CPU PyTorch from its official CPU index, then the pinned requirements:

```text
python -m pip install torch==2.8.0 --index-url https://download.pytorch.org/whl/cpu
python -m pip install -r scripts/requirements-math-cpu.txt
python scripts/provision-math-model.py --model-dir /absolute/private/math-model
```

Set `ALT_TEXT_MATH_PYTHON` to that environment's absolute Python executable and `ALT_TEXT_MATH_MODEL_DIR` to the absolute private model directory. A normal dedicated environment needs no PYTHONPATH. An isolated target installation can use `ALT_TEXT_MATH_PYTHONPATH`. `ALT_TEXT_MATH_DISABLED=1` overrides settings. The provisioning command downloads pinned public assets, verifies their hashes, initializes the actual worker offline, and writes a runtime receipt. Run provisioning again after a runtime or preprocessing change. Viewer/status requests only inspect hashes and the receipt; they never initialize inference or download files.

The Python worker and model lock are included in standalone API output, including the shared job endpoints. CPU packages and weights are external deployment assets. Hostinger's older Linux/glibc runtime has not been verified for PyTorch; provisioning must succeed on that host before enabling recognition. Do not assume the Windows smoke proves Linux compatibility.

## Evidence, permissions and execution

`GET/POST /api/alt-text/assets/[id]/math` reuses the existing module/session/tenant/history permissions. Viewing and editing have independent asset scopes. Occurrences must belong to the same asset. The source is opened through the existing private preview/security path. Only a current `equation_region` with known orientation and matching stored dimensions can run. Client paths, coordinates, tenant IDs and model overrides are rejected. Source byte hashes and region snapshots are rechecked by the worker.

`alt_text_accessibility_evidence` stores append-only versions attached to existing asset, occurrence and region IDs. Evidence and the existing `platform_background_jobs` job are inserted in one transaction. Request identity conflicts fail; compatible active work coalesces. Delivery replay skips completed evidence. Result writes require the current worker and unexpired lease. Queue retries, cancellation checkpoints and terminal lease recovery reuse the existing queue. Math and PDF page OCR share a cluster-wide heavy-work cap of one.

The crop is an independent white PNG with a 4-megapixel/5-MB limit. Source images are never written. Inference runs in a shell-free child process with an environment allowlist, local safetensors only, CPU threads bounded to two, a 90-second deadline and bounded output. Raw output remains text in the inspector; it cannot inject HTML. Long/token-limited generations are saved as incomplete, without a LaTeX candidate. No confidence score is invented.

Preprocessing `white-fit-half-v1` fits the crop into a 500×400 white canvas at a scale of at most 0.5 with offset (10,10). It preserves aspect ratio and records the transform. The model's small-text sensitivity is substantial; the transform is a reproducible tested choice, not a general accuracy guarantee.

## Integration and limits

The existing asset drawer and document Image Details sheet show equation region selection, an estimated source crop, versions, raw output/candidate, model identity, copy action and warnings. Reads never start recognition. One region is processed at a time; separate equation regions retain independent identities. Source position remains estimated by the existing vision detector.

Extracted document image assets/occurrences can use this path. Native DOCX OMML extraction is absent. Task 7 page OCR rasters are not registered as image assets, so direct whole scanned-PDF-page math recognition is not implemented here. An uploaded page image or an existing extracted image asset can be analyzed through the normal image workflow. Original DOCX/PPTX/PDF files remain unchanged. No equation solving, MathML conversion, syntax validity claim or manual correction workspace is included; these are later tasks.

## Verification

Real CPU initialization and inference ran locally with pinned assets. `scripts/check-math-recognition.py` exercises the actual production worker against labelled synthetic fixtures, records every raw output and character error rate, and checks source byte immutability. `test/fixtures/math/manifest.json` covers fractions, radicals, super/subscripts, sums, limits, integrals, Greek, vectors, composited matrices/multiline formulas, multiple equations, rotation, blur and English/Hindi surrounding text. `scripts/generate-math-fixtures.py` reproduces them with test-only Matplotlib 3.10.6 and Pillow; the Hindi sample uses Windows Nirmala TTC if available. Composited matrix rows are synthetic test drawings, not a TeX renderer's matrix-layout benchmark.

The model's results are weak on these fixtures. Arithmetic preserves `1+2=3` inside added LaTeX wrappers, while other examples contain missing/changed symbols or repetition. Raw exact match counts formatting as an error. Character error rate can exceed 100% and does not measure semantic mathematical equivalence. See the accompanying real-result JSON; do not advertise broad formula-type accuracy or production readiness from model initialization alone.

Unit tests exercise source frames, strict request/worker contracts, actual crops and source immutability, scoped reads, tenant/occurrence denial, missing runtime, transaction enqueue, stale leases, replay, cancellation and read-only views. The optional Node-to-Python smoke uses the real bridge (`RUN_LOCAL_MATH_SMOKE=1`). No tenant database or authenticated end-to-end environment was available, so MySQL transaction/race behavior and full live UI authorization remain unverified. Synthetic UI preview is separately labelled. The existing 12 baseline Alt Text test failures remain outside this task.

Task 9 should preserve this exact candidate/raw output and evidence version, add a bounded safe parser and presentation MathML, and keep syntactic validity separate from human verification and source correctness.

Measured local run: 24/24 worker invocations exited successfully and all 24 source hashes remained unchanged. Raw exact match was 0/24; mean per-example raw character error rate was 6.6992 (669.92%). This metric includes added formatting and is not a semantic score. One real Node-to-Python arithmetic smoke passed in 7 seconds, checking content, pin identity, no confidence invention and original-byte immutability. The 21 focused unit tests pass. TypeScript and production build pass. The broad run before the last 9 tests was 568 passed, 12 baseline failures, 2 skipped. Standalone output contained both the Python worker and model lock. A synthetic UI preview was prepared, but the local browser could not connect to that preview server, so visual verification is not claimed.
