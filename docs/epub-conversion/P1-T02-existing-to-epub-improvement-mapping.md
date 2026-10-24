# EPUB Conversion — P1-T02 Existing → EPUB Improvement Mapping

| Field | Value |
| --- | --- |
| Project | Muenot Publishing (`service.muenot.co.in`) |
| Module | Publishing Services › Conversion › ePub |
| Roadmap item | Phase 1, Task P1-T02 — Existing Pages → Improvement Mapping |
| Repository / branch | `dhania2000/muenot_publishing`, working branch `v0/epub-p1-t01-audit` |
| Verified at commit | `cd12920` (P1-T01 audit doc on top of `bd52b31`) |
| Date | 2026-10-25 |
| Nature of task | **Architecture planning and documentation only. No production code, schema, dependency, route or configuration was changed.** |

Companion documents:

- `docs/epub-conversion/P1-T02-feature-reuse-matrix.md` — the itemised REUSE / EXTEND / INTEGRATE / CREATE / N/A register with IDs (`R*`, `E*`, `I*`, `C*`, `N*`) used throughout this file.
- `docs/epub-conversion/P1-T02-integration-dependency-plan.md` — dependency map, development order, new-component justifications, risks.
- `docs/epub-conversion/P1-T01-existing-system-audit.md` — source audit (verified below).

Conventions: every path below exists in the repository at the verified commit unless marked **(proposed)**. "UI only" means the component renders but no API, persistence or engine is connected.

---

## 1. Step 1 — Verification of the P1-T01 audit

The audit was re-checked against the repository (`app/api/*`, `components/publishing/conversion/**`, `components/publishing/alt-text/*`, `lib/**`, `test/publishing/*`).

### 1.1 Confirmed findings

| P1-T01 finding | Re-verified evidence | Result |
| --- | --- | --- |
| Only `alt-text`, `health`, `jobs` API trees exist; no conversion/PDF/EPUB APIs | `ls app/api` → `alt-text/ health/ jobs/` | Confirmed |
| EPUB module registered with 10 planned pages | `lib/conversion-modules.ts` lines 166–183 (`slug: "epub"`, pages Workspace … History) | Confirmed |
| PDF Conversion is UI only (27 files under `components/publishing/conversion/pdf/`) | Directory listing; `pdf-workspace-config.ts` uses `PdfLocalFile` / `describeLocalFile` (browser-only file model) | Confirmed |
| No `lib/conversion/` | `ls lib/conversion` → not found | Confirmed |
| Closed job-type union | `lib/background-jobs.ts:12` `BACKGROUND_JOB_TYPES = ["alt_text.batch_processing", "alt_text.document_preparation"]`; enforced at line 155 | Confirmed |
| Upload allow-list excludes `.epub` | `lib/settings/uploads.ts:11` | Confirmed |
| `app_files.scan_status` written as `'clean'` | `lib/storage/index.ts:35–36` | Confirmed |
| Guideline contracts exist, parsing/storage missing | `lib/guidelines/guideline-contracts.ts` is the only file in `lib/guidelines/` | Confirmed |
| Permissions stub | `lib/permission-store.ts` (`getScope`, `getActionScope`, `hasActionGrant` ignore user/resource) | Confirmed |
| Mailer exists, not a notification system | `lib/mailer.ts` (`sendMail`), callers only `app/(auth)/actions.ts`, `app/(workspace)/admin/users/actions.ts` | Confirmed |

### 1.2 Corrections and additions to P1-T01

| # | P1-T01 statement | Correction (evidence) | Impact on EPUB plan |
| --- | --- | --- | --- |
| A1 | H.4: "Only byte-signature checks"; risk R7 implied no scan model | `lib/storage/file-scanning.ts` exists: `ScanStatus` (`pending/scanning/clean/infected/error`), quarantine status, `ScanRecord` with provider (`"signature"`), approval fields, `downloadGatePolicyFor()` (non-public files **fail closed**), `canDownload()`, `getScanForFile()`. Used by `lib/alt-text/batch-submission.ts` and `document-extraction-run.ts`. Alt Text also keeps its own `security_scan_status` column on documents. | **REUSE** the download gate for EPUB outputs (R21). The gap narrows to "no real malware provider" + "`app_files` insert hard-codes `clean`". |
| A2 | Tenant isolation listed only `lib/tenant-scope.ts` | `lib/tenant-context.ts` also exists (`TenantContext`, `runWithTenant`, `requireCurrentTenantId`) | Both must be used by EPUB job handlers (R17). |
| A3 | Permission model described only as `permission-store.ts` | `lib/permission-model.ts` defines `PERMISSION_SCOPES = none/all/added/owned/both` | A real scope vocabulary exists; only the store is a stub (E16). |
| A4 | Not listed | `lib/demo/outbound-guard.ts` — `assertOutboundAllowed()` is a no-op | Outbound delivery (email/FTP/retailer) must call it, but it currently enforces nothing (risk recorded). |
| A5 | AI credits mentioned generically | `lib/ai/credits/credits-service.ts` exports `beginMeteredRequest`, `abortMeteredRequest`, `finishMeteredRequest` with `sourceModule` | AI-assisted EPUB steps must meter through these (I4). |
| A6 | Audited commit `bd52b31` | HEAD is now `cd12920` (docs-only commit) | No code drift. |
| A7 | Roadmap reference | The approved 20-phase / 300-task EPUB roadmap is **not stored in the repository** (only PDF phase docs `PDF_PHASE*_*.md`) | Task IDs in the dependency plan are **provisional workstream references** to be reconciled (blocker B1). |

No P1-T01 finding was found to be false; A1 is the only material understatement.

---

## 2. Step 2 — Frontend component mapping

| # | Required capability | Actual file path(s) | Present functionality | Limitations | EPUB-specific improvement | Decision |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | Publishing services landing page | `app/(workspace)/modules/publishing/page.tsx`; `components/business-line/business-line-landing.tsx` | Business-line landing, publishing guard | Static | None — EPUB already reachable via Conversion | REUSE |
| F2 | Conversion service listing | `app/(workspace)/modules/publishing/conversion-name/page.tsx`; `components/publishing/conversion/conversion-nav.tsx` (`ConversionServiceGrid`, `ConversionSharedTabs`) | 24 service cards from `CONVERSION_MODULES`, ePub card already present | Card shows no live status | Card status should reflect EPUB capability status once engine ships (config only) | REUSE |
| F3 | File upload interface | `components/publishing/conversion/pdf/pdf-file-components.tsx` (dropzone, file card, list, metadata list, action menu) | Accessible dropzone with source/guidelines variants; browser-only | No server upload; PDF accept list | Parameterise `accept` (`.epub`, `.docx`, `.html`, `.xhtml`, `.xml`, `.idml`, `.pdf`) and bind to shared conversion upload API | EXTEND |
| F4 | Multiple-file upload | `pdf-file-components.tsx` (file list); `components/publishing/alt-text/use-bulk-upload.ts`, `bulk-processing-workspace.tsx` | PDF: local multi-file list. Alt Text: real bulk upload hook with per-file status | PDF has no server state; Alt Text hook is bound to Alt Text endpoints | Generalise the Alt Text bulk-upload hook pattern into a conversion upload hook **(proposed)** | EXTEND |
| F5 | Conversion settings forms | `pdf-settings-components.tsx` (collapsible group, labelled field + help, format selector, profile selector, summary); `pdf-workspace-config.ts` (settings group config) | Generic form primitives; PDF groups are planned items | No schema/validation/persistence | New EPUB settings schema (version, layout, CSS profile, metadata, a11y) rendered with the same primitives | REUSE components / CREATE config (C11) |
| F6 | Client guideline upload | `pdf-file-components.tsx` (guidelines dropzone); `pdf-workspace-config.ts` (`deriveGuidelineState`) | Optional guidelines file in local state | Not stored, not parsed | Bind to shared guideline service (C12) | EXTEND |
| F7 | Dashboard and statistics cards | `components/publishing/conversion/pdf/pdf-overview.tsx`, `pdf-overview-panels.tsx`; `components/publishing/alt-text/batch-progress-dashboard.tsx` | PDF overview cards from static config; Alt Text live batch metrics | PDF cards are static | EPUB overview reusing PDF overview panel pattern with an EPUB registry; live counts from conversion job API | EXTEND |
| F8 | Project and job listings | `CONVERSION_SHARED_PAGES.jobs` (`lib/conversion-modules.ts`) → `PlannedPage`; Alt Text `batch-history.tsx`, `document-history.tsx` | Jobs page planned; Alt Text has working histories | No cross-service job list | Build shared Conversion **Jobs** page once (C14); EPUB is a filter, not a separate list | CREATE (shared) |
| F9 | Processing status and progress | `pdf-processing-components.tsx` (progress, messages, log); `pdf-status-model.ts`; `pdf-capability-status.tsx` (`PdfStatusIndicator`) | Honest status/progress primitives (icon + text) | Not data-bound | Bind to job events (`platform_background_job_events`) via SWR polling | REUSE |
| F10 | File preview / document viewer | `pdf-preview-components.tsx` (toolbar, mode selector, container states, thumbnail) | Preview chrome only | No renderer | Sandboxed EPUB reader preview **(proposed)** inside existing preview container (C9) | REUSE chrome / CREATE renderer |
| F11 | Conversion job details | `[submodule]/[page]/page.tsx` → `PdfSectionPage`; `pdf-dialogs.tsx` (file information, error details) | Section shell + info dialogs | No job entity | Job detail view in EPUB `workspace`/`history` sections, data from conversion API | EXTEND |
| F12 | Validation report viewer | `pdf-processing-components.tsx` (validation summary, severity indicator, finding item, checklist); `components/publishing/alt-text/output-validation-panel.tsx` | Generic finding/severity UI; Alt Text real output-validation panel | PDF UI not data-bound; Alt Text panel typed to OOXML checks | Render EPUBCheck / accessibility / guideline findings with PDF primitives; mirror Alt Text panel data contract | REUSE + EXTEND |
| F13 | Error and warning messages | `pdf-feedback-state.tsx`; `components/enterprise/data-state.tsx`; `components/ui/alert.tsx`; `sonner` | Empty/loading/error presets; toasts | — | EPUB error-code copy only | REUSE |
| F14 | Download / export controls | `pdf-header-actions.tsx`, `pdf-file-components.tsx` (action menu); `components/publishing/alt-text/batch-export-action.tsx`, `document-history-outputs.tsx` | PDF actions are disabled/planned; Alt Text exports work | No generic download route | Shared Downloads page (C14) + module download route gated by `canDownload()` (C3) | EXTEND |
| F15 | Client review and approval forms | `components/publishing/alt-text/document-review-sheet.tsx`, `document-description-review.tsx`, `review-status-badge.tsx` | Alt Text human review of descriptions | Scoped to image descriptions, no approval/sign-off entity | EPUB client approval + exception approval (C13); reuse sheet + badge patterns | EXTEND (pattern) |
| F16 | Admin management interface | `app/(workspace)/admin/users/page.tsx`, `actions.ts` | User admin | No conversion/profile admin | Profiles & Presets admin belongs in shared `profiles-presets` page (C14), not admin | N/A (unchanged) |
| F17 | User permissions / access controls | `lib/permission-store.ts`, `lib/permission-model.ts`, `lib/api-auth.ts`, `app/(workspace)/layout.tsx` (session guard) | Session guard works; action scopes stubbed to `all` | No real grants | Action grants `conversion.epub:{create,approve,deliver,configure}` (E16) | EXTEND |
| F18 | Responsive layouts | `pdf-module-layout.tsx`, `pdf-section-navigation.tsx` (overflow + mobile selector), `pdf-format-matrix.tsx` (table → cards) | Tested responsive shell (`test/publishing/pdf-module-layout.test.ts`) | PDF-named | Generalise to module-agnostic shell keeping `Pdf*` aliases (E3) | EXTEND |
| F19 | Shared design system | `components/ui/*` (20 primitives), `components/enterprise/page-header.tsx`, `components/shell/*`, `app/globals.css` tokens | shadcn/Tailwind v4 tokens | Missing checkbox/switch/radio/dialog/slider primitives (noted in `PDF_PHASE1_TASK2_UI_ARCHITECTURE.md`) | Add missing primitives via shadcn CLI only when an EPUB setting first needs them | REUSE |
| F20 | Existing PDF Conversion frontend | `components/publishing/conversion/pdf/*` (27 files), `test/publishing/pdf-*.test.ts` | 12-section shell, overview, workspace, matrix, guidelines UI | UI only | **Must remain behaviourally unchanged**; EPUB consumes generalised copies/aliases | REUSE / NOT MODIFIED |

---

## 3. Step 3 — Backend service mapping

| # | Service | Exists? | API / entry points | Inputs → outputs | Dependencies | Security restrictions | Extension point for EPUB |
| --- | --- | --- | --- | --- | --- | --- | --- |
| B1 | Authentication / authorisation | Yes | `lib/auth.ts` (scrypt, `app_sessions`, `publishing_session` cookie), `app/(auth)/actions.ts`, `lib/api-auth.ts` `requireFeatureInModule()` | credentials → session; request → user/tenant | MySQL | httpOnly cookie, 14-day expiry; feature gate always-on | REUSE; new conversion route gate modelled on `lib/alt-text/route-gate.ts` (E17) |
| B2 | User / client management | Partial | `app/(workspace)/admin/users/*` | admin form → `users` rows | `lib/mailer.ts` | admin-only | No client/publisher entity exists; tenant = client boundary. Publisher profile is a guideline/profile concern (C12) |
| B3 | Project / job management | Alt Text only | `alt_text_projects`, `alt_text_batches`, `lib/alt-text/batch-*.ts` | — | MySQL, job queue | tenant-filtered SQL | CREATE shared `conversion_projects` / `conversion_jobs` (C1); do **not** reuse Alt Text tables |
| B4 | File upload / storage | Yes | `lib/storage/index.ts` (`uploadFile`), `keys.ts` (`t/<tenantId>/…`, `sanitizePath`), `file-metadata.ts`, `storage-quota.ts` | bytes + meta → `app_files` + `app_file_blobs` | MySQL blobs | tenant key prefix, `keyBelongsToTenant`, quota | REUSE with `module='conversion'`, `entity_type='epub_job'` |
| B5 | Input-file validation | Yes (Alt Text) | `lib/settings/uploads.ts` (`getUploadLimits`, content checks), `lib/alt-text/document-validation.ts`, `document-upload-contract.ts` (`DOCUMENT_ARCHIVE_LIMITS`) | bytes → accept/reject + reason | `node:zlib`, `fast-xml-parser` | MZ/ELF reject, ZIP bomb limits, ZIP64/encryption reject, DOCTYPE/ENTITY reject | EXTEND: per-module allow-list (E10); OCF validation profile (E12) |
| B6 | File extraction / parsing | Yes (Alt Text) | `lib/alt-text/pdf-extractor.ts`, `pptx-extractor.ts`, `docx-context.ts`, `document-extraction*.ts` | PDF/DOCX/PPTX → images + context | `pdf-lib`, zip readers | bounded readers | INTEGRATE DOCX reading pieces into DOCX→EPUB transformer; no EPUB reader exists (C4) |
| B7 | Document processing / write-back | Yes (Alt Text) | `docx-alt-text-inserter.ts`, `pptx-alt-text-inserter.ts`, `pdf-alt-text-remediator.ts`, `ooxml-zip-rewrite.ts` | package + edits → package | zip rewrite | preserves bytes of untouched entries | EXTEND zip rewriter for OCF (`mimetype` first, stored) (E13) |
| B8 | OCR | Yes | `lib/alt-text/ocr-contract.ts`, `ocr-engine.ts`, `ocr-service.ts` | image → text (eng, hin, eng+hin) | `tesseract.js` | server-side | INTEGRATE for scanned sources (I3); page-level OCR for books is a later scale concern |
| B9 | PDF Conversion services | **No** | — | — | — | — | PDF→EPUB depends on a PDF engine that does not exist; scheduled after DOCX/HTML/XML paths |
| B10 | Image processing | Partial | `lib/alt-text/media-format.ts`, `preview.ts` | image → format info / preview | — | SVG DOCTYPE/ENTITY reject | INTEGRATE for EPUB media manifest (media types, dimensions) |
| B11 | AI-assisted processing | Yes | `lib/ai/provider.ts`, `model-catalog.ts`, `lib/ai/credits/credits-service.ts`, Alt Text generation (`lib/alt-text/document-generation.ts`) | prompt → text, metered | AI SDK, credit ledger | credits reservation, tenant scoped | INTEGRATE: alt text for EPUB images, optional structure suggestions (I2, I4) |
| B12 | Conversion job queue | Yes (generic) | `lib/background-jobs.ts` (`enqueueBackgroundJobInTransaction`, claim, events) | job type + payload → durable job | MySQL | per-type payload validation, idempotency `(job_type, tenant_id)` | EXTEND: add `conversion.epub.*` types (E15) |
| B13 | Background workers | Yes | `app/api/jobs/run/route.ts` (Bearer `CRON_SECRET`), `vercel.json` cron `0 3 * * *` | — | job queue | secret-protected | INTEGRATE + resolve latency (I1, blocker B3) |
| B14 | Progress tracking | Yes | `platform_background_job_events`; Alt Text `batches/[id]/progress` route | job → events/progress | job queue | tenant scoped | REUSE event model; expose via conversion status API (C2) |
| B15 | Notifications | **Minimal** | `lib/mailer.ts` `sendMail()` | mail → SMTP | env SMTP | `lib/demo/outbound-guard.ts` no-op | INTEGRATE for delivery/approval emails (I5); in-app notifications MISSING |
| B16 | Error handling | Yes | `lib/job-retry-policy.ts` (transient/permanent/uncertain, dead-letter), `lib/ai/error-diagnostics.ts`, route-gate JSON helpers | error → classification | — | `Cache-Control: private, no-store` | REUSE |
| B17 | Database access | Yes | `lib/db.ts` (`mysql2/promise`, parameterised `query`) | — | `DATABASE_URL` | parameterised SQL | REUSE; schema via additive `database/migrations/*.sql` (not executed here) |
| B18 | Downloads / exports | Alt Text only | `app/api/alt-text/documents/[uploadId]/exports/[outputId]`, `.../original`, batch export; `lib/alt-text/batch-xlsx.ts` | stored file → stream | storage, `canDownload()` | fail-closed gate for non-public | CREATE conversion download route (C3); REUSE `exceljs` for reports |
| B19 | Logging / audit history | Partial | job events table; Alt Text history stores | — | — | — | Generic audit log MISSING (C13) |
| B20 | Compliance / QA checks | Partial | `lib/alt-text/output-validation*.ts`; `lib/guidelines/guideline-contracts.ts` (`assessGuidelineCompliance`, `isVerifiedPass`) | output → findings; evidence → verdict | `fast-xml-parser` | evidence required for pass | EXTEND output-validation framework (E14); REUSE compliance aggregation (R15); EPUBCheck MISSING (C8) |

Services confirmed present: 17 of 20 (B9 absent; B2, B15, B19 partial). Nothing was assumed.

---

## 4. Step 4 — EPUB feature mapping

Status key: **Existing** (working code), **Partial** (usable parts exist), **Missing**, **Proposed** (target location for new code).

### 4.1 EPUB standards

| Capability | Existing infrastructure | Status | Proposed location / note |
| --- | --- | --- | --- |
| EPUB 2.0.1 production (OPF 2, NCX) | none | Missing | `lib/conversion/epub/package/` (proposed); legacy compatibility profile only |
| EPUB 3 production | none | Missing | same |
| EPUB 3.3 standard profile (W3C Recommendation) | none | Missing | **Default profile** (C11) |
| EPUB 3.4 controlled compatibility profile | none | Missing | Feature-flagged profile; W3C 3.4 work is not a final Recommendation at time of writing — outputs must remain 3.3-valid, extra features opt-in and reported |
| Package: manifest, spine, nav, metadata | `fast-xml-parser` (R22) for parse/validate; zip writer pattern `ooxml-zip-rewrite.ts` | Partial (libraries only) | OPF/nav/NCX builders (C5); OCF writer (C4) |

### 4.2 Conversion engines

| Engine | Existing | Status | Note |
| --- | --- | --- | --- |
| Reflowable EPUB | `pdf-capabilities.ts` `to-epub` ("Only reflowable output is planned") | Missing | First engine target |
| Fixed Layout EPUB | `pdf-capabilities.ts` ("fixed-layout ePub is not registered") | Missing | `rendition:layout="pre-paginated"`; depends on page-image/PDF pipeline |
| Mixed Layout | — | Missing | per-spine `rendition:layout` overrides |
| Roll Layout | — | Missing | Not a named EPUB rendition; map to `rendition:flow="scrolled-continuous"` and document reader support limits |
| Enhanced / interactive | — | Missing | Scripted content requires explicit opt-in + `properties="scripted"` and sandbox policy (C7) |
| Media Overlay / read-aloud | — | Missing | SMIL generation; audio via storage; later phase |
| Multilingual | OCR `eng`/`hin` (`lib/alt-text/ocr-contract.ts`) | Partial | `xml:lang`/`dc:language`, `page-progression-direction`, font embedding; Devanagari shaping test set required |
| Accessible EPUB | Alt Text generation/review (`lib/alt-text/*`), `accessibility-settings.ts` | Partial | EPUB Accessibility 1.1 metadata + checks (C8); alt text via I2 |
| STEM / equations | — | Missing | MathML pass-through + fallback images; later phase |

### 4.3 Publishing workflows

| Workflow | Existing | Status | Mapping |
| --- | --- | --- | --- |
| DOCX → EPUB | DOCX ZIP reading (`docx-context.ts`, `document-validation.ts`) | Partial | Transformer (C6) reuses readers |
| PDF → EPUB | none (no PDF engine) | Missing | Depends on PDF text/structure extraction |
| HTML → EPUB | none (HTML uploads blocked in `lib/settings/uploads.ts`) | Missing | Needs per-module allow-list (E10) + sanitiser (C7) |
| XML (JATS/DocBook) → EPUB | `fast-xml-parser` | Partial | Transformer (C6) |
| IDML → EPUB | none | Missing | IDML is a ZIP; reuse bounded ZIP reader; later phase |
| OCR-assisted source processing | OCR service (B8) | Partial | I3 |
| Content structure extraction | Alt Text document context (`docx-context.ts`) | Partial | Heading/list/table model is new (C6) |
| Formatting / layout conversion | none | Missing | CSS profiles (C11) |
| EPUB editing and preview | EPUB section routes `toc-editor`, `css-profiles`, `metadata`, `reader-preview` (planned); preview chrome (F10) | Partial (UI shell) | C9 + section implementations |
| Validation and repair | output-validation framework (E14); zip rewriter (E13) | Partial | EPUBCheck adapter (C8); repair = deterministic fixes recorded as findings |
| Metadata and accessibility | none for EPUB | Missing | C5 + C8 |
| Bulk conversion | job queue (B12), Alt Text batch UI/services | Partial | Shared Batch Center (C14) |
| Publisher-specific export | guideline contracts (R15) | Partial | Profiles via C11/C12 |
| EPUB reverse conversion (EPUB → DOCX/PDF/HTML) | none | Missing | C16, later phase; requires EPUB reader (C4) |
| Client delivery and revision management | Alt Text exports/history | Partial | C1 revisions + C13 approvals + C3 downloads |

---

## 5. Step 5 — Client guidelines integration

| # | Workflow step | Existing facility | Status | Mapping / rule |
| --- | --- | --- | --- | --- |
| 1 | Optional guideline upload | Guidelines dropzone (`pdf-file-components.tsx`), `deriveGuidelineState` (`pdf-workspace-config.ts`) | UI only | Bind to shared guideline API (C12). Upload is **optional**; never blocks a job |
| 2 | Supported formats | `lib/settings/uploads.ts` allows `pdf`, `docx` | Partial | Guideline allow-list: PDF, DOCX, XLSX (spec sheets), TXT/MD (proposed); separate from source allow-list |
| 3 | Parsing | — (contract header: parsing arrives later) | Missing | Shared service; reuse Alt Text DOCX/PDF text extraction |
| 4 | Requirement extraction | Rule/RuleMapping types in `guideline-contracts.ts` | Types only | Deterministic + AI-assisted (metered, I4) extraction; every rule keeps source citation (doc, page, excerpt) |
| 5 | Publisher-specific settings | Priority levels job › company › preset › standard (`guideline-contracts.ts`) | Types only | Resolver maps rules to EPUB settings keys (C11) |
| 6 | Rule conflict detection | Conflict types + `pdf-guidelines-components.tsx` conflict panel | Types + UI | Resolver emits conflicts; UI reused |
| 7 | Accessibility requirements | `accessibility-settings.ts` pattern | Partial | Map to EPUB Accessibility 1.1 / WCAG 2.x level settings |
| 8 | Formatting requirements | — | Missing | Map to CSS profile tokens (C11) |
| 9 | Compliance validation | `assessGuidelineCompliance()`, `isVerifiedPass` | Exists | REUSE: a pass needs evidence (validator finding or check result) |
| 10 | Approval / exception handling | Exception types only | Missing | C13 approval records + audit log |
| 11 | Final compliance report | compliance summary UI; `exceljs` | Partial | Report generated from compliance results; XLSX/PDF export |

**Scenario A — no guidelines:** `assessGuidelineCompliance()` already returns "Not applicable"; the job uses the approved default EPUB 3.3 profile (C11). **Scenario B — guidelines supplied:** extract → map → resolve; every rule ends as *applied*, *conflict*, *unsupported* or *exception-approved*. Unsupported and conflicting rules are surfaced in the report and block "compliant" status — never silently dropped. Non-overridable constraints (`guideline-contracts.ts`) — e.g. EPUB validity, security policy — cannot be overridden by client rules.

The guideline service is built **once, service-agnostically** (`GuidelineServiceScope { area: "conversion", service: "epub" }`) so PDF and other services reuse it.

---

## 6. Step 6 — Existing → improvement mapping (master table)

Priority: **P0** prerequisite, **P1** first EPUB release, **P2** enhancement, **P3** later.

| Existing Page/Service | Actual File Path | Current Functionality | EPUB Requirement | Required Improvement | Reuse Decision | Priority | Dependencies |
|---|---|---|---|---|---|---|---|
| Conversion module registry | `lib/conversion-modules.ts` | Registers `epub` + 10 pages | Routes/nav source of truth | Optionally add `guidelines` page to EPUB pages (keep PDF list unchanged) | REUSE (R1) | P0 | — |
| Sidebar navigation | `lib/navigation.ts`, `components/shell/sidebar-nav.tsx` | ePub under Digital Publishing | Entry point | None | REUSE (R2) | P0 | R1 |
| "ePub Accessibility" menu item | `lib/navigation.ts` (`ACCESSIBILITY_SERVICES_MENU`) | Listed, no href | Link to EPUB accessibility checks | Add href to `/modules/publishing/conversion-name/epub/accessibility-checks` once live | INTEGRATE (I7) | P2 | C8 |
| Conversion dashboard | `app/(workspace)/modules/publishing/conversion-name/page.tsx`, `conversion-nav.tsx` | Service grid | EPUB card | None | REUSE (R3) | P0 | — |
| Service overview route | `app/(workspace)/modules/publishing/conversion-name/[submodule]/page.tsx` | PDF → `PdfOverview`, else `PlannedPage` | EPUB overview | Add `slug === "epub"` branch; PDF branch untouched | EXTEND (E1) | P1 | C10, E3 |
| Service section route | `.../conversion-name/[submodule]/[page]/page.tsx` | PDF sections; else planned | 10 EPUB sections | Add EPUB branch rendering generalised shell | EXTEND (E2) | P1 | C10, E3 |
| PDF section shell / layout / nav | `pdf-section-page.tsx`, `pdf-module-layout.tsx`, `pdf-section-navigation.tsx` | 12-section shell, responsive | EPUB section shell | Generalise behind registry param; keep `Pdf*` exports | EXTEND (E3) | P1 | PDF tests green |
| PDF header config/actions/menu | `pdf-header-config.ts`, `pdf-header-actions.tsx`, `pdf-header-more-menu.tsx` | PDF copy/actions | EPUB header | EPUB header config; renderer shared | EXTEND (E4) | P1 | E3 |
| PDF overview panels | `pdf-overview.tsx`, `pdf-overview-panels.tsx` | Static overview | EPUB overview | EPUB config through same panels | EXTEND (E5) | P1 | C10 |
| Content / dialogs / feedback / status / settings primitives | `pdf-content.tsx`, `pdf-dialogs.tsx`, `pdf-feedback-state.tsx`, `pdf-capability-status.tsx`, `pdf-settings-components.tsx` | Generic UI | EPUB UI | None (later move to `conversion/shared/` with re-exports) | REUSE (R7–R10, R28) | P1 | — |
| Processing / validation UI | `pdf-processing-components.tsx`, `pdf-status-model.ts` | Progress, findings, checklist | Job progress + validation report | Data binding only | REUSE (R11, R13) | P1 | C2 |
| Preview chrome | `pdf-preview-components.tsx` | Toolbar, states | Reader preview | Host sandboxed renderer | REUSE (R14) + CREATE (C9) | P1 | C4, C7 |
| File / upload components | `pdf-file-components.tsx` | Local dropzone | Server upload of sources + guidelines | Parameterised accept + upload callback | EXTEND (E6) | P1 | C2, E11 |
| Workspace | `pdf-workspace.tsx`, `pdf-workspace-panels.tsx`, `pdf-workspace-config.ts` | Stepper, local file model | EPUB workspace | Server-backed file model in EPUB config; PDF stays local | EXTEND (E7) | P1 | C2, E6 |
| Capability registry / matrix / formats | `pdf-capabilities.ts`, `pdf-format-matrix*.ts(x)`, `pdf-formats.ts` | PDF capabilities incl. `to-epub` | EPUB capability matrix | Parallel EPUB registry; keep `to-epub` status consistent | EXTEND (E8) + INTEGRATE (I6) | P1 | C10 |
| Guideline categories | `pdf-guideline-categories.ts` | PDF categories | EPUB categories | Add EPUB category set | EXTEND (E9) | P1 | C12 |
| Default profile | `pdf-status-model.ts` (`PDF_DEFAULT_PROFILES`) | `standard` | Approved default EPUB profile | EPUB 3.3 default profile | EXTEND (E10) | P0 | Blocker B4 |
| Guidelines UI | `pdf-guidelines-components.tsx` | Mapping, conflicts, compliance | EPUB guideline panel | None | REUSE (R12) | P1 | C12 |
| Guideline contracts | `lib/guidelines/guideline-contracts.ts` | Types + `assessGuidelineCompliance` | Optional guideline rules | None | REUSE (R15) | P0 | — |
| Guideline service | — | — | Storage, parse, extract, resolve, verify | New shared service + tables | CREATE (C12) | P1 | C1, E11 |
| Auth / session / tenant | `lib/auth.ts`, `lib/tenant-scope.ts`, `lib/tenant-context.ts` | Working | All EPUB APIs/jobs | None | REUSE (R16, R17) | P0 | — |
| Feature gate | `lib/api-auth.ts` | Always-on gate | API gate | None | REUSE (R18) | P0 | — |
| Route gate pattern | `lib/alt-text/route-gate.ts` | Alt Text JSON gate | Conversion gate | New `lib/conversion/route-gate.ts` (proposed) mirroring it | EXTEND (E17) | P0 | R18 |
| Permissions | `lib/permission-store.ts`, `lib/permission-model.ts` | Stub returns `all` | approve/deliver/configure | Real action grants | EXTEND (E16) | P1 | — |
| Storage | `lib/storage/index.ts`, `keys.ts`, `file-metadata.ts` | Tenant-scoped blobs | Sources, outputs, reports | None | REUSE (R19) | P0 | — |
| Quota | `lib/storage/storage-quota.ts` | Per-tenant quota | EPUB storage | None | REUSE (R20) | P0 | — |
| Scan / download gate | `lib/storage/file-scanning.ts` | Signature scan records, fail-closed gate | Gate EPUB downloads | Add OCF-internal checks; provider hook; stop hard-coded `clean` for conversion files | EXTEND (E19) | P1 | Blocker B6 |
| Upload limits | `lib/settings/uploads.ts` | Global allow-list | `.epub`, `.html`, `.xml`, `.idml` for conversion only | Per-module allow-lists; Alt Text list unchanged | EXTEND (E11a) | P0 | — |
| Upload pipeline | `lib/alt-text/document-upload.ts`, `app/api/alt-text/documents/upload/route.ts` | Validate → hash → dedupe → quota → store | Conversion upload | Extract shared pipeline; Alt Text keeps behaviour | EXTEND (E11) | P0 | E11a, C1 |
| ZIP validator | `lib/alt-text/document-validation.ts`, `document-upload-contract.ts` | OOXML profile | OCF profile | Add OCF profile, DOCTYPE allow-list | EXTEND (E12) | P0 | — |
| ZIP rewriter | `lib/alt-text/ooxml-zip-rewrite.ts` | Byte-preserving rewrite | EPUB repair | `mimetype` first + stored guarantee | EXTEND (E13) | P2 | C4 |
| XML parser | `fast-xml-parser` usage in `pptx-package.ts`, `output-validation.ts` | Parse/validate | OPF/nav/XHTML | None | REUSE (R22) | P1 | — |
| Output validation | `lib/alt-text/output-validation*.ts`, `output-validation-panel.tsx` | OOXML/PDF checks | EPUB structural checks record | EPUB check set in same record shape | EXTEND (E14, E21) | P1 | C4 |
| Job queue | `lib/background-jobs.ts` | 2 Alt Text types | `conversion.epub.*` | Additive job types + payload validators | EXTEND (E15) | P0 | — |
| Retry / limits | `lib/job-retry-policy.ts`, `lib/observability/job-limits.ts` | Classification, caps | EPUB jobs | None | REUSE (R23, R24) | P0 | E15 |
| Job runner | `app/api/jobs/run/route.ts`, `vercel.json` | Daily cron drain | EPUB processing | Register handlers; resolve dispatch latency | INTEGRATE (I1) | P0 | Blocker B3 |
| Batch UI / services | `components/publishing/alt-text/batch-*.tsx`, `lib/alt-text/batch-*.ts` | Alt Text batches | Bulk EPUB | Pattern for shared Batch Center | EXTEND (E20, pattern) | P2 | C14 |
| Alt Text generation | `lib/alt-text/document-generation.ts` et al. | Image descriptions | EPUB image alt text | Call as a service step | INTEGRATE (I2) | P2 | C4 |
| OCR | `lib/alt-text/ocr-*.ts` | eng/hin OCR | Scanned sources | Call as a service step | INTEGRATE (I3) | P3 | C6 |
| AI provider + credits | `lib/ai/*` | Metered AI | Assisted extraction | Meter with `sourceModule: "conversion.epub"` | INTEGRATE (I4) | P2 | — |
| Accessibility settings | `lib/alt-text/accessibility-settings.ts`, `accessibility-settings-workspace.tsx` | Alt Text a11y settings | EPUB a11y profile | Pattern for EPUB a11y settings | EXTEND (E18) | P1 | C11 |
| Review UI | `document-review-sheet.tsx`, `review-status-badge.tsx` | Alt Text review | Client approval | Pattern for approval sheet | EXTEND (E22, pattern) | P2 | C13 |
| XLSX export | `lib/alt-text/batch-xlsx.ts` (`exceljs`) | Batch XLSX | Validation/compliance report | None | REUSE (R25) | P2 | C8 |
| Mailer | `lib/mailer.ts` | SMTP mail | Delivery notifications | Template + outbound guard | INTEGRATE (I5) | P2 | C13 |
| DB access | `lib/db.ts` | Pooled parameterised SQL | All persistence | None | REUSE (R26) | P0 | — |
| Rate limit | `lib/rate-limit.ts` | In-memory window | Upload/convert APIs | None (scale risk noted) | REUSE (R27) | P1 | — |
| Shared Conversion pages | `CONVERSION_SHARED_PAGES` in `lib/conversion-modules.ts` | Planned | Jobs, Batch Center, File Manager, Downloads, QA Center, History, Profiles & Presets | Build once for all services | CREATE (C14) | P1–P2 | C1, C2 |
| Conversion domain + API | — | — | Projects, jobs, outputs, reports | `lib/conversion/*`, `app/api/conversion/*` (proposed) | CREATE (C1, C2) | P0 | E15, E11 |
| Download route | — (`/api/storage/file/*` URLs built but no route) | — | Deliverables | Conversion-scoped download route using `canDownload()` | CREATE (C3) | P1 | E19 |
| EPUB engine | — | — | OCF/OPF/nav/transform/validate/preview | `lib/conversion/epub/*` (proposed) | CREATE (C4–C9) | P1 | E12 |
| Approvals + audit log | — | — | Approvals, exceptions, delivery trail | Shared tables + service | CREATE (C13) | P1 | C1 |
| Alt Text workspace pages | `app/(workspace)/modules/publishing/alt-text/page.tsx`, `components/publishing/alt-text/*` | Working module | — | Unchanged | NOT APPLICABLE (N1) | — | — |
| Admin users | `app/(workspace)/admin/users/*` | User admin | — | Unchanged | NOT APPLICABLE (N2) | — | — |
| Auth pages | `app/(auth)/*` | Login/reset | — | Unchanged | NOT APPLICABLE (N3) | — | — |
| Root redirect | `app/page.tsx` | → Alt Text | — | Unchanged | NOT APPLICABLE (N4) | — | — |

---

## 7. Step 7 — Navigation and UI integration

| Decision | Detail | Justification |
| --- | --- | --- |
| Navigation location | **Existing** sidebar: Publishing › Conversion › Digital Publishing › **ePub** (`lib/navigation.ts`, generated from `CONVERSION_MODULES`) | Already present; adding anything would duplicate it |
| New menu items | **None** | Duplicate-menu risk R1 |
| Standalone EPUB dashboard | **None**. EPUB Overview = existing `/conversion-name/epub` route | Route already exists |
| EPUB sections | The 10 registered routes: `workspace`, `layout-settings`, `toc-editor`, `css-profiles`, `media-manager`, `metadata`, `accessibility-checks`, `epub-validation`, `reader-preview`, `history` | All already generated by `generateStaticParams` |
| Optional additional section | `guidelines` (and possibly `profiles-presets`) appended to EPUB pages in `lib/conversion-modules.ts` | Required by Step 5; mirrors PDF `pdf-sections.ts` which already declares `guidelines`. Must also fix registry inconsistency R12 for EPUB from the start |
| Cross-service views | Jobs, Batch Center, File Manager, Downloads, QA Center, History, Profiles & Presets stay **shared** pages under `conversion-name/<shared>` | Prevents EPUB-only job/download pages |
| Settings separation | Common settings (file naming, output delivery, guideline toggle) in shared groups; EPUB-specific (version profile, layout, CSS profile, nav depth, metadata, a11y) in EPUB `layout-settings` / `css-profiles` / `metadata` sections | Keeps PDF settings untouched |
| PDF preservation | PDF branch in both dynamic routes unchanged; generalisation uses new wrappers + `Pdf*` re-exports; `test/publishing/pdf-*.test.ts` must stay green | Regression risk R2 |

### 7.1 New routes proposed (with justification)

| Proposed route | Why an existing route cannot serve it |
| --- | --- |
| `app/api/conversion/uploads` (POST) | No conversion upload API exists; Alt Text upload is bound to `alt_text_documents` and must not be widened |
| `app/api/conversion/jobs` (GET/POST), `.../jobs/[jobId]` (GET), `.../jobs/[jobId]/cancel|retry` (POST) | No job API outside Alt Text; one service-parameterised set serves EPUB, PDF and others |
| `app/api/conversion/jobs/[jobId]/outputs/[outputId]` (GET download) | Download proxy `/api/storage/file/*` is referenced but absent; a conversion-scoped route applies `canDownload()` and tenant checks |
| `app/api/conversion/jobs/[jobId]/reports/[reportId]` (GET) | Validation/compliance reports are new artefacts |
| `app/api/conversion/guidelines` (+ `[guidelineId]`) | Shared guideline service has no API |
| EPUB preview content route on an isolated origin or sandboxed path, e.g. `app/api/conversion/preview/[jobId]/[...path]` | Untrusted XHTML must be served with a strict CSP and without same-origin privileges; no existing route does this |

No new **page** routes are proposed — all EPUB pages already exist as registered routes.

---

## 8. Step 8 — Database and API mapping

Existing tables (verified, P1-T01 §H.1): `users`, `app_sessions`, `password_resets`, `app_files`, `app_file_blobs`, `ai_credit_*`, `platform_background_jobs`, `platform_background_job_events`, `alt_text_*`. No `conversion_*`, `epub_*`, `guideline_*`, `audit_*` tables.

| Entity | Reuse | Proposed (not migrated) | Justification |
| --- | --- | --- | --- |
| Users / tenants | `users`, tenant id from session | — | Do not duplicate |
| Conversion projects | — | `conversion_projects` (tenant_id, service, title, client_ref, status, created_by) | Alt Text projects are module-specific; shared table serves all services |
| Conversion jobs | `platform_background_jobs` for execution | `conversion_jobs` (project_id, service=`epub`, source_format, target_format, profile_id, guideline_set_id, status, background_job_id, revision) | Business state (revision, approval) must outlive queue rows; queue stays the executor |
| Source files | `app_files` + `app_file_blobs` | link table `conversion_job_files` (job_id, file_id, role=`source|asset|guideline`) | No duplicate file table |
| Output files | `app_files` | `conversion_outputs` (job_id, file_id, format, epub_version, checksum, validation_status) | Outputs need validation state |
| EPUB version profiles | `PDF_DEFAULT_PROFILES` pattern | `conversion_profiles` (service, key, version, settings_json, is_default, is_system) | Shared presets table (also feeds Profiles & Presets page) |
| EPUB formatting settings | — | stored in `conversion_profiles.settings_json` + per-job override `conversion_jobs.settings_json` | No separate EPUB settings table needed |
| Client guidelines | `guideline-contracts.ts` types | `guideline_documents`, `guideline_rules`, `guideline_mappings` (scope area/service) | Shared, service-agnostic |
| Validation reports | Alt Text output-validation record shape | `conversion_reports` (job_id, kind=`structural|epubcheck|accessibility|guideline`, verdict, findings_json, file_id) | One table for all report kinds |
| QA results | — | rows in `conversion_reports` (`kind='qa'`) | Avoids a separate QA table |
| Revisions | — | `conversion_jobs.revision` + `parent_job_id` | Revision = new job linked to parent; no extra table |
| Approval history | — | `conversion_approvals` (job_id, kind=`client|exception`, decision, actor, reason) | Required by Step 5 #10 |
| Processing logs | `platform_background_job_events` | — | REUSE |
| Delivery records | — | `conversion_deliveries` (output_id, channel, recipient, status) | Tracks client delivery |
| Audit log | — | `platform_audit_log` (tenant_id, actor, action, entity, entity_id, data_json) | Generic, reused by all modules |

API style follows existing conventions: session/tenant gate, `Cache-Control: private, no-store`, parameterised SQL, tenant filter on every query, idempotency key on job create.

---

## 9. Step 9 — Security and compatibility assessment

| Area | Existing control | Risk for EPUB | Required mitigation |
| --- | --- | --- | --- |
| Tenant isolation | `tenant-scope.ts`, `tenant-context.ts`, `t/<tenantId>/` keys, tenant-filtered SQL | Job handlers lose context | Run every handler via `runWithTenant`; tenant id in every conversion query |
| File-access permissions | Session gate; stub permissions | Any user in tenant could approve/deliver | Action grants (E16) before approval/delivery ship |
| Malicious files | MZ/ELF reject, signature scan, fail-closed download gate | No AV; `app_files.scan_status='clean'` hard-coded | Conversion files start `pending`; scan provider hook; outputs gated by `canDownload()` |
| XML / ZIP safety | Bounded ZIP reader (5000 entries, 250 MiB, ratio 200, ZIP64/encryption reject); DOCTYPE/ENTITY reject | Valid EPUB XHTML has `<!DOCTYPE html>`; EPUB 2 uses public DTDs | OCF profile: allow known doctypes, reject internal subsets and `<!ENTITY`; never resolve external DTDs |
| EPUB active content | Upload blocks `.html/.svg/.js` | Scripts, event handlers, forms, iframes, `javascript:` URLs, remote resources inside EPUB | Sanitiser + policy (C7); scripted content opt-in only; report `remote-resources` |
| Preview XSS | none | Untrusted XHTML in app origin | Sandboxed iframe without `allow-same-origin`, separate route with strict CSP, no cookies |
| Job queue isolation | Per-tenant limits, payload caps | Large books monopolise runner | Per-type caps for `conversion.epub.*`; chunked steps; timeouts |
| Data retention | none | Confidential manuscripts kept indefinitely | Retention policy per tenant; purge job; delete blobs on job delete |
| Confidential manuscripts | private classification, fail-closed downloads | AI steps send content externally | AI steps opt-in per job/tenant, metered and logged; no training use |
| API compatibility | Alt Text routes | Shared upload extraction could alter Alt Text responses | Extract via adapter; Alt Text tests must pass unchanged |
| Backward compatibility | PDF UI tests | Generalising shell | Additive wrappers; keep exports; run `test/publishing` |
| Accessibility | UI primitives, status never colour-only | Reader preview and editors | WCAG 2.2 AA for all EPUB UI; EPUB Accessibility 1.1 for outputs |
| Multilingual | OCR eng/hin | Font shaping, RTL, mixed scripts | `xml:lang` per element, font embedding licence checks, Devanagari/RTL fixtures |

---

## 10. Summary

- Frontend: 20 capability areas mapped across 10 page routes and 61 component files (28 conversion, 20 UI primitives, 2 enterprise, 3 shell, 8 Alt Text pattern files).
- Backend: 20 service areas reviewed; 17 present (3 partial), 1 absent.
- Decisions (see reuse matrix for itemised list): **28 REUSE · 23 EXTEND · 7 INTEGRATE · 16 CREATE · 4 NOT APPLICABLE** (78 items).
- No new navigation item or page route; only new **API** routes and **library** modules, each justified in §7.1 and the dependency plan.
