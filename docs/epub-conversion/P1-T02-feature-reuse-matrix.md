# EPUB Conversion — P1-T02 Feature Reuse Matrix

| Field | Value |
| --- | --- |
| Roadmap item | Phase 1, Task P1-T02 |
| Verified at commit | `cd12920` |
| Nature | Documentation only — no code changed |

This is the authoritative register of reuse decisions. IDs are referenced by `P1-T02-existing-to-epub-improvement-mapping.md` and `P1-T02-integration-dependency-plan.md`. Every path exists unless marked **(proposed)**.

## Totals

| Decision | Count |
| --- | --- |
| REUSE | 28 |
| EXTEND | 23 (E1–E22 plus E11a) |
| INTEGRATE | 7 |
| CREATE | 16 |
| NOT APPLICABLE | 4 |
| **Total items** | **78** |

---

## 1. REUSE — works for EPUB without major change (28)

| ID | Item | Path | Evidence of fitness |
| --- | --- | --- | --- |
| R1 | EPUB module registry + 10 pages | `lib/conversion-modules.ts` (lines 166–183) | Routes generated via `generateStaticParams` |
| R2 | Sidebar navigation | `lib/navigation.ts`, `components/shell/sidebar-nav.tsx` | ePub entry auto-generated |
| R3 | Conversion dashboard, service grid, tabs, crumbs | `conversion-name/page.tsx`, `components/publishing/conversion/conversion-nav.tsx` | ePub card already rendered |
| R4 | UI primitives (20) | `components/ui/*` | shadcn / Tailwind v4 tokens |
| R5 | Page header, data state | `components/enterprise/page-header.tsx`, `data-state.tsx` | Generic props |
| R6 | App shell | `components/shell/app-shell.tsx`, `sidebar-menu.tsx` | Workspace layout |
| R7 | Content layout primitives | `components/publishing/conversion/pdf/pdf-content.tsx` | Section/panel/split grids, no PDF logic |
| R8 | Dialogs (confirm, error details, file info) | `pdf-dialogs.tsx` | Generic |
| R9 | Feedback presets | `pdf-feedback-state.tsx` | Generic empty/loading/error |
| R10 | Status indicator | `pdf-capability-status.tsx` | Icon + text, not colour-only |
| R11 | Status model (processing, progress, evidence-required pass) | `pdf-status-model.ts` | Service-neutral types |
| R12 | Guidelines UI (mapping, conflicts, compliance) | `pdf-guidelines-components.tsx` | Built on `lib/guidelines` |
| R13 | Processing / validation UI | `pdf-processing-components.tsx` | Severity, findings, checklist, log |
| R14 | Preview chrome | `pdf-preview-components.tsx` | Toolbar/states; renderer-agnostic |
| R15 | Guideline contracts + compliance aggregation | `lib/guidelines/guideline-contracts.ts` | Scope supports `{ area: "conversion", service: "epub" }`; Scenario A tested in `test/publishing/pdf-guidelines.test.ts` |
| R16 | Auth / sessions | `lib/auth.ts` | Working |
| R17 | Tenant scope / context | `lib/tenant-scope.ts`, `lib/tenant-context.ts` | `runWithTenant`, `requireCurrentTenantId` |
| R18 | Feature gate | `lib/api-auth.ts` | `requireFeatureInModule()` |
| R19 | Storage (keys, metadata, blobs) | `lib/storage/index.ts`, `keys.ts`, `file-metadata.ts` | Tenant-prefixed keys, `sanitizePath` |
| R20 | Storage quota | `lib/storage/storage-quota.ts` | Per tenant |
| R21 | Download gate | `lib/storage/file-scanning.ts` (`downloadGatePolicyFor`, `canDownload`) | Fail-closed for non-public files |
| R22 | XML parsing / well-formedness | `fast-xml-parser` (used in `lib/alt-text/pptx-package.ts`, `output-validation.ts`) | Installed dependency |
| R23 | Retry policy | `lib/job-retry-policy.ts` | transient/permanent/uncertain, dead-letter |
| R24 | Job limits | `lib/observability/job-limits.ts` | Per-tenant and global caps |
| R25 | XLSX report export | `lib/alt-text/batch-xlsx.ts` (`exceljs`) | Working |
| R26 | Database access | `lib/db.ts` | Parameterised pool |
| R27 | Rate limiting | `lib/rate-limit.ts` | In-memory (single instance) |
| R28 | Settings form primitives | `pdf-settings-components.tsx` | Group, field+help, selectors, summary |

## 2. EXTEND — needs EPUB-specific functionality (23)

| ID | Item | Path | Extension required | PDF / Alt Text preserved by |
| --- | --- | --- | --- | --- |
| E1 | Service overview route | `app/(workspace)/modules/publishing/conversion-name/[submodule]/page.tsx` | `epub` branch | PDF branch untouched |
| E2 | Service section route | `.../[submodule]/[page]/page.tsx` | `epub` branch | same |
| E3 | Section shell, layout, navigation | `pdf-section-page.tsx`, `pdf-module-layout.tsx`, `pdf-section-navigation.tsx` | Registry-parameterised shell | `Pdf*` re-exports; `test/publishing/pdf-module-layout.test.ts` |
| E4 | Header config / actions / more menu | `pdf-header-config.ts`, `pdf-header-actions.tsx`, `pdf-header-more-menu.tsx` | EPUB header config | `test/publishing/pdf-header.test.ts` |
| E5 | Overview panels | `pdf-overview.tsx`, `pdf-overview-panels.tsx` | EPUB overview config | `test/publishing/pdf-overview.test.ts` |
| E6 | File / upload components | `pdf-file-components.tsx` | Accept list + server upload callback props | defaults keep PDF behaviour |
| E7 | Workspace stepper + panels | `pdf-workspace.tsx`, `pdf-workspace-panels.tsx`, `pdf-workspace-config.ts` | Server-backed file model for EPUB | PDF keeps `PdfLocalFile` |
| E8 | Capability registry / matrix / formats | `pdf-capabilities.ts`, `pdf-format-matrix.tsx`, `pdf-format-matrix-model.ts`, `pdf-formats.ts` | Parallel EPUB registry | separate file |
| E9 | Guideline categories | `pdf-guideline-categories.ts` | EPUB categories (metadata, navigation, CSS, accessibility, media, packaging) | separate file |
| E10 | Default profile | `pdf-status-model.ts` (`PDF_DEFAULT_PROFILES`) | Approved default EPUB 3.3 profile | separate constant |
| E11 | Upload pipeline | `lib/alt-text/document-upload.ts`, `app/api/alt-text/documents/upload/route.ts` | Shared conversion upload pipeline | Alt Text calls adapter; tests unchanged |
| E11a | Upload limits | `lib/settings/uploads.ts` | Per-module allow-lists (`.epub`, `.xhtml`, `.html`, `.xml`, `.idml` for conversion) | Alt Text list unchanged |
| E12 | ZIP / XML validator | `lib/alt-text/document-validation.ts`, `document-upload-contract.ts` | OCF profile (`mimetype` first & stored, `META-INF/container.xml`, doctype allow-list) | OOXML profile unchanged |
| E13 | ZIP rewriter | `lib/alt-text/ooxml-zip-rewrite.ts` | Guarantee `mimetype` first + STORED | OOXML behaviour unchanged |
| E14 | Output validation framework | `lib/alt-text/output-validation*.ts` | EPUB structural check set | Alt Text checks unchanged |
| E15 | Background job types | `lib/background-jobs.ts` (`BACKGROUND_JOB_TYPES`) | `conversion.epub.convert`, `.validate`, `.package` + payload validators | additive union |
| E16 | Permissions | `lib/permission-store.ts`, `lib/permission-model.ts` | Action grants for conversion | default scope preserved for existing resources |
| E17 | Route gate | `lib/alt-text/route-gate.ts` (pattern) | `lib/conversion/route-gate.ts` **(proposed)** | Alt Text gate unchanged |
| E18 | Accessibility settings | `lib/alt-text/accessibility-settings.ts`, `components/publishing/alt-text/accessibility-settings-workspace.tsx` (pattern) | EPUB a11y profile schema | pattern only |
| E19 | Scan service | `lib/storage/file-scanning.ts`, `lib/storage/index.ts` | OCF-internal rules, provider hook, `pending` initial status for conversion files | Alt Text path unchanged |
| E20 | Batch UI / services | `components/publishing/alt-text/batch-*.tsx`, `lib/alt-text/batch-*.ts` (pattern) | Shared Batch Center | pattern only, no table coupling |
| E21 | Output validation panel | `components/publishing/alt-text/output-validation-panel.tsx` (pattern) | EPUB report viewer data contract | pattern only |
| E22 | Review / approval UI | `document-review-sheet.tsx`, `review-status-badge.tsx` (pattern) | Client approval sheet | pattern only |

## 3. INTEGRATE — connect existing infrastructure to EPUB (7)

| ID | Item | Path | Integration |
| --- | --- | --- | --- |
| I1 | Job runner | `app/api/jobs/run/route.ts`, `vercel.json` | Register EPUB handlers; resolve dispatch latency (blocker B3) |
| I2 | Alt Text generation | `lib/alt-text/document-generation.ts` and related | Generate/review alt text for EPUB images |
| I3 | OCR | `lib/alt-text/ocr-contract.ts`, `ocr-engine.ts`, `ocr-service.ts` | Scanned source text |
| I4 | AI provider + credits | `lib/ai/provider.ts`, `lib/ai/credits/credits-service.ts` | Metered assisted extraction (`sourceModule: "conversion.epub"`) |
| I5 | Mailer | `lib/mailer.ts`, `lib/demo/outbound-guard.ts` | Delivery/approval notifications |
| I6 | PDF `to-epub` capability | `pdf-capabilities.ts` | Keep status consistent with EPUB engine |
| I7 | "ePub Accessibility" menu entry | `lib/navigation.ts` | Add href once accessibility checks are live |

## 4. CREATE — technically necessary, no suitable existing component (16)

| ID | Component (proposed path) | Justification (why no existing asset suffices) |
| --- | --- | --- |
| C1 | Shared conversion domain: `lib/conversion/` store + tables (`conversion_projects`, `conversion_jobs`, `conversion_job_files`, `conversion_outputs`, `conversion_reports`, `conversion_profiles`, `conversion_deliveries`) | Only `alt_text_*` tables exist; reusing them would couple EPUB to Alt Text semantics |
| C2 | Shared conversion API: `app/api/conversion/{uploads,jobs,...}` | No conversion API exists (`app/api` has only `alt-text`, `health`, `jobs`) |
| C3 | Conversion download route | `/api/storage/file/*` URLs built in `lib/storage/index.ts` but no route exists |
| C4 | OCF reader/writer `lib/conversion/epub/ocf/` | No EPUB code in repo (P1-T01 §E) |
| C5 | OPF / nav.xhtml / NCX / metadata builders `lib/conversion/epub/package/` | same |
| C6 | Source transformers (DOCX, HTML, XML first; PDF, IDML later) `lib/conversion/epub/transform/` | No converter exists for any target |
| C7 | XHTML/SVG sanitiser + active-content policy `lib/conversion/epub/security/` | Existing checks only block file extensions/DOCTYPE; no content sanitiser |
| C8 | Validation adapter: EPUBCheck worker + EPUB Accessibility 1.1 checks | No validator or Java runtime |
| C9 | Sandboxed reader preview renderer + isolated content route | No safe renderer for untrusted XHTML |
| C10 | EPUB UI registries `components/publishing/conversion/epub/{epub-sections,epub-header-config,epub-capabilities}.ts` | Config files consumed by generalised shell; PDF registries must not be edited |
| C11 | EPUB settings schema + profiles (3.3 default, 3.4 controlled, EPUB 2 legacy; layout; CSS profiles) | No EPUB settings model |
| C12 | Shared guideline service (storage, parse, extract, resolve, verify) + tables | Contracts only; header says parsing/enforcement not implemented |
| C13 | Approvals/exceptions + `platform_audit_log` | Only job events exist; no approval or audit entity |
| C14 | Shared Conversion pages: Jobs, Batch Center, File Manager, Downloads, QA Center, History, Profiles & Presets | All render `PlannedPage`; built once for every service |
| C15 | Advanced layout engines: fixed, mixed, scrolled ("roll"), media overlays, interactive, STEM | Later phases; depend on C4–C8 |
| C16 | Reverse conversion EPUB → DOCX/HTML/PDF | No reader/transformer exists |

## 5. NOT APPLICABLE — must remain unchanged (4)

| ID | Item | Path |
| --- | --- | --- |
| N1 | Alt Text module pages/workflows | `app/(workspace)/modules/publishing/alt-text/page.tsx`, `components/publishing/alt-text/*` (used only as patterns) |
| N2 | Admin users | `app/(workspace)/admin/users/*` |
| N3 | Auth pages | `app/(auth)/*` |
| N4 | Root redirect | `app/page.tsx` |

## 6. Missing capability register

| Capability | Status | Covered by |
| --- | --- | --- |
| EPUB parse / package / nav / OPF / NCX | Missing | C4, C5 |
| EPUB 2 / 3.3 / 3.4 profiles | Missing | C11 |
| DOCX/HTML/XML/PDF/IDML → EPUB | Missing | C6 (PDF also needs a PDF engine) |
| Reflowable / fixed / mixed / scrolled / overlays / interactive / STEM | Missing | C6, C15 |
| EPUBCheck + accessibility validation | Missing | C8 |
| Safe preview | Missing | C9 |
| Guideline parsing / resolution / approvals | Missing | C12, C13 |
| Conversion persistence + API + downloads | Missing | C1–C3 |
| Shared conversion pages | Missing (planned placeholders) | C14 |
| Real malware scanning | Missing (signature only) | E19 + provider decision |
| Real permissions | Missing (stub) | E16 |
| In-app notifications | Missing | out of scope; email via I5 |
| Reverse conversion | Missing | C16 |

## 7. Shared functionality that must not be duplicated

Navigation (R1, R2), auth/tenant (R16–R18), storage + quota + download gate (R19–R21), job queue/retry/limits (E15, R23, R24), upload pipeline (E11), guideline contracts/service (R15, C12), conversion domain/API (C1, C2), shared conversion pages (C14), audit log (C13), UI primitives (R4–R14, R28).
