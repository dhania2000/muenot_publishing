# EPUB Conversion — P1-T01 Existing Website & Codebase Audit

| Field | Value |
| --- | --- |
| Project | Muenot Publishing (`service.muenot.co.in`) |
| Module | Publishing Services › Conversion › ePub |
| Roadmap item | Phase 1, Task P1-T01 — Existing Website & Codebase Audit |
| Repository | `dhania2000/muenot_publishing`, branch `main` |
| Audited commit | `bd52b31` (Merge PR #65 `v0/alt-text-ui-polish`) |
| Audit date | 2026-10-25 |
| Nature of task | **Audit and documentation only. No frontend, backend, API, schema, dependency or configuration change was made.** |

Evidence convention: every finding cites the file(s) it is based on. Statements prefixed **Not verified** could not be confirmed from code in this repository. "Planned" means the code registers a label/route but no working functionality.

---

## A. Repository and framework overview

| Aspect | Finding | Evidence |
| --- | --- | --- |
| Framework | Next.js `16.3.8`, App Router, React 19, TypeScript `5.7.3` | `package.json`, `tsconfig.json`, `app/` |
| Styling / UI kit | Tailwind CSS v4 (`@tailwindcss/postcss`), shadcn-style primitives in `components/ui/*`, `@base-ui/react`, `@radix-ui/react-alert-dialog`, `lucide-react`, `sonner` toasts | `package.json`, `components.json`, `components/ui/` |
| Data fetching | `swr` installed and used by Alt Text hooks | `package.json`, `components/publishing/alt-text/use-*.ts` |
| Database | MySQL via `mysql2/promise` pool from `DATABASE_URL`; raw parameterised SQL, no ORM | `lib/db.ts` |
| Schema management | Runtime `CREATE TABLE IF NOT EXISTS` (`ensurePlatformSchema`, `ensureBackgroundJobSchema`) plus additive SQL files | `lib/platform-schema.ts`, `lib/background-jobs.ts`, `database/migrations/*.sql` |
| Auth | Custom email/password: scrypt hashing, DB-backed sessions (`app_sessions`), `publishing_session` httpOnly cookie, 14-day expiry | `lib/auth.ts`, `app/(auth)/*` |
| Background work | MySQL-backed durable job queue with row-lock claiming, timeouts, retry/backoff, dead-letter, cancellation, events; drained by Vercel Cron `/api/jobs/run` | `lib/background-jobs.ts`, `lib/job-retry-policy.ts`, `lib/observability/job-limits.ts`, `app/api/jobs/run/route.ts`, `vercel.json` |
| AI | `ai` SDK `7.0.113`, provider resolution + AI credit ledger | `lib/ai/*`, `lib/platform-schema.ts` (`ai_credit_*`) |
| OCR | `tesseract.js` 7 with bundled `eng` and `hin` packs | `package.json`, `next.config.mjs`, `lib/alt-text/ocr-*.ts` |
| Document libs | `pdf-lib` (PDF), `fast-xml-parser` (XML validation/parsing), `exceljs` (XLSX export); ZIP handled by hand-written readers on `node:zlib` | `package.json`, `lib/alt-text/document-validation.ts`, `lib/alt-text/ooxml-zip-rewrite.ts` |
| Tests | Vitest; 43 files in `test/alt-text`, 12 in `test/publishing` (6 PDF UI tests) | `vitest.config.mts`, `test/` |
| Deployment | `output: 'standalone'` for Hostinger; security headers set in `next.config.mjs` (nosniff, Referrer-Policy, HSTS, `X-Frame-Options: SAMEORIGIN`, Permissions-Policy) | `next.config.mjs`, `scripts/prepare-standalone.mjs`, `hostinger.env.example` |
| Provenance | Repo is an extraction of the Muenot ERP Publishing module. README states it "is NOT a standalone deployable application" and still depends on ERP contracts; `_erp-shared/` holds reference copies | `README.md`, `_erp-shared/`, `publishing-extraction-manifest.json` |

Note: the README describes an earlier extraction snapshot (e.g. "2 pages", "23 components"). The current code has grown well beyond that (Conversion module, PDF UI, guidelines contracts, OCR). The README is therefore partly out of date; code was treated as the source of truth.

---

## B. Existing routes / pages inventory

### B.1 Pages

| Route | File | Status |
| --- | --- | --- |
| `/` | `app/page.tsx` | Redirects to `/modules/publishing/alt-text` |
| `/login`, `/reset-password` | `app/(auth)/login/page.tsx`, `app/(auth)/reset-password/page.tsx`, `app/(auth)/actions.ts` | Working |
| Workspace layout (auth guard + shell) | `app/(workspace)/layout.tsx` | Redirects to `/login` without session |
| `/modules` | `app/(workspace)/modules/page.tsx` | Working |
| `/modules/publishing` | `app/(workspace)/modules/publishing/page.tsx` | Working |
| `/modules/publishing/alt-text` | `app/(workspace)/modules/publishing/alt-text/page.tsx` | **Working, full backend** |
| `/modules/publishing/conversion-name` (Conversion Dashboard) | `app/(workspace)/modules/publishing/conversion-name/page.tsx` | Service grid only |
| `/modules/publishing/conversion-name/[submodule]` | `.../conversion-name/[submodule]/page.tsx` | PDF → `PdfOverview`; shared pages and all other modules (incl. **epub**) → `PlannedPage` "Coming soon" |
| `/modules/publishing/conversion-name/[submodule]/[page]` | `.../conversion-name/[submodule]/[page]/page.tsx` | PDF `workspace` → `PdfWorkspace`; other PDF sections → `PdfSectionPage` shell; all other modules → `PlannedPage` |
| `/admin/users` | `app/(workspace)/admin/users/page.tsx`, `actions.ts` | Working (admin) |

### B.2 ePub routes that already exist (registered, planned only)

Generated from `CONVERSION_MODULES` in `lib/conversion-modules.ts` (lines ~229–247) via `generateStaticParams`:

- `/modules/publishing/conversion-name/epub` (overview, "Coming soon")
- `/modules/publishing/conversion-name/epub/{workspace, layout-settings, toc-editor, css-profiles, media-manager, metadata, accessibility-checks, epub-validation, reader-preview, history}`

These routes and sidebar entries already exist; **no new navigation entry is needed for EPUB.**

### B.3 Shared Conversion pages (all "Coming soon" except `services`)

`services`, `jobs`, `batch-center`, `file-manager`, `profiles-presets`, `format-library`, `qa-center`, `history`, `downloads`, `reports`, `settings` — `CONVERSION_SHARED_PAGES` in `lib/conversion-modules.ts`.

### B.4 API routes

| Area | Routes | Evidence |
| --- | --- | --- |
| Alt Text (≈46 handlers) | `assets/*`, `batches/*` (submit, pause, resume, cancel, retry, progress, export, credits), `documents/*` (upload, extract, process, generate, review, export, validation, history, context, original), `export`, `generate`, `settings`, `upload` | `app/api/alt-text/**/route.ts` |
| Jobs | `GET /api/jobs/run` (Bearer `CRON_SECRET`) | `app/api/jobs/run/route.ts` |
| Health | `GET /api/health` | `app/api/health/route.ts` |
| Conversion / PDF / EPUB | **None** | No `app/api/conversion*`, `app/api/pdf*`, `app/api/epub*` |
| Storage download proxy | **Missing.** `lib/storage/index.ts` returns URLs of the form `/api/storage/file/<key>`, but `app/api/storage/` does not exist | `lib/storage/index.ts`, directory listing |

---

## C. Existing shared UI component inventory

| Group | Components | Path |
| --- | --- | --- |
| Primitives | alert, alert-dialog, as-child, badge, button, card, dropdown-menu, empty, input, label, progress, select, separator, sheet, skeleton, spinner, table, tabs, textarea, tooltip | `components/ui/*` |
| Enterprise | `PageHeader` (title, description, icon, breadcrumbs), `DataState` | `components/enterprise/page-header.tsx`, `components/enterprise/data-state.tsx` |
| Shell / nav | `AppShell`, `SidebarNav` (sectioned children), `SidebarMenu` (category menus) | `components/shell/*`, `lib/navigation.ts` |
| Business-line guard | `guardBusinessLine("publishing")` | `components/business-line/business-line-landing.tsx` |
| Conversion nav | `ConversionServiceGrid`, `ConversionSharedTabs`, `ConversionModuleTabs`, `PlannedPage`, `PUBLISHING_CRUMBS`, `CONVERSION_CRUMB` | `components/publishing/conversion/conversion-nav.tsx` |
| PDF module shell | `PdfSectionPage`, `PdfModuleLayout`, `PdfSectionNavigation` (overflow + mobile selector), header config/actions/more-menu | `components/publishing/conversion/pdf/pdf-section-page.tsx`, `pdf-module-layout.tsx`, `pdf-section-navigation.tsx`, `pdf-header-*.ts(x)` |
| PDF content primitives | section/panel/info card/split/three-panel grid | `pdf-content.tsx` |
| Files / upload UI | dropzone (source or guidelines), file card, file list, metadata list, file action menu | `pdf-file-components.tsx` |
| Preview UI | generic toolbar (arrow-key nav, overflow), preview toolbar, mode selector, container states, thumbnail | `pdf-preview-components.tsx` |
| Settings UI | collapsible group, labelled field w/ help tooltip, format selector, profile selector, summary | `pdf-settings-components.tsx` |
| Processing / QA UI | action feedback, progress, messages, log, validation summary, severity indicator, finding item, checklist | `pdf-processing-components.tsx` |
| Status | `PdfStatusIndicator` (icon + text, never colour only) | `pdf-capability-status.tsx` |
| Dialogs | confirm (destructive/unsaved), error details, file information | `pdf-dialogs.tsx` |
| Feedback | empty/loading/error presets | `pdf-feedback-state.tsx` |
| Guidelines UI | rule mapping summary, conflict indicator/panel, compliance summary | `pdf-guidelines-components.tsx` |
| Format matrix | searchable/filterable capability matrix (table on desktop, cards on mobile) | `pdf-format-matrix.tsx`, `pdf-format-matrix-model.ts` |
| Workspace | stepper, toolbar, Source / Preview / Settings / Processing regions | `pdf-workspace.tsx`, `pdf-workspace-panels.tsx`, `pdf-workspace-config.ts` |
| Alt Text (working, backend-bound) | document upload status, processing workspace, live processing, batch progress dashboard, batch control/retry/export, history sheets, review UI, output validation panel, accessibility settings | `components/publishing/alt-text/*` |

Observation: the PDF components are generic in behaviour but **PDF-named** (`Pdf*` prefix, `pdf/` folder). They are the strongest UI reuse candidates but are not yet a module-agnostic library.

---

## D. Existing conversion services and workflow inventory

| Capability | Implemented? | Evidence |
| --- | --- | --- |
| Conversion module registry (24 services, 6 categories, per-service pages) | Yes (configuration only) | `lib/conversion-modules.ts` |
| PDF Conversion UI (Overview, Workspace, 12-section shell, capability registry, format matrix) | UI only | `components/publishing/conversion/pdf/*` |
| PDF Conversion engine / API / persistence | **No** | `pdf-capabilities.ts` header: "no PDF conversion route, uploader or engine"; no conversion API routes; no `fetch`/`useSWR` in `components/publishing/conversion/` |
| Word, PowerPoint, Spreadsheets, XML, HTML, ePub, Kindle, DTP, OCR, etc. as conversion services | **No** — "Coming soon" | `[submodule]/page.tsx`, `[page]/page.tsx` |
| Document upload (PDF/DOCX/PPTX) with structural validation, quota, dedupe, rate limit | Yes — **Alt Text only** | `app/api/alt-text/documents/upload/route.ts`, `lib/alt-text/document-upload.ts`, `lib/alt-text/document-validation.ts` |
| Document extraction (PDF, DOCX, PPTX images + context) | Yes — Alt Text | `lib/alt-text/pdf-extractor.ts`, `pptx-extractor.ts`, `docx-context.ts`, `document-extraction*.ts` |
| Write-back into source package (DOCX/PPTX alt text, PDF remediation) | Yes — Alt Text | `docx-alt-text-inserter.ts`, `pptx-alt-text-inserter.ts`, `pdf-alt-text-remediator.ts`, `ooxml-zip-rewrite.ts` |
| Output validation of produced files | Yes — Alt Text (OOXML/PDF) | `lib/alt-text/output-validation*.ts`, `.../exports/[outputId]/validation/route.ts` |
| OCR (eng, hin, eng+hin) | Yes — Alt Text image OCR | `lib/alt-text/ocr-contract.ts`, `ocr-engine.ts`, `ocr-service.ts` |
| Bulk jobs (batch submit/pause/resume/cancel/retry, progress, XLSX export) | Yes — Alt Text | `lib/alt-text/batch-*.ts`, `app/api/alt-text/batches/**` |
| Previews | Alt Text image preview; PDF preview is UI shell only | `lib/alt-text/preview.ts`, `pdf-preview-components.tsx` |
| Downloads / client deliverables | Alt Text exports (`documents/[uploadId]/exports/[outputId]`, batch export); no generic Downloads page | routes above; `CONVERSION_SHARED_PAGES.downloads` is planned |
| HTML conversion | **No** | — |
| XML conversion (JATS/XSLT/schema) | **No** (only `fast-xml-parser` validation used by Alt Text) | `docx-alt-text-inserter.ts`, `output-validation.ts` |

---

## E. Current EPUB support and evidence

Repository-wide search for `epub|EPUB|Epub|epubcheck|.opf|ncx|media overlay|DAISY` (excluding lockfile/docs) returned only:

| Hit | File | Meaning |
| --- | --- | --- |
| `slug: "epub"` module with 10 planned pages | `lib/conversion-modules.ts` | Navigation/registry only |
| `"to-epub"` "PDF to ePub" capability, limitations "Only reflowable output is planned; fixed-layout ePub is not registered." | `components/publishing/conversion/pdf/pdf-capabilities.ts` (~line 219) | Static, status not "available" |
| `ePub` format entry, ext `epub`, MIME `application/epub+zip`, note "Reflowable output is planned…" | `components/publishing/conversion/pdf/pdf-formats.ts` (~line 70) | Format reference only |
| "ePub Accessibility" menu entry without `href` | `lib/navigation.ts` (`ACCESSIBILITY_SERVICES_MENU`) | Listed, not navigable |
| "Produce DAISY…" description | `lib/conversion-modules.ts` (accessible-formats) | Unrelated planned module |

| EPUB capability | Status |
| --- | --- |
| EPUB parsing / reading (OCF container, OPF, spine, manifest) | **MISSING** |
| EPUB packaging (mimetype-first stored entry, `META-INF/container.xml`, OPF, nav.xhtml, NCX) | **MISSING** |
| Export / download of `.epub` | **MISSING** |
| EPUBCheck or any EPUB validator | **MISSING** (no Java runtime, no dependency) |
| Metadata (Dublin Core, ONIX mapping) | **MISSING** |
| Formatting / CSS profiles | **MISSING** |
| Media overlays (SMIL) | **MISSING** |
| EPUB Accessibility 1.1 / WCAG metadata, Ace-style checks | **MISSING** |
| Fixed-layout | **MISSING** (explicitly "not registered") |
| `.epub` accepted by uploads | **No** — `getUploadLimits()` allows `png, jpg, jpeg, webp, gif, pdf, pptx, docx` only | `lib/settings/uploads.ts` |

**Conclusion: there is no functional EPUB code in the repository. Only registry entries, routes rendering "Coming soon", and descriptive metadata exist.**

---

## F. Existing PDF Conversion → EPUB reuse assessment

What PDF actually provides today (verified): a configuration-driven 12-section UI shell, a workspace with a local (browser-only) file model, settings/guidelines/processing/validation UI primitives, a capability registry with honest statuses, and six UI tests. It provides **no** engine, upload API, persistence, jobs or downloads.

| PDF asset | File | Reuse for EPUB | Regression risk & mitigation |
| --- | --- | --- | --- |
| Section registry pattern (order, labels, header copy, layout, status) | `pdf-sections.ts` | EXTEND — create an equivalent EPUB registry following the same shape | None if a parallel registry is added; do not edit PDF's |
| Section page shell | `pdf-section-page.tsx`, `pdf-module-layout.tsx`, `pdf-section-navigation.tsx` | EXTEND — generalise into a module-agnostic shell (or parameterise by section registry) | Medium: PDF tests (`test/publishing/pdf-*.test.ts`) must stay green; generalise via new wrapper, keep `Pdf*` exports as aliases |
| Header config / actions / more menu | `pdf-header-config.ts`, `pdf-header-actions.tsx`, `pdf-header-more-menu.tsx` | EXTEND (config is PDF-specific; renderer is generic) | Low |
| Content, file, preview, settings, processing, dialog, feedback, status components | `pdf-content.tsx`, `pdf-file-components.tsx`, `pdf-preview-components.tsx`, `pdf-settings-components.tsx`, `pdf-processing-components.tsx`, `pdf-dialogs.tsx`, `pdf-feedback-state.tsx`, `pdf-capability-status.tsx` | REUSE as-is initially; later move to a shared `conversion/shared/` folder with PDF re-exports | Low if import paths for PDF are preserved |
| Status model (processing, progress, validation, evidence-required passes) | `pdf-status-model.ts` | REUSE | Low |
| Guidelines UI | `pdf-guidelines-components.tsx` | REUSE (built on shared `lib/guidelines`) | Low |
| Guideline category registry | `pdf-guideline-categories.ts` | EXTEND — EPUB needs its own categories (metadata, navigation, CSS, accessibility, media) | None |
| Capability registry + format matrix | `pdf-capabilities.ts`, `pdf-format-matrix*.ts(x)`, `pdf-formats.ts` | EXTEND — EPUB capability set (DOCX→EPUB, HTML→EPUB, EPUB→EPUB remediation, PDF→EPUB) | None if separate registry; `to-epub` entry in PDF must stay consistent with the EPUB engine status |
| Workspace config (steps, local file model, settings groups, guideline state) | `pdf-workspace-config.ts`, `pdf-workspace*.tsx` | EXTEND — same step model (upload → configure → guidelines → preview → validate → export) | Medium: local-only file model must be replaced with server upload for EPUB without changing PDF behaviour |
| Default profile | `PDF_DEFAULT_PROFILES` (`standard`) in `pdf-status-model.ts` | EXTEND — EPUB "approved default publishing profile" | None |

Route integration point: the EPUB branch would be added beside the existing `service.slug === "pdf"` branches in `[submodule]/page.tsx` and `[submodule]/[page]/page.tsx` — additive, PDF branch untouched.

---

## G. Client guidelines and compliance infrastructure

| Item | Status | Evidence |
| --- | --- | --- |
| Service-independent contracts: documents, versioned profiles, rules, mappings, conflicts, exceptions, compliance results, 4 separate status models, priority levels (job › company › preset › standard), non-overridable constraints, verification layers | **Exists (pure types + aggregation)** | `lib/guidelines/guideline-contracts.ts` |
| `assessGuidelineCompliance()` — verdict requires evidenced pass or approved exception; no guidelines ⇒ "Not applicable" (Scenario A) | Exists | same file; `test/publishing/pdf-guidelines.test.ts` |
| `GuidelineServiceScope` supports `{ area: "conversion", service: "epub" }` | Usable as-is | same file |
| Guidelines UI (summary, mapping, conflicts, compliance) | Exists (PDF-named) | `pdf-guidelines-components.tsx` |
| Guidelines upload UI (dropzone variant) | Exists, browser-only | `pdf-file-components.tsx`, `pdf-workspace-config.ts` (`deriveGuidelineState`) |
| Guideline document storage / API | **MISSING** | no route, no table |
| Guideline parsing / rule extraction | **MISSING** (file header: "Nothing here parses, interprets, maps or enforces guidelines. Those arrive in Phase 6") | `guideline-contracts.ts` |
| Rule → setting resolver / enforcement | **MISSING** (only `GuidelineResolutionOutcome` type) | same |
| Approvals workflow for exceptions | **MISSING** (type only) | same |
| Guidelines section page for PDF | Planned (`status: "planned"`, not in `CONVERSION_MODULES.pdf.pages`, so rendered non-navigable) | `pdf-sections.ts`, `lib/conversion-modules.ts`, `pdf-section-page.tsx` |
| Architecture doc | Exists | `PDF_PHASE1_TASK9_GUIDELINES_ARCHITECTURE.md` |

Fit for the EPUB requirement ("optional guidelines; none ⇒ approved default profile; supplied ⇒ assessed, applied, verified"): the **contract layer already encodes exactly this rule**. Storage, parsing, resolution, verification and approval services are missing and must be built once, service-agnostically, not inside EPUB.

---

## H. Database, API, security and storage assessment

### H.1 Database tables (verified)

| Table | Source |
| --- | --- |
| `users`, `password_resets`, `app_sessions` | `lib/platform-schema.ts`, `database/migrations/2026-10-10-*.sql`, `2026-10-12-*.sql` |
| `app_file_blobs` (file bytes in MySQL), `app_files` (metadata: module, entity, checksum, classification, scan_status) | `lib/platform-schema.ts`, `lib/storage/*` |
| `ai_credit_reservations`, `ai_credit_ledger` | `lib/platform-schema.ts` |
| `platform_background_jobs`, `platform_background_job_events` | `lib/background-jobs.ts` (`ensureBackgroundJobSchema`) |
| `alt_text_projects`, `alt_text_assets`, `alt_text_versions`, `alt_text_exports`, `alt_text_settings`, `alt_text_batches`, `alt_text_documents`, `alt_text_document_images`, `alt_text_ocr_results`, `alt_text_region_analyses` (+ review/context columns) | `database/migrations/2026-10-11` … `2026-10-24-*.sql` |
| Any `conversion_*`, `pdf_*`, `epub_*`, `guideline_*` table | **None** |
| Generic audit log table | **None** (no `audit_log`/`recordAudit` found). Job events table is the only durable event trail |

### H.2 Jobs, retry, status, errors

- Job types are a closed list: `BACKGROUND_JOB_TYPES = ["alt_text.batch_processing", "alt_text.document_preparation"]` — an EPUB job type must be **added** to this union (`lib/background-jobs.ts`).
- Retry classification (`transient | permanent | uncertain`), `JobCancelledError`, `JobDeferredError`, dead-letter disposition: `lib/job-retry-policy.ts`.
- Per-tenant pending/running limits, payload size cap, global running caps: `lib/observability/job-limits.ts`.
- Idempotency key per `(job_type, tenant_id)`: `enqueueBackgroundJobInTransaction`.
- Draining: only by daily Vercel Cron (`vercel.json` schedule `0 3 * * *`) or explicit triggers — **Not verified** how Alt Text triggers immediate processing on Hostinger; daily cron alone is insufficient for interactive conversion latency.

### H.3 API conventions

- Session gate: `requireFeatureInModule()` (`lib/api-auth.ts`) — standalone stub, always enabled for signed-in users.
- Alt Text gate with permissions + `Cache-Control: private, no-store` JSON helpers: `lib/alt-text/route-gate.ts` (pattern to mirror, but Alt-Text-specific).
- Rate limiting: in-memory fixed window per instance (`lib/rate-limit.ts`) — not shared across instances.

### H.4 Security

| Concern | Existing control | Evidence | EPUB gap |
| --- | --- | --- | --- |
| Tenant isolation | AsyncLocalStorage tenant scope bound from session; `runForTenant` for jobs; storage keys `t/<tenantId>/…`, `keyBelongsToTenant` on download; every storage query filters `tenant_id` | `lib/tenant-scope.ts`, `lib/auth.ts`, `lib/storage/keys.ts`, `lib/storage/index.ts` | REUSE |
| Path traversal in storage keys | `sanitizePath` removes `.`/`..` | `lib/storage/keys.ts` | REUSE |
| ZIP bombs / malformed ZIP | Bounded central-directory reader: max 5000 entries, 250 MiB uncompressed, ratio 200, ZIP64 rejected, encrypted rejected, overlap/duplicate checks, unsafe entry names | `lib/alt-text/document-validation.ts`, `DOCUMENT_ARCHIVE_LIMITS` in `document-upload-contract.ts` | EXTEND — currently OOXML-profiled (requires `[Content_Types].xml`); EPUB needs an OCF profile (`mimetype` first & stored, `META-INF/container.xml`) |
| XXE / entity expansion | Rejects `<!DOCTYPE`/`<!ENTITY` in inspected XML | `document-validation.ts`, `docx-alt-text-inserter.ts`, `media-format.ts` | **Conflict**: EPUB 3 XHTML legitimately starts with `<!DOCTYPE html>`; EPUB 2 uses DTD doctypes. A blanket DOCTYPE reject would refuse valid EPUBs — needs an allow-list for the HTML5/known public doctypes while still rejecting `<!ENTITY` and internal subsets |
| Remote/external resources | Rejects remote templates/OLE; external targets limited to `http(s):`, `mailto:`, `#` | `document-validation.ts` | EXTEND — EPUB remote resources (`properties="remote-resources"`), `<script>`, forms, `<iframe>`, `javascript:` URLs need explicit policy |
| Active content in HTML/SVG | Upload blocks `.html/.htm/.svg/.js` extensions; SVG inspection rejects DOCTYPE/ENTITY | `lib/settings/uploads.ts`, `lib/alt-text/media-format.ts` | MISSING — XHTML/SVG sanitisation inside EPUB (scripts, event handlers) |
| Executable uploads | MZ/ELF magic-byte reject | `lib/settings/uploads.ts` | REUSE |
| Malware scanning | Only byte-signature checks; `app_files.scan_status` is inserted as `'clean'` unconditionally | `lib/storage/index.ts` | Risk: no AV scan; "clean" is not evidence of a scan |
| Quota | `STORAGE_QUOTA_GB` per tenant | `lib/storage/storage-quota.ts` | REUSE |
| Permissions | `permission-store.ts` returns `"all"` for every resource; only `manage_settings` admin-only | `lib/permission-store.ts` | Risk: no real role/action model for EPUB approve/deliver actions |
| Preview rendering of untrusted XHTML | None | — | MISSING — must render in sandboxed iframe / separate origin with strict CSP |
| CSP | Not set (only other headers) | `next.config.mjs` | Recommend Report-Only CSP for preview routes |

### H.5 Storage

File bytes live in MySQL (`app_file_blobs.body`). Suitable for documents ≤ `MAX_UPLOAD_MB` (default 50 MB). EPUBs with heavy media and generated outputs will increase DB size; acceptable for Phase 1–2 but should be reviewed (**risk J-R6**). The download proxy route referenced by `uploadFile()` (`/api/storage/file/...`) is absent; Alt Text serves files through its own routes (`documents/[uploadId]/original`, `exports/[outputId]`).

---

## I. Existing page / component / service → EPUB improvement mapping

Legend: **REUSE** use unchanged · **EXTEND** add EPUB-specific variant/config next to existing code · **INTEGRATE** wire EPUB into an existing shared mechanism · **MISSING** must be built · **N/A** not applicable.

| # | Existing asset | Path | EPUB use | Decision |
| --- | --- | --- | --- | --- |
| 1 | Conversion registry `epub` module + 10 pages | `lib/conversion-modules.ts` | Route + nav source of truth | REUSE (do not duplicate; adjust page list only if EPUB section registry needs a `guidelines` page) |
| 2 | Sidebar Conversion children (auto-generated) | `lib/navigation.ts` | ePub entry already in "Digital Publishing" | REUSE — no new nav entry |
| 3 | "ePub Accessibility" menu entry (no href) | `lib/navigation.ts` | Future link to EPUB accessibility checks | INTEGRATE (later; separate Accessibility Services decision) |
| 4 | Dynamic routes `[submodule]`, `[submodule]/[page]` | `app/(workspace)/modules/publishing/conversion-name/**` | Add `slug === "epub"` branch | EXTEND |
| 5 | Conversion Dashboard / shared tabs / service grid | `conversion-nav.tsx`, `conversion-name/page.tsx` | EPUB card already listed | REUSE |
| 6 | Shared pages Jobs, Batch Center, File Manager, Downloads, QA Center, History, Profiles & Presets | `CONVERSION_SHARED_PAGES` | Cross-service views must include EPUB jobs | INTEGRATE (build once, shared; not EPUB-only) |
| 7 | PDF section shell, layout, navigation | `pdf-section-page.tsx`, `pdf-module-layout.tsx`, `pdf-section-navigation.tsx` | EPUB section shell | EXTEND (generalise) |
| 8 | PDF header config/actions | `pdf-header-*.ts(x)` | EPUB header copy/actions | EXTEND |
| 9 | Content/file/preview/settings/processing/dialog/feedback/status components | `components/publishing/conversion/pdf/*` | EPUB workspace UI | REUSE |
| 10 | Workspace stepper + panels | `pdf-workspace*.tsx`, `pdf-workspace-config.ts` | EPUB workspace | EXTEND |
| 11 | Capability registry + format matrix | `pdf-capabilities.ts`, `pdf-format-matrix*.ts(x)`, `pdf-formats.ts` | EPUB capability matrix | EXTEND |
| 12 | `to-epub` PDF capability | `pdf-capabilities.ts` | Keep status aligned with EPUB engine | INTEGRATE |
| 13 | Guideline contracts + compliance assessment | `lib/guidelines/guideline-contracts.ts` | EPUB guidelines (scope `service: "epub"`) | REUSE |
| 14 | Guidelines UI | `pdf-guidelines-components.tsx` | EPUB guidelines panel | REUSE |
| 15 | Guideline categories | `pdf-guideline-categories.ts` | EPUB categories | EXTEND |
| 16 | Default profile | `PDF_DEFAULT_PROFILES` | Approved default EPUB publishing profile | EXTEND |
| 17 | Guideline storage, parsing, resolver, approvals | — | Required for supplied guidelines | MISSING (shared service) |
| 18 | Auth/session/tenant scope | `lib/auth.ts`, `lib/tenant-scope.ts` | All EPUB routes | REUSE |
| 19 | Feature gate | `lib/api-auth.ts` | EPUB API gate | REUSE |
| 20 | Route gate pattern | `lib/alt-text/route-gate.ts` | EPUB API helper | EXTEND (new conversion gate mirroring it) |
| 21 | Permissions | `lib/permission-store.ts` | Approve/deliver actions | EXTEND (currently permissive stub) |
| 22 | Storage (tenant keys, metadata, quota) | `lib/storage/*` | Sources, outputs, reports | REUSE |
| 23 | Storage download proxy `/api/storage/file/*` | — | Downloads | MISSING (or use module routes like Alt Text) |
| 24 | Upload limits/content check | `lib/settings/uploads.ts` | Accept `.epub` (+ `application/epub+zip`) | EXTEND (per-module allow-list; must not widen Alt Text) |
| 25 | Document upload pipeline (validate → hash → dedupe → quota → store → metadata) | `lib/alt-text/document-upload.ts` | Pattern for conversion uploads | EXTEND (extract to shared conversion upload; keep Alt Text behaviour) |
| 26 | Bounded ZIP validator | `lib/alt-text/document-validation.ts` | EPUB/OCF validation | EXTEND (new OCF profile; DOCTYPE policy, see H.4) |
| 27 | ZIP byte-preserving rewriter | `lib/alt-text/ooxml-zip-rewrite.ts` | EPUB remediation (edit parts in place) | REUSE/EXTEND (must keep `mimetype` first and stored) |
| 28 | `fast-xml-parser` validator/parser | `pptx-package.ts`, `output-validation.ts` | OPF/nav/XHTML well-formedness | REUSE |
| 29 | Output validation framework | `lib/alt-text/output-validation*.ts` | Post-export checks record | EXTEND |
| 30 | Background job queue, retry, limits, events | `lib/background-jobs.ts`, `lib/job-retry-policy.ts`, `lib/observability/job-limits.ts` | `conversion.epub` job type | INTEGRATE (add job type) |
| 31 | Cron drain | `app/api/jobs/run/route.ts`, `vercel.json` | Job execution | INTEGRATE (latency risk, J-R5) |
| 32 | Batch control/progress/retry UI + services | `components/publishing/alt-text/batch-*.tsx`, `lib/alt-text/batch-*.ts` | Pattern for Batch Center | EXTEND (pattern only; do not couple EPUB to Alt Text tables) |
| 33 | Alt-text generation & review | `lib/alt-text/*` | Missing image descriptions inside EPUB | INTEGRATE (call Alt Text services for EPUB images) |
| 34 | OCR (eng/hin) | `lib/alt-text/ocr-*.ts` | Scanned-source to EPUB | INTEGRATE (later phase) |
| 35 | Accessibility settings schema | `lib/alt-text/accessibility-settings.ts` | EPUB accessibility profile | EXTEND (pattern) |
| 36 | AI provider + credits | `lib/ai/*` | Optional AI-assisted structuring/alt text | INTEGRATE |
| 37 | XLSX export | `lib/alt-text/batch-xlsx.ts` (`exceljs`) | Validation/compliance report export | REUSE |
| 38 | Mailer | `lib/mailer.ts` | Delivery notifications | INTEGRATE |
| 39 | Audit log | — | Approvals, delivery, guideline decisions | MISSING |
| 40 | EPUB parse / package / nav / OPF metadata / CSS profiles / media overlays / fixed layout / reader preview / EPUBCheck / EPUB Accessibility checks | — | Core EPUB engine | MISSING |
| 41 | Admin users page | `app/(workspace)/admin/users/*` | — | N/A |
| 42 | Login / reset password | `app/(auth)/*` | — | N/A |

---

## J. Feature gaps, dependencies and risks

### J.1 Gaps (MISSING)

1. EPUB engine: OCF reader/writer, OPF generation, `nav.xhtml` + optional NCX, spine/manifest builder, XHTML content transformation, CSS profiles, media handling, metadata (DC/accessibility), fixed-layout, media overlays.
2. Source converters into EPUB (DOCX, HTML, PDF, XML) — none exist (PDF engine is also absent).
3. Validation: EPUBCheck (Java) and EPUB Accessibility 1.1 checks — no runtime or dependency present.
4. Conversion domain persistence: no `conversion_jobs` / outputs / reports tables.
5. Conversion API layer: no routes for upload, job create, status, output, preview, download.
6. Guideline storage, parsing, rule resolution, application, verification, approvals.
7. Safe reader preview (sandboxed rendering of untrusted XHTML).
8. Generic audit log; real permission model.
9. Shared conversion pages (Jobs, Batch Center, Downloads, QA Center, History) are placeholders.

### J.2 Implementation dependencies (order)

1. Shared conversion data model + job type (prerequisite for every service, incl. PDF).
2. Shared conversion upload + OCF validation profile.
3. EPUB packaging core (pure, unit-tested) → validation adapter → preview.
4. Guideline service (shared) before EPUB "supplied guidelines" path; EPUB default-profile path can ship first.
5. Decision on EPUBCheck runtime hosting (Java not available in Node standalone build).

### J.3 Risks

| ID | Risk | Severity | Mitigation |
| --- | --- | --- | --- |
| R1 | **Duplicate-module risk**: building an EPUB-specific upload, job table, dashboard or nav alongside existing ones | High | Use registry (`lib/conversion-modules.ts`), shared job queue, shared storage; generalise PDF shell instead of copying |
| R2 | Regressing PDF UI while generalising `Pdf*` components | Medium | Additive wrappers + re-exports; keep `test/publishing/pdf-*.test.ts` green |
| R3 | Widening global upload allow-list affects Alt Text | Medium | Per-module allow-lists |
| R4 | DOCTYPE blanket rejection vs valid EPUB XHTML | Medium | OCF-specific XML policy: allow known doctypes, reject `<!ENTITY` and internal subsets |
| R5 | Job latency: queue drained daily by cron | High for UX | **Not verified** whether an in-request/worker trigger exists on Hostinger; confirm before EPUB jobs |
| R6 | MySQL blob storage growth from EPUB media/outputs | Medium | Monitor; consider object storage adapter behind `lib/storage` interface |
| R7 | No real AV scan; `scan_status='clean'` written unconditionally | Medium | Treat as unscanned; add scanner hook before client delivery |
| R8 | Permissive permissions stub (`"all"`) | Medium | Introduce action-level grants for approve/deliver |
| R9 | EPUBCheck requires Java | Medium | Separate validation worker/service; until then report "not verified", never "valid" |
| R10 | Untrusted XHTML/SVG/JS in preview (XSS) | High | Sandboxed iframe, no `allow-same-origin`, strict CSP, sanitisation |
| R11 | README out of date vs code; repo marked "not standalone" | Low/Medium | Treat code as truth; confirm deployment target is this repo |
| R12 | PDF `guidelines` and `profiles-presets` sections exist in `pdf-sections.ts` but not in `CONVERSION_MODULES.pdf.pages` (rendered non-navigable) | Low | Keep registries consistent when adding EPUB sections |
| R13 | In-memory rate limiter not shared across instances | Low | Acceptable single-instance; revisit for scale |

---

## K. Recommended implementation architecture (proposed, **not implemented**)

```
Existing nav / registry (lib/conversion-modules.ts: slug "epub")       ← REUSE, no new nav
        │
app/(workspace)/modules/publishing/conversion-name/[submodule]/...     ← add `epub` branch beside `pdf`
        │
components/publishing/conversion/
   shared/            ← generalised section shell + primitives (PDF re-exports kept)
   pdf/               ← unchanged behaviour
   epub/              ← epub-sections.ts, epub-header-config.ts, epub-capabilities.ts,
                         epub-guideline-categories.ts, epub-workspace(-config).tsx
        │
app/api/conversion/   ← shared, service-parameterised routes (upload, jobs, status, outputs,
                         preview, download); gate mirrors lib/alt-text/route-gate.ts
        │
lib/conversion/       ← shared: job model, upload pipeline (from alt-text pattern),
                         output/report records, delivery
lib/conversion/epub/  ← pure engine: ocf-reader, ocf-writer (mimetype first, stored),
                         opf, nav, xhtml transform, css profiles, metadata, a11y metadata,
                         ocf validation profile (extends document-validation limits)
lib/guidelines/       ← existing contracts + NEW shared guideline service
                         (storage, parse, resolve, apply, verify, approvals)
lib/background-jobs.ts← add job type "conversion.epub" (additive union change)
Validation worker     ← EPUBCheck / accessibility checks as external service (Java)
Storage               ← lib/storage (tenant keys) for sources, outputs, reports
```

Workflow (per job): Upload (shared) → OCF/source validation → Profile resolution (no guidelines ⇒ approved default EPUB profile; guidelines ⇒ assess → map → resolve conflicts/exceptions) → Convert/package (background job) → Validate (structural + EPUBCheck + accessibility + guideline verification with evidence) → Preview (sandboxed) → Approve → Deliver/download → History/audit.

Principles: additive changes only; PDF and Alt Text untouched in behaviour; statuses stay honest (`planned` / `ui-ready` until verified end-to-end); a pass without evidence is "not verified" (already enforced by `isVerifiedPass`).

---

## L. Exact file paths supporting important findings

| Finding | Files |
| --- | --- |
| EPUB module registered, planned only | `lib/conversion-modules.ts`; `app/(workspace)/modules/publishing/conversion-name/[submodule]/page.tsx`; `.../[submodule]/[page]/page.tsx` |
| No EPUB engine | repository-wide search (Section E); `package.json` (no EPUB/EPUBCheck dependency) |
| PDF is UI-only | `components/publishing/conversion/pdf/pdf-capabilities.ts` (header note); no `app/api/conversion*`; no `fetch`/`useSWR` under `components/publishing/conversion/` |
| PDF section registry (12 sections) | `components/publishing/conversion/pdf/pdf-sections.ts` |
| PDF → ePub capability & format | `pdf-capabilities.ts`, `pdf-formats.ts` |
| Guidelines contracts | `lib/guidelines/guideline-contracts.ts`; `PDF_PHASE1_TASK9_GUIDELINES_ARCHITECTURE.md`; `test/publishing/pdf-guidelines.test.ts` |
| Default profile | `components/publishing/conversion/pdf/pdf-status-model.ts` (`PDF_DEFAULT_PROFILES`) |
| Upload allow-list excludes EPUB | `lib/settings/uploads.ts` |
| ZIP/XML safety limits | `lib/alt-text/document-validation.ts`; `lib/alt-text/document-upload-contract.ts` |
| ZIP rewrite | `lib/alt-text/ooxml-zip-rewrite.ts` |
| Upload pipeline pattern | `app/api/alt-text/documents/upload/route.ts`; `lib/alt-text/document-upload.ts` |
| Tenant isolation | `lib/tenant-scope.ts`; `lib/auth.ts`; `lib/storage/keys.ts`; `lib/storage/index.ts` |
| Storage in MySQL; scan_status hard-coded | `lib/storage/index.ts`; `lib/platform-schema.ts` |
| Missing storage proxy route | `lib/storage/index.ts` (URL builder); absence of `app/api/storage/` |
| Job queue & closed job types | `lib/background-jobs.ts`; `lib/job-retry-policy.ts`; `lib/observability/job-limits.ts`; `app/api/jobs/run/route.ts`; `vercel.json` |
| Permissions stub | `lib/permission-store.ts`; `lib/api-auth.ts` |
| Navigation (no new entry needed) | `lib/navigation.ts`; `components/shell/sidebar-nav.tsx` |
| OCR languages | `lib/alt-text/ocr-contract.ts` |
| Security headers | `next.config.mjs` |

---

## M. Items that could not be verified

1. **Production website** `service.muenot.co.in` was not inspected; whether it runs this exact commit is unknown.
2. **Live database** state (actual tables/rows, whether migrations were applied) — no DB access during audit.
3. **ERP integration**: README says Publishing still depends on ERP infrastructure; whether the deployed site runs standalone (this repo) or inside the ERP is not verifiable here. `publishing-dependencies.md` and `scripts/publishing-extraction/extract-publishing.mjs`, both referenced by README, are **missing** from the repository.
4. **Job triggering in production** beyond the daily cron (immediate dispatch on Hostinger) — not verified.
5. **Malware scanning provider** — none found; any external scanning is unverified.
6. **Client guideline documents/approved default publishing profile content** — no sample guidelines or approved EPUB profile spec supplied; required input for later tasks.
7. **Target EPUB specification baseline** (EPUB 3.3 vs 3.2, EPUB 2 compatibility, retailer requirements) — not defined in repo.
8. **EPUBCheck hosting** (Java availability on Hostinger) — not verified.
9. Test suite was **not executed** in this task (audit-only); test inventory is from the file system.

---

## N. Acceptance checklist and completion status

| # | Requirement (from P1-T01) | Status |
| --- | --- | --- |
| 1 | Project structure, framework, routes, layouts, nav, deps, config, APIs, services, types, schemas, storage, auth, permissions inspected | Done (A, B, H) |
| 2 | Existing conversion services located (PDF, document, HTML, XML, accessibility, OCR, upload, bulk, validation, previews, downloads, deliverables) | Done (D) |
| 3 | Reusable UI components identified | Done (C) |
| 4 | Existing EPUB functionality identified (evidence-based) | Done — none functional (E) |
| 5 | PDF architecture audited; shareable infra identified without regression | Done (F) |
| 6 | Client guidelines upload/parsing/rules/approvals/compliance checked | Done (G) |
| 7 | Job models, queues, retry, status, errors, audit logs, storage, delivery | Done (H.2, H.5, J) |
| 8 | Security for EPUB/ZIP, XML, HTML, uploads, external resources, paths, tenant isolation | Done (H.4) |
| 9 | Accessibility, multilingual and validation infrastructure | Done (D, H, I #33–35; OCR eng/hin; `<html lang="en">` in `app/layout.tsx`, no i18n framework) |
| 10 | Component/Page/Service → EPUB mapping with REUSE/EXTEND/INTEGRATE/MISSING/N/A | Done (I) |
| 11 | Gaps, risks, duplicate-module risks, constraints, dependencies | Done (J) |
| 12 | No separate EPUB app / nav / upload / dashboard / services created | Complied |
| 13 | No changes to frontend, backend, APIs, schemas, deps, config | Complied — only this document added |
| 14 | Missing inputs reported, nothing invented | Done (M) |

**Completion status: P1-T01 COMPLETE** — evidence-backed audit report exists at `docs/epub-conversion/P1-T01-existing-system-audit.md`. No implementation changes were made.
