# Muenot Publishing — PDF Module
## Phase 1 · Task 2 — Enterprise UI Architecture

| Item | Value |
| --- | --- |
| Repository | `dhania2000/muenot_publishing` (working branch `v0/pdf-phase1-task1-audit`) |
| Module | Publishing → Conversion → PDF |
| Primary reference | `PDF_PHASE1_TASK1_AUDIT.md` (repository root) |
| Date | 2026-10-24 |
| Scope | Architecture and design specification only. No source code, routes, navigation, dependencies, APIs or database were modified. |
| Location | Repository root, next to the Task 1 audit (the repo has no `docs/` folder; see Task 1 §1 header). |

**Permanent business rule (applies to every section below):**
> Company guidelines are **optional**. When supplied, applicable requirements guide processing and undergo validation. When absent, standard processing continues **without restrictions**. "Not Provided — Standard Profile" is a valid, non-warning state.

**Path conventions used in this document**
- `path` in backticks with no marker = **verified** to exist in the repository today.
- `path` marked **(proposed)** = does not exist; recommended location for a future task. Final names are confirmed by the implementing task.

---

## 1. Task 1 Audit References

Findings from `PDF_PHASE1_TASK1_AUDIT.md` that drive this architecture (not repeated in full):

| # | Topic | Task 1 finding | Architecture consequence |
| --- | --- | --- | --- |
| 1 | Pages & routes | PDF overview = `app/(workspace)/modules/publishing/conversion-name/[submodule]/page.tsx` (`submodule="pdf"`); tabs = `[submodule]/[page]/page.tsx`. Base path `CONVERSION_BASE_PATH = "/modules/publishing/conversion-name"` (§1.2) | Keep both dynamic routes. PDF gets a **branch** inside them, not new static routes. URLs unchanged. |
| 2 | Working functionality | Module is a **navigation shell**: every PDF tab renders `PlannedPage` (§ headline, §2.1) | Every section starts from a real route that already resolves; no broken links possible. |
| 3 | Component architecture | Registry `lib/conversion-modules.ts` (`CONVERSION_MODULES[0]`, `pages(...)` with 9 labels) + `components/publishing/conversion/conversion-nav.tsx` (`ConversionModuleTabs`, `ConversionSharedTabs`, `ConversionServiceGrid`, `PlannedPage`) (§2.1) | Registry stays the **single source of truth** for sections and capabilities. |
| 4 | Reusable UI | `components/ui/*` (20 primitives), `components/enterprise/page-header.tsx` (`PageHeader`, `Breadcrumbs`, `Crumb`), `components/enterprise/data-state.tsx` (`ErrorState`, `EmptyState`) (§2.3, §4.1) | All PDF components compose these. No new design system. |
| 5 | Design system | OKLCH tokens in `app/globals.css`, Geist Sans/Mono, `--radius: 0.5rem`, page padding `p-4 sm:p-6 md:p-8` (§4.1) | Tokens reused as-is (§5). |
| 6 | Conversion utilities | `lib/alt-text/pdf-package.ts` (`readPdfPackage`), `pdf-extractor.ts`, `pdf-context.ts`, `pdf-image-decode.ts`, `pdf-text-decode.ts`; `pdf-lib@1.17.1`, `exceljs`, `fast-xml-parser` (§2.2, §7.1) | Capability registry marks text/image extraction **Partially Available (engine exists, not exposed)**; everything else Planned/Unsupported. |
| 7 | Upload & preview | Upload only in Alt Text (`image-input-panel.tsx`, `use-document-uploads.ts`, `use-bulk-upload.ts`, `uploaded-documents-card.tsx`, `document-upload-status.tsx`). **No PDF viewer** (no pdfjs/iframe/embed) (§2.4 #6–7) | Source panel reuses the Alt Text upload *pattern* via a later extraction; Preview panel is a **slot** until a renderer is chosen. |
| 8 | Technical limits | R1 no native runtime, R2 daily cron, R3 BLOB storage, R4 missing `/api/storage/file`, R5 closed job-type tuple, R6 encrypted/JS PDFs rejected, R7 html/svg blocked, R8 no PDF permission (§7.4) | UI must show honest **Unavailable/Planned** states and must not promise interactive speed (R2). |
| 9 | Guideline support | **None exists** (§6.2). Proposed shared `lib/guidelines/*` + `components/guidelines/*` (§6.3) | §11–12 of this document define the UI side of that contract. |
| 10 | Regression risks | Preserve URLs, slugs, `generateStaticParams`, sidebar generation, Alt Text, tokens (§8.1) | Every recommendation below is additive. |

### 1.1 Reconciling Task 1 §9 with the Task 2 brief

Task 1 §9 mapped Tasks 2–12 to **features** (Workspace, Guidelines, Output Settings …). The Task 2 brief redefines Phase 1 Tasks 3–12 as **UI foundation** tasks (Module Foundation, Header, Navigation …). This document follows the **Task 2 brief**. Task 1 §9 feature work moves to the later phases listed in §15 (Upload & Workspace, PDF Viewer, Output Settings, Client Guidelines, …). Task 1's P0 decisions (runtime, storage, job latency) remain prerequisites for those feature phases, not for Phase 1.

### 1.2 Evidence gaps

| Gap | Impact | Handling |
| --- | --- | --- |
| Text contrast not measured with a tool (Task 1 §4.1) | AA claim for `--muted-foreground` unverified | Task 11 measures; until then do not use `text-muted-foreground` below `text-xs` or on `bg-muted`. |
| No `--success`/`--warning`/`--info` tokens in `app/globals.css` | Status colors | Reuse the **existing Tailwind palette convention** already used in Alt Text (see §5.2). |
| Shell header height not a token | Workspace height calc | Task 7 measures and uses a flex fill, not a magic number (§7.6). |
| No checkbox, switch, radio-group, slider, dialog, scroll-area, resizable primitives in `components/ui/` | Settings controls, panels | Added via shadcn CLI in the task that first needs them (listed per section). Not in Phase 1 Tasks 3–5. |

---

## 2. Architecture Objectives

1. **One module, twelve sections, zero duplicate pages.** Sections are registry entries rendered by the two existing dynamic routes.
2. **Registry-driven.** Sections, capabilities and their statuses live in data, so later phases add rows, not layouts.
3. **Honest status.** No control may imply a planned capability works. Status comes from the capability registry (§10), never hard-coded copy.
4. **Guidelines optional by construction.** No section, button or validation is gated on guidelines being present.
5. **Preview-first workspace.** The document preview gets the largest share of space at every breakpoint.
6. **Reuse before create.** Compose `components/ui/*` and `components/enterprise/*`; extract Alt Text *patterns* to shared locations with re-exports; never import `components/publishing/alt-text/*` into PDF.
7. **Cross-module readiness.** Generic pieces (header, nav, workspace shell, guideline components, status) are written module-agnostic so Word, XML, ePub, HTML, Editorial and Accessibility can adopt them later without changes to PDF.
8. **WCAG 2.2 AA** as the interface design target.

---

## 3. Existing Component Reuse Map

| Need | Reuse (verified) | Action | Notes |
| --- | --- | --- | --- |
| Page header | `PageHeader` (`components/enterprise/page-header.tsx`) | Reuse; pass `icon={FileText}` from the registry | Fixes Task 1 §4.2 issue 2 (business-line icon used today). `actions` slot holds primary/secondary actions. |
| Breadcrumbs | `Breadcrumbs`, `PUBLISHING_CRUMBS`, `CONVERSION_CRUMB` | Reuse | Trail: Modules › Publishing › Conversion › PDF › Section. |
| Section navigation | `ConversionModuleTabs` + internal `TabStrip`/`tabClass` (`conversion-nav.tsx`) | **Improve in place** (overflow, scroll-into-view, mobile switcher) | Improvement benefits all 26 modules; no PDF fork. |
| Shared conversion nav | `ConversionSharedTabs` | Unchanged | — |
| Placeholder section | `PlannedPage` | Reuse for every section not yet built | Already link-safe. |
| Overview cards | `ConversionServiceGrid` card markup, `Card`, `Badge` | Reuse pattern | Capability cards follow the same `rounded-lg border bg-card p-5` recipe. |
| In-page sub-tabs | `components/ui/tabs.tsx` (`variant` default/line) | Reuse | Only for **in-page** switches (e.g. preview modes), never for routing. |
| Forms | `input.tsx`, `label.tsx`, `textarea.tsx`, `select.tsx` | Reuse | Add `checkbox`, `switch`, `radio-group`, `slider` via shadcn CLI when Output Settings is built. |
| Menus | `dropdown-menu.tsx` | Reuse | Overflow "More" menu, toolbar menus. |
| Drawers | `sheet.tsx` (`side: right/left/bottom`) | Reuse | Tablet/mobile settings and source panels; detail drawers. |
| Confirmations | `alert-dialog.tsx` | Reuse | Destructive actions, unsaved changes. No generic `dialog.tsx`; add via CLI only if a non-confirm modal is required. |
| Tables | `table.tsx`; pattern `extracted-images-table.tsx` | Reuse primitive; copy pattern | History, batch, findings, rules. |
| Loading | `skeleton.tsx`, `spinner.tsx`, `progress.tsx` | Reuse | — |
| Empty/error | `empty.tsx`, `EmptyState`, `ErrorState` | Reuse | `ErrorState` already has `role="alert"` and retry. |
| Inline notices | `alert.tsx` | Reuse | Guideline conflicts, capability limitations. |
| Tooltips | `tooltip.tsx` | Reuse | Icon-only buttons only. |
| Notifications | `sonner` Toaster in `app/layout.tsx` | Reuse | Transient confirmations only, never the sole carrier of an error. |
| Upload | Alt Text `use-document-uploads.ts`, `use-bulk-upload.ts`, `document-upload-contract.ts` | **Extract pattern** later (Upload & Workspace phase) to a shared location with re-exports | Do not import Alt Text components into PDF. |
| Status badges | Alt Text `review-status-badge.tsx`, `document-upload-status.tsx` | **Pattern** for `StatusBadge` (§8) | Same color convention (§5.2). |
| Toolbar | Alt Text `extracted-images-toolbar.tsx` | Pattern | — |
| Detail drawer | Alt Text `image-details-sheet.tsx` | Pattern | File information panel. |

---

## 4. PDF Section Specifications (12)

### 4.0 Section registry (target state)

Order follows the brief. Existing slugs are **preserved** (Task 1 §8.1).

| # | Section | Slug | Exists today | Registry change (Task 5) |
| --- | --- | --- | --- | --- |
| 1 | Overview | *(root)* `/pdf` | Yes | None |
| 2 | Workspace | `workspace` | Yes | None |
| 3 | Guidelines | `guidelines` | **No** | Add label "Guidelines" after Workspace |
| 4 | Output Settings | `output-settings` | Yes | None |
| 5 | Page Layout | `page-layout` | Yes | None |
| 6 | Content Extraction | `content-extraction` | Yes | None |
| 7 | Compliance Profiles | `compliance-profiles` | Yes | None |
| 8 | Preflight | `preflight-and-validation` | Yes ("Preflight & Validation") | **Keep slug.** Display label "Preflight" via an optional `label`/`slug` override in `pages()` so the URL does not change. |
| 9 | Batch Processing | `batch-processing` | Yes | None |
| 10 | Output Preview | `output-preview` | Yes | None |
| 11 | Profiles & Presets | `profiles-presets` | **No** (shared page exists) | Add PDF tab; same slug string as shared page for consistency |
| 12 | History | `history` | Yes | None |

Because `generateStaticParams` iterates the registry, the two new slugs are generated automatically and render `PlannedPage` until built — no broken navigation.

**Shared-page relationship (one source of truth):** PDF *Batch Processing*, *Profiles & Presets* and *History* are **module-filtered views** of the same data that the shared Conversion pages (`batch-center`, `profiles-presets`, `history`, `jobs`, `downloads` in `CONVERSION_SHARED_PAGES`) show unfiltered. Same components, a `module="pdf"` filter prop. Never two stores.

### 4.1 Common section contract

Every section uses the same frame (§6) and the same state patterns (§14.3). Per-section tables below list only what differs.

| Aspect | Rule for all sections |
| --- | --- |
| Shell | `PdfSectionLayout` (§8) → `PageHeader` + `ConversionModuleTabs` + content |
| Loading | `Skeleton` matching final layout (no layout shift); `Spinner` only inside buttons |
| Error | `ErrorState` with message + "Try again"; never a blank area |
| Unavailable | Capability or section not built → `PlannedPage` / "Planned" badge, no disabled fake controls |
| Guidelines | Read-only `GuidelineStatusChip` in header area when a job context exists; "Not Provided — Standard Profile" is neutral |
| Permissions | Gate on a PDF feature grant (Task 1 R8) once introduced; denied → existing guard behavior |

### 4.2 Section details

#### 1. Overview
| Aspect | Specification |
| --- | --- |
| Purpose | Entry point: what PDF can do now, what is planned, recent activity, quick start. |
| Layout | Dashboard: header → capability summary strip → capability category grid → two-column (Recent jobs / Guidance) on `lg`. |
| Components | `CapabilityCard`, `StatusBadge`, `Card`, `Table` (recent jobs), `EmptyState`. |
| Controls | Primary "Open Workspace"; secondary "View History"; card links to Workspace with `?capability=<id>` (only for Available capabilities). |
| Shared | `PdfSectionLayout`, `CapabilityCard`, `StatusBadge`. |
| Navigation | Card click → Workspace preselected. Planned cards are **not links**; they show "Planned". |
| Data | Capability registry (static), recent PDF jobs (future `conversion_jobs`, filtered `module=pdf`). |
| Empty | "No conversions yet" + "Open Workspace". |
| Error | Recent jobs fail → `ErrorState` in that card only; capability grid still renders (static). |
| Loading | Skeleton for recent jobs table only. |
| Dependencies | Capability registry (Task 6), job store (Batch/History phase). |
| Guidelines | Info card: "Client guidelines are optional. Add them in Guidelines if a client supplied any." No warning. |

#### 2. Workspace
| Aspect | Specification |
| --- | --- |
| Purpose | Upload → choose capability → configure → run → review → download for one job. |
| Layout | Three-panel + bottom processing panel (§7). |
| Components | `PdfWorkspaceLayout`, `SourcePanel`, `PreviewPanel`, `SettingsPanel`, `ProcessingPanel`, `GuidelineSelector`, `StatusBadge`. |
| Controls | Upload, file select/remove, capability picker, target format, profile/preset select, guideline select (optional), Run, Cancel, Download. |
| Shared | All workspace panels; `GuidelinesSummary`. |
| Navigation | Deep-linkable `?capability=` and later `?job=`. Leaving with unsaved settings → `AlertDialog` (§14). |
| Data | Uploaded file refs, capability, effective settings, job status, logs, validation summary. |
| Empty | No files: centered upload zone in preview area + "Supported: PDF up to 25 MB" (from `DOCUMENT_UPLOAD_LIMITS`, not hard-coded). |
| Error | Upload rejection (validation codes, e.g. `ENCRYPTED_DOCUMENT`) shown per file in Source panel; job failure in Processing panel. |
| Loading | Per-file upload progress (`Progress`); preview skeleton; Run button spinner. |
| Dependencies | Shared uploader extraction, storage download route (R4), job type (R5), renderer (R1). |
| Guidelines | Selector defaults to "None — Standard Profile". Run is **never** disabled for missing guidelines. |

#### 3. Guidelines
| Aspect | Specification |
| --- | --- |
| Purpose | Optional management of client guideline sets for PDF jobs. |
| Layout | List/detail: table of guideline sets; detail drawer (`Sheet`) or detail route later. |
| Components | `GuidelineSetTable`, `GuidelineStatusChip`, `GuidelineRuleTable`, `ConflictPanel`, upload zone. |
| Controls | "Add guidelines" (secondary, never primary nag), upload files, company, version, effective date, applicable service/format, special instructions, review rules, map to setting, resolve conflict. |
| Shared | `components/guidelines/*` **(proposed)**, module-agnostic. |
| Navigation | Section reachable at any time; Workspace links here via "Manage guidelines". |
| Data | `GuidelineSet`, `GuidelineFile`, `GuidelineRule`, mappings, check results (Task 1 §6.3). |
| Empty | "No client guidelines. Jobs use the Standard Profile." Neutral `EmptyState`, not a warning. |
| Error | Upload/parse failure per file; unsupported rules listed (state Unsupported). |
| Loading | Table skeleton; per-file upload progress. |
| Dependencies | Client Guidelines phase (storage, extraction, resolver). TXT/XLSX allow-list for guidelines only (Task 1 §6.2 #3). |
| Guidelines | This **is** the guideline section. See §11–12. |

#### 4. Output Settings
| Aspect | Specification |
| --- | --- |
| Purpose | Default and per-job output options per target format. |
| Layout | Settings page: left section index (`lg+`), right grouped `Card` forms; sticky save bar. |
| Components | `SettingsGroup`, `SettingRow` (label, control, helper, source badge), `EffectiveValueBadge`. |
| Controls | Target format, quality, image compression/resolution, font embedding, color profile, metadata, accessibility tags. |
| Shared | Same `SettingRow` used inside the Workspace Settings panel. |
| Navigation | Unsaved-changes guard. |
| Data | Default settings, selected preset, guideline overrides → resolved effective value + **source** (Job guideline / Company profile / Preset / Default). |
| Empty | Never empty — defaults always exist. |
| Error | Field-level messages under control (`aria-describedby`); save failure as `Alert`. |
| Loading | Form skeleton. |
| Dependencies | `resolveEffectiveSettings` (Task 1 §6.3), checkbox/switch/radio/slider primitives. |
| Guidelines | Each overridden setting shows a source badge; conflicted setting shows `Conflict` and blocks **only that setting** until reviewed. |

#### 5. Page Layout
| Aspect | Specification |
| --- | --- |
| Purpose | Page size, margins, rotation, crop, reorder, merge, split. |
| Layout | Workspace variant: thumbnail grid (center) + operation settings (right). |
| Components | `PageThumbnailGrid` (slot), `SettingsPanel`, `Toolbar`. |
| Controls | Select pages, rotate, crop box, reorder (keyboard-operable move up/down, not drag-only), merge files, split ranges. |
| Shared | Workspace panels. |
| Navigation | Same as Workspace. |
| Data | Page count/labels (`readPdfPackage`), selection, operation list. |
| Empty | "Upload a PDF to edit page layout." |
| Error | Operation failure per page range. |
| Loading | Thumbnail skeletons. |
| Dependencies | `pdf-lib` operations (feasible, Task 1 §3B); thumbnails need a renderer (R1). |
| Guidelines | Page size/margin rules map here; conflicts surface on the affected setting. |

#### 6. Content Extraction
| Aspect | Specification |
| --- | --- |
| Purpose | Extract text, images, metadata, bookmarks, tables. |
| Layout | Workspace variant: results in center with `Tabs` (Text / Images / Metadata / …), options right. |
| Components | `Tabs`, `Table`, extraction result views, `StatusBadge` per extractor. |
| Controls | Extractor checklist, page range, export format. |
| Shared | Workspace panels; export pattern from Alt Text `export.ts`. |
| Navigation | In-page tabs only. |
| Data | `PdfPackage`, `PdfTextLayout`, `PdfExtractionReport.limitations`. |
| Empty | "No extraction run yet." |
| Error | Limitations (e.g. `TEXT_UNREADABLE`, unsupported image codecs JPX/CCITT/JBIG2) shown as warnings **with the reason**, not as failures. |
| Loading | Per-extractor progress. |
| Dependencies | Move `lib/alt-text/pdf-*.ts` to shared `lib/pdf/*` with re-exports (Task 1 P1-4). |
| Guidelines | Extraction rules (e.g. "preserve heading hierarchy") map to options. |

#### 7. Compliance Profiles
| Aspect | Specification |
| --- | --- |
| Purpose | Define/select target standards (PDF/A, PDF/UA, PDF/X) and their check sets. |
| Layout | Card list of profiles; detail drawer with rule list. |
| Components | `Card`, `StatusBadge`, `Table`. |
| Controls | Select profile, view rules, set as default for a preset. |
| Shared | Profiles consumed by Preflight and Workspace. |
| Navigation | Profile → "Run preflight with this profile". |
| Data | Profile definitions (static first), validator availability. |
| Empty | Not applicable (built-in list). |
| Error | Load failure → `ErrorState`. |
| Loading | Card skeletons. |
| Dependencies | External validator (Task 1 §7.1, veraPDF not installed). |
| Guidelines | Client may require a standard; shown as a mapped rule. **Never** labels a document "PDF/A compliant" without a validator result. |

#### 8. Preflight
| Aspect | Specification |
| --- | --- |
| Purpose | Run checks and present a findings report. |
| Layout | Report: summary bar (counts by severity) → filterable findings table → finding detail drawer. |
| Components | `ValidationSummary`, `FindingsTable`, `Sheet`, `StatusBadge`. |
| Controls | Choose profile, Run, filter by severity/category/page, export report. |
| Shared | `ValidationSummary` also in Workspace Processing panel. |
| Navigation | Finding → jump to page in Output Preview (later). |
| Data | Validation state (§9), findings `{ id, ruleId, severity, page?, message, source: standard/guideline/technical }`. |
| Empty | "Not run" state with "Run preflight". |
| Error | Engine unavailable → "Unavailable" state naming the missing capability. |
| Loading | Running state with progress; table skeleton. |
| Dependencies | Preflight engine phase. |
| Guidelines | Guideline-derived checks are tagged `source=guideline`; result per rule = Verified / Not verifiable / Failed. |

#### 9. Batch Processing
| Aspect | Specification |
| --- | --- |
| Purpose | Many files, one configuration. |
| Layout | Table-first: batch list → batch detail (progress header + items table). |
| Components | `Table`, `Progress`, `StatusBadge`, batch toolbar. |
| Controls | New batch, pause, resume, cancel, retry failed, export results. |
| Shared | Same components as shared `batch-center` with `module="pdf"`. |
| Navigation | Item → Workspace in read-only job view. |
| Data | Batch + items with processing state (§9). Pattern: `lib/alt-text/batch-*`. |
| Empty | "No batches yet." |
| Error | Per-item failure reason; batch-level failure banner. |
| Loading | Table skeleton; progress polled via SWR. |
| Dependencies | Job queue + latency fix (R2, R5). |
| Guidelines | One guideline set per batch (optional), shown in batch header. |

#### 10. Output Preview
| Aspect | Specification |
| --- | --- |
| Purpose | Inspect output, compare with source. |
| Layout | Full-width viewer with toolbar; optional side-by-side split. |
| Components | `PreviewPanel` (same as Workspace center), `DocumentToolbar`. |
| Controls | Page nav, zoom, fit width/page, mode (Source / Output / Side-by-side), download. |
| Shared | `PreviewPanel`. |
| Navigation | `?job=&page=` deep link. |
| Data | Scan-gated output stream (pattern `lib/alt-text/preview.ts`). |
| Empty | "Select a completed job to preview." |
| Error | Stream blocked by scan gate → explicit message; render failure → download fallback. |
| Loading | Page skeleton at viewer aspect ratio. |
| Dependencies | Renderer decision (R1), storage download route (R4). |
| Guidelines | Optional overlay of findings per page. |

#### 11. Profiles & Presets
| Aspect | Specification |
| --- | --- |
| Purpose | Saved reusable configurations (preset) and company profiles. |
| Layout | Table with type filter (Preset / Company profile); detail drawer. |
| Components | `Table`, `Sheet`, `SettingRow` (read-only), `StatusBadge`. |
| Controls | Create, duplicate, edit, archive, set default, version view. |
| Shared | Same component as shared `profiles-presets` page, filtered `module="pdf"`. |
| Navigation | "Use in Workspace". |
| Data | Future `conversion_profiles` (Task 1 §9 #11), versioning pattern `alt_text_versions`. |
| Empty | "Standard Profile is always available." + "Create preset". |
| Error | Standard. |
| Loading | Table skeleton. |
| Dependencies | Profiles phase. |
| Guidelines | A company profile may link a guideline set; priority in §12. |

#### 12. History
| Aspect | Specification |
| --- | --- |
| Purpose | Audit trail and re-download of PDF jobs. |
| Layout | Filterable table → job detail drawer (settings snapshot, guideline state, events, outputs). |
| Components | `Table`, `StatusBadge`, `Sheet`, filters (`Select`, `Input`). |
| Controls | Filter by status/capability/date, search, re-download, re-run with same settings. |
| Shared | Same as shared `history`/`jobs`/`downloads` with `module="pdf"`. |
| Navigation | Row → detail; "Open in Preview". |
| Data | Jobs + `platform_background_job_events`. |
| Empty | "No PDF jobs yet." |
| Error | Standard. |
| Loading | Table skeleton. |
| Dependencies | `conversion_jobs` store. |
| Guidelines | Snapshot of guideline set id/version and final guideline state per job (immutable). |

---

## 5. UI Design System Specification

All values reuse `app/globals.css` tokens and existing Tailwind usage. **No new tokens.**

### 5.1 Typography (Geist Sans; Geist Mono for IDs, file sizes, page numbers, logs)

| Role | Classes | Source |
| --- | --- | --- |
| Page heading (h1) | `text-2xl font-semibold tracking-tight text-balance` | `PageHeader` |
| Page description | `text-sm text-muted-foreground text-pretty` | `PageHeader` |
| Section heading (h2) | `text-base font-semibold` | — |
| Group/category label | `text-sm font-semibold uppercase tracking-wide text-muted-foreground` | `ConversionServiceGrid` |
| Card title | `font-medium` | `ConversionServiceGrid` |
| Form label | `text-sm font-medium` (`Label`) | `label.tsx` |
| Body / table text | `text-sm` | `table.tsx` |
| Descriptions | `text-sm leading-relaxed text-muted-foreground` | `ConversionServiceGrid` |
| Helper text | `text-xs text-muted-foreground` (linked via `aria-describedby`) | — |
| Status label | `text-xs font-medium` inside `Badge` | `badge.tsx` |
| Breadcrumb | `text-xs text-muted-foreground` | `Breadcrumbs` |
| Mono data | `font-mono text-xs tabular-nums` | — |

### 5.2 Color

| Use | Token / class |
| --- | --- |
| Primary action | `Button` default → `bg-primary text-primary-foreground` (navy `oklch(0.36 0.09 258)`) |
| Secondary action | `Button variant="outline"` or `"secondary"` |
| Tertiary / toolbar | `Button variant="ghost"` |
| Destructive | `Button variant="destructive"` |
| Page background | `bg-background` |
| Surfaces | `bg-card`; panels `bg-card`, panel headers `bg-muted/40` |
| Borders / dividers | `border` (`--border`), `Separator` |
| Selected (nav, row) | Existing `tabClass(active)` style for tabs; rows `bg-accent` + `aria-selected` |
| Hover | `hover:bg-accent/40 hover:border-primary/40` (from service cards) |
| Focus | `focus-visible:ring-2 focus-visible:ring-ring` |

**Status palette — existing convention** (already used across `components/publishing/alt-text/*`, e.g. `batch-progress-dashboard.tsx`, `alt-text-history.tsx`):

| Status | Background / border / text |
| --- | --- |
| Success | `bg-emerald-50 border-emerald-200 text-emerald-800` (icon `text-emerald-700`) |
| Warning / review | `bg-amber-50 border-amber-200 text-amber-800` |
| Info / in progress | `bg-sky-50 border-sky-200 text-sky-800` |
| Error | `bg-red-50 border-red-200 text-red-800`, or `destructive` variants |
| Neutral / not provided / planned | `Badge variant="outline"` / `secondary` |

Color is **never** the only signal: every status has an icon + text label. Centralize the mapping in one `StatusBadge` (§8) so the palette lives in one file; if dark-mode parity is needed, Task 11 adds `dark:` variants there only.

### 5.3 Spacing

| Area | Value |
| --- | --- |
| Page padding | `p-4 sm:p-6 md:p-8` (existing pages) |
| Page vertical rhythm | `flex flex-col gap-6` |
| Header internal | `gap-3` (`PageHeader`) |
| Card padding | `p-5` (service card) / `Card` defaults |
| Card grid | `grid gap-4 sm:grid-cols-2 xl:grid-cols-3` |
| Form groups | `gap-6` between groups, `gap-4` between rows, `gap-1.5` label→control→helper |
| Table density | Default `table.tsx` rows; compact density (`h-9` rows) for Batch/History only |
| Workspace panel gap | `0` with `border` dividers (panels share edges; maximizes preview) |
| Panel inner padding | `p-3` headers, `p-4` bodies |
| Radius | `--radius: 0.5rem` (`rounded-lg` cards, `rounded-md` controls) |

### 5.4 Components

| Component | Spec |
| --- | --- |
| Buttons | One primary per view. Icon-only buttons need `aria-label` + `Tooltip`. Loading: `Spinner` + text kept, `disabled`, `aria-busy`. |
| Inputs | `Input`/`Textarea` with `Label`; error → `aria-invalid` + message below. |
| Dropdowns | `Select` for values; `DropdownMenu` for actions. |
| Tabs | Routing tabs = `ConversionModuleTabs` (links). In-page = `Tabs` (`variant="line"` inside panels). |
| Cards | `Card`; clickable card = whole card is a single `Link` (service-card pattern). |
| Tables | `Table` in `overflow-x-auto` wrapper; sticky header for long lists; row actions in `DropdownMenu`. |
| Dialogs | `AlertDialog` for confirm/destructive/unsaved. |
| Drawers | `Sheet` right for details/settings, left for source on tablet, bottom for processing on mobile. |
| Tooltips | Supplementary only; never hold required info. |
| Upload zones | Dashed `border-dashed rounded-lg` (same as `PlannedPage`'s `Empty`), keyboard-activatable button, accepted types/limits from contract constants. |
| File lists | Rows: icon, name (truncate + `title`), size (mono), status badge, remove button. |
| Status indicators | `StatusBadge` (§8). |
| Progress | `Progress` with visible % and `aria-valuenow`; indeterminate → `Spinner` + label. |

---

## 6. Header & Navigation Architecture

### 6.1 Global PDF header (`PageHeader`)

```
Modules › Publishing › Conversion › PDF › {Section}          (Breadcrumbs)
[FileText] {Section title}                [secondary…] [Primary]
{Section description}
[GuidelineStatusChip]  (Workspace/job contexts only)
```

| Element | Source |
| --- | --- |
| Breadcrumb | `[...PUBLISHING_CRUMBS, CONVERSION_CRUMB, { label: "PDF", href }, { label: section }]`; on Overview the last crumb is "PDF". |
| Module name | Registry `label` ("PDF") |
| Icon | Registry `icon` (`FileText`) |
| Title | Overview: "PDF"; sections: section label |
| Description | Section description from registry (Task 5 adds optional per-page descriptions; fallback = module description) |
| Primary action | Per section: Overview "Open Workspace"; Workspace "Run" (in workspace toolbar, not header — see §7); Guidelines "Add guidelines" *(secondary styling)*; Preflight "Run preflight"; Batch "New batch"; Profiles "New preset"; History none. Settings pages: "Save" in sticky footer. |
| Secondary actions | Max 2 visible; rest in `DropdownMenu` "More". |

Planned sections show **no** primary action.

### 6.2 Internal navigation (improve `ConversionModuleTabs`)

| Requirement | Design |
| --- | --- |
| Pattern | Keep link-based tab strip (`<nav aria-label>` → `<ul>` → `<Link aria-current="page">`). It is navigation, so **not** ARIA `tablist` (correct as today). |
| Order | The 12 sections in §4.0 order. |
| Active | Existing `tabClass(true)` + `aria-current="page"`. |
| Overflow ≥ md | Horizontal scroll (existing `overflow-x-auto`) + active tab `scrollIntoView({ inline: "nearest" })` on mount + edge fade masks. Optional (Task 5 decides): "More" `DropdownMenu` for tabs past available width. |
| < md | Replace strip with a full-width section switcher: button showing current section → `DropdownMenu` of 12 links. Prevents a 12-item scroll row on phones. |
| Grouping | Visual separators only (no extra click depth): **Start** (Overview, Workspace, Guidelines) · **Configure** (Output Settings, Page Layout, Content Extraction, Compliance Profiles) · **Verify & Run** (Preflight, Batch Processing, Output Preview) · **Manage** (Profiles & Presets, History). |
| Keyboard | Tab/Shift+Tab through links; Enter activates. Visible focus ring. |
| Undeveloped | All 12 routes exist and render `PlannedPage`; optional small "Planned" dot is **not** added (avoids noise) — the page itself states it. |
| Route safety | No slug changes; `generateStaticParams` unchanged in shape. |
| Scope | Improvement is inside `conversion-nav.tsx`, so all 26 modules benefit identically. |

### 6.3 Main content containers

| Container | Use | Classes |
| --- | --- | --- |
| `page` | Overview, Settings, Guidelines, Profiles, History, Batch, Preflight | existing `flex min-w-0 flex-col gap-6 p-4 sm:p-6 md:p-8` |
| `settings` | Output Settings, Compliance | `page` + `lg:grid lg:grid-cols-[200px_minmax(0,1fr)] gap-8`, sticky footer |
| `workspace` | Workspace, Page Layout, Content Extraction, Output Preview | full-bleed below header+tabs (§7), no page padding on panels |
| `report` | Preflight | summary row + table |
| `table` | Batch, History, Profiles | toolbar row + `overflow-x-auto` table |

### 6.4 Contextual panels

| Panel | Container | Trigger |
| --- | --- | --- |
| Settings panel | Workspace right / `Sheet` right on ≤ lg | — / "Settings" button |
| File information | `Sheet` right (pattern `image-details-sheet.tsx`) | "Details" on file row |
| Guideline summary | Card at top of Settings panel; `Sheet` for full view | Chip click |
| Validation findings | Processing panel tab; `Sheet` for one finding | Row click |
| Processing details | Processing panel tab "Logs" | — |

---

## 7. Three-Panel Workspace Blueprint

```
┌──────────────── PageHeader + ConversionModuleTabs ────────────────┐
├─ Workspace toolbar (sticky): capability · target · [Run] [Cancel] ┤
├──────────┬────────────────────────────────────────┬──────────────┤
│ SOURCE   │ PREVIEW                                 │ SETTINGS     │
│ upload   │ ┌ Document toolbar (sticky) ──────────┐ │ source fmt   │
│ files    │ │ page ◀ 3/120 ▶  zoom  fit  mode     │ │ target fmt   │
│ metadata │ └─────────────────────────────────────┘ │ output opts  │
│ thumbs   │          document canvas                │ quality      │
│          │      (largest area, own scroll)         │ profile      │
│          │                                         │ guidelines ○ │
│          │                                         │ advanced ▸   │
├──────────┴────────────────────────────────────────┴──────────────┤
│ PROCESSING  [Status] [Logs] [Warnings] [Errors] [Validation]  ▾  │
└──────────────────────────────────────────────────────────────────┘
```

### 7.1 Panel content

| Panel | Holds (slots) |
| --- | --- |
| Source (left) | Upload zone, file list with selection, file metadata (name, size, pages, PDF version, tagged?, likely scanned?), page thumbnails, source navigation (outline later) |
| Preview (center) | `DocumentToolbar` (page nav, zoom, fit, mode `Tabs`: Source / Output / Side-by-side), canvas slot, compare split |
| Settings (right) | Source format (read-only, detected), target format, output options, quality, profile/preset, **optional** `GuidelineSelector` + `GuidelinesSummary`, collapsible Advanced |
| Processing (bottom) | In-panel `Tabs` (`variant="line"`): Status, Logs (mono), Warnings, Errors, Validation (`ValidationSummary`); count badges on each tab |

### 7.2 Proportions (desktop ≥ xl / 1280px)

| Panel | Default | Min | Max | Collapsed |
| --- | --- | --- | --- | --- |
| Source | 280px | 240px | 360px | 48px icon rail |
| Preview | `minmax(480px, 1fr)` | 480px | — | never |
| Settings | 320px | 280px | 400px | 48px icon rail |
| Processing | 200px tall | 40px (header only) | 40vh | header bar only |

Phase 1 uses **fixed defaults + collapse toggles** (CSS grid `grid-cols-[auto_minmax(0,1fr)_auto]`). Drag-resizing needs a new dependency (shadcn `resizable` → `react-resizable-panels`); decision deferred to the Upload & Workspace phase. Collapse state persists per user in `localStorage` (UI preference only — not business data).

### 7.3 Collapse, scroll and sticky rules

- Each panel body scrolls **independently** (`min-h-0 overflow-y-auto`); the page itself does **not** scroll in workspace mode → no nested page+panel scroll.
- Panel headers and `DocumentToolbar` are sticky within their panel.
- The workspace toolbar (Run/Cancel) is always visible; it is the Workspace's primary-action location.
- Collapse buttons: `aria-expanded`, `aria-controls`, label "Collapse source panel"; keyboard shortcut optional later (documented, not required).
- Processing panel auto-expands on first error or warning, never on routine status updates.

### 7.4 Responsive changes (detail in §13)

| Breakpoint | Layout |
| --- | --- |
| ≥ xl (1280) | 3 panels + bottom |
| lg (1024–1279) | Source collapsed to rail by default; Settings open; bottom panel 160px |
| md (768–1023) | Preview only; Source = `Sheet side="left"`, Settings = `Sheet side="right"`; Processing = collapsible bar |
| < md | Single column stacked: upload/file list → preview (aspect-fit) → "Settings" button (`Sheet side="bottom"`) → processing summary; sticky bottom action bar with Run |

### 7.5 States

| State | Behavior |
| --- | --- |
| Empty (no document) | Preview area hosts the upload zone; Settings shows defaults (enabled, editable); Processing shows "Not started"; Run disabled with visible reason "Add a source file" |
| Loading document | Preview skeleton at page aspect ratio; Source row shows progress |
| Capability planned | Settings panel shows `Alert`: "{Capability} is planned and not yet available." Run absent, not merely disabled |
| Upload rejected | Per-file error with code mapped to plain language (e.g. encrypted PDF, active content) |
| Job failed | Processing panel opens on Errors tab; toolbar shows "Retry" |
| Preview unavailable | Message + "Download output" fallback |

### 7.6 Height model

Workspace root: `flex min-h-0 flex-1 flex-col` inside the shell's main column, with header+tabs as `shrink-0`. No hard-coded `calc(100dvh - Npx)`; requires the route container to be a flex column filling `min-h-dvh` (the `AppShell` root is already `flex min-h-dvh flex-col md:flex-row`). Task 7 verifies.

---

## 8. Reusable Component Architecture

Names follow repo convention (kebab-case files, PascalCase exports). Generic components get generic names so other modules can adopt them; PDF-only ones carry `Pdf`.

| Component (proposed) | File (proposed) | Reuses | Responsibilities | Props / state | Parent → children | Used by sections | Task |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `PdfSectionLayout` | `components/publishing/conversion/pdf/pdf-section-layout.tsx` | `PageHeader`, `ConversionModuleTabs` | Header + nav + container variant | `section`, `title`, `description`, `actions?`, `variant: page/settings/workspace/report/table`, `children` | route page → header, nav, content | all 12 | 3–4 |
| *(improve)* `ConversionModuleTabs` | `components/publishing/conversion/conversion-nav.tsx` | existing `TabStrip` | Overflow, scroll-into-view, mobile switcher, group separators | `module`, `activePage` (unchanged API) | layout → links | all | 5 |
| `CapabilityCard` | `components/publishing/conversion/capability-card.tsx` | service-card markup, `Badge` | Show capability + honest status; link only if Available | `capability: CapabilityDefinition` | Overview grid | 1 | 6 |
| `ConversionWorkspaceLayout` | `components/publishing/conversion/workspace/workspace-layout.tsx` | `Sheet` | Panel grid, collapse, responsive swap to drawers | `source`, `preview`, `settings`, `processing` (slots), `toolbar` | section → 4 panels | 2, 5, 6, 10 | 7 |
| `WorkspacePanel` | same folder `workspace-panel.tsx` | `Button`, `Tooltip` | Header, collapse, scroll body, empty slot | `title`, `side`, `collapsed`, `onCollapsedChange`, `actions?`, `children` | layout → content | 2, 5, 6, 10 | 7 |
| `SourcePanel` / `PreviewPanel` / `SettingsPanel` / `ProcessingPanel` | `workspace/*` | above + `Tabs`, `Progress` | Slot frames only in Phase 1 (empty/loading/error states wired) | content-specific; Phase 1 = state props only | `WorkspacePanel` children | 2, 5, 6, 10 | 7 |
| `StatusBadge` | `components/enterprise/status-badge.tsx` | `Badge`, palette §5.2 | One mapping `{ kind, status } → icon + label + tone` for processing, validation, guideline, capability | `kind`, `status`, `size?` | anywhere | all | 8 |
| `SectionState` (empty/error/loading/unavailable) | extend `components/enterprise/data-state.tsx` | `EmptyState`, `ErrorState`, `Empty`, `Skeleton` | Add `UnavailableState` + optional action to `EmptyState` (additive props) | `title`, `description`, `action?` | anywhere | all | 8 |
| `SettingRow` | `components/publishing/conversion/settings/setting-row.tsx` | `Label` | Label, control, helper, **value source badge**, conflict marker | `id`, `label`, `helper?`, `source?`, `conflict?`, `children` | settings forms | 2, 4, 5, 6 | 8 |
| `GuidelineStatusChip` | `components/guidelines/guideline-status-chip.tsx` | `StatusBadge` | Show guideline state; neutral for Not Provided | `state`, `setName?` | header, panels, tables | 2, 3, 9, 12 | 9 |
| `GuidelineSelector` | `components/guidelines/guideline-selector.tsx` | `Select` | Choose guideline set; default "None — Standard Profile" | `value`, `options`, `onChange`, `module` | Settings panel | 2, 9 | 9 |
| `GuidelinesSummary` | `components/guidelines/guidelines-summary.tsx` | `Card`, `Alert` | Applied / conflicts / unsupported counts; link to review | `resolution: GuidelineResolution` | Settings panel, job detail | 2, 4, 12 | 9 |
| `ValidationSummary` | `components/publishing/conversion/validation-summary.tsx` | `StatusBadge`, `Table` | Counts by severity + top findings | `state`, `findings` | Processing panel, Preflight | 2, 8 | 8 |

Not created (avoid fragmentation): separate `PdfModuleHeader` (= `PageHeader` with props), `PdfModuleNavigation` (= improved `ConversionModuleTabs`), `PdfEmptyState`/`PdfErrorState` (= enterprise states), `PdfServiceCard` (= `CapabilityCard`).

---

## 9. State & Data Flow Design

### 9.1 State model

```ts
// Types only (proposed, Task 6/9). Not implemented.
type ProcessingStatus = "pending" | "queued" | "processing" | "completed" | "failed" | "cancelled"
type ValidationStatus = "not_run" | "running" | "passed" | "failed" | "review_required"
type GuidelineState =
  | "not_provided" | "uploaded" | "pending_review" | "reviewed" | "applied"
  | "conflict" | "unsupported" | "verification_pending" | "verified" | "failed"
```

`ProcessingStatus` maps onto existing `lib/background-jobs.ts` statuses: `queued→queued`, `running→processing`, `completed→completed`, `failed`/`dead_letter→failed`, `cancelled→cancelled`; `pending` = client-side before enqueue.

### 9.2 Ownership

| State | Fields | Owner | Persistence |
| --- | --- | --- | --- |
| Document | selected file ids, source format (detected), target format, metadata, page selection | Workspace client state (`useReducer` in `ConversionWorkspaceLayout` context) | File refs + metadata: backend (`app_files`); selection: URL/local |
| Configuration | capability, profile/preset id, output settings, advanced, guideline set id | Workspace context; resolved values from server | Draft: local; on Run: snapshot persisted with job |
| Preview | current page, zoom, mode, selected document | `PreviewPanel` local; page in URL `?page=` | None (URL only) |
| Processing | status, progress, logs, warnings, errors | Server; client reads via **SWR** polling `jobId` | Backend (jobs + events) |
| Validation | status, findings | Server; SWR | Backend |
| Guidelines | set, files, rules, state, resolution | Server; SWR in Guidelines section and selector | Backend (`lib/guidelines/*` proposed) |
| UI prefs | panel collapse, table density | `localStorage` | Client only (non-business) |

Rules: no `fetch` in `useEffect` (SWR only, as in Alt Text hooks); no new global store library; URL holds shareable state (`capability`, `job`, `page`); server holds anything auditable.

### 9.3 Flow (future)

```
Upload → app_files ref ─┐
Capability + preset ────┼─► resolveEffectiveSettings(defaults, preset, companyProfile?, jobGuidelines?)
Guideline set (opt.) ───┘        → { settings, sources, appliedRules, unsupported, conflicts }
                                    │ conflicts on a setting → that setting needs review; others proceed
Run → enqueue job (snapshot settings + guideline version) → SWR poll → completed/failed
    → validation (standard + technical + guideline checks) → per-rule Verified / Not verifiable / Failed
```

---

## 10. Conversion Capability Registry Design

### 10.1 Contract (proposed, extends `lib/conversion-modules.ts` data pattern; Task 6)

```ts
type CapabilityStatus = "available" | "partially_available" | "planned" | "unsupported" | "unverified"
type CapabilityCategory = "pdf-to-documents" | "pdf-to-publishing" | "pdf-to-images" | "documents-to-pdf" | "advanced-pdf"

interface CapabilityDefinition {
  id: string                    // "pdf.to-docx"
  label: string
  category: CapabilityCategory
  inputFormats: string[]        // extensions
  outputFormats: string[]
  settings: string[]            // setting keys rendered by SettingsPanel
  guidelineCategories: string[] // rule categories that may map here
  preview: "none" | "page" | "text" | "image" | "side-by-side"
  validation: string[]          // check ids
  status: CapabilityStatus
  statusNote?: string           // evidence/limitation, user-visible
  engine?: string               // shared engine id when reused from another submodule
}
```

UI rules: only `available` renders a Run path. `partially_available` renders Run **with** `statusNote` visible. `planned`/`unsupported` render a status badge and description only. `unverified` = code exists but not tested end-to-end — shown as "Preview" label and excluded from batch.

### 10.2 Initial status (from Task 1 §3 evidence)

| Category | Capability | Status | Note / engine reuse |
| --- | --- | --- | --- |
| PDF → Documents | Word, Excel, PowerPoint, Markdown, RTF | Planned | Excel: `exceljs` writer exists, no table detection. Word: reuse future Word submodule engine. |
| | Text | Partially Available *(engine only)* | `readPdfPackage({ collectText })`; not exposed → shown as **Planned** until a route exists |
| PDF → Publishing | XML, JATS, HTML, XHTML, ePub, Structured Data | Planned | Reuse XML/JATS/HTML/ePub submodule engines; `fast-xml-parser` builder |
| PDF → Images | PNG, JPEG, TIFF | Planned | Needs renderer (R1). Embedded image extraction is a Content Extraction feature, not page render |
| | SVG | Unsupported (for now) | SVG blocked in uploads/preview (R7) |
| Documents → PDF | Word, Excel, PowerPoint, HTML, XML → PDF | Planned | Needs native runtime (R1); HTML input blocked (R7) |
| | Images → PDF | Planned | Feasible with `pdf-lib` `embedPng/embedJpg` |
| Advanced | Merge, Split, Rotate, Crop, Reorder | Planned | Feasible with `pdf-lib` |
| | Compression, Optimization | Planned | Real downsampling needs native tool |
| | OCR, Searchable PDF | Planned | Detection only exists (`likely_scanned_page`) |
| | PDF/A, PDF/UA, PDF/X | Planned | No validator; never claim conformance |
| | Forms | Unsupported (for now) | JS actions rejected by validator (R6) |
| Extraction | Image extraction | Partially Available *(Alt Text only)* | `extractPdfImages`; exposed for PDF after `lib/pdf/*` move |

**Display rule:** "engine exists in another module" ≠ available in PDF. Until a PDF route ships, Overview shows these as **Planned** with note "Engine available; integration planned".

---

## 11. Optional Client Guidelines Architecture

### 11.1 Scenario A — no guidelines

| Surface | Behavior |
| --- | --- |
| Header chip | "Not Provided — Standard Profile" (neutral outline badge, no icon of warning) |
| Workspace Settings | `GuidelineSelector` = "None — Standard Profile"; Run enabled |
| Validation | Standard + technical checks only; no "missing guidelines" finding |
| History | Records `guideline_state = not_provided` |
| Copy | Never "Add guidelines to continue", never warning tone |

### 11.2 Scenario B — guidelines provided

| Capability | UI element |
| --- | --- |
| Upload (multiple files) | Upload zone in Guidelines create drawer; PDF/DOCX/TXT/XLSX (TXT/XLSX allowed for guidelines only) |
| Company, version, effective date, applicable service/format, special instructions | Form fields in guideline set form |
| Reusable company profiles | Link set to company profile (Profiles & Presets) |
| Preview | Document preview slot (same `PreviewPanel` once renderer exists; text fallback) |
| Rule review | `GuidelineRuleTable`: rule text, source (file + page/section), category, mapped setting, support level, state |
| Rule-to-setting mapping | Per-rule `Select` of setting keys from the capability's `settings` |
| Validation | Guideline checks tagged `source=guideline` in findings |
| Exceptions | Per-rule "Accept exception" with mandatory reason, recorded in history |

### 11.3 State lifecycle

```
not_provided ─(upload)─► uploaded ─(extraction/manual)─► pending_review ─(reviewer)─► reviewed
reviewed ─(resolve)─► applied | conflict | unsupported
applied ─(job run)─► verification_pending ─(checks)─► verified | failed
conflict ─(review resolves)─► applied        unsupported = reported, never silently dropped
```

**Uploaded ≠ Applied ≠ Verified.** Chip text always names the exact state; "Compliant" wording appears only for `verified`.

### 11.4 Integration contract (proposed, module-agnostic)

```ts
interface GuidelineModuleAdapter {
  module: "pdf" | "word" | "xml" | "epub" | "html" | "editorial" | "accessibility"
  settingKeys: string[]                         // mappable targets
  mapRule(rule: GuidelineRule): MappedSetting | { unsupported: string }
  checks: Array<{ ruleCategory: string; checkId: string }>
}
interface GuidelineResolution {
  state: GuidelineState
  settings: Record<string, unknown>
  sources: Record<string, "job_guideline" | "company_profile" | "preset" | "default">
  applied: string[]; unsupported: string[]; conflicts: GuidelineConflict[]
}
```

Components in `components/guidelines/*` take `module` as a prop and no PDF imports, so other modules reuse them unchanged. Other modules are **not** modified now.

---

## 12. Guideline Priority & Conflict Handling

### 12.1 Priority (highest first)

0. **Mandatory safety & technical constraints** — upload validation, size limits, encryption/active-content policy, format capability. Not overridable by any level.
1. Job-specific guidelines
2. Selected company profile
3. Selected conversion preset
4. Standard default settings

Each resolved setting carries its `source`; `SettingRow` displays it (e.g. "From client guideline v2.1").

### 12.2 Conflicts

| Type | Example | Handling |
| --- | --- | --- |
| Guideline vs safety/technical | "Embed JavaScript" vs active-content rejection | Constraint wins; rule state `unsupported` with reason |
| Guideline vs guideline (same set or job vs profile) | Two margin values | `conflict`; setting needs review |
| Guideline vs capability | "Output PDF/A-3" without validator | `unsupported` for verification; conversion may proceed, compliance **not claimed** |

UI for a conflict (`ConflictPanel`, `Alert` amber tone):
- Affected setting name and current resolved value.
- Each conflicting requirement with its source (file, page/section, level).
- Actions: choose value, accept exception (reason required), mark unsupported.
- Only the affected setting is held; other settings and Scenario A jobs are unaffected. If the job is run with an unresolved conflict, the job record and report state the conflict explicitly; status cannot reach `verified`.

---

## 13. Responsive Design Specification

Uses Tailwind default breakpoints already used in the repo (`sm` 640, `md` 768 — the shell sidebar switches at `md`, `lg` 1024, `xl` 1280).

| Device | Range | Navigation | Workspace | Pages |
| --- | --- | --- | --- | --- |
| Desktop | ≥ xl | Full tab strip | 3 panels + bottom | grid `xl:grid-cols-3`, settings 2-col |
| Laptop | lg | Tab strip, scroll/More | Source rail, Settings open, compact toolbars (icon + tooltip for secondary) | grid 2–3 cols |
| Tablet | md | Tab strip scroll | Preview only; Source/Settings as `Sheet`; processing bar | grid `sm:grid-cols-2`; tables scroll horizontally in their wrapper |
| Mobile | < md | Section switcher dropdown | Upload-first single column; sticky bottom action bar; settings bottom `Sheet` | single column; tables → stacked row cards for History/Batch |

Overflow guarantees: every container `min-w-0`; long file names `truncate` + `title`; tables inside `overflow-x-auto` only (page never scrolls horizontally); one scroll container per region (no nested scroll in the same axis); critical actions (Run, Save) never truncated or hidden behind overflow menus. Touch targets ≥ 24×24 CSS px (WCAG 2.5.8), primary actions 36–40px.

---

## 14. Accessibility & UX Standards (WCAG 2.2 AA)

### 14.1 Requirements

| Area | Standard |
| --- | --- |
| Landmarks/headings | One `h1` per page (`PageHeader`); panels are `section` with `aria-labelledby` `h2`; nav labelled ("PDF sections") |
| Keyboard | All actions reachable; no drag-only interaction (reorder has buttons); `Sheet`/`AlertDialog` trap focus and return it; Esc closes |
| Focus | `focus-visible:ring-2 ring-ring` everywhere; focus not obscured by sticky bars (2.4.11) — add `scroll-padding` equal to sticky heights |
| Labels | Every control has `Label`/`aria-label`; icon buttons have text alternative |
| Live regions | Processing status changes announced via `aria-live="polite"`; errors via `role="alert"` (existing `ErrorState`) |
| Contrast | 4.5:1 text, 3:1 UI/focus; verify `--muted-foreground` and amber/emerald text combos (Task 11) |
| Validation messages | Specific, next to field, linked via `aria-describedby`; summary at top for multi-field errors |
| Tables | `<th scope>`; caption or `aria-label`; mobile card fallback keeps label/value pairs |
| Disabled | Prefer hidden/absent over disabled for unavailable capabilities; when disabled, show the reason in text |
| Unsaved changes | `AlertDialog` on in-app navigation; `beforeunload` for tab close on Settings/Guidelines forms |
| Motion | Respect `prefers-reduced-motion` for transitions |
| Target size | ≥ 24×24 px (2.5.8) |
| Consistent help | Help/guidance link in the same header position across sections (3.2.6) |

### 14.2 Predictability

Same header, same tab position, same primary-action position per layout variant; routing never changes on focus; Run never auto-starts.

### 14.3 State patterns

| State | Pattern | Copy rule |
| --- | --- | --- |
| Empty | `EmptyState` + one action | Say what will appear and how to start |
| Loading | `Skeleton` shaped like content; `aria-busy` on region | — |
| Error | `ErrorState` (`role="alert"`) + retry | What failed, why (if known), what to do |
| Success | Inline emerald `StatusBadge` + optional toast | State the result, e.g. "Converted 1 file" (only from real data) |
| Unavailable | `UnavailableState` / `PlannedPage` | "Planned" or named missing dependency; no fake controls |

No placeholder business data or fabricated results in any state.

---

## 15. Future Development Dependencies

| Future phase | Depends on (this doc) | External prerequisite (Task 1) |
| --- | --- | --- |
| Overview Dashboard | §4.2-1, §10 registry, `CapabilityCard` | Job store |
| Upload & Workspace | §7, workspace components, §9 | Shared uploader extraction, R4 route, R5 job type, R2 latency |
| PDF Viewer | `PreviewPanel` slot, §7.5 | Renderer decision (R1), scan-gated stream |
| Output Settings | §4.2-4, `SettingRow`, §12 sources | Form primitives via shadcn CLI, settings store |
| Client Guidelines | §11–12, `components/guidelines/*` | `lib/guidelines/*`, TXT/XLSX allow-list (guidelines only) |
| Content Extraction | §4.2-6 | `lib/alt-text/pdf-*` → `lib/pdf/*` with re-exports |
| Preflight | §4.2-8, `ValidationSummary` | Check engine |
| Batch Processing | §4.2-9, shared view w/ `module` filter | Batch job type |
| Conversion Engines | §10 statuses flip per engine | R1 runtime |
| Compliance Validation | §4.2-7, §12 "never claim" rule | External validator |
| Final QA | §18 checklist, Task 1 §8.2 | — |

---

## 16. Task 3–12 Implementation Mapping (Phase 1)

| Task | Implements | Files touched (expected) | Out of scope |
| --- | --- | --- | --- |
| 3 Module Foundation | PDF branch in `[submodule]/page.tsx` and `[submodule]/[page]/page.tsx` rendering `PdfSectionLayout`; section → component map with `PlannedPage` fallback; layout variants (§6.3) | both route files, `components/publishing/conversion/pdf/*` (new) | Real features |
| 4 Header & Breadcrumbs | `PageHeader` with module icon, section titles/descriptions, action slots (§6.1) | PDF branch, optional per-page description field in registry | Changing `PageHeader` API |
| 5 Internal Navigation | Add Guidelines + Profiles & Presets to PDF `pages()`; label override for Preflight (slug kept); `ConversionModuleTabs` overflow, scroll-into-view, mobile switcher, groups (§6.2) | `lib/conversion-modules.ts`, `conversion-nav.tsx` | Renaming slugs, sidebar edits (auto-generated) |
| 6 Overview Foundation | Capability registry data (§10) + `CapabilityCard` grid with honest statuses; empty recent-jobs card | `lib/conversion/pdf-capabilities.ts` **(proposed)**, Overview component | Job data fetching |
| 7 Workspace Foundation | `ConversionWorkspaceLayout`, `WorkspacePanel`, four panel frames with empty/loading/error states; collapse; height model (§7) | `components/publishing/conversion/workspace/*` | Upload, viewer, run |
| 8 Shared UI Components | `StatusBadge`, `UnavailableState`/`EmptyState` action prop, `SettingRow`, `ValidationSummary` shell | `components/enterprise/*`, `components/publishing/conversion/*` | Engines |
| 9 Guidelines Architecture | Guidelines section shell, `GuidelineStatusChip`, `GuidelineSelector` (static "None — Standard Profile"), `GuidelinesSummary` (Scenario A rendering), TS contracts (§11.4) types only | `components/guidelines/*`, `lib/guidelines/guideline-contract.ts` **(proposed, types only)** | Upload, storage, extraction, enforcement |
| 10 Responsive Layout | Breakpoint behavior (§13), drawer swaps, mobile switcher, table card fallback | layout components | — |
| 11 Accessibility & UX | §14 audit and fixes, contrast measurement, live regions, focus/scroll-padding | across new components | — |
| 12 Final QA & Integration | §18 + Task 1 §8.2 checklists, tsc, vitest (no new failures beyond 29 baseline), browser check of all 12 routes and 3 other modules | — | — |

---

## 17. Technical Risks & Mitigations

| # | Risk | Mitigation |
| --- | --- | --- |
| T1 | Changing `ConversionModuleTabs` affects all 26 modules | Keep props API; change behavior only; spot-check Word/XML/ePub (Task 1 §8.2) |
| T2 | PDF branch in shared dynamic routes breaks other modules | Branch on `module.slug === "pdf"` with default path unchanged; `generateStaticParams` untouched in shape |
| T3 | Slug rename for Preflight breaks bookmarks | Label override; slug `preflight-and-validation` kept |
| T4 | Duplicate stores for History/Batch/Profiles | Shared components with `module` filter (§4.0) |
| T5 | UI implies planned capabilities work | Registry-driven status; Run path only for `available` |
| T6 | Guidelines accidentally become mandatory | Contract test: no guidelines → job runnable; neutral copy; `GuidelineSelector` default "None" |
| T7 | False compliance claims | "Verified" only from check results; PDF/A/UA/X `planned` until validator |
| T8 | Workspace nested scroll / overflow | One scroll region per panel; `min-w-0`; page non-scrolling in workspace mode |
| T9 | Status palette not tokenized; dark mode parity | Single `StatusBadge` mapping; add `dark:` variants there only |
| T10 | New primitives (checkbox, slider, resizable) add dependencies | Add via shadcn CLI only in the task that needs them; resizable deferred |
| T11 | Interactive expectations vs daily cron (R2) | Processing states say "Queued" honestly; latency fix precedes Upload & Workspace phase |
| T12 | Coupling PDF to Alt Text UI | Extract patterns to shared locations with re-exports; never import `components/publishing/alt-text/*` |
| T13 | Unverified contrast | Task 11 measurement before sign-off |

---

## 18. Architecture Acceptance Checklist

- [x] Task 1 findings reviewed and referenced (§1), gaps listed (§1.2)
- [x] Existing component reuse documented (§3)
- [x] All 12 sections specified with purpose, layout, components, controls, shared, navigation, data, empty/error/loading, dependencies, guideline behavior (§4)
- [x] Design system defined from existing tokens/components, no new tokens (§5)
- [x] Header and navigation finalized; existing routes/slugs unchanged; no broken links (§6)
- [x] Three-panel workspace finalized: proportions, min/max, collapse, scroll, sticky, responsive, states (§7)
- [x] Conversion capability registry and honest status model (§10)
- [x] Shared component responsibilities, props, parents, sections, tasks (§8)
- [x] State and data flows mapped with ownership (§9)
- [x] Client guidelines explicitly optional; Scenario A is valid and non-warning (§11.1)
- [x] Guideline states, priorities and conflict handling defined (§11.3, §12)
- [x] Responsive behavior documented (§13)
- [x] Accessibility (WCAG 2.2 AA target) documented (§14)
- [x] Tasks 3–12 mapped (§16); future phases mapped (§15)
- [x] No source code modified in Task 2 (only this file added)

*End of Phase 1 · Task 2. Task 3 not started.*
