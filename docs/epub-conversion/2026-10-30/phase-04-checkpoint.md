# Phase 4 — optional client publishing guidelines checkpoint

Date: 2026-10-30. Original global tasks 46–60. All fifteen implementation slices are present; fourteen have their bounded implementation acceptance recorded. **P4-T15 remains verification partial** for actual no-file end-to-end conversion, which depends on the later real conversion engine. Phase 4 is not labelled fully accepted. Continue into Phase 5 automatically under the user's phase delivery instruction and revisit the explicit dependency.

| Task | Evidence | Checkpoint |
| --- | --- | --- |
| P4-T01 | [optional-client-guideline-upload](P4-T01-optional-client-guideline-upload.md) | Implementation complete; tested bounded capability |
| P4-T02 | [guideline-document-ingestion](P4-T02-guideline-document-ingestion.md) | Implementation complete; tested bounded capability |
| P4-T03 | [guideline-ocr-source-validation](P4-T03-guideline-ocr-source-validation.md) | Implementation complete; tested bounded capability |
| P4-T04 | [named-client-publishing-profiles](P4-T04-named-client-publishing-profiles.md) | Implementation complete; tested bounded capability |
| P4-T05 | [requirement-categories-severity](P4-T05-requirement-categories-severity.md) | Implementation complete; tested bounded capability |
| P4-T06 | [structure-css-font-image-rules](P4-T06-structure-css-font-image-rules.md) | Implementation complete; tested bounded capability |
| P4-T07 | [accessibility-metadata-platform-rules](P4-T07-accessibility-metadata-platform-rules.md) | Implementation complete; tested bounded capability |
| P4-T08 | [precedence-and-reviewed-exceptions](P4-T08-precedence-and-reviewed-exceptions.md) | Implementation complete; tested bounded capability |
| P4-T09 | [conflicting-guideline-detection](P4-T09-conflicting-guideline-detection.md) | Implementation complete; tested bounded capability |
| P4-T10 | [unsupported-instruction-review](P4-T10-unsupported-instruction-review.md) | Implementation complete; tested bounded capability |
| P4-T11 | [version-control-and-approval](P4-T11-version-control-and-approval.md) | Implementation complete; tested bounded capability |
| P4-T12 | [rule-workflow-routing](P4-T12-rule-workflow-routing.md) | Implementation complete; tested bounded capability |
| P4-T13 | [automatic-compliance-checklist](P4-T13-automatic-compliance-checklist.md) | Implementation complete; tested bounded capability |
| P4-T14 | [validation-and-deviation-report](P4-T14-validation-and-deviation-report.md) | Implementation complete; tested bounded capability |
| P4-T15 | [standard-profile-without-client-guidelines](P4-T15-standard-profile-without-client-guidelines.md) | Verification partial: actual converter required |

## Integration and authority

The existing EPUB planner/project tabs, sole intake writer, resumable upload finalization, private app_files/blobs, shared background_jobs, project revision/events and conversion_qa_runs are extended. Shared guideline precedence, safe ZIP inspection, PDF text/rendering, Tesseract and ExcelJS are reused. The six additive domain tables are specific to EPUB publishing instructions, source extractions and exact-output evidence; Alt Text guideline tables are not copied or repurposed. Schema SQL is mirrored in `database/migrations/2026-10-30-epub-phase04-guidelines.sql` and was not applied live.

Company profiles are owner-private unless an administrator explicitly approves staff sharing. Company approval requires admin; project book review requires authorized staff/admin. Selections are per-project version references. Client A work cannot change Client D work. Source excerpts only become approved through traceable human review of clean hash-matched sources. Source ownership, current access, worker lease, cancellation and supersession are checked; OCR cannot approve rules. Unsupported requirements and mandatory conflicts stay visible, and accepted exceptions never erase unmet output checks.

Limits: three optional files, 5 MiB/file, combined existing 100 MiB project/tenant quota; source extraction 500 segments/200k characters, page/cell/archive limits; OCR bounded pages/images with actual engine timeouts; request nonce replay and per-document lifetime cap; private original-download and report routes. Production jobs remain held when security, reviewed guidelines or conversion engine are unavailable. No conversion, charge or release is fabricated.

## Executed verification

- Complete regression: **1,730 passed, 0 failed, 4 skipped; 174 passing files, 4 opt-in skipped files**. Includes the actual shared OCR engine/render/pipeline tests. Three existing opt-in suites are unchanged; the old `zz-explore` order/PSM diagnostic is now explicitly opt-in and its obsolete Tesseract object-language call is corrected to private staged packs plus codes. Its optional experiment was not executed. Earlier blanket test attempts exposed that old diagnostic and were interrupted; this result is the completed clean regression.
- TypeScript and Next.js webpack production build/standalone preparation passed. No package/dependency changes.
- Domain SQL models test real functions for tenant/access boundaries, independent pinned versions, source proof, atomic upload/receipt rollback and idempotence, extraction leases/cancellation, stale evidence and output-bound manual decisions. Route tests cover identity/origin/rate/body/file gates and private downloads. These are not live MySQL tests.
- Real synthetic ZIP/DOCX/XLSX/PDF/TXT/JSON fixtures exercise parsers and output inspection. The EPUB checker fixture is an actual bounded archive for subset checks, **not an end-to-end converter result or standards conformance proof**.
- Browser: actual components with labelled synthetic API responses. Expert A chooses/applies Client A while Expert B chooses/applies Client D independently; named profile draft, effective date retention, rule editor and explicit approval are exercised. OCR 42% uncertainty remains human review; no output means not-run checks and disabled validation. No browser console errors; observed viewport 1265px has no horizontal document overflow. Native AT/mobile/live persistence are not claimed.

Local browser evidence, outside Git: `outputs/epub-phase04-independent-clients.png` and `outputs/epub-phase04-source-review.png` in this chat workspace. Preview tab/server were closed after verification.

Overall: **58 complete (15 specification, 43 implementation), 2 verification partial, 240 pending**. P2-T15 still needs native screen-reader/remaining-state verification; P4-T15 needs real no-guideline conversion. New work proceeds in Phase 5 input adapters while preserving all original 300 prompts, IDs, order and source SHA.
