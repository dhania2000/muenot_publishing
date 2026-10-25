# EPUB Conversion — P1-T03 Complete Service Scope & Boundaries

| Field | Value |
| --- | --- |
| Project | Muenot Publishing (`service.muenot.co.in`) |
| Module | Publishing Services › Conversion › ePub |
| Roadmap item | Phase 1, Task P1-T03 — EPUB Conversion Service Scope & Boundaries Definition |
| Repository / branch | `dhania2000/muenot_publishing`, branch `v0/epub-p1-t03-scope` (from `main` @ `f3c4c84`) |
| Date | 2026-10-25 |
| Nature | **Specification and documentation only.** No engine, page, API, schema, dependency or configuration was changed. Existing production functionality is untouched. |

## Document set

| # | File | Contents |
| --- | --- | --- |
| 1 | `P1-T03-service-scope-and-boundaries.md` (this file) | Step 1 review, scope summary, requirement scheme and totals, Step 12 enterprise workflow, reuse summary |
| 2 | `P1-T03-format-compatibility-matrix.md` | Step 2 versions, Step 3 layouts, Step 5 sources, Step 10 reverse/migration, Step 11 distribution |
| 3 | `P1-T03-publishing-capabilities.md` | Step 4 categories, Step 6 core, Step 7 advanced, Step 8 accessibility, Step 9 guidelines |
| 4 | `P1-T03-service-boundaries.md` | Step 13 non-functional requirements, Step 14 boundaries A–F and exception route |
| 5 | `P1-T03-requirements-traceability.md` | Step 15 traceability of every requirement + gap register + proposed roadmap extensions |

---

## 1. Step 1 — Review of previous tasks

### 1.1 Inputs reviewed

| Input | Location | Present? |
| --- | --- | --- |
| P1-T01 Existing Website & Codebase Audit | `docs/epub-conversion/P1-T01-existing-system-audit.md` | Yes |
| P1-T02 Existing → EPUB Improvement Mapping, Feature Reuse Matrix, Integration Dependency Plan | `docs/epub-conversion/P1-T02-*.md` | Yes |
| PDF Conversion infrastructure docs | `PDF_PHASE1_TASK*.md`, `PDF_PHASE2_TASK*.md` (repo root) | Yes |
| Approved 20-phase / 300-task EPUB roadmap | — | **No** (blocker B1, recorded in P1-T02; still open) |

### 1.2 Re-verification against source code at `f3c4c84`

| Previous finding | Re-check | Result |
| --- | --- | --- |
| No functional EPUB code | Repository-wide search for `epub` in `lib/`, `components/`, `app/`: only `lib/conversion-modules.ts:166` (module registry), `lib/navigation.ts:128` ("ePub Accessibility", no href), `pdf-capabilities.ts:219` (`to-epub` planned), `pdf-formats.ts:70`, `pdf-overview-panels.tsx:160` (copy) | **Confirmed** |
| API trees limited to `alt-text`, `health`, `jobs` | `ls app/api` | Confirmed |
| No `lib/conversion/` | `ls lib/conversion` → not found | Confirmed |
| Upload allow-list excludes `.epub` | `lib/settings/uploads.ts:11` (`png, jpg, jpeg, webp, gif, pdf, pptx, docx`) | Confirmed |
| Closed job-type union (Alt Text only) | `lib/background-jobs.ts:12` | Confirmed |
| Guideline contracts only | `lib/guidelines/` contains only `guideline-contracts.ts` | Confirmed |
| OCR is `tesseract.js` with eng/hin | `package.json` (`tesseract.js` 7.0.0, `@tesseract.js-data/eng`, `/hin`), `lib/alt-text/ocr-contract.ts` (`OCR_PROVIDER_ID = "tesseract_js"`) | Confirmed |
| Libraries available for reuse | `package.json`: `fast-xml-parser` 5, `exceljs` 4, `pdf-lib` 1.17.1, `ai` 7 | Confirmed |
| PDF Conversion is UI only | P1-T01 §D / P1-T02 §1.1; unchanged since | Confirmed |

New since P1-T02: **EPUB 3.4** status verified externally as a W3C **Candidate Recommendation Draft** (CR 2026-07-21; latest draft 2026-10-22). It is treated as conditional scope (VER-08). No previous finding was found to be false. No existing service is duplicated by this scope.

---

## 2. Scope summary

| Dimension | Covered |
| --- | --- |
| EPUB versions | 2.0/2.0.1, 3.0, 3.0.1, 3.1, 3.2, **3.3 (default)**, 3.4 (conditional), legacy remediation, upgrade, controlled downgrade, version detection (12 reqs) |
| Layouts | Reflowable, fixed, pre-paginated per document, mixed, multiple renditions, responsive, portrait/landscape, spreads, RTL, vertical, roll/scrolled, image FXL, XHTML/SVG FXL, accessible FXL alternatives, reconstruction (15 reqs) |
| Content categories | General (6), Academic & Educational (11), Visual (10), Advanced digital (10), Special cases (6): **43** |
| Source formats | Office/text (10), PDF (5), publishing/structured (11), visual/multimedia (5): **31** |
| Core capabilities | 27 (ingestion → final validation) |
| Advanced capabilities | 18 |
| Accessibility | 21 |
| Client guidelines | 13 |
| Reverse conversion and migration | 15 |
| Distribution | 9 |
| Enterprise workflow | 27 |
| Non-functional | 31 (security 8, scalability 6, reliability 6, performance 5, maintainability 6) |
| **Total requirements** | **262** |

### 2.1 Requirement ID scheme

`VER` versions · `LAY` layouts · `CAT-G/A/V/D/S` categories · `SRC` sources · `CORE` core capabilities · `ADV` advanced · `A11Y` accessibility · `GDL` guidelines · `REV` reverse/migration · `DST` distribution · `WF` workflow · `NFR-SEC/SCL/REL/PRF/MNT` non-functional. IDs are stable; new requirements are appended, never renumbered.

### 2.2 Classification totals (Step 14 classes)

| Class | Meaning | Count |
| --- | --- | --- |
| A | Core supported | 101 |
| B | Advanced supported | 89 |
| C | Publisher-specific | 22 |
| D | Integration-dependent | 34 |
| E | Conditional / experimental | 11 |
| F | Out of scope / restricted | 5 (listed in `P1-T03-service-boundaries.md` §2F; exception routes only, not counted as deliverable requirements in the 262) |

Counts per class come from the Scope column of `P1-T03-requirements-traceability.md`. A + B + C + D + E = 257, and the remaining 5 deliverable requirements (DST-08, DST-09, GDL-12, A11Y-21, NFR-MNT-01) are governance rules classified A. The classes therefore sum to 262.

### 2.3 Proposed default production profile (subject to blocker B4)

EPUB 3.3 · reflowable · `nav.xhtml` + NCX off (on for legacy distribution profiles) · landmarks on · page-list when a print source exists · EPUB Accessibility 1.1 WCAG 2.2 AA **target** (claimed only with evidence) · embedded fonts only with a recorded licence · no scripting · MathML with alt text and image fallback for STEM profiles · output validated by EPUBCheck (or reported "not verified" until B5 is resolved).

---

## 3. Step 12 — Enterprise workflow scope

**Auto** = automatic · **Human** = requires internal approval/action · **Client** = client-dependent.

### 3.1 Pipeline stages

| Req | Stage | Actor | Description | Exit condition |
| --- | --- | --- | --- | --- |
| WF-01 | Client submission | Client | Upload sources, optional guidelines, order details, rights confirmation | Files accepted by upload validation |
| WF-02 | Preflight | Auto | CORE-02 analysis; DRM and safety checks | Preflight report stored |
| WF-03 | Source analysis | Auto + Human | Structure signals, OCR need, effort; production reviews flags | Analysis accepted |
| WF-04 | Profile selection | Human (auto-proposed) | Layout/profile chosen by the §3 algorithm in the matrix doc + guidelines | Profile version pinned to job |
| WF-05 | Conversion | Auto | Adapter → semantic model → XHTML | Stage completes or fails typed |
| WF-06 | Content review | Human | Structure, reading order, OCR proofing (level L0–L3 per category) | Reviewer sign-off |
| WF-07 | EPUB generation | Auto | Packaging (CORE-25), optimisation (CORE-26) | Package built |
| WF-08 | Validation | Auto | CORE-27: structure, EPUBCheck, accessibility, guidelines | Reports stored; failures block QA |
| WF-09 | QA | Human | Reader checks per ADV-18 test list, manual a11y where required | QA pass recorded |
| WF-10 | Client review | Client | Client previews (sandboxed C9) and downloads draft | Feedback or approval |
| WF-11 | Revision | Human + Auto | New revision job linked to parent | Revision validated |
| WF-12 | Approval | Client + Human | Client approval record; internal release approval | Approval rows in C13 |
| WF-13 | Delivery | Human (Auto for download) | Gated download; optional email notification; manual store upload by client | Delivery record written |

### 3.2 Cross-cutting workflow capabilities

| Req | Capability | Actor | Notes / reuse |
| --- | --- | --- | --- |
| WF-14 | Single and bulk conversion | Auto | Shared Batch Center (C14), job queue (E15) |
| WF-15 | Multi-book projects | Human | `conversion_projects` (C1) |
| WF-16 | Multiple output profiles per source | Auto | One job per profile, sharing the semantic model |
| WF-17 | Progress monitoring | Auto | Job events (`platform_background_job_events`), SWR polling |
| WF-18 | Failed-job retry | Auto + Human | `lib/job-retry-policy.ts`; manual retry from Jobs page |
| WF-19 | Workflow approvals | Human | C13 + E16 grants |
| WF-20 | Version control | Auto | Revisions; profile and guideline versions pinned |
| WF-21 | Internal production review | Human | Review queue |
| WF-22 | Audit logs | Auto | `platform_audit_log` (C13) |
| WF-23 | Notifications | Auto | Email via `lib/mailer.ts` (I5); in-app notifications missing (gap G-08) |
| WF-24 | SLA handling | Human + Auto | Due dates, at-risk flags; SLA values are contractual and not defined here (gap G-09) |
| WF-25 | Revision requests | Client | Structured feedback linked to locations |
| WF-26 | Final deliverables | Auto | EPUB + validation + accessibility + compliance reports + checksums |
| WF-27 | Production reporting | Auto | Throughput, first-pass validation rate, revision count; XLSX (R25) |

---

## 4. Existing functionality reuse (summary)

All reuse IDs refer to `P1-T02-feature-reuse-matrix.md`.

| Need | Reused asset | ID |
| --- | --- | --- |
| Navigation, routes (10 EPUB pages already registered) | `lib/conversion-modules.ts`, `lib/navigation.ts` | R1, R2 |
| UI shell, settings, preview chrome, validation UI | `components/publishing/conversion/pdf/*` (generalised, PDF unchanged) | R4–R14, R28, E3–E8 |
| Auth, tenant, feature gate | `lib/auth.ts`, `lib/tenant-*.ts`, `lib/api-auth.ts` | R16–R18 |
| Storage, quota, fail-closed download gate | `lib/storage/*` | R19–R21 |
| Upload validation and ZIP/XML safety | `lib/settings/uploads.ts`, `lib/alt-text/document-validation.ts` | E11, E11a, E12 |
| ZIP rewrite (OCF packaging basis) | `lib/alt-text/ooxml-zip-rewrite.ts` | E13 |
| Job queue, retry, limits, runner | `lib/background-jobs.ts`, `lib/job-retry-policy.ts`, `lib/observability/job-limits.ts`, `app/api/jobs/run` | E15, R23, R24, I1 |
| Output validation framework | `lib/alt-text/output-validation*.ts` | E14, E21 |
| Guideline contracts and compliance verdicts | `lib/guidelines/guideline-contracts.ts` | R15, R12 |
| Alt text generation and review | `lib/alt-text/document-generation.ts` et al. | I2 |
| OCR | `lib/alt-text/ocr-*.ts` | I3 |
| AI provider and metering | `lib/ai/*` | I4 |
| Reports (XLSX) | `lib/alt-text/batch-xlsx.ts` | R25 |
| Email | `lib/mailer.ts` | I5 |

No duplicate architecture is proposed. New components are limited to P1-T02 C1–C16 (justified in `P1-T02-integration-dependency-plan.md` §4) plus the roadmap extensions in the traceability gap register.

---

## 5. Completion status

| Acceptance criterion | Status | Evidence |
| --- | --- | --- |
| 1 Versions and profiles inventoried | Met | Matrix §2; profile codes in capabilities doc |
| 2 Reflowable, fixed, mixed, roll covered | Met | Matrix §3 |
| 3 Content categories | Met | Capabilities §1 (43) |
| 4 Source → output compatibility | Met | Matrix §4 (31) |
| 5 Accessibility and multilingual | Met | Capabilities §4, ADV-13/14, CAT-D06, CAT-S04 |
| 6 STEM and academic | Met | CAT-A01–A11, CORE-17–19, ADV-10/11 |
| 7 Multimedia and interactive | Met | ADV-01–08 |
| 8 Reverse conversion and repair | Met | Matrix §5 |
| 9 Guidelines optional but enforceable | Met | GDL-01–13 |
| 10 Publisher limitations | Met | Matrix §6, boundaries class C |
| 11 Exception routes | Met | Boundaries §2 D/E/F + exception route |
| 12 Linked to phases/tasks | **Met with limitation**: linked to provisional workstreams; exact 300-task IDs pending B1 | Traceability doc |
| 13 Reusable infrastructure identified | Met | §4 |
| 14 No unjustified duplicate architecture | Met | §4 |
| 15 Five deliverables exist | Met | Document set table |
| 16 No production functionality changed | Met | Only `docs/epub-conversion/P1-T03-*.md` added |

**Task status: Complete (documentation)**, with one open dependency: reconcile workstream references to exact roadmap task IDs once the approved roadmap (B1) is provided.
