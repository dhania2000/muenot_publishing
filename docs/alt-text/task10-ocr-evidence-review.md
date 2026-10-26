# Task 10: OCR corrections and evidence review

Added a shared correction workbench for image OCR, equation OCR and scanned PDF page OCR. It is available from the existing image/equation inspectors and PDF page text inspector. A paginated OCR evidence review view sits inside the existing History workspace; no sidebar module or independent editor was added.

## Source and version integrity

Sources resolve through the existing tenant-scoped asset/document stores, image record scopes and occurrence checks. Page sources require a clean owner-scoped document. The server derives original text, region/page/run identity, model/source snapshot, warnings and confidence from saved recognition. The browser cannot submit an original text, tenant or editor identity.

Corrections append the `ocr_review` kind to the same accessibility evidence table introduced in Task 8. No duplicate correction/version table is created. A page review uses a null asset reference and retains its actual document/page/run in its input snapshot. Migration files establish the evidence table and permit page references without fabricating image assets. Runtime schema checks migrate only the old non-null asset column.

Each record preserves original raw text, corrected text, editor, timestamp, source analysis/version/ref, review state/comment, source snapshot and any corrected-equation validation. State is needs review, in review, corrected, verified or rejected/unusable. The parent asset or document is locked; the actual source is checked again; expected correction version must match the latest version. Conflicts return 409. Identical save request identities replay; changed payloads conflict. History is append-only. Earlier recognition/run corrections remain explicitly labelled and never silently become corrections to new OCR results.

Image reviews append audit-only entries to the existing `alt_text_versions` log. Page reviews append metadata events to their existing background job audit where a run exists. Neither operation changes description text, its content version, approval or original document/image bytes.

## Reviewer workflow

The desktop workbench places the original image/estimated crop or explicitly loaded PDF page on the left and correction/source/history/warning views on the right. Task 9's safe presentation MathML preview is shared for saved equation corrections. Local validation runs when saving an equation; a malformed equation cannot be marked verified. Explicit human verification creates a review reference in that correction's validation. This records a reviewer assertion, not computational proof of mathematical equivalence. Original Task 9 validation evidence is unchanged.

Editing uses existing update permission and per-record scope. Verification separately requires the existing review/approve gate. Save, in-review, verified, unusable, reload, reprocessing and queue Previous/Next controls are contextual. Unsaved changes are guarded on drawer close, queue/view changes, workspace tab change and browser unload. A conflicting save retains the local text until the reviewer chooses to reload.

English, Hindi, mixed scripts, scientific text and equation source remain exact Unicode strings. No translation, normalization or transliteration occurs. The server rejects oversized or broken Unicode strings instead of truncating graphemes; the editor does not silently trim pasted text at its limit. Comments are bounded plain text and React escapes their display.

Confidence is the actual Tesseract 0–100 engine score where present and is explicitly not an accuracy percentage. Mathematical recognition reports no confidence. Warning/failure/incomplete and manually selected records enter the scoped review view; reviewed or unusable sources can be included through the all-records selection.

Reprocessing invokes the existing image OCR, math job or PDF page OCR APIs after an explicit confirmation. It starts no paid description generation. Existing API permissions/settings remain authoritative. If failed mathematical recognition has no usable saved region snapshot, its reprocess action remains unavailable here; use the existing region/recognition panel to choose a current region. Corrections remain tied to their original run and are available as `human_corrected_ocr` evidence to later analysis.

## API and tests

`GET /api/alt-text/ocr-review` reads a tenant/owner-scoped paginated queue. A strict target query returns authorized source and saved/earlier review history. `POST` accepts strict correction input and expected version, rechecks edit/reviewer permission, applies rate/body limits and appends evidence transactionally. Reads do not run OCR or charge AI credits.

- 26 focused tests pass: exact English/Hindi/mixed/combining-character preservation, encoding/limit rejection, region/page associations, source isolation, stale source/version conflicts, role enforcement, immutable raw text, audit writes, queue scope binding and read-only retrieval.
- TypeScript and production webpack/standalone build pass.
- Broad Alt Text tests: 645 pass, 12 existing failures, 3 skipped (660 total); no new failures.
- Queue SQL bindings, transaction boundaries and conflicts are tested with controlled database adapters. A live MySQL tenant was unavailable; actual SQL execution, database race behavior, migration execution and authenticated browser interactions are not claimed verified.
- Unsaved-change UI guards and reprocessing controls compile but have not been browser-tested. The earlier local preview connectivity limitation remains.

Task 11 can consume existing raw OCR plus these separately identified corrections as evidence. It must preserve their source/version and reviewer status; final Alt Text approval stays independent.
