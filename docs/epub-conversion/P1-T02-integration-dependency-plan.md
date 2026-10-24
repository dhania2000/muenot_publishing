# EPUB Conversion — P1-T02 Integration Dependency Plan

| Field | Value |
| --- | --- |
| Roadmap item | Phase 1, Task P1-T02 |
| Verified at commit | `cd12920` |
| Nature | Planning only. **No implementation task is marked complete by this document.** |

IDs (`R*`, `E*`, `I*`, `C*`) refer to `P1-T02-feature-reuse-matrix.md`.

---

## 1. Roadmap reference (provisional)

The approved 20-phase / 300-task EPUB roadmap is **not present in the repository** (blocker B1). Items below are grouped into workstreams **WS1–WS10** that should be reconciled to the approved task IDs when the roadmap file is provided. No task ID is invented.

| Workstream | Scope | Matrix items |
| --- | --- | --- |
| WS1 Foundation & scope | Profiles baseline, decisions on blockers | E10, C11 (spec only) |
| WS2 Shared conversion platform | Domain tables, API, gate, job types, upload, downloads | C1, C2, C3, E11, E11a, E15, E17, E19, I1 |
| WS3 EPUB UI shell | Generalised shell, EPUB registries, routes | E1–E5, C10, R1–R14, R28 |
| WS4 EPUB core engine | OCF, OPF, nav, sanitiser | C4, C5, C7, E12, E13 |
| WS5 Source transformers | DOCX, HTML, XML → EPUB; later PDF, IDML, OCR | C6, I3 |
| WS6 Validation & QA | Structural checks, EPUBCheck, accessibility | C8, E14, E21, R25 |
| WS7 Preview & editing | Reader preview, TOC/metadata/CSS editors | C9, E6, E7 |
| WS8 Client guidelines | Shared guideline service, EPUB categories | C12, E9, R12, R15, I4 |
| WS9 Review, approval, delivery | Approvals, audit log, permissions, notifications, shared pages | C13, C14, E16, E20, E22, I5 |
| WS10 Advanced EPUB | Fixed/mixed/scrolled, overlays, interactive, STEM, multilingual, reverse | C15, C16, I2 |

---

## 2. Dependency map

### 2.1 Reusable immediately (no prerequisite)

R1–R28 (navigation, registry, UI primitives, auth, tenant, storage, quota, download gate, XML parser, retry policy, job limits, DB, rate limit, guideline contracts, XLSX).

### 2.2 Existing features requiring improvement

E1–E22 and E11a. Critical-path subset: **E11a → E11 → E12** (uploads), **E15** (job types), **E3** (shell), **E19** (scan status), **E16** (permissions before approval/delivery).

### 2.3 Missing shared infrastructure (build once, used by all services)

C1 domain/tables · C2 API · C3 downloads · C12 guideline service · C13 approvals + audit log · C14 shared pages · E17 conversion gate · E19 scanning provider hook.

### 2.4 Missing EPUB-specific infrastructure

C4 OCF · C5 package/nav/metadata · C6 transformers · C7 sanitiser · C8 validation · C9 preview · C10 UI registries · C11 profiles · C15 advanced engines · C16 reverse conversion.

### 2.5 Dependency graph

```
B1 roadmap ─┐
B4 profile ─┼─► C11 profiles ───────────────┐
            │                               │
E11a ─► E11 upload ─► C2 API ◄── C1 domain ◄┤◄── E15 job types ◄── (B3 dispatch) I1
              │          │         │        │
E12 OCF validation       │         └─► C13 approvals/audit ◄── E16 permissions
   │                     │                    │
   └─► C4 OCF ─► C5 package ─► C6 transformers ─► C8 validation ─► C14 QA/Downloads/History
          │          │                │               │
          └─► C7 sanitiser ─────────► C9 preview      └─► C12 guideline verification
                                                          ▲
E3 shell ─► C10 EPUB registries ─► E1/E2 routes ─► E6/E7 workspace binding (needs C2)
E19 scan ─► C3 downloads (needs C1)
```

### 2.6 Can be developed independently (parallel)

| Track | Items | Why independent |
| --- | --- | --- |
| UI shell | E3, E4, E5, C10, E1, E2 | Static config + existing components; statuses stay `planned` |
| Pure EPUB core | C4, C5, C7 | Pure functions, unit-testable without DB/API |
| Platform | C1, E15, E17, E11a | No EPUB engine needed |
| Guideline service | C12 (storage + parse) | Service-agnostic; uses existing contracts |
| Validation worker spike | C8 hosting decision | Infrastructure decision (B5) |

### 2.7 Requires previous dependencies

| Item | Requires |
| --- | --- |
| C2 API | C1, E11, E15, E17 |
| E6/E7 workspace binding | C2 |
| C6 transformers | C4, C5, C7 |
| C8 validation | C4 + hosting decision B5 |
| C9 preview | C4, C7, isolated route/CSP |
| C3 downloads | C1, E19 |
| C13 approvals | C1, E16 |
| C12 verification step | C8, C11 |
| C14 shared pages | C1, C2 |
| C15 advanced engines | C4–C8 |
| C16 reverse | C4 |
| I1 production processing | B3 dispatch decision |

---

## 3. Recommended development order

| Order | Step | Items | Exit criterion |
| --- | --- | --- | --- |
| 1 | Resolve blockers B1–B6 | — | Written decisions |
| 2 | Default EPUB 3.3 profile spec | C11 (spec), E10 | Approved profile document |
| 3 | Generalise UI shell (no behaviour change) | E3, E4, E5 | All `test/publishing/pdf-*.test.ts` pass |
| 4 | EPUB UI registries + routes (honest `planned` statuses) | C10, E1, E2 | EPUB sections render via shared shell |
| 5 | Shared platform | C1, E15, E17, E11a, E11, E12 | Alt Text tests unchanged; conversion upload accepts valid `.epub`/`.docx`, rejects unsafe archives |
| 6 | EPUB core | C4, C5, C7 | Generated minimal EPUB passes EPUBCheck (via spike) |
| 7 | API + job execution | C2, I1, E19, C3 | Upload → job → output → gated download end-to-end |
| 8 | First transformers | C6 (DOCX, HTML, XML) | Reflowable 3.3 output validates |
| 9 | Validation & reports | C8, E14, E21, R25 | Reports stored; "valid" only with evidence |
| 10 | Workspace binding + preview | E6, E7, C9 | Sandboxed preview, CSP verified |
| 11 | Guidelines | C12, E9, R12 | Scenario A/B behaviour; unsupported/conflicting rules reported |
| 12 | Approval, audit, delivery, permissions | C13, E16, I5, E22 | Approve/deliver require grants; audit rows written |
| 13 | Shared conversion pages | C14, E20 | Jobs/Downloads/QA/History list EPUB via service filter |
| 14 | Accessibility + AI assists | I2, I4, I7, E18 | EPUB Accessibility 1.1 metadata + checks |
| 15+ | Advanced engines, OCR, PDF/IDML sources, reverse conversion | C15, C16, I3 | Per-feature validation |

Capability statuses in `pdf-capabilities.ts` (`to-epub`) and the EPUB registry stay `planned` until step 9 evidence exists (I6).

---

## 4. Justification of newly proposed components

| ID | New component | Existing alternatives considered | Reason they are insufficient |
| --- | --- | --- | --- |
| C1 | Conversion domain tables | `alt_text_projects/batches/documents`; `platform_background_jobs` | Alt Text tables encode image-description semantics; queue rows are execution state, not business records (revisions, approvals) |
| C2 | `app/api/conversion/*` | `app/api/alt-text/*` | Alt Text routes are bound to Alt Text tables/permissions; a service-parameterised API avoids one API per service |
| C3 | Conversion download route | `/api/storage/file/*` (absent), Alt Text export routes | Proxy route never existed; Alt Text routes are entity-specific |
| C4–C7 | EPUB engine modules | `ooxml-zip-rewrite.ts`, `document-validation.ts`, `fast-xml-parser` | These are reused inside the engine; no OCF/OPF/nav/sanitiser logic exists |
| C8 | Validation adapter/worker | `output-validation*.ts` | OOXML/PDF checks only; EPUBCheck is the industry reference and needs Java |
| C9 | Preview renderer + isolated route | `pdf-preview-components.tsx` | Chrome only; untrusted XHTML needs isolation |
| C10 | EPUB registries | `pdf-sections.ts`, `pdf-header-config.ts`, `pdf-capabilities.ts` | Editing PDF registries would change PDF; parallel config is additive |
| C11 | EPUB profiles/settings | `PDF_DEFAULT_PROFILES` | No EPUB settings model |
| C12 | Guideline service | `guideline-contracts.ts` | Contracts only, explicitly no parsing/enforcement |
| C13 | Approvals + audit log | job events | Job events are per-job execution logs, not user decisions |
| C14 | Shared conversion pages | `PlannedPage` placeholders | Placeholders; implemented once, not per service |
| C15, C16 | Advanced engines, reverse conversion | none | No code exists |

---

## 5. Integration and regression risks

| ID | Risk | Severity | Mitigation | Affected items |
| --- | --- | --- | --- | --- |
| IR1 | PDF regressions while generalising `Pdf*` shell | Medium | Wrappers + re-exports; PDF tests in CI | E3–E5 |
| IR2 | Alt Text upload regression when extracting shared pipeline | High | Adapter; run `test/alt-text` + `test/publishing/alt-text-upload.test.ts` before/after (note: P1 QA recorded 12 pre-existing failures in credit/upload tests — baseline must be captured first) | E11 |
| IR3 | Widening global upload allow-list | Medium | Per-module allow-lists | E11a |
| IR4 | DOCTYPE policy weakened for OOXML | Medium | Separate OCF profile; OOXML profile untouched | E12 |
| IR5 | Daily cron drain makes conversion unusable interactively | High | Decide dispatch (immediate trigger / worker) before C2 ships | I1 |
| IR6 | MySQL blob growth from EPUB media | Medium | Size caps; object-storage adapter behind `lib/storage` | R19 |
| IR7 | Hard-coded `scan_status='clean'` misrepresents safety | Medium | Conversion files start `pending`; provider hook | E19 |
| IR8 | Permission stub allows any tenant user to approve/deliver | High (for delivery) | E16 before C13 ships | E16, C13 |
| IR9 | Preview XSS from EPUB content | High | C7 + C9 isolation, strict CSP | C9 |
| IR10 | EPUBCheck unavailable in Node standalone build | Medium | External worker; report "not verified" until available | C8 |
| IR11 | EPUB 3.4 features producing invalid 3.3 output | Medium | 3.4 opt-in, controlled profile, validation gate | C11 |
| IR12 | Duplicate job/upload/nav modules | High | This matrix; code review checklist §6 of reuse matrix | all |
| IR13 | Registry drift (PDF sections vs `CONVERSION_MODULES`, audit R12) | Low | Keep EPUB sections and `CONVERSION_MODULES.epub.pages` aligned from day one | C10, R1 |
| IR14 | Outbound guard is a no-op | Medium | Real guard before email/retailer delivery | I5 |
| IR15 | In-memory rate limit across instances | Low | Accept for single instance; revisit | R27 |

---

## 6. Unresolved blockers

| ID | Blocker | Needed for | Owner |
| --- | --- | --- | --- |
| B1 | Approved 20-phase / 300-task roadmap not in repository | Exact task-ID mapping | Product |
| B2 | Confirm production `service.muenot.co.in` runs this repo (README says extraction, not standalone) | All implementation | Engineering |
| B3 | Job dispatch on Hostinger beyond daily cron | I1, C2 | Engineering |
| B4 | Approved default EPUB production profile content | C11, E10 | Publishing ops |
| B5 | EPUBCheck / Java hosting | C8 | Engineering |
| B6 | Malware scanning provider | E19, C3 | Security |
| B7 | Sample client guideline documents | C12 | Publishing ops |

---

## 7. Status

P1-T02 deliverables are documentation only. All implementation items (WS1–WS10) remain **not started**.
