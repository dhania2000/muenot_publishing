# Phase 3 Task 21 — scientific evidence and accessibility QA

Implemented 2026-10-28 on `feat/phase3-task08-math-ocr`. No merge or production deployment.

## Existing services reused

One advanced-image rule registry extends the existing QA contracts and runs inside the existing image/document evidence-review workbench and structured review queue. It reuses the existing KaTeX parser and safe presentation MathML sanitizer, Task 19 terminology checks, Task 20 current-source resolver and correction contracts, original private-image authorization/scan checks, existing validation summary/filter/sort/finding UI, CSV neutralization, session/module/tenant gates, rate limits, evidence table and asset-version audit. Existing native DOCX/PPTX/PDF output validation remains intact; this task adds saved-image evidence QA rather than asserting document conformance.

There is no new recognition model, provider request, worker queue, credit ledger, approval service or database table. Inspection/validation never rewrites source pixels, analysis, description text or document output. Human verification of evidence is not converted into scientific truth or final description approval.

## Executed rule inventory

Registry/version: `advanced-quality.v1`, 34 typed rules. Findings carry rule ID, applies-to category, status, severity, execution flag, evidence/source version and region references, review state, explanation, recommended action and validation version.

| IDs | Actual supported checks |
| --- | --- |
| QA-SOURCE-01 | Current source identity, stale/incomplete coverage and bounded omission reporting |
| QA-DESC-01–08 | Required short/long description, active human approval, decorative/content inconsistency, bounded placeholder list, Unicode corruption, advisory prose-script mismatch and editorial length target |
| QA-MATH-01–04 | Saved non-rejected equation transcription, actual bounded LaTeX parsing, actual safe presentation MathML generation/sanitization, ambiguous or unreviewed notation |
| QA-OCR-01–06 | Current recognition presence/failure/pending status, actual supported engine scores, retained raw/corrected differences, Unicode/unreadable text, recorded loaded language packs versus requested mode, unverified/truncated/column reading order |
| QA-GRAPH-01–08 | Same-axis unit contradictions, tick/calibration/slope/direction consistency, confirmed printed-label value provenance, foreign/missing series links, estimates/extra decimal precision, statistical/causal keyword review, individual pie-percentage bounds and title/tick label references |
| QA-SCI-01–03 | Existing component endpoints/arrow prerequisites, verified-source unit/chemical-case/Greek/geometry-notation detectors and domain uncertainty |
| QA-FLOW-01 | Existing flowchart endpoints, explicit unknowns and saved arrowhead/direction prerequisites |
| QA-TABLE-01 | Missing cell-scoped readable evidence and manual table/header/reading-order review |
| QA-EXPERT-01 | Explicit expert review for scientific truth, source equivalence and critical-information completeness |
| QA-GUIDE-01 | Optional additive, bounded declarative client rules; absent/empty rule sets do not create fabricated passes |

The actual math-parser policy, renderer version and terminology rule version are recorded in the report and input audit, and included in cache identity. Updating a validator version invalidates a previous matching report. The current renderer is KaTeX 0.19.1, math parser policy 1 and terminology policy `literal-source.v1`.

Syntax validity, presentation MathML generation and matching reference IDs do not establish mathematical equivalence or scientific truth. The English/Hindi script and technical-notation checks are advisory heuristics; a valid spoken/linear equivalent can differ from the printed symbols. Statistical/causal wording is routed to expert review, not semantically certified. Tesseract's real 0–100 evidence is never relabelled as an accuracy percentage. Missing confidence remains Not Verified. Output language and OCR recognition mode are separate: English recognition with Hindi description output is not automatically a mismatch.

Graph checks do not enable pixel extraction. Image-derived native source-exact values are unsupported; label-exact values need both current verified OCR references and confirmed label-role review. Manual estimates remain estimates. Only individual supported pie/doughnut percentages are bounded to 0–100; category completeness and a 100% total remain Not Verified. Different axes can legitimately use different units. Critical omissions without a reliable deterministic signal require expert review rather than invented passing checks.

## Status, severity and scoring

Statuses remain distinct: Passed, Failed, Warning, Not Verified, Not Applicable, Not Executed and Manual Review Required. Severity supports Critical, High, Medium, Low and Information, with Information displayed accurately while adapting to the existing finding component.

The aggregate is labelled **Automated Checks Pass Rate**. Only applicable executed Passed/Failed/Warning rules enter its denominator. Not Applicable/Not Executed/Not Verified/Manual Review cannot inflate it; an empty denominator yields no calculated score. Critical/high failures are counted separately as blocking failures, independent of a high aggregate rate. A defensive summary adapter also prevents unexecuted findings labelled "passed" by a faulty caller from entering the pass rate. No result is called a WCAG compliance percentage or certification.

The flawed browser fixture produces 4 blocking failures and 56.3% over 16 executed rules. Its corrected snapshot produces zero blocking failures and 94.4% over 18 executed rules while keeping 2 manual-review findings. The remaining raw/corrected-source warning is intentional. These are fixture results from the real registry, not measured production accuracy.

## Current-source snapshot, storage and audit

All inputs are loaded server-side. The public run request accepts only request identity and exact optional occurrence; client tenant, reviewer, descriptions, findings, approval and guideline payloads are rejected. Source access checks tenant, image record scope, exact document occurrence, current document access/scan/source and private image access. QA can inspect a viewer-authorized source without granting update rights; recording a report additionally requires actual image update scope, checked again inside the image lock.

The snapshot binds actual image bytes, content version, classification, supported policy, current OCR/region/review versions and authorized context identity. OCR queries project only needed fields rather than loading all layout words. Evidence input queries project source/target references instead of cached private document-context packets, limit source records and omit over-budget JSON explicitly. Structured sources reuse Task 20's current image/analysis/OCR/crop checks. Raw and corrected OCR remain distinct; only exact raw/source/occurrence matches attach a review. Cached scientific-domain context and private native paragraphs are not copied into the QA input/report.

Bounds include a 20 MB image read, 32 OCR scopes, 96 recent latest-per-scope evidence records, 12 structured source inspections, at most 8 math/chart/science/illustration groups and a 240 KB serialized QA input. Oversized/unsupported inputs fail safely or produce explicit incomplete coverage; omitted material is not certified. No inference or recognition is started to fill gaps.

Immutable report snapshots use `alt_text_accessibility_evidence.kind='quality_validation'`; their normalized input and validator versions are stored in the same tenant-scoped audit row. A shared image transaction lock rechecks current fingerprint and permissions before the append. A source change produces a conflict rather than saving stale findings. Repeating an identical request or validating the same unchanged snapshot reuses the existing report. Report append and `alt_text_versions` audit are one transaction. Active description content/version, approval and export remain unchanged.

Reading an existing report re-authorizes the source and compares its fingerprint plus actual validator versions. Historical reports remain readable with an explicit stale indicator. Read-only inspection of an image with no saved QA report does not execute QA or recognition. JSON/CSV downloads require the existing export permission and private/no-store responses. CSV reuses the existing UTF-8 BOM/quoting/formula neutralization and records run, validator versions, content version, source fingerprint, snapshot currentness and evidence references. The internal full input snapshot is not included in the public report download.

## Review integration and optional guidelines

The existing workbench and structured-review queue show a focused QA disclosure, summary, status/severity/search filters, 10 findings per page, evidence-inspection actions for available saved sources, review state and suggested correction. The existing `Finding` component gains optional presentation/footer properties; normal document-validation behavior is unchanged. OCR/structured correction saves refresh the matching saved QA report; description saves already invalidate asset-related caches. Mounting/refreshing the inspector rechecks report currentness. None of these refreshes invokes paid analysis.

No active tenant/project glossary or client-guideline registry exists in this repository. Standard server QA therefore uses `guideline:null`. The pure engine supports a bounded trusted-server policy of required/forbidden literal terms and required long description, recording its ID/version when supplied. These rules are additive, do not execute instructions/regex/code, cannot disable mandatory rules and are not accepted from public run requests. An absent or empty guideline is Not Applicable, not a fabricated success. No working guideline upload/approval service is claimed.

## Verification and limits

- Full Alt Text suite: **1,167 passed, 0 failed, 3 skipped** (1,170 total in 106 files). Existing exploratory `zz-explore.test.ts` remains excluded. Task 21 adds 61 checks; final targeted checks also cover the last validator-version and explicit complex-purpose changes.
- TypeScript and production webpack build/standalone preparation are checked against the final implementation.
- Good/flawed fixtures exercise actual parser/MathML execution, malformed/unsafe LaTeX, ambiguous notation, Hindi/Unicode, OCR failure/unknown scores/model selection, false exact values, units/ticks/calibration/series/label references, percentage bounds, precision wording, scientific endpoints/arrows/notation/domain uncertainty, flow/table evidence, source conflicts, decorative errors, missing approval/descriptions, optional additive rules and deterministic scoring.
- SQL/route boundary tests exercise foreign tenant/record/document denial, exact occurrence/source/review matching, bounded projections, cached private-context exclusion, source/permission changes inside the lock, shared audit failure, replay, report currentness, strict client input, export permission and safe JSON/CSV behavior.
- Clearly labelled browser component fixtures use the actual engine and report UI with mocked authenticated persistence. They cover flawed/corrected source results, expert-review separation, filtering, evidence-inspection controls, stale-report warning and narrow-screen layout. Screenshots live in the task's external `outputs` folder.

No live MySQL concurrency/audit rollback, authenticated production tenant, paid provider, independent scientific expert review, screen-reader audit, native Office/PDF conformance validator or Hostinger deployment was available. Snapshot fixtures and SQL-boundary tests do not establish those outcomes. These are supported image-level deterministic checks; page-wide OCR semantics, arbitrary language correctness, mathematical equivalence, complete graph digitization, chemical/biological/physical truth and certified accessibility remain outside automatic verification.

## Actual files and Task 22 dependencies

New: `lib/alt-text/advanced-quality-contract.ts`, `advanced-quality.ts`, `advanced-quality-source.ts`, `advanced-quality-store.ts`; `app/api/alt-text/assets/[id]/quality/route.ts`; `components/publishing/alt-text/advanced-quality-panel.tsx`; four `test/alt-text/advanced-quality*.test.ts` files; this report.

Updated: `components/publishing/alt-text/evidence-review-workbench.tsx`, `structured-review-history.tsx`, `output-validation-panel.tsx`, `structured-evidence-review.tsx`, `ocr-evidence-review.tsx`.

Task 22 can call the same bounded server engine/store from the existing durable pipeline and retain report/source/validator identities in progress data. It must continue to use the existing credit reservations, job leases, replay, cancellation and human approval boundaries. A stale report or a high pass rate cannot authorize unapproved content or substitute for current source evidence. Paid recognition/generation remains an explicit existing pipeline operation; running QA introduces no new billable provider usage.
