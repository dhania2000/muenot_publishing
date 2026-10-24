# PDF Phase 2 — Task 4: Supported Format Matrix

## 1. Audit — existing configuration inspected

| Existing configuration / component | Current behavior | Required improvement | Reuse strategy |
|---|---|---|---|
| `pdf-capabilities.ts` (`PDF_CAPABILITIES`) | 36 typed capabilities with id, category, kind, direction, status, OCR, limitations, `engineRef` | None structural | Single source of truth for cards, matrix and reference |
| `pdf-formats.ts` (`PDF_FORMATS`) | Families, extensions, MIME types, variants, legacy/modern, standard profiles | None | Matrix details and search read from it |
| `pdf-format-matrix-model.ts` | Local filtering, derived options, upload acceptance, Workspace gate | Requirements column showed OCR only | Added `capabilityRequirements()` |
| `pdf-format-matrix.tsx` | Desktop table, mobile record cards, expandable details, format reference | Richer requirements cell | Renders `capabilityRequirements()` |
| `pdf-overview.tsx` | Mounts matrix and reference under "Supported formats" | None | Unchanged |
| `pdf-workspace-config.ts` (`PDF_SOURCE_EXTENSIONS`) | Extension-only upload check | None now (no MIME/content checks claimed) | Used by `isFormatAcceptedForUpload` |
| Matrix tests | **Missing** | Add coverage | New `test/publishing/pdf-format-matrix.test.ts` |

No PDF conversion route, worker or engine exists in this module, so no engine was invented and no status was raised.

## 2–4. Files

- Modified: `components/publishing/conversion/pdf/pdf-format-matrix-model.ts`, `components/publishing/conversion/pdf/pdf-format-matrix.tsx`
- New: `test/publishing/pdf-format-matrix.test.ts`, this report

## 5–7. Coverage, pair model, Advanced PDF classification

Each `PdfCapability` has a stable `pdf.*` id, explicit `inputFormats → outputFormats` direction, category, `kind`, status, OCR dependency, limitations and a null `engineRef`. Reverse directions are separate records. Advanced PDF uses `pdf-transformation`, `text-recognition`, `form-processing` and `conformance-profile` kinds, never `format-conversion`. Rasterization, vector export and embedded image extraction are distinct kinds.

| Category | Planned Operations | Represented | Verified Working | Partial/UI Ready | Planned/Unsupported/Unverified |
|---|---:|---:|---:|---:|---:|
| PDF to Documents | 6 | 6 | 0 | 0 | 6 (6 planned) |
| PDF to Publishing | 6 | 6 | 0 | 0 | 6 (6 planned) |
| PDF to Images | 5 | 5 | 0 | 0 | 5 (4 planned, 1 unsupported: SVG) |
| Documents to PDF | 6 | 6 | 0 | 0 | 6 (6 planned) |
| Advanced PDF | 13 | 13 | 0 | 0 | 13 (12 planned, 1 unsupported: Forms) |
| TOTAL | 36 | 36 | 0 | 0 | 36 |

## 8–13. Behavior

- **Availability:** no capability is Available; engines in other modules (text collection, image extraction in Alt Text) are noted but not counted.
- **Search/filter:** case-insensitive multi-term search over id, label, category, kind, format labels/names and extensions; category, source, target (narrowed by other filters) and availability filters; reset and empty state. Filtering never mutates registry state.
- **Workspace:** "Open Workspace" appears only for Available rows; every row currently shows "Not runnable yet". No new routes, jobs or downloads.
- **Limitations/fidelity:** every non-available row carries "Output fidelity has not been verified for this conversion." No percentages or lossless claims.
- **OCR:** configuration-driven per operation kind (Optional / Required / Not Applicable / Unknown), never from the extension alone.
- **Requirements cell:** OCR dependency, "Conformance not validated" for profiles, "Source upload not accepted" when no source passes the Workspace extension check, and a known-limitation count.
- **Guidelines:** optional; details state that guidelines cannot make an unavailable operation available.

## 14–16. Responsive, accessibility, preserved functionality

Table on `md+` (Category and Requirements columns from `lg`), record cards below `md`, internal table overflow only. Captioned table, scoped headers, labelled native selects inside `role="search"`, `aria-expanded`/`aria-controls` disclosure, polite result count, text status labels. Category cards, Overview, Workspace and other modules are untouched.

## 17. Test results (executed)

- `tsc --noEmit`: pass
- `vitest run test/publishing/pdf-*.test.ts`: 7 files, 104 tests pass
- Lint: no ESLint config in the repository; not run
- Production build: not run
- Pre-existing, unrelated failure on `main`: `alt-text-upload.test.ts` expects a response without the `reused` field

## 18–19. Known limitations and Task 5 readiness

Upload validation is extension-only; MIME, content, corrupt and encrypted files are not verified. PDF/A/UA/X version and conformance levels are not registered. The status model, `summarizeStatuses` and `PdfCapabilityStatusIndicator` are ready for the Task 5 availability-indicator refinement.
