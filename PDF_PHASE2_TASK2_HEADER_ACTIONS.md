# PDF Module — Phase 2 · Task 2: Dashboard Header & Actions

**Module:** Publishing › Conversion › PDF
**Route:** `/modules/publishing/conversion-name/pdf` (Overview) and the 9 registered internal routes
**Scope:** Header and header actions only. No uploader, engine, API, route or database change.
**Date:** 2026-10-25

---

## 1. Existing files inspected

| File | Role |
|---|---|
| `app/(workspace)/modules/publishing/conversion-name/[submodule]/page.tsx` | Overview route and `generateMetadata` |
| `app/(workspace)/modules/publishing/conversion-name/[submodule]/[page]/page.tsx` | Internal PDF routes |
| `lib/conversion-modules.ts` | Route registry (`CONVERSION_MODULES`, `conversionHref`) |
| `components/enterprise/page-header.tsx` | Shared `PageHeader` + `Breadcrumbs` (reused, unchanged) |
| `components/publishing/conversion/pdf/pdf-section-page.tsx` | Single PDF page shell (one header for every section) |
| `components/publishing/conversion/pdf/pdf-module-layout.tsx` | Layout slots |
| `components/publishing/conversion/pdf/pdf-sections.ts` | Section labels, header copy, status |
| `components/publishing/conversion/pdf/pdf-header-config.ts` | `getPdfHeader` — title, subtitle, breadcrumbs, action model |
| `components/publishing/conversion/pdf/pdf-header-actions.tsx` | Primary action + menu |
| `components/publishing/conversion/pdf/pdf-header-more-menu.tsx` | "More actions" overflow menu |
| `components/publishing/conversion/pdf/pdf-capabilities.ts` | Six-state status model (`PDF_CAPABILITY_STATUS_META`) |
| `components/publishing/conversion/pdf/pdf-workspace.tsx`, `pdf-workspace-panels.tsx` | Existing local file intake (`PdfUploadDropzone`, "Add Files") |
| `test/publishing/pdf-header.test.ts` | Header tests |

Reports read: `PDF_PHASE1_TASK1_AUDIT.md`, `PDF_PHASE1_TASK2_UI_ARCHITECTURE.md`, `PDF_PHASE1_TASK12_FINAL_QA.md`, `PDF_PHASE2_TASK1_OVERVIEW_AUDIT.md` (primary reference). All present.

## 2. Audit findings used (Phase 2 Task 1 §5, §19)

| Existing component | Issue | Improvement | Reuse strategy |
|---|---|---|---|
| `getPdfHeader` | No Workspace action; Upload was the disabled "primary" | Open Workspace as the single primary link; upload demoted | Same config function |
| `getPdfHeader` | Batch Processing linked a "Coming soon" route without a marker | Kept as a link, labelled **Planned** | Shared status model |
| `generateMetadata` | Description differed from visible subtitle (R8) | Reads `getPdfHeader().subtitle` | Same header source |
| `PdfHeaderMoreMenu` trigger | `aria-label="More PDF actions"` did not contain the visible text "More actions" (WCAG 2.5.3) | Accessible name = visible text at every width | Same `Button` |
| `PdfHeaderMoreMenu` unavailable items | Radix `disabled` removes items from keyboard focus, so the reason could not be reached by keyboard | `aria-disabled` + no-op `onSelect` | Same `DropdownMenuItem` |

## 3–5. Components reused, files modified, new files

**Reused (unchanged):** `PageHeader`, `Breadcrumbs`, `Button`, `DropdownMenu*`, lucide icons, `PDF_CAPABILITY_STATUS_META`, `conversionHref`, `PDF_SECTIONS`.

**Modified (this task, across commit `0fb1596` and this change):**
- `components/publishing/conversion/pdf/pdf-header-config.ts`
- `components/publishing/conversion/pdf/pdf-header-actions.tsx`
- `components/publishing/conversion/pdf/pdf-header-more-menu.tsx` (new in `0fb1596`; accessibility fixes in this change)
- `components/publishing/conversion/pdf/pdf-sections.ts` (Overview header copy)
- `app/(workspace)/modules/publishing/conversion-name/[submodule]/page.tsx` (metadata)
- `test/publishing/pdf-header.test.ts`

**New:** this report only. No new routes, components systems, APIs or tables.

## 6. Header layout

- Breadcrumbs: **Publishing › Conversion › PDF › Overview** (last crumb `aria-current="page"`, unlinked; PDF links to the Overview from internal pages).
- Title **PDF Conversion** (single `h1`, rendered once by `PageHeader`); subtitle "Convert, organize, and process documents with professional publishing workflows."
- Actions: one primary button + one "More actions" menu, right-aligned from `sm:` up, with the primary action's purpose shown as a short visible hint.

## 7. Final action hierarchy

| Tier | Action | Notes |
|---|---|---|
| Primary | **Open Workspace** | The only working entry point. Upload Files and New Conversion both resolve to this page, so they are consolidated here rather than shown as duplicate buttons. |
| Secondary (menu) | Batch Processing | Link, labelled *Planned* |
| Secondary (menu, not available) | Server upload | Planned; reason visible |
| Tertiary (menu, not available) | Guidelines (optional) | Planned; reason states the Standard Profile applies |

## 8. Primary action integration

There is no server uploader. Files are selected locally in the Workspace Source Files panel (`PdfUploadDropzone` + "Add Files", existing validation via `describeLocalFile`, multiple files supported). The primary CTA navigates there with `next/link`; no second uploader, modal or validation was added, and no upload success is simulated. Its hint states files stay in the browser.

## 9. Workspace navigation

`/modules/publishing/conversion-name/pdf/workspace` — real route. Route-based, so the internal nav highlights Workspace (`aria-current`), breadcrumbs update, and Back/Forward work. On the Workspace itself the primary action is omitted (no self-link).

## 10. Batch Processing

Route exists but renders the honest "planned" body. Shown in the menu with the *Planned* label and "batch runs are not available yet". Hidden on the Batch Processing page itself. No jobs, queues or workers.

## 11. Optional Guidelines

No Guidelines route is registered, so the item is a non-navigating, `aria-disabled` menu entry: "Planned. Not required: the Standard Profile applies when no guidelines are provided." No error, no popup, no blocked navigation. When a `guidelines` route is registered the config automatically turns it into a link (covered by tests). The label always contains "optional", never "required".

## 12. Responsive

- Below `sm`: actions span the full width; primary button flexes, menu collapses to an icon trigger whose accessible name is still "More actions".
- `sm`+: actions right-aligned next to the title block; `PageHeader` wraps actions below the title when space runs out, so title and actions never collide.
- Breadcrumbs wrap (`flex-wrap`); four short crumbs, no horizontal overflow.

## 13. Accessibility

Single `h1`; breadcrumb `nav` landmark with current page; primary action is a link (navigation) described by `aria-describedby`; menu built on Radix (keyboard operable, focus returns to the trigger); trigger name matches visible text; unavailable items reachable by keyboard and explained in visible text (no hover-only info); 44 px menu items, 36 px buttons (meets 2.2 AA 24 px).

## 14. Preserved

Workspace, internal navigation, local file intake, settings, preview shells, other Conversion modules, Editorial, Accessibility, Alt Text and Admin are untouched.

## 15. Tests executed

| Check | Result |
|---|---|
| `npx vitest run test/publishing/pdf-` | **6 files, 77 tests passed** (was 70; +3 header tests) |
| `npx vitest run test/publishing/` | 149 passed, **1 failed**: `alt-text-upload.test.ts` — fails identically on unchanged `main` (pre-existing, unrelated) |
| `pnpm typecheck` | exit 0 |
| `pnpm build` | Passed (all PDF routes compiled; postbuild standalone step OK) |
| ESLint | Not run: repo has no ESLint flat config (`eslint` exits with migration notice) |
| Browser QA | **Not Verified**: route requires sign-in (`307 → /login`), no test credentials |

## Action verification table

| Action | Actual destination / handler | Availability | Tested result |
|---|---|---|---|
| Upload Files | Consolidated into Open Workspace → Workspace `PdfUploadDropzone` (local). "Server upload" menu item: no handler | Local intake UI Ready; server upload Planned | Unit: upload item is `unavailable`/`planned`; no link |
| New Conversion | Consolidated into Open Workspace (same destination) | UI Ready | Unit: no `new-conversion` action; ids unique |
| Open Workspace | `next/link` → `/modules/publishing/conversion-name/pdf/workspace` | UI Ready | Unit: single primary, href matches registry; SSR link has `aria-describedby` |
| Batch Processing | `next/link` → `/modules/publishing/conversion-name/pdf/batch-processing` (planned body) | Planned | Unit: link to registered route, labelled planned, absent on its own page |
| Guidelines | None (no route); auto-links to `/pdf/guidelines` once registered | Planned, optional | Unit: unavailable + Standard Profile reason; linked when route added |

## 16. Known limitations

- Rendered responsive/contrast/keyboard checks not executed (auth wall).
- Quick Start body still contains its own "Open Workspace" link; that section belongs to the Quick Start task and was left unchanged.

## 17. For Phase 2 Task 3

Conversion Category Cards: single section-level "not yet available" footer, visible label for `unsupported` chips, rename "PDF to JATS" → "PDF to JATS XML", deduplicate Image Extraction outputs (audit §6).
