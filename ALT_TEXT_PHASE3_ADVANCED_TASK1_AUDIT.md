# Muenot Publishing — Alt Text · Phase 3 Advanced Accessibility
## Task 1 of 25 — Repository Audit & Integration Foundation

| Item | Value |
| --- | --- |
| Repository | `dhania2000/muenot_publishing`, base `main` |
| Module | Publishing → Alt Text (existing; no new module, page, tab, sidebar item, table, job type or migration) |
| Audit date | 2026-10-24 |
| Report location | Repository root (follows `PDF_PHASE1_TASK1_AUDIT.md` convention; no `docs/` folder) |

**Legend:** **[V]** verified in code or by an executed command · **[A]** assumption or recommendation

---

## A. Existing Code Inventory

| Area | Files | Notes |
| --- | --- | --- |
| Workspace UI | `components/publishing/alt-text/alt-text-workspace.tsx` (tabs `generate`, `bulk`, `documents`, `history`) | [V] Single place where advanced results should surface |
| Domain contract | `lib/alt-text/core.ts` | [V] `IMAGE_CLASSIFICATIONS` already include `chart`, `table`, `map`, `math_equation`, `scientific_diagram`, `flowchart`; `COMPLEX_CLASSIFICATIONS`; `AltTextResult` already has `extractedText`, `warnings`, `classification` |
| Generation | `lib/alt-text/generate.ts`, `lib/alt-text/vision-service.ts`, `lib/ai/provider.ts`, `lib/ai/governance-core.ts` | [V] AI SDK via governed provider; tenant policy has `allowVision`, `allowFileAnalysis` |
| Credits | `lib/alt-text/credit-service.ts` (`reserve/settle/releaseAltTextCredits`, `IMAGE_INPUT_TOKEN_RESERVE`) | [V] Reservation-based metering |
| Image input | `lib/alt-text/media-format.ts`, upload/scan routes, `lib/storage/*` | [V] Private storage, hash dedupe (`content_sha256`) |
| Bulk | `batch-*.ts`, `batch-settings.ts` (`OVERRIDABLE_FIELDS`, per-image overrides), `batch-processor.ts` | [V] |
| Jobs | `lib/background-jobs.ts` (`alt_text.batch_processing`, `alt_text.document_preparation`) | [V] Durable DB queue, retry, cancel, per-tenant concurrency keys |
| Documents | `pdf-*`, `pptx-*`, `docx-*`, `document-extraction-run.ts` | [V] Extraction, occurrences, scanned-page detection |
| Document context | `lib/alt-text/document-context.ts` | [V] `ContextConfidence` tiers, `ContextProvenance`, `normalizeContextText`, `boundText`, `looksLikeInstruction` |
| Location | `lib/alt-text/image-location.ts` | [V] `NormalizedBounds` (0–1), accuracy tiers |
| Human review | `document-image-review.ts`, `document-approval-contract.ts` (`DESCRIPTION_REVIEW_STATUSES`) | [V] |
| QA | `output-validation*.ts` | [V] `AS-012` scanned-content check; `policy.guideline: null` ("no client guideline system exists yet") |

## B. Capability Gap Matrix

| Capability | Status | Existing | Missing | Reuse | Task [A] |
| --- | --- | --- | --- | --- | --- |
| Analysis-type routing | Partial | `ImageClassification` | Routing category incl. text-heavy / mixed | `analysisTypeForClassification` (new) | 2–3 |
| OCR | **Missing** [V] | `extractedText` (model-read only); scanned-page warnings say "needs OCR" | Engine, regions, per-token confidence | Evidence contract, jobs, storage | 4–6 |
| Equations (LaTeX/MathML) | **Missing** [V] (no `latex`/`mathml` references) | `math_equation` class | Recognition, spoken math | `representation: latex/mathml` | 7–9 |
| Charts/graphs | Missing | `chart` class, detailed description | Axis/series/data extraction | `chart_structure` evidence | 10–12 |
| Scientific diagrams/flowcharts | Missing | classes exist | Components/relationships | `diagram_component`, `relationship` | 13–15 |
| Image tables | Missing | `table` class | Cell structure | `table_structure` evidence | 16–17 |
| Maps/geometry | Missing | `map` class | — | routing only | 18 |
| Provenance/confidence | Partial | document-context tiers | Per-evidence source incl. OCR/model/user | **New contract** | 1 (done) |
| Client guidelines | **Missing** [V] | `policy.guideline: null`; PDF header "Guidelines" hidden until page exists | Upload/scoping | existing file storage + tenant scope | 20+ |
| Feature activation | Missing | tenant AI governance flags | Per-capability availability | `CAPABILITY_UNAVAILABLE` warning; settings JSON | 2 |

No OCR/vision packages are installed (`tesseract`, `paddle`, `mathpix`: none in `package.json` or code) [V].

## C. Integration Mapping

| Existing | Future improvement [A] |
| --- | --- |
| Generate tab / `generate.ts` | Optional pre-analysis evidence fed as delimited, untrusted source material into the existing prompt |
| Bulk tab / `batch-processor.ts` | Analysis runs per asset inside the existing `alt_text.batch_processing` job; new settings via `OVERRIDABLE_FIELDS` |
| Documents / extraction | Scanned-page occurrences routed to OCR instead of the current "out of scope" warning |
| Review (`document-image-review`, approvals) | Evidence shown with source labels; reuse `DescriptionReviewStatus` |
| QA (`output-validation*`) | Contribute findings (e.g. unverified model interpretation) to existing checks; no certification claims |
| Credits | OCR/analysis calls metered through existing reserve/settle |

## D. Foundation Changes

| File | Change |
| --- | --- |
| `lib/alt-text/advanced-analysis-contract.ts` (new) | Browser-safe types + `parseAccessibilityAnalysis` validator. Reuses `ContextConfidence`, `NormalizedBounds`, `normalizeContextText`, `boundText`, `looksLikeInstruction`, `DescriptionReviewStatus`, `CLASSIFICATION_LABELS`. Contains no analysis, no AI calls and no stubs that return results. |
| `test/alt-text/alt-text-advanced-analysis-contract.test.ts` (new) | 11 focused tests |
| This report | — |

Enforced rules: only `user_confirmed` evidence is verified. Model interpretation is capped at `medium` and flagged. A numeric score is kept only when an engine reported it and the engine is named. Instruction-like text is kept as data and flagged. Regions and size are bounded and validated. No existing file, API payload or schema was modified.

## E. Database Assessment

No migration in Task 1 [V]. Later tasks will need one additive, nullable JSON column for persisted analysis, e.g. `alt_text_assets.analysis_json` (plus optional `analysis_version`). The column is parsed with `parseAccessibilityAnalysis`. No per-category tables [A]. Document occurrences already link to assets via `alt_text_asset_id`, so no second column is needed there [V].

## F. Security Assessment

- OCR or document text could be used for prompt injection. It must be wrapped as delimited data, as Task 12 context already is. The contract flags instruction-like text [V].
- Tenant isolation: future analysis must go through the existing `route-gate.ts` and `currentTenantId()`. Guidelines must be scoped by tenant [A].
- No OCR engine is present, so nothing can be enabled yet. Do not show toggles until an engine exists [V].
- Paid OCR APIs need the same governance and credit metering as vision calls [A].
- Blocker: none for Task 2.

## G. Test Results

| Command | Outcome |
| --- | --- |
| `pnpm exec vitest run test/alt-text/alt-text-advanced-analysis-contract.test.ts` | **11/11 passed** |
| `pnpm exec tsc --noEmit` | **Passed** (exit 0) |
| `pnpm exec vitest run test/alt-text` | 37/38 files, 434/445 tests passed. **11 failures, all in `alt-text-credit-service.test.ts`**. |
| Same suite with the new files stashed (baseline `main`) | **Same 11 credit-service failures.** They were already failing before this change and are not caused by it. Not fixed here (out of scope: AI pricing and credits). |

No paid provider calls were made. The Step 15 areas (uploads, short/detailed text, settings, batches, jobs, versions, document occurrences/context, approvals, exports, history) are covered by the passing existing suites. Credit accounting is the exception: its suite was already failing.

## H. Task 2 Readiness

Ready [V]. Configuration can extend the existing `AltTextSettings` JSON (`alt_text_settings`) and per-image overrides (`batch-settings.ts`), with tenant AI governance as the gate. No new settings table is needed. Recommended first step for Task 2: investigate the pre-existing credit-service test failures before adding any metered analysis [A].
