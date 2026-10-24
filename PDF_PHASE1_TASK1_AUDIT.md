# Muenot Publishing — PDF Module
## Phase 1 · Task 1 — Complete Codebase & Functionality Audit

| Item | Value |
| --- | --- |
| Repository | `dhania2000/muenot_publishing` (branch `main`, HEAD `ee7c154`) |
| Module | Publishing → Conversion → PDF |
| Audit date | 2026-10-24 |
| Scope | Audit only. No source code, routes, config, dependencies or database were modified. |
| Report location | Repository root (no `docs/` folder exists in the repo). |

**Status legend:** Fully Working · Partially Working · UI Only · Missing · Defective · Not Verified

**Headline finding:** The PDF module today is a **navigation shell only**. Its overview and its 9 internal tabs all render a shared "Coming soon" empty state. **No PDF conversion or PDF manipulation operation exists in the module.** But the repository does contain a hardened, tested **PDF reading engine** (structure, image, text and tag parsing), upload/validation/storage, a durable job queue and history patterns. All of these were built for the **Alt Text** module (`lib/alt-text/*`), and the PDF module should reuse them rather than duplicate them.

---

## Section 1 — Project Overview

### 1.1 Detected architecture

| Layer | Technology / evidence |
| --- | --- |
| Framework | Next.js `16.3.8` App Router, React 19 (`package.json`) |
| Language | TypeScript `5.7.3`; `pnpm exec tsc --noEmit` passed with no errors during this audit |
| Styling | Tailwind CSS v4 (`@tailwindcss/postcss`), tokens in `app/globals.css`, shadcn-style primitives in `components/ui/*` (Base UI + Radix alert-dialog) |
| Fonts | Geist / Geist Mono via `next/font/google` (`app/layout.tsx`) |
| Data fetching | SWR `^2.5.1` (used by Alt Text hooks) |
| Notifications | `sonner` `<Toaster richColors position="top-right" />` mounted in `app/layout.tsx` |
| Database | MySQL via `mysql2` pool (`lib/db.ts`, `DATABASE_URL`) |
| File storage | MySQL BLOB table `app_file_blobs` + metadata `app_files` (`lib/storage/index.ts`) |
| Background jobs | DB-backed durable queue `platform_background_jobs` (`lib/background-jobs.ts`), drained by `GET /api/jobs/run` (Vercel Cron `0 3 * * *`, `vercel.json`, `CRON_SECRET` bearer) |
| Auth | Session-based (`lib/auth.ts`, `app/(auth)/*`, tables `users`, `app_sessions`, `password_resets`) |
| Authorization | `guardBusinessLine()` (`components/business-line/business-line-landing.tsx`) + `hasActionGrant()` (`lib/permission-store.ts`) + `requireFeatureInModule()` (`lib/api-auth.ts`) |
| Multi-tenancy | `currentTenantId()` (`lib/tenant-scope.ts`), tenant-prefixed storage keys (`lib/storage/keys.ts`) |
| AI | AI SDK `ai@7.0.113` (`lib/ai/provider.ts`), credits (`lib/ai/credits/*`) |
| Deployment | `output: 'standalone'` (Hostinger, `next.config.mjs`, `scripts/prepare-standalone.mjs`) |
| Tests | Vitest (`vitest.config.mts`, `test/**`) |

### 1.2 PDF module location

| Concern | Path |
| --- | --- |
| Publishing landing | `app/(workspace)/modules/publishing/page.tsx` |
| Conversion dashboard | `app/(workspace)/modules/publishing/conversion-name/page.tsx` → `/modules/publishing/conversion-name` |
| PDF overview | `app/(workspace)/modules/publishing/conversion-name/[submodule]/page.tsx` with `submodule = "pdf"` → `/modules/publishing/conversion-name/pdf` |
| PDF internal pages | `app/(workspace)/modules/publishing/conversion-name/[submodule]/[page]/page.tsx` → `/modules/publishing/conversion-name/pdf/<page>` |
| PDF definition (single source of truth) | `lib/conversion-modules.ts`, the `CONVERSION_MODULES[0]` entry (`slug: "pdf"`, `category: "document-office"`, `icon: FileText`) |
| Conversion nav UI | `components/publishing/conversion/conversion-nav.tsx` |
| Sidebar entry | `lib/navigation.ts` → `NAV_GROUPS[0].items[1].children` (generated from `CONVERSION_MODULES`) |

> Note: the route segment is literally `conversion-name` (`CONVERSION_BASE_PATH = "/modules/publishing/conversion-name"`). It looks like a placeholder name. Do **not** rename it in this phase, because the sidebar, breadcrumbs, static params and any bookmarks depend on it. (See Regression Risks.)

### 1.3 Repository caveat

`README.md` and `publishing-extraction-manifest.json` describe the repo as a "source archive … NOT a standalone deployable application" extracted from `dhania2000/muenot_erp`. The repo has since gained local `lib/auth.ts`, `lib/db.ts`, `lib/storage/*`, etc. (the `_erp-shared/` copies are reference-only). The README is **out of date**. It is a documentation item, not a code defect.

---

## Section 2 — Existing File Inventory

### 2.1 PDF module (Conversion)

| File | Symbol(s) | Responsibility |
| --- | --- | --- |
| `lib/conversion-modules.ts` | `CONVERSION_MODULES`, `CONVERSION_CATEGORIES`, `CONVERSION_SHARED_PAGES`, `conversionHref`, `getConversionModule`, `getConversionPage`, `getSharedPage`, `modulesByCategory`, `slugify`, `pages()` | Registry of 26 conversion services and their internal tab labels. Slugs are derived from labels via `slugify`. |
| `app/(workspace)/modules/publishing/conversion-name/page.tsx` | `ConversionNamePage` | Dashboard: shared tabs + service grid |
| `app/(workspace)/modules/publishing/conversion-name/[submodule]/page.tsx` | `ConversionSubmodulePage`, `generateStaticParams`, `generateMetadata` | Renders a module overview (e.g. PDF) **or** a shared page (`services`, `jobs`, `batch-center`, `profiles-presets`, `history`, …). Only `services` has content; all others show `PlannedPage`. |
| `app/(workspace)/modules/publishing/conversion-name/[submodule]/[page]/page.tsx` | `ConversionInternalPage`, `generateStaticParams`, `generateMetadata` | Renders any module tab. Always shows `PlannedPage` ("Coming soon"). |
| `components/publishing/conversion/conversion-nav.tsx` | `PUBLISHING_CRUMBS`, `CONVERSION_CRUMB`, `ConversionSharedTabs`, `ConversionModuleTabs`, `ConversionServiceGrid`, `PlannedPage`, `TabStrip` (internal), `tabClass` (internal) | Link-based tab strips (`aria-current="page"`), category service grid, empty-state placeholder |

**Current PDF tabs** (from `lib/conversion-modules.ts` lines 84–94): Overview (implicit root), `workspace`, `output-settings`, `page-layout`, `content-extraction`, `compliance-profiles`, `preflight-and-validation`, `batch-processing`, `output-preview`, `history`. That is 10 tabs in total.

### 2.2 Reusable PDF processing code (Alt Text module)

| File | Key symbols | What it does |
| --- | --- | --- |
| `lib/alt-text/pdf-package.ts` (1,105 lines) | `readPdfPackage(bytes, { collectText })`, `PdfPackage`, `PdfOccurrence`, `PdfTextRun`, `PdfTextLayout`, `PdfExtractionReport`, `PDF_EXTRACTION_LIMITS`, `PDF_TEXT_LIMITS`, `PdfPackageError`, `formatPageLabel` | Loads the PDF with `pdf-lib` `PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false, throwOnInvalidObject: false })`. Walks the page tree, resolves image XObjects and inline images, reads `StructTreeRoot` (figure association, `/Alt`, `ActualText`) and `PageLabels`, collects text runs, flags `likely_scanned_page` |
| `lib/alt-text/pdf-content-stream.ts` | `interpretContentStream`, `decodePdfText`, `Matrix`, `multiply`, `transformRect`, `intersectClip`, `ContentLimitError`, `MarkedContent` | Bounded content-stream tokenizer/interpreter (CTM, clip, marked content, text shows) |
| `lib/alt-text/pdf-image-decode.ts` | `decodePdfImage`, `decodeFilters`, `encodePng`, `readJpegHeader`, `describeImageSpec`, `UnsupportedFilterError`, `DecodeLimitError` | Decodes Flate/DCT/etc. image streams to PNG/JPEG (JPX, CCITT and JBIG2 are reported as unsupported) |
| `lib/alt-text/pdf-text-decode.ts` | `parseToUnicode`, `winAnsiDecoder`, `joinTextParts` | ToUnicode CMap / WinAnsi text decoding |
| `lib/alt-text/pdf-context.ts` | `groupPdfTextBlocks`, `buildPdfContextEvidence`, `PDF_CONTEXT_RULES` | Groups text runs into blocks/roles (caption/heading) near images. Emits `TEXT_UNREADABLE` ("… cannot be decoded without OCR") |
| `lib/alt-text/pdf-extractor.ts` | `extractPdfImages(documentId, scope)`, `PDF_SYNC_LIMITS` | Orchestrates image extraction and persists images (`maxDocumentBytes: 25 MiB`, `concurrency: 2`) |
| `lib/alt-text/document-validation.ts` | `validateDocumentBytes`, `readZipDirectory`, `assertSafeEntries`, `readZipEntryBytes`, `isUnsafeEntryName`, `resolvePartTarget`, `asValidationRejection` | Structural validation. For PDF: `%PDF-` header, `%%EOF`/`startxref`, rejects `/Encrypt`, rejects `/JavaScript`, `/JS` and `/Launch`. Also ZIP-bomb-safe OOXML validation |
| `lib/alt-text/document-upload-contract.ts` | `DOCUMENT_UPLOAD_LIMITS`, `DOCUMENT_ARCHIVE_LIMITS`, `deriveDocumentSecurity`, `DocumentUploadReference` | Browser-safe upload limits (25 MB/file, 10 files, 100 MB/selection, 2 concurrent) and scan → processing status mapping |
| `lib/alt-text/document-upload.ts`, `document-upload-queue.ts`, `document-service.ts`, `document-store.ts`, `document-records.ts` | — | Upload service, client upload queue, persistence |
| `lib/alt-text/document-preparation-*.ts`, `document-processing*.ts`, `document-extraction*.ts` | — | Status contracts and the background preparation job (`alt_text.document_preparation`) |
| `lib/alt-text/batch-*.ts` | `batch-processor`, `batch-progress`, `batch-control`, `batch-retry`, `batch-history`, `batch-export`, `batch-xlsx` | Batch lifecycle (submit, pause, resume, cancel, retry, progress, export) |
| `lib/alt-text/export.ts`, `batch-export.ts`, `batch-xlsx.ts` | `EXPORT_FORMATS = ["txt","csv","json"]`, `BATCH_EXPORT_FORMATS` (+`xlsx`), `buildBatchWorkbook` (ExcelJS) | Download/export pattern |
| `lib/alt-text/preview.ts` | `PreviewImage`, `PreviewFailure` | Tenant-scoped, scan-gated streaming of a stored image |
| `lib/alt-text/route-gate.ts` | `gateAltTextHistory`, `jsonOk`, `jsonError`, `unexpected`, `NO_STORE` | Standard API gate and JSON error envelope |

### 2.3 Shared platform infrastructure

| File | Symbols | Responsibility |
| --- | --- | --- |
| `lib/storage/index.ts` | `uploadFile`, `downloadFile`, `deleteFile`, `STORAGE_UNAVAILABLE` | Tenant-scoped blob storage in MySQL |
| `lib/storage/file-metadata.ts` | `FileObject`, `getFileById`, `getByObjectKey`, `listFileMetadata`, `FileClassification` | `app_files` metadata (SHA-256 checksum, classification, owner) |
| `lib/storage/file-scanning.ts` | `canDownload`, `downloadGatePolicyFor`, `getScanForFile`, `ScanStatus`, `QuarantineStatus` | Download gate policy (fail-closed/fail-open) |
| `lib/storage/keys.ts` | `tenantKey`, `sanitizePath`, `keyBelongsToTenant`, `tenantIdFromKey` | Key isolation |
| `lib/storage/storage-quota.ts` | `checkStorageQuota` | Quota decision |
| `lib/settings/uploads.ts` | `getUploadLimits`, `validateUploadContent` | `MAX_UPLOAD_MB` (default 50), extension allow-list, blocked-extension list, MZ/ELF magic-byte rejection |
| `lib/background-jobs.ts` | `BACKGROUND_JOB_TYPES`, `enqueueBackgroundJob`, `enqueueBackgroundJobInTransaction`, `getBackgroundJob`, `requestBackgroundJobCancel`, `isBackgroundJobCancelRequested`, `recordBackgroundJobEvent`, `retryDelaySeconds`, `runDueBackgroundJobs` | Durable queue with statuses `queued, running, completed, failed, dead_letter, cancelled` |
| `lib/job-retry-policy.ts`, `lib/observability/job-limits.ts` | — | Retry policy and job limits |
| `lib/rate-limit.ts` | `checkRateLimit` | Rate limiting |
| `lib/platform-schema.ts` | — | Platform table bootstrap (`app_files`, `app_file_blobs`, `platform_background_jobs`, `platform_background_job_events`, `ai_credit_*`) |
| `components/enterprise/page-header.tsx` | `PageHeader`, `Breadcrumbs`, `Crumb` | Standard page header and breadcrumbs |
| `components/enterprise/data-state.tsx` | `ErrorState`, `EmptyState` | Standard error/empty states |
| `components/shell/app-shell.tsx`, `sidebar-nav.tsx`, `sidebar-menu.tsx` | `AppShell`, `SidebarNav`, `SidebarMenuToggle`, `SidebarMenuPanel` | Application shell and sidebar |

### 2.4 Checklist answers (Task 1.1)

| # | Item | Finding |
| --- | --- | --- |
| 1 | Publishing module location | `app/(workspace)/modules/publishing/` |
| 2 | Conversion module location | `app/(workspace)/modules/publishing/conversion-name/` + `lib/conversion-modules.ts` |
| 3 | Existing PDF route | `/modules/publishing/conversion-name/pdf` and `/pdf/[page]` (dynamic, statically generated) |
| 4 | Existing PDF components | None specific to PDF. It uses the generic `ConversionModuleTabs` and `PlannedPage` |
| 5 | Shared frontend components | `components/ui/*` (20 primitives), `components/enterprise/*`, `components/shell/*` |
| 6 | Upload interfaces | Alt Text only: `components/publishing/alt-text/image-input-panel.tsx`, `use-document-uploads.ts`, `use-bulk-upload.ts`, `uploaded-documents-card.tsx`, `document-upload-status.tsx` |
| 7 | PDF viewer components | **Missing.** No `pdfjs`, `react-pdf`, `<iframe>`, `<embed>` or `<object>` usage was found. `lib/alt-text/preview.ts` streams **images** only |
| 8 | Processing APIs | Alt Text only: `app/api/alt-text/documents/[uploadId]/{extract,process,generate,images,results,review,…}`. **No `/api/pdf/*` or `/api/conversion/*` routes exist** |
| 9 | Conversion utilities/libraries | `pdf-lib@1.17.1` (read-only use in `pdf-package.ts`), `exceljs`, `fast-xml-parser`, `node:zlib`. No converter binaries |
| 10 | File storage | `lib/storage/*` (MySQL BLOBs) |
| 11 | Settings/profile infra | `app/api/alt-text/settings/route.ts` + `alt_text_settings` table (module-specific). No generic conversion profile store |
| 12 | Validation utilities | `lib/alt-text/document-validation.ts`, `lib/settings/uploads.ts`, `lib/alt-text/document-upload-contract.ts` |
| 13 | Download mechanisms | `app/api/alt-text/export/route.ts`, `batches/[id]/export/route.ts`, `assets/[id]/image/route.ts` (scan-gated) |
| 14 | Processing status management | `background-jobs.ts` statuses, `document-preparation-contract.ts`, `document-processing-contract.ts`, `batch-progress.ts` |
| 15 | Conversion history | Alt Text only (`lib/alt-text/history.ts`, `batch-history.ts`, `components/publishing/alt-text/alt-text-history.tsx`, `batch-history.tsx`). No conversion history |
| 16 | Error-handling patterns | `jsonError`/`unexpected` (`route-gate.ts`), typed `HistoryFailure`, `PdfPackageError`, `ContentLimitError`, `DecodeLimitError`, `asValidationRejection`, `ErrorState` UI, sonner toasts |

---

## Section 3 — Conversion Capability Matrix

"Buttons" column: whether any UI control exists in the PDF module. No PDF-module tab has any action button. Every tab renders `PlannedPage`.

### 3A. PDF Conversion

| Capability | Status | Buttons? | Evidence / notes |
| --- | --- | --- | --- |
| PDF → Word | Missing | No | No DOCX writer dependency; no route |
| PDF → Excel | Missing | No | `exceljs` is installed (used for Alt Text batch export) and could write XLSX, but there is no table-detection pipeline |
| PDF → PowerPoint | Missing | No | No PPTX writer |
| PDF → Text | Missing (engine partial) | No | `readPdfPackage(bytes, { collectText: true })` returns `PdfTextLayout` runs (capped by `PDF_TEXT_LIMITS`). It is used only for Alt Text context, with no export |
| PDF → Markdown | Missing | No | Could build on `groupPdfTextBlocks` roles |
| PDF → HTML/XHTML | Missing | No | — |
| PDF → XML/JATS | Missing | No | `fast-xml-parser` is installed (it can build XML) but is unused for PDF |
| PDF → ePub | Missing | No | — |
| PDF → PNG/JPEG/TIFF (page render) | Missing | No | No rasterizer (pdfjs, poppler, mupdf). Only **embedded-image** extraction exists (see 3B) |
| PDF → SVG | Missing | No | — |
| Word/Excel/PowerPoint → PDF | Missing | No | No LibreOffice/Gotenberg or equivalent |
| HTML/XML → PDF | Missing | No | No headless browser |
| Image → PDF | Missing (feasible) | No | `pdf-lib` supports `embedPng`/`embedJpg`, but it is not used |

### 3B. Advanced PDF

| Capability | Status | Evidence / notes |
| --- | --- | --- |
| Merge | Missing (feasible) | `pdf-lib` `copyPages` is available but unused |
| Split | Missing (feasible) | Same as above |
| Compression | Missing | `pdf-lib` alone gives limited compression (object streams). Real image downsampling needs a native tool |
| Optimization / linearization | Missing | — |
| Page reordering | Missing (feasible) | `pdf-lib` |
| Page rotation | Missing (feasible) | `pdf-lib` `setRotation` |
| Page cropping | Missing (feasible) | `pdf-lib` `setCropBox` |
| Text extraction | **Partially Working, inside Alt Text only** | `lib/alt-text/pdf-package.ts` + `pdf-text-decode.ts`. Undecodable fonts produce the `TEXT_UNREADABLE` warning (`pdf-context.ts:249`) |
| Image extraction | **Fully Working, inside Alt Text only** | `extractPdfImages` (`lib/alt-text/pdf-extractor.ts`), route `app/api/alt-text/documents/[uploadId]/extract/route.ts`, tests `test/alt-text/alt-text-pdf-package.test.ts`. Unsupported codecs (JPX, CCITT, JBIG2) are reported, not decoded |
| Table extraction | Missing | — |
| Equation extraction | Missing | — |
| Metadata extraction | Partially Working, internal only | Page count, page labels and structure tree are read. Document `/Info` and XMP are **not** extracted (`updateMetadata: false`; no `/Info` read found) |
| Bookmarks & links | Missing | No `Outlines`/`Annots` parsing found in `pdf-package.ts` |
| OCR | Missing | No OCR engine. `likely_scanned_page` classification exists (`PDF_EXTRACTION_LIMITS.scannedPageCoverage: 0.85`) and can be used to **detect** OCR need |
| Searchable PDF | Missing | Depends on OCR |
| PDF forms | Missing | No `AcroForm` handling. Note that validation rejects PDFs containing JS actions, which many form PDFs do |
| PDF/A | Missing | No veraPDF or other validator |
| PDF/UA | Missing (signals only) | Tag-tree, `/Alt` and `ActualText` reading exist for Alt Text. This is not a conformance check |
| PDF/X | Missing | — |
| Batch processing | Missing for PDF, **Fully Working for Alt Text** | `lib/alt-text/batch-*`, job type `alt_text.batch_processing` |
| Encrypted PDF handling | Defective by design for conversion | `validateDocumentBytes` rejects `/Encrypt` with `ENCRYPTED_DOCUMENT`. This is correct for Alt Text, but blocks password-protected sources unless a decrypt flow is added |

---

## Section 4 — UI/UX Audit

### 4.1 Design system inventory

| Element | Existing implementation | Reusable? | Observation |
| --- | --- | --- | --- |
| Sidebar | `components/shell/sidebar-nav.tsx`, `sidebar-menu.tsx`, data in `lib/navigation.ts` | Yes | PDF entry is auto-generated under the "Document & Office" section. Do not add items manually |
| Module navigation | `ConversionSharedTabs`, `ConversionModuleTabs` | Yes | Link-based, horizontally scrollable, `aria-current`. Good foundation |
| Headers | `PageHeader` | Yes | Takes title, description, icon and breadcrumbs. The icon is the Publishing business-line icon (`BookOpen`), not the module icon |
| Breadcrumbs | `Breadcrumbs`, `PUBLISHING_CRUMBS`, `CONVERSION_CRUMB` | Yes | Consistent |
| Tabs (in-page) | `components/ui/tabs.tsx` (`Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`) | Yes | Use these for sub-tabs inside a page. Keep `ConversionModuleTabs` for page routing |
| Cards | `components/ui/card.tsx` | Yes | — |
| Buttons | `components/ui/button.tsx` (`buttonVariants`) | Yes | — |
| Forms / inputs | `input.tsx`, `label.tsx`, `textarea.tsx`, `select.tsx` | Yes | No checkbox, switch, radio-group, slider or form primitives exist. Output Settings and Page Layout will need them (add via shadcn CLI in a later task, not now) |
| Dropdowns | `dropdown-menu.tsx` | Yes | — |
| Toolbars | `components/publishing/alt-text/extracted-images-toolbar.tsx` (pattern) | Pattern | Module-specific. Extract the pattern rather than import across modules |
| Dialogs / drawers | `alert-dialog.tsx`, `sheet.tsx` | Yes | No generic `dialog.tsx` |
| Tables | `table.tsx`; example `extracted-images-table.tsx` | Yes | — |
| Upload areas | `image-input-panel.tsx`, `use-document-uploads.ts`, `use-bulk-upload.ts` | Pattern | Alt-Text-coupled. A shared uploader is needed (Task 2) |
| Preview | `extracted-images-gallery.tsx`, `image-details-sheet.tsx` | Pattern | No PDF page viewer exists |
| Status indicators | `badge.tsx`, `review-status-badge.tsx`, `document-upload-status.tsx`, `document-preparation-status.tsx` | Yes/pattern | — |
| Notifications | `sonner` (global) | Yes | — |
| Loading | `skeleton.tsx`, `spinner.tsx`, `progress.tsx` | Yes | — |
| Empty / error | `empty.tsx`, `EmptyState`, `ErrorState`, `PlannedPage` | Yes | — |
| Responsive layout | Pages use `flex min-w-0 flex-col gap-6 p-4 sm:p-6 md:p-8`; grid `sm:grid-cols-2 xl:grid-cols-3` | Yes | Consistent mobile-first padding |
| Typography | Geist Sans/Mono | Yes | — |
| Theme colors | OKLCH tokens in `app/globals.css`, light (warm neutral bg, navy primary `oklch(0.36 0.09 258)`) and dark | Yes | Do not change |
| Contrast | `--muted-foreground: oklch(0.5 0.02 260)` on `--background: oklch(0.985 …)` | Not Verified | Likely meets AA for body text. Not measured with a tool |
| Spacing | Tailwind scale, `gap-*` | Yes | Consistent |

### 4.2 Issues found (no changes made)

1. **The 10-tab strip will grow to 12.** It already scrolls horizontally on narrow viewports. It needs grouping or an overflow pattern for enterprise UX (Task 2).
2. The `PageHeader` icon on PDF pages is the business-line icon, not `FileText`. This is a minor identity inconsistency.
3. Shared pages (`profiles-presets`, `history`, `batch-center`, `jobs`, `downloads`) duplicate the purpose of PDF tabs (`history`, `batch-processing`). There is a risk of two sources of truth (see Section 9).
4. `/modules/publishing/conversion-name` is a user-visible placeholder-looking URL.

---

## Section 5 — PDF Pages Matrix (Existing Page → Required Improvement)

| # | Planned section | Exists? | Current route / file | Working functionality | Missing | Reusable assets | Future task |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Overview | Yes (placeholder) | `/pdf` → `[submodule]/page.tsx` | Header, breadcrumbs, tabs | Capability cards, recent jobs, quick start, status | `ConversionServiceGrid` card style, `Card`, `Badge` | Task 2 |
| 2 | Workspace | Yes (placeholder) | `/pdf/workspace` → `[page]/page.tsx` | Tab only | Upload, operation picker, run, progress, result, download | Alt Text upload hooks/contract, `validateDocumentBytes`, `uploadFile`, job queue | Task 3 |
| 3 | Guidelines | **No** | — | — | Optional guideline upload, profile link, rule mapping | `uploadFile`, OOXML/PDF validation, `app_files` metadata | Task 4 |
| 4 | Output Settings | Yes (placeholder) | `/pdf/output-settings` | Tab only | Format, quality, fonts, image options | `Select`, `Input`, alt-text settings route pattern | Task 5 |
| 5 | Page Layout | Yes (placeholder) | `/pdf/page-layout` | Tab only | Size, margins, rotate, crop, reorder, merge/split | `pdf-lib` | Task 6 |
| 6 | Content Extraction | Yes (placeholder) | `/pdf/content-extraction` | Tab only | Text, image, table, metadata and bookmark export | **`readPdfPackage`, `extractPdfImages`, `groupPdfTextBlocks`** | Task 7 |
| 7 | Compliance Profiles | Yes (placeholder) | `/pdf/compliance-profiles` | Tab only | PDF/A, PDF/UA, PDF/X profile definitions | Struct-tree/`/Alt` reading | Task 8 |
| 8 | Preflight | Yes, as **"Preflight & Validation"** (slug `preflight-and-validation`) | `/pdf/preflight-and-validation` | Tab only | Checks engine, report | `PdfExtractionReport.limitations`, validation codes | Task 8 |
| 9 | Batch Processing | Yes (placeholder) | `/pdf/batch-processing` | Tab only | Multi-file queue, progress, control | **Alt Text batch architecture**, `background-jobs.ts` | Task 9 |
| 10 | Output Preview | Yes (placeholder) | `/pdf/output-preview` | Tab only | PDF viewer, before/after | Scan-gated streaming (`preview.ts` pattern) | Task 10 |
| 11 | Profiles & Presets | **No PDF tab**. A shared Conversion page exists | `/conversion-name/profiles-presets` (placeholder) | Shared tab only | Saved presets per company/client | `alt_text_settings` pattern | Task 11 |
| 12 | History | Yes (placeholder). A shared `/conversion-name/history` also exists | `/pdf/history` | Tab only | Job list, audit, re-download | Alt Text `history.ts`, `batch-history.ts`, `alt-text-history.tsx` | Task 12 |

**Registry delta required later** (in `lib/conversion-modules.ts` PDF `pages(...)`): add "Guidelines" and "Profiles & Presets". Decide whether to rename "Preflight & Validation" to "Preflight". **Renaming changes the slug** (`preflight-and-validation` → `preflight`), so it needs a redirect. Recommendation: keep the existing slug and change only the label, or keep both.

---

## Section 6 — Client Guidelines Audit

### 6.1 Permanent business rule (recorded)

> **Client Guidelines upload is OPTIONAL.**
> - **Scenario A (none supplied):** default settings apply, and processing must never be blocked.
> - **Scenario B (supplied):** applicable requirements map to settings, output is checked against them, unsupported requirements are reported, conflicts require human review, and compliance is never claimed without verification.

### 6.2 Existing support

| # | Capability | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Guideline file upload | Missing | No "guideline" symbol in `app/`, `lib/` or `components/`. The only match is a code comment in `lib/alt-text/core.ts:242` |
| 2 | Multiple attachments | Missing (infra exists) | `DOCUMENT_UPLOAD_LIMITS.maxFiles = 10`, `use-document-uploads.ts` |
| 3 | PDF/DOCX/TXT/XLSX docs | Partial infra | PDF and DOCX validation exist (`validateDocumentBytes`). **TXT and XLSX are not in the `getUploadLimits().extensions` allow-list**. `exceljs` can read XLSX |
| 4 | Guideline preview | Missing | No document viewer |
| 5 | Company-specific profiles | Missing | Tenancy exists (`tenant_id`). There is no client/company entity below tenant |
| 6 | Versions | Missing (pattern exists) | `alt_text_versions` table shows a versioning pattern |
| 7 | Reusable default profiles | Missing | Only `alt_text_settings` (one row per tenant) |
| 8 | Special instructions | Partial pattern | Alt Text document context (`document-context-service.ts`, `document-context-sheet.tsx`) captures free-text context for AI. This is the closest precedent |
| 9 | Rule extraction/mapping | Missing | AI SDK + credits could support assisted extraction later |
| 10 | Conflict handling | Missing | — |
| 11 | Quality checklists | Missing | — |
| 12 | Compliance reports | Missing | Export pattern (`batch-xlsx.ts`, `export.ts`) is reusable |

### 6.3 Future cross-module architecture (recommendation, not implemented)

To support PDF, XML, ePub, Word, Editorial and Accessibility services without duplication:

```
lib/guidelines/                       (shared, module-agnostic)
  guideline-contract.ts   GuidelineSet { id, tenantId, clientId?, version, files[], status }
                          GuidelineRule { id, source(fileRef, page/section), text,
                                          category, targetModules[], mappedSetting?,
                                          support: "supported" | "partial" | "unsupported",
                                          conflictsWith?: ruleId[] }
  guideline-store.ts      persistence (guideline_sets, guideline_files, guideline_rules,
                          guideline_rule_mappings, guideline_check_results)
  guideline-resolver.ts   resolveEffectiveSettings(moduleDefaults, profile?, guidelineSet?)
                          → { settings, appliedRules[], unsupported[], conflicts[] }
  guideline-checks.ts     per-module check adapters register: { module, ruleCategory, check() }
components/guidelines/    shared uploader, rule review table, conflict-resolution sheet,
                          compliance report view
```

Each module (PDF first) supplies only an **adapter**: a mapping from rule categories to its own settings, plus check functions. Uploads reuse `lib/storage` with `metadata.module = "guidelines"`. Conflicts block only the conflicting setting, never the whole job. Reports state **"Verified / Not verifiable / Failed"** per rule, which prevents false compliance claims.

---

## Section 7 — Technical Dependencies

### 7.1 Installed libraries relevant to PDF

| Package | Version | Current use | PDF-module potential |
| --- | --- | --- | --- |
| `pdf-lib` | 1.17.1 | Read-only parsing (`pdf-package.ts`) | Merge, split, rotate, crop, reorder, image→PDF, metadata write. **Cannot** render pages, OCR, or convert Office/HTML |
| `exceljs` | ^4.4.0 | Batch XLSX export | PDF→Excel output, XLSX guideline reading |
| `fast-xml-parser` | ^5.11.2 | OOXML parsing (Alt Text) | XML/JATS output, XML input |
| `ai` | 7.0.113 | Vision alt text | Guideline rule extraction, layout assistance (credit-metered) |
| `node:zlib`, `node:crypto` | built-in | Stream decode, hashing | — |

**Not installed:** a PDF renderer (pdfjs-dist), OCR (tesseract), a DOCX writer, Office→PDF, HTML→PDF (headless Chromium), a PDF/A or PDF/UA validator (veraPDF), and native optimizers (qpdf, Ghostscript). Many of these are **native binaries**, which matters for the Hostinger standalone + Vercel serverless targets (see risks).

### 7.2 Limits and restrictions in force

| Limit | Value | Source |
| --- | --- | --- |
| Global upload max | `MAX_UPLOAD_MB` or 50 MB | `lib/settings/uploads.ts` |
| Server action body | 60 MB | `next.config.mjs` |
| Document upload (Alt Text) | 25 MB/file, 10 files, 100 MB/selection | `document-upload-contract.ts` |
| PDF parse | 2,000 pages, 500 image occurrences/request, 16 MiB/content stream, 96 MiB total content, 3M operators | `PDF_EXTRACTION_LIMITS` |
| Text | 4,000 runs/page, 60,000 total | `PDF_TEXT_LIMITS` |
| Image decode | 96 MiB decoded, 12,000 px max dimension | `PDF_SYNC_LIMITS` |
| Allowed extensions | png, jpg, jpeg, webp, gif, pdf, pptx, docx | `getUploadLimits()` |
| Blocked extensions | exe, dll, bat, cmd, com, msi, scr, ps1, sh, js, vbs, jar, php, **html, htm, svg** | `lib/settings/uploads.ts` |
| Job runner | Cron daily `0 3 * * *`, `maxDuration = 300` | `vercel.json`, `app/api/jobs/run/route.ts` |
| Security headers | nosniff, strict-origin referrer, HSTS, `X-Frame-Options: SAMEORIGIN`, Permissions-Policy | `next.config.mjs` |

### 7.3 Security boundaries for uploaded files

- Tenant-prefixed keys and `keyBelongsToTenant` checks on download (`lib/storage/index.ts`).
- Magic-byte executable rejection and filename sanitization (`validateUploadContent`).
- PDF active-content and encryption rejection (`validateDocumentBytes`).
- ZIP-bomb ceilings for OOXML (`DOCUMENT_ARCHIVE_LIMITS`).
- Scan-gated download (`canDownload`, `downloadGatePolicyFor`). **Note:** `uploadFile` inserts `scan_status = 'clean'` directly (`lib/storage/index.ts`, "Scanning is a byte-signature check at upload"). There is no AV engine.
- Bounded parser budgets (`ContentLimitError`, `DecodeLimitError`).

### 7.4 Risks and limitations

| # | Risk | Severity | Evidence |
| --- | --- | --- | --- |
| R1 | **No native conversion runtime.** Office/HTML→PDF, OCR, rasterization and PDF/A all need binaries or an external service | High | §7.1 |
| R2 | **The job runner fires once per day.** It is unsuitable for interactive conversions unless jobs are also kicked inline or the schedule changes | High | `vercel.json` |
| R3 | **Storage in MySQL BLOBs.** Large PDFs and outputs will bloat the DB, and every read buffers the full file in memory (`Buffer.from(rows[0].body)`) | High | `lib/storage/index.ts` |
| R4 | `UploadResult.url` points to `/api/storage/file/...`, **but no such route exists** in `app/api/` | Medium (Defective) | `lib/storage/index.ts`; `ls app/api` = `alt-text, health, jobs` |
| R5 | `BACKGROUND_JOB_TYPES` is a closed tuple and enforces types at enqueue. New PDF job types must be added there (a shared file) | Medium | `lib/background-jobs.ts:12,155` |
| R6 | Encrypted PDFs and PDFs with JS actions are rejected globally by the shared validator. The PDF module needs its own policy without weakening Alt Text | Medium | `document-validation.ts:293–294` |
| R7 | HTML, HTM and SVG are blocked uploads, which conflicts with "HTML/XML → PDF" and "PDF → SVG" input/preview requirements | Medium | `lib/settings/uploads.ts` |
| R8 | The PDF module pages call `guardBusinessLine("publishing")` with **no feature-specific permission** (Alt Text uses `publishing.view_alt_text`) | Medium | `[submodule]/page.tsx`, `[page]/page.tsx` |
| R9 | Synchronous parsing is CPU-bound on the Node event loop | Medium | `PDF_SYNC_LIMITS.concurrency: 2` comment |
| R10 | **Pre-existing test failures**: 5 files / 29 tests fail (of 477), all in Alt Text (`alt-text-batch-processor`, `alt-text-batch-store`, `alt-text-credit-service`, …). Assertions expect tenant `42` but receive `1`, and there is a missing `ensureAltTextSchema` mock. These look like test/stub drift after the standalone extraction, not PDF-related failures | Medium | `pnpm exec vitest run` during this audit |
| R11 | `README.md` is stale (it says the repo is not deployable) | Low | `README.md` |

---

## Section 8 — Regression Risks & Checklist

### 8.1 Must remain untouched / backward-compatible

- `CONVERSION_BASE_PATH` and the `/modules/publishing/conversion-name/*` URLs.
- Existing PDF tab slugs (`workspace`, `output-settings`, `page-layout`, `content-extraction`, `compliance-profiles`, `preflight-and-validation`, `batch-processing`, `output-preview`, `history`).
- `generateStaticParams` in both dynamic routes. These cover all 26 modules, and a PDF-only page must not break other modules.
- Sidebar generation in `lib/navigation.ts`, and the Editorial and Accessibility menus.
- The whole Alt Text module: `app/(workspace)/modules/publishing/alt-text/`, `app/api/alt-text/**`, `lib/alt-text/**`, `components/publishing/alt-text/**`.
- `lib/alt-text/pdf-*.ts` behavior. If reused, **extract to a shared location and re-export** rather than editing semantics.
- `validateDocumentBytes` rejection rules for Alt Text.
- `lib/storage/*`, `lib/background-jobs.ts` contracts, `app/api/jobs/run`.
- `components/ui/*` APIs, `app/globals.css` tokens, `app/layout.tsx` Toaster and fonts.
- `next.config.mjs` security headers and `output: 'standalone'`.

### 8.2 Regression checklist (run after every subsequent task)

- [ ] `pnpm exec tsc --noEmit` passes (baseline: **passes**).
- [ ] `pnpm exec vitest run` shows **no new failures** beyond the 29 baseline failures in Section 7.4 R10.
- [ ] `/modules/publishing/conversion-name` renders the dashboard and all 26 service cards.
- [ ] Every non-PDF module overview and tab still renders (spot-check Word, XML, ePub).
- [ ] All pre-existing PDF tab URLs still resolve (no 404s); any renamed slug redirects.
- [ ] The sidebar still lists PDF under "Document & Office", and the active state is correct.
- [ ] Breadcrumbs read Modules › Publishing › Conversion › PDF › Page.
- [ ] Alt Text: image upload, document upload (PDF/PPTX/DOCX), extraction, generation, review, batch, export and history all still work.
- [ ] Uploads are still tenant-scoped, and downloads are still scan-gated.
- [ ] Encrypted and JS PDFs are still rejected in Alt Text.
- [ ] No new background job type breaks `runDueBackgroundJobs` for existing types.
- [ ] Light and dark themes are unchanged; no new design tokens.
- [ ] Mobile (≤ 400 px): the tab strip scrolls with no horizontal page overflow.
- [ ] **Guidelines:** a job with **no** guidelines runs end-to-end, and is never blocked.

---

## Section 9 — Future Task Mapping (Phase 1 Tasks 2–12)

| Task | Scope | Affected existing code | Proposed improvement |
| --- | --- | --- | --- |
| 2 | Overview + module IA | `lib/conversion-modules.ts` (PDF `pages`), `conversion-nav.tsx`, `[submodule]/page.tsx` | Add Guidelines and Profiles & Presets tabs (keep existing slugs), PDF-specific overview branch, feature permission (e.g. `publishing.view_conversion_pdf`), tab overflow pattern |
| 3 | Workspace (upload → run → download) | New `components/publishing/conversion/pdf/*`, new `app/api/conversion/pdf/*`, `lib/storage`, `background-jobs.ts` (new job type) | Extract a shared uploader from Alt Text upload hooks. Add first real operations using `pdf-lib` (merge, split, rotate, image→PDF). Add a storage download route (fixes R4) |
| 4 | Guidelines (optional) | New `lib/guidelines/*`, `components/guidelines/*` | Implement the §6.3 shared architecture with the PDF adapter first. Allow TXT/XLSX for guideline uploads only |
| 5 | Output Settings | `[page]/page.tsx` branch, settings store | Typed `PdfOutputSettings`, defaults plus guideline overrides via `resolveEffectiveSettings` |
| 6 | Page Layout | `pdf-lib` operations | Page size, margins, crop, rotate, reorder, thumbnails (needs a renderer, R1) |
| 7 | Content Extraction | Move `lib/alt-text/pdf-*.ts` to `lib/pdf/*` with re-exports from the old paths | Text/Markdown/JSON export, image export (reuse `extractPdfImages`), metadata `/Info`, bookmarks. Tables and equations are later |
| 8 | Compliance Profiles + Preflight | New `lib/pdf/preflight/*` | Rule-based checks from `PdfPackage` (tags, alt, fonts, encryption, page sizes). External validator for PDF/A and PDF/UA certification claims |
| 9 | Batch Processing | Generalize `lib/alt-text/batch-*` patterns | `conversion.pdf_batch` job type, progress, pause, retry, export. Reconcile with the shared `batch-center` |
| 10 | Output Preview | New viewer component | Add a PDF renderer (dependency decision), scan-gated streaming as in `preview.ts`, before/after comparison |
| 11 | Profiles & Presets | Shared `profiles-presets` page + PDF tab | One store (`conversion_profiles`) consumed by both; client/company scoping; versioning (pattern: `alt_text_versions`) |
| 12 | History | Shared `history`/`jobs`/`downloads` pages + PDF tab | A single `conversion_jobs` source, filtered by module in the PDF tab; audit events from `platform_background_job_events` |

---

## Section 10 — Prioritized Recommendations

**P0: decide before Task 3**
1. **Conversion runtime strategy (R1).** Choose between pure-JS (`pdf-lib` + `pdfjs-dist`) for in-process operations and an external worker or service (Gotenberg/LibreOffice, Tesseract, qpdf/Ghostscript, veraPDF) for heavy conversions. Hostinger standalone vs Vercel serverless changes this answer.
2. **Storage for large binaries (R3).** Keep the `lib/storage` facade but plan an object-storage backend (e.g. Vercel Blob or S3) behind it, and add streaming download plus the missing `/api/storage/file` route (R4).
3. **Job execution latency (R2).** Add an inline "kick" after enqueue, or a more frequent schedule, for interactive PDF jobs.

**P1: foundation**
4. Extract `lib/alt-text/pdf-*.ts` into a shared `lib/pdf/` with compatibility re-exports, so there is zero behavior change for Alt Text.
5. Add a module-specific validation policy (allow encrypted PDFs with a password flow, and a forms policy) without editing Alt Text rules (R6, R7).
6. Add a PDF feature permission and gate both page and API routes (R8).
7. Build the shared **Guidelines** service (§6.3) with **optional** semantics enforced in the resolver, plus a contract test: "no guidelines → job proceeds with defaults".
8. Stabilize the 29 pre-existing failing Alt Text tests (R10) so regression checks give a clean signal.

**P2: enterprise UX**
9. Tab grouping/overflow for 12 sections, a PDF-specific header icon, and consistent status badges across jobs.
10. One source of truth for Profiles, History and Batch across the shared Conversion pages and PDF tabs.
11. Compliance reporting must state per-rule **Verified / Not verifiable / Failed**, and must never claim PDF/A or PDF/UA without a validator.

**P3: hygiene**
12. Update `README.md` to reflect the current standalone state (R11).
13. Consider a canonical `/conversion` path with a permanent redirect from `/conversion-name`, as a later dedicated task.

---

*End of audit. No source code was modified during Phase 1 · Task 1.*
