# Task 25 — Final Advanced Accessibility implementation audit

Date: 2026-10-29. Branch: `feat/phase3-task08-math-ocr`. Application code audited at `5e22478`; this task adds measured evidence and test coverage. No production data, deployment, paid provider request or destructive migration was performed.

**Decision: NOT FULLY VERIFIED.** Local regression, actual OCR/rendering, one actual mathematical worker smoke, dependency audit and production build pass. Mandatory live database, authenticated tenancy/provider flows and target-host prerequisites remain unverified. Broad mathematical recognition and unattended scientific accuracy are not accepted; live DOCX extraction remains unsupported. This report completes the audit, not a claim that every roadmap capability is production-ready.

## A. Task 1–24 completion matrix

Paths below are relative to the repository; library paths are under `lib/alt-text/`, and tests under `test/alt-text/` unless another directory is named. “Tested” describes the indicated local coverage, not a live end-to-end deployment.

| Task | Implementation / actual evidence | Tested evidence | Partial, unsupported or blocked |
| --- | --- | --- | --- |
| 1 Architecture | Implemented shared asset/occurrence/evidence/version and capability contracts: `store.ts`, `description-evidence.ts`, `accessibility-settings.ts`, `processing-pipeline-contract.ts`. | `description-evidence.test.ts`, `processing-pipeline-plan.test.ts`, `test/publishing/session-tenant-scope.test.ts`. | Live schema upgrade/claim contention blocked by unavailable dedicated database. |
| 2 Settings / optional guidelines | Implemented revisioned tenant settings and optional named tenant-default client policy: `client-guideline.ts`, `store.ts`, Settings route/workspace. All eight sections audited. | `alt-text-accessibility-settings.test.ts`, `alt-text-settings-route.test.ts`, `client-guideline*.test.ts`, `settings-capability-completeness.test.ts`; real component browser preview. | Project/document-specific policy selection and guideline-file import unsupported. Normal work requires no guideline. |
| 3 Classification | Implemented category, complexity, categorical uncertainty, manual override and downstream routing: `classification.ts`, `classification-service.ts`. | `alt-text-classification-service.test.ts`, generator/vision tests. | Provider-backed classification mocked; no calibrated probability or accuracy claim. |
| 4 Regions | Implemented governed region proposals, source/frame validation and bounded crops: `region-analysis.ts`, `region-service.ts`, `region-image-crop.ts`. | `alt-text-region-service.test.ts`, crop/processing source tests. | Vision geometry is estimated; no pixel-location accuracy benchmark or paid live run. |
| 5 Free OCR | Implemented actual local Tesseract engine with pinned/integrity-checked assets: `ocr-engine.ts`, `ocr-contract.ts`. | Real `alt-text-ocr-engine.test.ts`, actual initialization and image checks. | Synthetic results do not establish general OCR accuracy; deployment packs/runtime must be checked. |
| 6 Hindi / English | Implemented explicit `eng`, `hin`, `eng_hin` modes independent of output language. | Real 37-fixture `ocr-accuracy-report.test.ts`; fresh report and six cold/warm-mode measurements. | Hindi/bilingual errors are material; correction and review remain required. |
| 7 Scanned PDF | Implemented page classification, renderer, OCR, page store and durable jobs: `pdf-page-ocr-pipeline.ts`, `pdf-page-renderer.ts`, page store/job. | Real digital/scanned/mixed/existing-text-layer fixtures, rotations/crops, multi-page 10/100/500 classification, source checksums; page contract/route/store/job tests. | Real MySQL round-trip skipped. No OCR text layer or automatic Figure tagging. Hostinger runtime unverified. |
| 8 Math OCR | Implemented isolated pinned offline CPU recognizer, region/source mapping, model hashes, runtime receipt and durable evidence: `math-engine.ts`, `math-service.ts`, `math-job.ts`. | Fresh actual Node-to-Python arithmetic smoke passed; contract/store/job tests. Historical labelled 24-case evaluation retained. | Broad recognition quality remains weak (historical raw exact match 0/24); no semantic accuracy or general-notation acceptance. |
| 9 LaTeX / MathML | Implemented bounded syntax checks, actual KaTeX rendering and sanitized Presentation MathML: `math-validation.ts`, validation store/routes. | `math-validation*.test.ts`. | Rendering does not verify formula equivalence, source matching or scientific truth. |
| 10 OCR manual review | Implemented source-bound correction/verification versions and original evidence retention: `ocr-review-source.ts`, review store/routes/contracts. | `ocr-review-*.test.ts`. | Real authenticated reviewer/DB persistence not exercised. |
| 11 Graph recognition | Implemented governed chart-region proposals and categories: chart services and contracts. | `chart-contract.test.ts`, `chart-route.test.ts`, advanced evidence service/job tests. | Paid vision interpretation mocked; no real chart-recognition accuracy score. |
| 12 Axes / legends | Implemented reviewed-label interpretation, linear/logarithmic/reversed/date/time scales and unknown ambiguity: chart axis modules. | `chart-axis-scale.test.ts`, labels/analysis/service/job/route tests, dual-axis/ambiguous fixtures. | Scale models remain candidates; pixel extraction is disabled. |
| 13 Graph data | Implemented printed visible-value extraction, explicit role confirmation, exact/estimated distinctions and safe dataset exports: chart data modules. | `chart-data-*.test.ts`. | Native chart datasets and pixel digitization unsupported. No empirical plot-digitization error score is invented. |
| 14 Scientific components | Implemented bounded component/label/relationship proposals: `scientific-structure-service.ts`, contracts/jobs. | `scientific-structure*.test.ts`. | Domain truth and causal/relationship meaning require expert review. |
| 15 Scientific subjects | Implemented source-bound biology/chemistry/physics/geometry observations: scientific domain modules. | `scientific-domain*.test.ts`, subject fixtures. | No chemical validity, simulation, diagnosis, proof or universal subject accuracy. |
| 16 Complex illustrations | Implemented existing-region flowchart/table/map/mixed proposals: illustration modules. | `illustration-*.test.ts`. | No geocoding, missing-cell invention, native table remediation or automatic reading-order verification. |
| 17 Descriptions | Implemented saved evidence into existing governed generation; approved active text is retained and regeneration saves a review candidate: `generate.ts`, `vision-service.ts`, `description-evidence-source.ts`. | `alt-text-generate.test.ts`, `description-evidence*.test.ts`, `generation-candidate-store.test.ts`. | Paid provider and qualitative expert description suitability not live-tested. |
| 18 Document context | Implemented exact PDF/PPTX occurrence context and distinct page-OCR/native/image evidence: document context/source/packet/generation modules. | `document-context-*.test.ts`, existing document-context route/service tests. | Live DOCX extraction/context unsupported; logical DOCX metadata/context builders do not prove a live extractor. |
| 19 Terminology | Implemented source-literal technical notation and separate recognition/output language, Unicode-safe manual editing: `terminology-policy.ts`, `core.ts`, generation/manual edit services. | `terminology-policy.test.ts`, core/generation/edit regressions. | No semantic translation or universal scientific correctness certification. |
| 20 Evidence workspace | Implemented shared OCR/equation/structured evidence review with source/version conflicts: structured-review modules and existing workbench inspectors. | `structured-review-*.test.ts`, OCR/math review tests. | Full authenticated browser/assistive-technology acceptance not performed. |
| 21 QA | Implemented 34 versioned local rules, saved-source freshness, immutable reports and exact references: advanced quality modules. Current version `advanced-quality.v2`. | `advanced-quality*.test.ts`; actual syntax/MathML validators; optional client policy/decorative regressions. | Human-only findings never become automated passes; no WCAG/PDF-UA certification. |
| 22 Jobs / credits | Implemented optional shared pipeline in existing queue/batch/document paths with bounded stages, checkpoint resume and exact existing-ledger attribution. | `processing-*.test.ts`, batch/credits/background integrity tests; additional 5/100/500/1000 orchestration microbenchmark. | Provider/store calls mocked in load test; no real database races, scheduler cadence, billing/network latency or 1,000-image OCR capacity claim. |
| 23 Security | Implemented record-specific View/Update/Approve/Export checks, current document authorization, bounded JSON, metadata-only denial logs, patched packages. | `security-*.test.ts`, tenant/session, preview/store/download/job/credit tests. Two synthetic tenants at mocked boundaries; dependency audit has zero entries. | Live authenticated multi-tenant/database/storage deployment unverified; no OS sandbox, egress firewall or penetration-test claim. |
| 24 Document outputs | Implemented exact approved occurrence/version plus bounded evidence/QA snapshots, historical-locator validation and provenance panel through existing exporters/history. | DOCX insertion suite; `document-native-compatibility.test.ts`, snapshot/historical/provenance route tests. | Native Word/PowerPoint visual validation, live DOCX extraction, arbitrary PDF tagging and formal conformance unsupported/unverified. |

## B–C. Reused services and integration results

Single-image upload, governed model selection, AI reservation/settlement, asset history, batch uploads/settings/overrides, durable background queue, private document source readers, review stores, DOCX/PPTX writers, incremental PDF Figure remediator, Output Validation and secure downloads are reused. No duplicate queue, export system, authentication layer or document extractor was introduced.

The end-to-end verification boundary is explicit:

| Chain | Actual execution | Remaining boundary |
| --- | --- | --- |
| Image → classification/regions → OCR → correction → description → review | Real local OCR; contract/source/review/pipeline tests compose the remaining services with mocked providers and stores. | No single authenticated HTTP-to-MySQL-to-provider chain. |
| PDF → inspect/render → multilingual OCR → page persistence/retry → context | Real PDF readers, rendering and OCR; digital/mixed/existing-layer/page failures and geometry tests; mocked store/job/retry/context boundaries. | Dedicated MySQL integration and live upload/security clearance not run. |
| Math region → isolated worker → syntax/MathML → review → description | Fresh real worker smoke and actual syntax/render validators; service/source/review/generation contracts. | Broad recognition acceptance and authenticated persistence remain incomplete. |
| Approved descriptions → exact document output → QA/history/download | Real native writers and re-parsing plus scoped snapshot/API/store tests; actual collapsed provenance component opened in browser fixture. | No native Office rendering or live download/session/storage E2E. |

## D–F. OCR, mathematical and scientific quality

Fresh multilingual evaluation uses 37 labelled synthetic fixtures with NFC and collapsed-whitespace comparison; case, punctuation, digit script and symbols must match. Raw CER/WER are text transcription metrics, not semantic or accessibility scores. See `ocr-accuracy-report.json`.

- English: 1 fixture, 1 exact match; CER 0, WER 0. Coverage is very small.
- Hindi: 23 fixtures, 3 exact matches; CER 0.1848, WER 0.6413.
- Mixed English/Hindi: 13 fixtures, 0 exact matches; CER 0.2251, WER 0.4211.
- Overall: 4/37 exact matches; CER 0.1938, WER 0.5112. These errors make manual correction and source review essential.

The mathematical worker smoke rechecked pinned model/runtime hashes, initialized the real CPU model offline, recognized arithmetic containing `1+2=3`, preserved input bytes and invented no confidence. The dedicated test took 22.50 seconds including its checks and initialization. An initial invocation with a different Python executable was correctly rejected by the saved runtime receipt; rerunning with the receipt's executable passed. No receipt or readiness guard was bypassed.

The historical 24-case mathematical evaluation remains 0/24 raw exact matches, with formatting-sensitive mean per-example raw CER 6.6992. It was not rerun as a new 24-case benchmark, and neither CER nor rendering establishes formula equivalence. Automated unrestricted mathematical recognition is not accepted for unattended release.

Charts retain exact printed values versus estimates/unknowns, reviewed series/axis roles and local scale models. Tests exercise linear/logarithmic/reversed/dual-axis/ambiguous cases; native datasets and pixel digitization remain unsupported. Biology, chemistry, physics, geometry, flowcharts, maps and tables are covered by synthetic source/contract/review tests with mocked vision. No expert scientific correctness score or live vision accuracy is claimed. Short/long descriptions preserve purpose, audience, language, source references and human approval/version gates.

## G–J. Security, workers, output and UI QA

Backend tests cover tenant/session scoping, guessed foreign sources, revoked documents, per-record export and reviewer assignment, evidence versions, queue identifiers, credits, validation and downloads. The two synthetic tenant tests do not replace live SQL isolation verification. Final `npm audit --json` reports **0 info/low/moderate/high/critical vulnerabilities** for the resolved dependency graph; this is not a penetration test.

Mocked-provider tests cover authorized model selection, reservations, actual-usage settlement, 402/429 halts, provider failures, duplicate delivery, cancellation, interrupted paid work, lease expiry and failed saves requiring reconciliation. The added load regression saves/restores serialized checkpoints and verifies completed mocked generation is not repeated. Browser closure does not own queued work in code; scheduler behavior still needs target-host verification.

Document tests preserve original bytes, exact asset/occurrence and approved-version identity. DOCX tests cover inline/floating/table/header/footer/Unicode and unchanged parts. PPTX tests preserve reused-media occurrences, grouped pictures, notes/themes and untouched ZIP entries. PDF updates append to the unchanged source prefix, retain ParentTree/MCID association and reject untagged cases. OCR, structured MathML and scientific corrections remain separate from native short-alt fields. Unsupported remediation and manual findings remain explicit; automated pass rate never means conformance.

Browser verification used real Settings and export-reference components with explicitly synthetic data. All eight Settings sections were opened, QA status inspected, client-policy changes saved through actual frontend request/draft handling and version display confirmed. Desktop and 390-pixel mobile screenshots were saved; mobile horizontal content width matched viewport width. Prior Generate/Bulk/Document shared-processing component previews remain documented in Task 22. This was not a complete authenticated browser E2E or a comprehensive keyboard, screen-reader, contrast, modal-focus and reduced-motion audit across all workspaces.

An additional tablet check at 768 pixels had equal content/viewport widths (753 CSS pixels after the scrollbar). Keyboard Tab from the labelled client-name input reached the labelled required-terms field. This targeted check does not establish complete UI accessibility.

## K. Measured local performance

`task25-performance.json` is a dedicated, isolated test invocation on Windows/Node 24.22.1. The workload below exercises **two-stage orchestration and real QA on minimal photograph inputs**, with mocked generation, source, database and checkpoint I/O. These figures are not OCR/AI throughput or production capacity.

| Synthetic images | Orchestration + real QA elapsed | QA total | Mocked generation calls | Sampled Node RSS |
| ---: | ---: | ---: | ---: | ---: |
| 5 | 5.249 ms | 1.983 ms | 5 | 88,043,520 bytes |
| 100 | 11.202 ms | 2.317 ms | 100 | 91,082,752 bytes |
| 500 | 45.586 ms | 7.022 ms | 500 | 114,331,648 bytes |
| 1,000 | 67.274 ms | 8.231 ms | 1,000 | 119,529,472 bytes |

JIT warm-up and tiny local fixtures explain the changing per-image costs. There was no parallel provider load. Sampled RSS is aggregate Node test-process memory, not per-worker allocation or guaranteed peak memory.

Real OCR readiness initialization took 378.084 ms in that isolated run. First/second recognition wall times after the probe were English 92.119/46.796 ms, Hindi 93.727/17.925 ms and mixed 183.553/35.557 ms. Sampled Node RSS including OCR worker threads was approximately 209–246 MB during these requests. “First” is the first recognition after the readiness probe, not a whole-application cold boot. OCR decoding errors and post-error recovery are covered separately. The full fixture report contains measured recognition durations.

Real database latency, production batch throughput, target worker memory limits, network/provider latency, native Office rendering time and browser interaction latency were not measured. No unlimited-capacity claim is made. PDF page-inspection tests cover 10/100/500 repeated synthetic pages; they are not a 500-page OCR throughput benchmark.

Additional actual Output Validation measurements over small two-occurrence fixtures were PDF **3.935 ms** (26 findings) and PPTX **2.740 ms** (25 findings), excluding writing, storage and native Office rendering. See `task25-native-outputqa.json`. Cross-service tests also validate an actual derived DOCX. These tests require approved native text/identity/checksums to pass and deliberately fail different approved text, absent versions, wrong occurrence locators and altered recorded checksums; PDF/UA remains not verified.

## L–M. Defects and remaining limitations

| Priority | Verified finding | Outcome |
| --- | --- | --- |
| P2 | Settings displayed implemented QA and syntax/review capabilities as pending; the client-guideline page had no workflow. | Fixed in `5e22478`; optional versioned policy, truthful capability/readiness states and tests/browser verification. |
| P2 | Failed settings reads could silently drop saved policy before generation. | Fixed before the final audit: generation stops before claim/charge; regression passes. |
| P2 | Client rules could ask a decorative description for long text, and canonically equivalent Unicode literals differed. | QA v2 preserves decorative purpose and compares NFC literals; regression passes. |
| P3 | An older Phase 1 upload test expected the pre-deduplication response shape. | Update the exact expected `reused:false` contract and assert that private storage keys do not appear. Runtime API behavior was already correct. |
| P1 quality limitation | Mathematical recognizer succeeds technically but broad synthetic transcription is weak. | Unresolved recognition-quality limitation. Keep candidate/manual-review treatment and do not accept unattended mathematical accuracy. No speculative model replacement. |
| Unsupported | Live DOCX extraction/context, arbitrary PDF tagging/OCR text layer, chart pixel digitization/native datasets, project-specific/file-import guidelines. | Reported explicitly; no substitute or fake implementation introduced by the final audit. |
| Verification blocker | Dedicated MySQL integration/concurrency, live authenticated provider/storage flows, target Linux runtime and complete UI accessibility acceptance unavailable. | Still unverified. These block a production-ready conclusion. |

No known unresolved P0 was demonstrated by the executed local tests. That statement does not rule out vulnerabilities in untested deployment boundaries.

## N. Deployment configuration and rollback prerequisites

1. Establish Node **>=22.13.0** on the target, the committed lockfile, Next 16.4.3 webpack build, standalone preparation and a clean dependency audit. Local tests used Node 24.22.1; Hostinger's older glibc/native bindings and real Node 22 deployment must be verified. Root/PDF.js canvas must remain deduplicated at 1.0.13.
2. Provision private storage, scans and tenant-safe database credentials without exposing keys. Apply existing schema bootstrap/migrations in a dedicated test deployment and run the guarded `PAGE_OCR_TEST_DATABASE_URL` integration only against a disposable database ending `_test`. Verify row locks, duplicate claims, credit transactions and two real tenant sessions. No production migration was executed here.
3. Include the pinned English/Hindi packs and Tesseract runtime. Confirm integrity/readiness, actual Windows/Linux behavior, CPU/memory budgets and cleanup. OCR limits remain 25 million pixels, 10,000-pixel sides and bounded text/layout. PDF rendering uses 150–400 DPI within the same pixel ceiling, 30-second rendering and 120-second page-OCR limits.
4. Mathematical recognition needs the documented pinned CPU Python packages, private model assets, provisioning receipt, `ALT_TEXT_MATH_PYTHON`, `ALT_TEXT_MATH_MODEL_DIR` and, only for isolated package installations, `ALT_TEXT_MATH_PYTHONPATH`. Receipt/platform/executable/hash checks must pass. Recognition remains opt-in and unsuitable for unattended broad notation. Use `ALT_TEXT_MATH_DISABLED=1` where prerequisites or acceptance fail.
5. Configure the existing `/api/jobs/run` scheduler/worker authorization and invocation cadence; verify it while the browser is closed. Respect durable queue/tenant/batch/heavy-stage caps and 15-second heartbeats. A deferred stage is not detached HTTP work. Pipeline and source/evidence budgets remain bounded; exports retain their 5,000-occurrence limit.
6. Verify authorized vision models/provider configuration with an explicit small staging request, actual settlement/reconciliation and storage/download/session access. No automated paid load test was run. `ALT_TEXT_ADVANCED_DISABLED=1` and `ALT_TEXT_OCR_DISABLED=1` remain deployment controls.
7. Review field-only denial/job/credit/export logs, alert handling, retention/storage policy and recovery procedures on the host. The application does not establish an OS sandbox, firewall or automatic evidence purge merely by passing tests.
8. Rollback through ordinary reviewed Git revert/redeployment and disable new submissions/stages as appropriate; retain original files, existing approved versions and export/evidence history. Drain or reconcile durable work and reservations rather than deleting queue, ledger or tenant data. A rollback was not executed against production.

## O. Commands and outcomes

Run from `work/repo` with the documented local Node executable (or a supported provisioned `node`). Environment paths used for the math smoke are local test configuration, not committed credentials.

```powershell
node node_modules/typescript/bin/tsc --noEmit
$env:OCR_ACCURACY_REPORT='1'
node node_modules/vitest/vitest.mjs run --exclude test/alt-text/zz-explore.test.ts
# Separately, with RUN_LOCAL_MATH_SMOKE=1 and the receipt-matching CPU runtime configured:
node node_modules/vitest/vitest.mjs run test/alt-text/math-engine.integration.test.ts
# Dedicated isolated measurements, with ALT_TEXT_AUDIT_OUTPUT pointing to a local output JSON:
node node_modules/vitest/vitest.mjs run test/alt-text/final-audit-performance.test.ts
# Native output QA tests; ALT_TEXT_OUTPUT_QA_AUDIT_OUTPUT optionally records small-fixture timings:
node node_modules/vitest/vitest.mjs run test/alt-text/document-native-compatibility.test.ts test/alt-text/alt-text-docx-insertion.test.ts
node node_modules/next/dist/bin/next build --webpack
node scripts/prepare-standalone.mjs
npm audit --json
```

- Final whole-repository run: **1,507 passed, 0 failed, 2 skipped**, 144 test files (142 passed). Duration 9.26 seconds in this invocation. OCR accuracy mode was enabled. Expected malformed-image decoder stderr is part of negative tests.
- The skipped math smoke passed separately (1/1, 22.50 seconds) when explicitly configured. The remaining skipped integration is the dedicated live MySQL page-OCR round trip. The exploratory `zz-explore.test.ts` remains excluded.
- Dedicated performance suite: 2/2 passed. TypeScript passed. Final application webpack build and standalone preparation passed during Settings verification; Task 25 makes no further application-code change.
- Current dependency audit: zero vulnerabilities of all severities. JSON and measured reports accompany this document. Local raw logs are retained in `work/` and user-facing copies in `outputs/`, outside Git.

## P. Acceptance decision

**NOT FULLY VERIFIED.** Code-level regression, actual local OCR/PDF processing, targeted mathematical runtime smoke, version/source integrity checks, mocked-provider billing/recovery, existing native writers, Settings implementation and package/build checks provide substantial local evidence. They do not satisfy the mandatory live tenancy/database/storage/provider, Hostinger deployment and complete UI accessibility gates. Broad mathematical recognition quality, unsupported DOCX extraction and explicitly limited graph/PDF capabilities must remain visible in release scope. No automatic deployment or formal accessibility certification is authorized by this audit result.
