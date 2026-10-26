# Phase 3 Task 7 — scanned PDF page OCR

Implemented on top of main `ee2364e`, including the previously merged PDF.js build fix. Scope stops at Task 7.

**Release status: implemented, locally verified, awaiting database and hosting verification.** This is a reviewable implementation, not a claim that the hosted service has been deployed or is operational. No source PDFs, approvals, exports or credit records were modified during this work.

## Verification status

| Status | Evidence |
| --- | --- |
| IMPLEMENTED AND VERIFIED | Actual PDF inspection; real PDF.js/canvas rasterization; English, Hindi and bilingual Tesseract recognition; Unicode; source hashes; rotation, CropBox and UserUnit transforms; synthetic 10/100/500-page inspection; TypeScript; production build; standalone dependency smoke. |
| IMPLEMENTED AND VERIFIED using controlled dependencies | Route authorization, owner/action scopes, input validation, queue idempotency, leases, crash checkpoints, cancellation, retry/backoff, preservation of successful results, partial outcomes, context provenance. These tests use mocks for database/auth/queue boundaries and do not establish live database behavior. |
| IMPLEMENTED AND VERIFIED visually | The actual React drawer, selection, inspector and confirmation flow in a browser with explicitly synthetic API fixtures. This is not a logged-in production test. |
| IMPLEMENTED BUT UNVERIFIED | MySQL migration and real persistence/transactions; concurrent database claimants; authenticated HTTP → private storage → worker → database → API round trip; actual scheduler recovery; full 500-page OCR throughput. An opt-in real MySQL integration test is included. |
| BLOCKED in this environment | No `DATABASE_URL`, dedicated test database, authenticated test tenant or Hostinger worker runtime was supplied. The real MySQL test is skipped. Hostinger Linux/GLIBC/native-canvas compatibility and its exact Node 22 patch version remain unverified. |
| UNSUPPORTED | Encrypted PDFs; files beyond existing upload limits; more than 500 OCR pages; excessive source/raster pixels; arbitrary paid/external OCR; verified handwriting; math OCR; reading-order remediation; inserting text layers; PDF/UA compliance. |

## Requested implementation report

1. **Actual files created/modified:** complete inventory follows below. Additive page-evidence migration, API routes, worker adapter, workbench drawer, test suites and deployment smoke script; focused changes to the existing engine, parser, context service, gate and queue.
2. **Existing services reused:** `getDocumentForExtraction`, `readVerifiedOriginal`, tenant scope, document permission gate, existing document/image records, `readPdfPackage`, OCR settings resolver, `recognizeImage`, `buildRecognitionResult`, coordinate helpers and the MySQL-backed background queue. No second upload service, image extractor, OCR provider, credit ledger or queue was created.
3. **Selected renderer:** existing `pdfjs-dist@5.7.284` legacy Node renderer drawing onto `@napi-rs/canvas@0.1.100`. The removed `isEvalSupported` option remains removed; XFA and system-font lookups are disabled. Input is a copied byte buffer, not a URL. Worker fetching, range loading and auto-fetching are disabled.
4. **Runtime compatibility:** local Windows, Node 24.22.1 passed. PDF.js requires Node >=22.13.0; package engines now declare this minimum. Next standalone tracing includes PDF worker assets, canvas binaries, CMaps/fonts/WASM and both language packs, including pnpm paths. A real bilingual recognition test ran using dependencies from `.next/standalone`, with no database or network.
5. **PDF classification:** existing parser provides native text, undecodable runs, approximate text coverage, raster coverage, image counts and vector evidence. Document labels aggregate page classes. Parser truncation is exposed as review-required evidence.
6. **Scanned/mixed detection:** full-page rasters without native text are scan candidates, not proof of printed text. Candidates/photos require selection and review. Automatic mode requires existing full-image OCR evidence matched by tenant, occurrence, asset and image hash, with >=40 recognized characters and engine confidence >=60. Mixed and existing-text-layer pages are kept distinct; re-OCR requires explicit authorization. This intentionally favors conservative selection over labeling every image as a scan.
7. **Rasterization:** worker reads the verified private original, checks source hash, renders one page at a time, validates output and saves transform/configuration evidence. Rasters remain in memory. Interactive PNG previews require an explicit click and separate authorization, source verification and rate limiting.
8. **English:** reuses the pinned English traineddata and real local engine. Existing sentence, numeric/punctuation, region and malformed-image recovery tests pass.
9. **Hindi:** reuses the pinned Hindi traineddata. A necessary Tesseract.js 7 compatibility fix supplies language codes with verified local pack files, rather than passing language-buffer objects that the installed initializer incorrectly treated as language names. Temporary pack directories are removed after initialization. Printable Unicode is preserved; normalization uses the existing NFC/whitespace policy.
10. **Bilingual:** loads `hin+eng` explicitly; no English-only fallback. Actual model references/hashes and loaded language codes are stored. Tests verify Devanagari survives real recognition. Accuracy remains imperfect, especially spacing and digits; see measurements below.
11. **Coordinates/layout:** preserves raw engine lines, words, paragraph associations, confidences and sequence. Persists raster dimensions, CropBox, MediaBox, rotation, UserUnit, viewport matrix, normalized line boxes and inverse-mapped PDF rectangles. PDF coordinates are default user-space units; one unit equals UserUnit points. Multi-column ordering remains unverified, with engine-supported warnings rather than fabricated semantic order.
12. **Persistence:** one tenant/document/page row in `alt_text_document_page_ocr`, attached to existing document records. Native text and the last successful OCR result remain separate. Failed/cancelled attempts update status/error/attempt counts without erasing the successful result. Results include source hash, page/run identity, language/model/engine version, raw/normalized text, warnings, layout and render configuration. List responses contain bounded previews; selected-page retrieval returns full evidence.
13. **Jobs:** new handler type on the existing durable queue. Submission locks the existing document row, queues work transactionally and rejects conflicting active scopes. Page writes require the current worker ID and unexpired queue lease. Shared claim serialization bounds OCR jobs globally to one; tenant concurrency is one. Deliveries process up to ten pages sequentially, stopping at a soft 30-second checkpoint between pages; each individual page retains its bounded rendering/recognition budget. Continuations use the existing deferral mechanism without consuming failure retries.
14. **Retries/partial failure:** three attempts per selected page per run, 30/60-second retry backoff, failed-page and selected/all-failed retries, cancellation checks between stages, recovery of interrupted rendering/recognition, and preservation of completed pages. Queue completion means work was exhausted; a separate persisted business outcome identifies completed/partial/failed scopes. Empty text is a distinct result, not an execution failure.
15. **Workbench:** contextual “Page OCR & results” action in the existing document workspace, with a wide drawer, paginated page table, explicit page preview and text inspector. “Recognize Scanned Pages” requires permission, available language/renderer, an eligible selection and confirmation. Raw/normalized text, copy, warnings, confidence, date, retries and actual coordinates are available. No sidebar entry, top-level module or full PDF editor was added.
16. **Document context:** explicit existing context analysis may add bounded `ocr_page_text` evidence from the same document/page, tagged as approximate/untrusted. A meaningful native text layer wins to avoid duplication. OCR jobs themselves never overwrite context or trigger AI generation.
17. **Security/privacy:** existing authentication, module and view/upload scopes; upload-own remains owner-only even with view-all; tenant filters on page data; fresh security clearance and verified private source reads; source-version checks; fixed page/DPI/segmentation/language policies; bounded request bodies; no client storage paths/tenant IDs; safe React text rendering; no recognized page text in production logs. Original bytes are hash-checked in tests. Local OCR has no provider-credit charge.
18. **Resource limits:** existing upload ceiling unchanged; 500 pages; 25 million aggregate source image pixels per page; 25 million output raster pixels; 10,000-pixel raster sides; 150–400 DPI, source-aware DPI ceiling and explicit fallback warnings; 30-second renderer stages; 120-second recognition; 280-second queue delivery; 2 MB maximum serialized page result; 25-row API pagination. One open renderer per process also limits interactive preview pressure. These are application limits, not an OS-level memory sandbox; hosting must supply sufficient memory and enforce process limits. Worker initialization/native CPU stalls have not been stress-tested on Hostinger.
19. **Real rendering test:** passed actual scanned PDFs through PDF.js and native canvas, including page selection, rotated geometry, CropBox offsets, UserUnit, raster validity and source preservation. Tiny synthetic PDFs were used, not client documents.
20. **Real multilingual OCR:** three scanned PDFs ran through inspection → actual rendering → actual recognition → result construction. Separately, all 37 existing labeled image fixtures ran against the corrected local engine. Database/API end-to-end operation was not substituted with a mock success claim.
21. **Commands/results:** see validation commands below. Focused Task 7 tests: 55 passed; real MySQL test skipped. Broad Alt Text suite: 556 passed, 12 failed, 2 skipped. The same 12 failures reproduce on untouched main: 11 existing credit/metering expectations and one existing OCR request-shape expectation. They were not changed. The existing experimental `zz-explore.test.ts` was excluded; it directly invokes the broken object-language initializer rather than the production adapter. TypeScript and Next production build passed.
22. **Unsupported PDFs/cases:** encryption/protection, corrupt PDF/page trees/content, invalid pages, excessive pixels/complexity/page counts, missing renderer/language assets and source-version mismatches produce explicit failures or unsupported statuses. The complete 18-category fixture matrix is not verified: dedicated skew/blur/handwriting, chart/equation page datasets and production worker stress tests remain outstanding. Existing ordinary OCR warnings are not claims of math or chart understanding.
23. **Deployment dependencies:** apply the additive migration (runtime ensure is also idempotent); deploy Node >=22.13.0, both exact language packages, PDF.js worker/assets and the matching Linux canvas binary; allow private temporary pack directories; enable the existing OCR settings/languages; run the existing authenticated job scheduler regularly; use a worker/host timeout compatible with the 280-second job limit. Run the standalone smoke below on the actual Linux host before enabling production OCR. No hosting configuration or production database was changed here.
24. **Remaining dependencies for Task 8:** persisted page/run identities, coordinate systems, source hashes, native/OCR provenance and warnings are available. Mathematical OCR, equation detection, LaTeX/MathML and semantic validation were not implemented. Task 8 was not started.

## Measured recognition results

Error rates are measured, not accuracy guarantees. CER is Unicode code-point Levenshtein error rate; WER is token error rate. Both sides use NFC and collapsed whitespace; case, punctuation, numbers and script remain significant.

### Scanned PDF samples (one sample per mode, 200-DPI source)

| Mode | CER | WER |
| --- | ---: | ---: |
| English | 0% | 0% |
| Hindi | 13.33% | 66.67% |
| Hindi + English | 12.50% | 66.67% |

`page-ocr-smoke-results.json` contains exact source text, actual recognized text and model hashes. The bilingual sample misreads “10” as “40”; this is not corrected or hidden. Upsampling this fixture from 200 to 300 DPI made recognition worse, so the production render policy now caps DPI using measured source resolution and records a warning.

### Existing labeled image fixtures (separate evaluation)

| Mode | Samples | CER | WER |
| --- | ---: | ---: | ---: |
| English | 1 | 0% | 0% |
| Hindi | 23 | 18.48% | 64.13% |
| Hindi + English | 13 | 22.51% | 42.11% |

`ocr-accuracy-report.json` contains every actual output, comparison policy and model reference. These results establish execution and expose limitations; they do not establish reliable production transcription accuracy. Human verification remains necessary, especially for Hindi word spacing and numbers.

## Validation and deployment commands

Commands ran using the bundled Node executable (24.22.1). Equivalent project commands:

```text
npm run typecheck
npx vitest run test/alt-text --exclude '**/zz-explore.test.ts'
npx vitest run test/alt-text/pdf-page-ocr-contract.test.ts test/alt-text/pdf-page-ocr-job.test.ts test/alt-text/pdf-page-ocr-pipeline.test.ts test/alt-text/pdf-page-ocr-route.test.ts test/alt-text/pdf-page-ocr-store.test.ts test/alt-text/pdf-page-ocr-render.test.ts test/alt-text/pdf-page-ocr-mysql.integration.test.ts
OCR_ACCURACY_REPORT=1 npx vitest run test/alt-text/ocr-accuracy-report.test.ts
npm run build
node scripts/check-page-ocr-runtime.mjs .next/standalone synthetic-bilingual.pdf eng_hin
```

Actual build verification invoked `next build --webpack` followed by `node scripts/prepare-standalone.mjs`, matching the build/postbuild scripts. Final standalone smoke reported PDF.js 5.7.284, one page, 1100×133 raster, `hin+eng`, and 16 recognized characters.

The opt-in integration command below is **not executed here**. It creates and removes only its own synthetic rows in a dedicated database whose name must end in `_test`. It exercises real OCR plus the MySQL persistence adapter and cross-tenant reads; it does not replace the required authenticated HTTP/private-storage smoke.

```text
PAGE_OCR_TEST_DATABASE_URL=<dedicated MySQL *_test connection> npx vitest run test/alt-text/pdf-page-ocr-mysql.integration.test.ts
```

Before production enablement, run an authenticated test-tenant workflow: upload security-cleared English/Hindi/bilingual synthetic PDFs through the existing upload path; inspect pages; select and confirm OCR; let the real scheduler finish; reopen results; retry one failed page; verify cross-tenant denial and unchanged original checksums. Repeat native runtime smoke on Hostinger. These deployment checks remain blocked here.

## Complete file inventory

- app/api/alt-text/documents/[uploadId]/page-ocr/preview/route.ts
- app/api/alt-text/documents/[uploadId]/page-ocr/route.ts
- components/publishing/alt-text/extracted-images-panel.tsx
- components/publishing/alt-text/pdf-page-ocr-workbench.tsx
- components/publishing/alt-text/workbench.tsx
- database/migrations/2026-10-26-alt-text-page-ocr.sql
- docs/alt-text/ocr-accuracy-report.json
- docs/alt-text/page-ocr-smoke-results.json
- docs/alt-text/task7-implementation-report.md
- lib/alt-text/document-context-service.ts
- lib/alt-text/ocr-engine.ts
- lib/alt-text/pdf-package.ts
- lib/alt-text/pdf-page-ocr-context.ts
- lib/alt-text/pdf-page-ocr-contract.ts
- lib/alt-text/pdf-page-ocr-identity.ts
- lib/alt-text/pdf-page-ocr-job.ts
- lib/alt-text/pdf-page-ocr-pipeline.ts
- lib/alt-text/pdf-page-ocr-policy.ts
- lib/alt-text/pdf-page-ocr-store.ts
- lib/alt-text/pdf-page-ocr-types.ts
- lib/alt-text/pdf-page-renderer.ts
- lib/alt-text/route-gate.ts
- lib/background-jobs.ts
- next.config.mjs
- package.json
- scripts/check-page-ocr-runtime.mjs
- test/alt-text/pdf-page-ocr-contract.test.ts
- test/alt-text/pdf-page-ocr-job.test.ts
- test/alt-text/pdf-page-ocr-mysql.integration.test.ts
- test/alt-text/pdf-page-ocr-pipeline.test.ts
- test/alt-text/pdf-page-ocr-render.test.ts
- test/alt-text/pdf-page-ocr-route.test.ts
- test/alt-text/pdf-page-ocr-store.test.ts
