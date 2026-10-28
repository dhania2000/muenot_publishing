# Phase 3 Task 20 — advanced evidence review and correction workspace

Implemented 2026-10-28 on `feat/phase3-task08-math-ocr`. No merge or production deployment.

## Existing workflow reused

The image asset drawer and document image details sheet now open the same saved-evidence workbench. The long stack of analysis panels is replaced by a focused evidence selector and a collapsed selector that mounts one existing analysis tool at a time. Existing classification, description editing, quality warnings, final approval, export and version history remain in their original workflows. The History/Review area adds a structured-evidence queue alongside its existing OCR queue and saved generations; there is no new top-level module.

OCR text and equation LaTeX use Task 10's `OcrEvidenceReview`, existing equation preview/validation, version storage, source recheck and explicit reprocess confirmation. Page OCR remains available through that existing paginated queue and its PDF page preview. Structured corrections reuse `alt_text_accessibility_evidence` and add `evidence_review` audit entries to `alt_text_versions`; no new table, reviewer registry, approval store, model, paid call, background job, source-pixel edit or document edit is introduced.

## Supported corrections

- Graph axes, literal labels and units; current saved data points, finite numeric transcription, existing series references, explicit unknown/null and manual-estimate precision notes.
- Scientific component labels/terminology, existing visible relationships and label associations to existing same-panel targets. Unknown/unreadable is explicit. These edits cannot establish scientific truth.
- Table cell text, flowchart node labels and existing connector relationships; map/mixed-content literal labels within existing regions. No invented cells, routes, numeric digitization or scientific identities.
- Reviewer context notes for an exact authorized document occurrence with a usable current context packet. Notes are marked as human evidence and do not change native document text. Private native paragraphs are not returned in a note target.

Manual graph values are tagged `human_source_transcription`, `manual_estimate` or `unknown`, never `source_exact`. Original saved chart points and the current Task 13 label-role review are displayed separately. Native exact values, scientific accuracy and final description approval stay false on every structured review record.

## Review versions, source and permissions

Five compatible states are supported: needs review, in review, corrected, verified and rejected. Verification/rejection require a reason; corrected/verified records require at least one explicit correction. Verification additionally requires the actual image's approve scope as well as update access. The existing OCR endpoint was also tightened to enforce record-specific approve scope and authorized document-occurrence access rather than trusting a global capability flag.

Each append records source kind/id/version/region/fingerprint, correction targets and values, reviewer, timestamp, state and reason. Raw analysis rows remain unchanged. A tenant-scoped image transaction lock serializes review saves; expected-version conflicts reject stale writes, a source recheck detects changed pixels/regions/OCR reviews/context, and request/config identities allow the same save to be retried without appending twice. Permissions are checked again against the current source inside the transaction. A review append and its existing image-version audit are atomic. No final content, active content version, approval, language or export is changed by an evidence correction.

Current image hash, region analysis/crop and OCR review references are checked before editing. Historical sources are read-only. A review from an older source fingerprint is retained in history and is not copied automatically into a new draft. Canonical fingerprints tolerate MySQL JSON object-key reordering while preserving array order and literal text.

Request bodies are bounded to 80 KB, corrections to 32, targets to 200/180 KB and selected review history to 50 versions. Strict request keys reject client tenant/reviewer/final-approval claims. Numeric values, unit lengths, same-panel endpoints, association membership, UTF-16 and literal text limits are validated. Existing session/module/tenant gates, rate limiting, safe React rendering and private/no-store responses apply.

## Queue and interface

The structured queue supports parameterized image-name search, evidence kind, pending/all/specific review state, warning/routine priority, image/document source and reviewer ID, with server-side pagination (25 default, 50 maximum). Counts and list rows return metadata only; analysis JSON is used in SQL solely to derive the warning flag and is never selected into the list response. Tenant, image view scope, exact occurrence mapping, extracted status, clean document status and document ownership predicates protect list rows. Opening a row performs the stronger live source authorization/currentness check.

Desktop uses three columns: image with named selectable overlays, one typed correction editor, and immutable evidence/warnings/version inspector. Narrow screens use explicit image/editor/inspector section controls, showing one section at a time. Existing sheet widths expand only for this review workflow. Inputs support Hindi and technical Unicode; region controls work by keyboard and the selected evidence list provides the same targets without pointer precision. Selecting an overlay moves focus into the selected-evidence control. Dirty drafts protect source changes, queue/filter/page changes, sheet close, duplicate-occurrence navigation and browser unload. Description/evidence dirty state is combined in the asset drawer. No inspection, correction, refresh or save invokes recognition, generation or metering.

## Verification

- Full Alt Text suite: **1,106 passed, 0 failed, 3 skipped** (1,109 total in 102 files; existing exploratory `zz-explore.test.ts` excluded). Task 20 adds 53 checks, including two OCR permission/privacy regressions.
- Production webpack build includes TypeScript validation and standalone preparation.
- Tests exercise literal Hindi/Unicode, strict inputs, raw preservation, explicit numeric precision, unknown/null, existing-series mapping, same-panel relationships/associations, table corrections, review transitions, source/occurrence/tenant denial, changed OCR/image evidence, permissions, atomic append/audit boundaries, optimistic conflict, replay, source hashes, queue bounds/SQL predicates and route gates/body limits.
- Real React component browser checks use clearly labelled synthetic authenticated responses: exact Hindi/Unicode save payload, original text preservation, saved review version, concurrent-review conflict, canceling an unsaved-change confirmation, keyboard region selection and 390×844 layout. Screenshots: `outputs/task20-evidence-review-desktop.png` and `outputs/task20-evidence-review-mobile.png` outside the repo.

## Limits and Task 21 readiness

No live MySQL transaction/concurrent session, authenticated production tenant, paid provider, screen-reader audit or Hostinger deployment was available. SQL-boundary tests and simulated browser conflicts do not establish live database concurrency or full accessibility conformance. Priority reflects warning presence and is not a scientific-risk score. Queue status describes the last saved evidence review; live source freshness is rechecked when opening it. The bounded source selector shows 100 structured and 25 each OCR/math records; very large sources fail safely rather than silently truncating targets. Existing DOCX live context extraction remains unsupported.

Corrections are a separate reviewer layer, visible in this workbench and existing audit history. They do not silently overwrite Task 13 role decisions, Task 17 generation packets or exported descriptions. Later QA/pipeline work must explicitly consume a current, authorized review snapshot and retain human/manual/estimated provenance. Task 21 can build typed QA rules on these snapshots and the existing Task 19 advisory validators without treating human verification as scientific certification.

## Actual repository files

New: `lib/alt-text/structured-review-contract.ts`, `structured-review-source.ts`, `structured-review-store.ts`, `structured-review-queue.ts`; `app/api/alt-text/assets/[id]/evidence-review/route.ts`; `app/api/alt-text/evidence-review/route.ts`; `components/publishing/alt-text/structured-evidence-review.tsx`, `evidence-review-workbench.tsx`, `evidence-analysis-tools.tsx`, `structured-review-history.tsx`; five `test/alt-text/structured-review-*.test.ts` files; this report.

Updated: `app/api/alt-text/ocr-review/route.ts`; `lib/alt-text/ocr-review-source.ts`, `ocr-review-queue.ts`; `components/publishing/alt-text/alt-text-asset-drawer.tsx`, `image-details-sheet.tsx`, `ocr-review-history.tsx`; `test/alt-text/ocr-review-source.test.ts`, `ocr-review-route.test.ts`.
