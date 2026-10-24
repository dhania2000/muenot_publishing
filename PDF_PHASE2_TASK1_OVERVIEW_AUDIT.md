# PDF Module — Phase 2 · Task 1: Existing Overview Audit & Dashboard Gap Analysis

**Module:** Publishing › Conversion › PDF
**Route audited:** `/modules/publishing/conversion-name/pdf` (Overview) and its 9 registered internal routes
**Scope:** Audit and documentation only. No production source code was changed for this task.
**Date:** 2026-10-25

---

## 1. Executive Summary

The PDF Overview is a **well-structured, honest UI-only dashboard**. Every section from the Phase 2 brief exists. All of them are rendered on the server from **static configuration**, and none of them connect to a backend. The Phase 1 foundation (layout, header, navigation, shared components, optional-guidelines model) is all present in code and passes its tests.

The main conclusions:

1. **No PDF processing engine exists.** All 37 capabilities in `PDF_CAPABILITIES` are `planned` (35) or `unsupported` (2). None are `available`, `partial` or `ui-ready`. The UI shows this correctly. No label claims an engine works.
2. **No PDF data source exists** for recent activity, job records, saved profiles or guideline records. The `/api/*` routes in the repo belong to the Alt Text module (`app/api/alt-text/*`) and the generic cron runner (`app/api/jobs/run`). None of them are PDF endpoints.
3. **Nothing on the page is broken.** The Overview has 3 links and they all go to real routes. The header's only primary action (Upload Files) is correctly disabled and explains why.
4. **The gaps are mostly consistency and duplication, not missing sections.** Examples: the Quick Start steps are defined separately from the Workspace workflow steps, the accepted file extensions are hard-coded separately from the capability registry, and a few links lead to pages that only say "Coming soon".
5. **Rendered browser QA could not run in this audit.** The route sits behind authentication (`307 → /login`), and no test credentials were available. Server-rendered markup was checked instead (see §14). Responsive and contrast behaviour is therefore **Not Verified** in this task.

Phase 2 should **improve the existing components in place**. It should not add new dashboard cards, and it should not touch the engine or backend layers.

---

## 2. Actual Repository Files Inspected

| File | Component / export | Current responsibility |
|---|---|---|
| `app/(workspace)/modules/publishing/conversion-name/[submodule]/page.tsx` | `ConversionSubmodulePage` | Overview route. Renders `PdfSectionPage` + `PdfOverview` when `submodule === "pdf"`. |
| `app/(workspace)/modules/publishing/conversion-name/[submodule]/[page]/page.tsx` | `ConversionInternalPage` | Internal PDF routes. `workspace` renders `PdfWorkspace`. Every other route renders the default "Coming soon" body. |
| `lib/conversion-modules.ts` | `CONVERSION_MODULES`, `conversionHref` | Route registry. PDF registers 9 pages: Workspace, Output Settings, Page Layout, Content Extraction, Compliance Profiles, Preflight & Validation, Batch Processing, Output Preview, History. |
| `components/publishing/conversion/pdf/pdf-section-page.tsx` | `PdfSectionPage`, `getPdfNavItems` | Shared page shell (header, navigation, layout, default body). |
| `components/publishing/conversion/pdf/pdf-module-layout.tsx` | `PdfModuleLayout`, `getPdfSectionLayout` | Width/spacing shell with header, nav, status, toolbar and aside slots. |
| `components/publishing/conversion/pdf/pdf-sections.ts` | `PDF_SECTIONS`, `isPdfSectionNavigable` | Configuration for the 12 sections (labels, status, layout). |
| `components/publishing/conversion/pdf/pdf-header-config.ts` | `getPdfHeader` | Title, subtitle, breadcrumbs and actions for every section. |
| `components/publishing/conversion/pdf/pdf-header-actions.tsx` | `PdfHeaderActions` | Renders header actions. Unavailable actions are disabled and linked to a hint with `aria-describedby`. |
| `components/publishing/conversion/pdf/pdf-section-navigation.tsx` | `PdfSectionNavigation` | Route-based internal navigation (`aria-current`, "More" overflow menu, mobile selector). |
| `components/publishing/conversion/pdf/pdf-overview.tsx` (281 lines) | `PdfOverview`, `PdfQuickStart`, `PdfCategoryCard`, `PdfFormatPanel`, `PdfAvailabilityLegend` | Overview body. |
| `components/publishing/conversion/pdf/pdf-overview-panels.tsx` (203 lines) | `PdfGuidelinesSummary`, `PdfSavedProfilesPanel`, `PdfProcessingInfoPanel`, `PdfRecentActivityPanel`, `PdfHelpGuidance` | Overview side panels. |
| `components/publishing/conversion/pdf/pdf-capabilities.ts` (151 lines) | `PDF_CAPABILITIES`, `PDF_CAPABILITY_CATEGORIES`, `PDF_CAPABILITY_STATUS_META`, `deriveFormatAvailability`, `summarizeStatuses` | Capability and format registry, the single source of truth for availability. |
| `components/publishing/conversion/pdf/pdf-capability-status.tsx` | `PdfCapabilityStatusIndicator`, `PdfStatusIndicator` | Status pill with icon and text (status is never shown by colour alone). |
| `components/publishing/conversion/pdf/pdf-status-model.ts` (233 lines) | Processing, validation, severity and profile models, `PDF_DEFAULT_PROFILES` | Shared status vocabulary. |
| `components/publishing/conversion/pdf/pdf-content.tsx` | `PdfSection`, `PdfPanel`, `PdfInfoCard`, split and three-panel layouts | Section containers. |
| `components/publishing/conversion/pdf/pdf-feedback-state.tsx` | `PdfFeedbackState`, `PDF_FEEDBACK_PRESETS` | Empty, loading and error presets over `Empty`, `Skeleton` and `ErrorState`. |
| `components/publishing/conversion/pdf/pdf-guidelines-components.tsx` | `OPTIONAL_GUIDELINES_MESSAGE`, `PdfGuidelinesStatus`, rule/conflict/compliance components | Optional-guidelines UI. |
| `components/publishing/conversion/pdf/pdf-settings-components.tsx` | `PdfFormatSelector`, `PdfProfileSelector`, `PdfSettingsSummary` | Settings building blocks (used by the Workspace). |
| `components/publishing/conversion/pdf/pdf-processing-components.tsx` | Progress, log, validation summary and checklist components | Processing UI. Not used on the Overview. |
| `components/publishing/conversion/pdf/pdf-workspace-config.ts` | `PDF_WORKFLOW_STEPS`, `PDF_SOURCE_EXTENSIONS`, `deriveGuidelineState`, `resolveSettingsProfile` | Workspace workflow and local-file rules. |
| `components/publishing/conversion/pdf/pdf-workspace.tsx`, `pdf-workspace-panels.tsx` | `PdfWorkspace` | Local, in-browser file intake and settings shell. |
| `lib/guidelines/guideline-contracts.ts` | `GuidelineContext`, `assessGuidelineCompliance`, `GUIDELINE_PRIORITY_LEVELS` | Guideline data contracts (types and logic only, no persistence). |
| `app/api/jobs/run/route.ts` | `GET` | Cron runner for `runDueBackgroundJobs`. Contains no PDF job type. |
| `test/publishing/pdf-*.test.ts` (6 files) | — | Unit and SSR tests for the PDF module. |
| `PDF_PHASE1_TASK1_AUDIT.md`, `PDF_PHASE1_TASK2_UI_ARCHITECTURE.md`, `PDF_PHASE1_TASK6_OVERVIEW.md`, `PDF_PHASE1_TASK9_GUIDELINES_ARCHITECTURE.md`, `PDF_PHASE1_TASK12_FINAL_QA.md` | — | Phase 1 documentation. |

The following do **not** exist: a `loading.tsx` or `error.tsx` file under `app/(workspace)`, any PDF API route, any PDF history or profile store, and a Guidelines or Profiles & Presets route for PDF.

---

## 3. Phase 1 Foundation Verification

`PDF_PHASE1_TASK12_FINAL_QA.md` concludes: *"Phase 1 is accepted, and the PDF module is ready for Phase 2."* The code was re-checked independently rather than taken on trust:

| # | Foundation item | Evidence in current code | Status |
|---|---|---|---|
| 1 | Enterprise PDF module layout | `PdfModuleLayout` has header, navigation, status, toolbar and aside slots. Width and spacing come from `PDF_SECTIONS[].layout`. | Verified |
| 2 | Header & breadcrumbs | `getPdfHeader` builds Publishing › Conversion › PDF (› section). Covered by tests in `pdf-header.test.ts` (one h1, current crumb marked). | Verified |
| 3 | Internal navigation | `PdfSectionNavigation`: 12 items. Unrouted items are `aria-disabled` and labelled "Planned". Includes overflow menu and mobile selector. | Verified in code. Rendered behaviour Not Verified (auth). |
| 4 | Overview foundation | `PdfOverview` renders 6 `h2` sections (see §4). | Verified |
| 5 | Workspace foundation | `PdfWorkspace` handles local intake and validation (`describeLocalFile`). Settings shell; preview, validate and export marked planned. | Verified (UI-only) |
| 6 | Shared UI components | `pdf-content`, `pdf-feedback-state`, `pdf-capability-status`, `pdf-processing-components`, `pdf-settings-components`, `pdf-guidelines-components`. | Verified |
| 7 | Optional guidelines architecture | `deriveGuidelineState` returns `"not-provided"` (neutral). `resolveSettingsProfile` always sets `requiresGuidelines: false`. | Verified |
| 8 | Responsive layout | Container query (`@3xl/pdf-module`) and grid breakpoints (`md`, `lg`, `xl`) in code. | Code reviewed. Rendered behaviour Not Verified. |
| 9 | Accessibility | Labelled sections, `aria-describedby` on disabled actions, `aria-current`, decorative icons hidden, status shown as icon plus text. | Code verified. Not a full WCAG claim. |

**Test evidence (run during this audit):** `npx vitest run test/publishing/pdf-` → **6 files, 70 tests passed**. `pnpm typecheck` → **exit 0**.

**Dependency note:** Phase 1 is verified at code and unit-test level. Its rendered QA relied on a temporary harness that has since been removed. This audit could not repeat it because the route requires sign-in, so rendered checks carry over to Task 9 as an open dependency.

---

## 4. Existing PDF Overview Structure

Heading outline from server rendering (`renderToStaticMarkup(PdfOverview)`), below the header's `h1` "PDF":

```
h2 Quick Start
h2 Conversion categories
   h3 PDF to Documents · PDF to Publishing · PDF to Images · Documents to PDF · Advanced PDF
h2 Supported formats
   h3 Input formats · Output formats · Capability availability
h2 Guidelines, profiles and processing
   h3 Client Guidelines · Saved Profiles · Processing Information
h2 Recent activity
h2 Help & format guidance
```

The markup contains 0 buttons and 0 inputs. Its links are **Open Workspace → /pdf/workspace**, **View History → /pdf/history** and **Alt Text service → /modules/publishing/alt-text**.

| # | Brief section | Exists | Data source | Functionality | Loading / empty / error | Classification |
|---|---|---|---|---|---|---|
| 1 | Welcome & Quick Actions | Covered by the `PageHeader` (title, subtitle, actions) plus the Quick Start "Open Workspace" button. No separate welcome block. | `getPdfHeader` (static) | Batch Processing link works. Upload is disabled. | Static content, so no loading or error states are needed. | Partial |
| 2 | Conversion Categories | Yes, 5 `PdfCategoryCard`s | `capabilitiesByCategory()` (static registry) | Information only. All cards show "Not yet available to run" (5 of 5). | n/a | UI Only |
| 3 | Supported Formats | Yes, `PdfFormatPanel` for input and output | `deriveFormatAvailability()` | Correctly derived from capabilities | n/a | Complete (as a status display) |
| 4 | Capability Availability | Yes, `PdfAvailabilityLegend` | `summarizeStatuses()` | Correct counts per status | n/a | Complete (as a status display) |
| 5 | Quick Start | Yes, `PdfQuickStart` | Local `QUICK_START_STEPS` constant | Opens the Workspace. The 7 steps are shown without availability status. | n/a | Partial |
| 6 | Guidelines Summary | Yes, `PdfGuidelinesSummary` | `GuidelineContext` prop, always `null` on the Overview | Neutral "not provided" state. A supplied-context branch exists and is tested. | Neutral empty state. No error state. | UI Only |
| 7 | Recent Activity | Yes, `PdfRecentActivityPanel` | None | `PdfFeedbackState kind="no-data"` plus View History link | Empty state only | UI Only |
| 8 | Saved Profiles | Yes, `PdfSavedProfilesPanel` | Hard-coded "Standard settings" copy | Static | Inline "No saved profiles yet." | UI Only |
| 9 | Processing Information | Yes, `PdfProcessingInfoPanel` | None | Static "No active document" | Empty state only | UI Only |
| 10 | Help & Format Guidance | Yes, `PdfHelpGuidance` | Static copy | Information only, plus a link to Alt Text | n/a | Complete |

**Duplicated or oversized content:**
- *Quick Start* says "Process / Validate / Download", and *Processing Information* separately says that processing is not available yet. On the Overview, they partly repeat each other.
- *Supported formats* (format chips) and *Conversion categories* (capability chips plus From/To lines) show the same registry data from two angles. That is acceptable, but the category cards also list formats, which is redundant with the format panels.
- The server-rendered markup is about 56 KB. That is reasonable for static content.

---

## 5. Header & Actions Audit

Header output for the Overview (`getPdfHeader(pdf)`):

```json
{ "title": "PDF", "subtitle": "Professional Document Conversion & Processing",
  "breadcrumbs": ["Publishing → /modules/publishing", "Conversion → /modules/publishing/conversion-name", "PDF (current)"],
  "actions": [
    { "id": "batch-processing", "status": "link", "href": "/modules/publishing/conversion-name/pdf/batch-processing" },
    { "id": "upload", "variant": "primary", "status": "unavailable", "reason": "Server upload is planned. Add files locally in the Workspace." } ] }
```

| Item | Finding | Classification |
|---|---|---|
| Breadcrumbs | Publishing › Conversion › PDF. The "Modules" root is omitted by design. The current crumb has no link. | Working |
| Heading / subtitle | "PDF" / "Professional Document Conversion & Processing". **Inconsistency:** route metadata (`generateMetadata`) uses `module.description` ("Convert source content into print-ready and accessible PDF files."), so the `<title>` and description meta differ from the visible subtitle. | Working (copy inconsistency) |
| Upload Files | Disabled primary button with a visible reason linked by `aria-describedby` | Unavailable (correct) |
| Workspace action | **Not in the header.** The only way into the Workspace from the Overview is the Quick Start button or the nav tab. | Missing |
| Batch Processing action | Links to a registered route, but that route only renders "Coming soon" (`PdfFeedbackState kind="unavailable"`). | Partially Working (real route, planned body) |
| Guidelines action | Hidden because no `guidelines` route is registered. It is never marked as required. | Correctly absent |
| Button alignment | Buttons sit in one wrapping row with hints below, right-aligned from `sm:` upward | Code verified. Rendered Not Verified. |
| Active navigation state | `aria-current="page"` on the active link, Overview active on the root | Verified in code |

**Recommendations for Task 2:**
- Add **Open Workspace** as the primary working action. It is the only working path into the module.
- Demote Upload Files to secondary, or merge its hint into the Workspace action.
- Either keep Batch Processing visibly marked "Planned", or remove it from the Overview header until that page has content.
- Align `generateMetadata` with the section subtitle.

---

## 6. Conversion Category Audit

Source: `PDF_CAPABILITY_CATEGORIES` and `PDF_CAPABILITIES` in `pdf-capabilities.ts`. The cards are rendered by `PdfCategoryCard` with an `article` element labelled by its `h3`, a lucide icon, a capability chip list, From/To format lines, and a footer.

| Category | Icon | Listed operations (vs brief) | Working actions | Status accuracy |
|---|---|---|---|---|
| A · PDF to Documents | `FileOutput` | Word, Excel, PowerPoint, Text, Markdown, RTF. All 6 present. | None | All planned. Text says "Engine exists in another module". Accurate. |
| B · PDF to Publishing | `FileText` | XML, **"PDF to JATS"** (brief: "PDF to JATS XML"), HTML, XHTML, ePub, Structured Data (JSON). All 6 present. | None | All planned. Accurate. |
| C · PDF to Images | `FileImage` | PNG, JPEG, TIFF, SVG, Image Extraction. All 5 present. | None | SVG is `unsupported` (blocked by the upload and preview security rules). Image Extraction is planned with the "engine elsewhere" note. Accurate. |
| D · Documents to PDF | `FileInput` | Word, Excel, PowerPoint, HTML (+XHTML), XML, Images. All 6 present. | None | All planned. Accurate. |
| E · Advanced PDF | `Settings2` | OCR, Searchable PDF, Merge, Split, Compression, Optimization, Rotate, Crop, Reorder, Forms, PDF/A, PDF/UA, PDF/X. All 13 present. | None | Forms is `unsupported` (rejected by the PDF validator). PDF/A, UA and X are planned with "conformance is never claimed". OCR is planned with "Only scanned-page detection exists today". Accurate. |

**Engine evidence:** PDF text extraction, image extraction and scanned-page detection exist in the **Alt Text** module (`lib/alt-text/*`), not in the PDF module. The registry marks these "engine elsewhere" rather than available, which is correct.

**Gaps for Task 3:**
- All 5 cards show the same footer, "Not yet available to run". The `Start` link branch never renders because no capability is runnable. The cards are informative but repetitive. Show the footer once at section level, or show it per card only when the status differs.
- Planned chips hide their status label. Only non-planned statuses get a visible label. That keeps the chips uncluttered, but SVG and Forms rely on the legend for context. Keep the visible label for `unsupported`.
- Rename "PDF to JATS" to **"PDF to JATS XML"** to match the business catalogue.
- Image Extraction lists `PNG, JPEG` as outputs, which overlaps with the PDF to PNG and PDF to JPEG chips in the "To:" line. Deduplicate per card.

---

## 7. Supported Format Matrix Audit

| Aspect | Current source of truth | Status |
|---|---|---|
| Source and output formats (labels) | `PDF_CAPABILITIES[].inputFormats / outputFormats` → `deriveFormatAvailability()` | Present and derived (good) |
| File extensions | `PDF_SOURCE_EXTENSIONS` in `pdf-workspace-config.ts`, **hard-coded**: `pdf docx xlsx pptx html htm xhtml xml jpg jpeg png tif tiff` | **Duplicated.** Not derived from the registry. |
| MIME types | None. `PdfLocalFile.mimeType` only stores what the browser reports. | Missing |
| Conversion direction | Implicit in each capability's input and output lists | Present |
| Engine availability | `PdfCapability.status` + `note` | Present |
| Feature limitations / validation requirements | Free-text `note` only | Partial |
| Format-specific settings | `PDF_SETTINGS_GROUPS[].plannedItems` (generic, not per format) | Missing |

**Duplication:**
- Overview format panels, the Workspace target-format list (`getTargetFormatOptions()` → `deriveFormatAvailability("output")`) and the capability registry all share one source. That is good.
- The Workspace **accepted extensions** list and the **unsupported-file message** ("PDF, Word, Excel, PowerPoint, HTML, XML or image") are a second, manual source. If a capability is added or removed, these drift.
- The other conversion modules (`lib/conversion-modules.ts`) have no format data, so they create no duplication.

Every format is effectively **Planned** at the engine level. Intake by extension is **UI Ready**, because the Workspace accepts and validates the files locally. SVG output is **Unsupported**.

**Recommendation for Task 4:** Extend the existing registry with a small format table: label, extensions, MIME types, and supported directions. Derive `PDF_SOURCE_EXTENSIONS` and the unsupported-file message from it. Render the Overview format panels as a compact **format × direction matrix** from the same data. Do not create a second registry.

---

## 8. Capability Availability Audit

- **Status model:** `available · partial · ui-ready · unverified · planned · unsupported` (`PDF_CAPABILITY_STATUS_META`). Each status has a label, a description and a rank. Formats inherit the best status among the capabilities that use them.
- **Current distribution:** 35 planned, 2 unsupported (PDF to SVG, PDF Forms), 0 available, partial, ui-ready or unverified. Test `"never marks a capability available without an implemented PDF engine"` enforces this.
- **UI availability vs processing availability:** These are kept separate. `PDF_SECTIONS[].status` (`ui-ready` for Overview and Workspace) describes the **interface**. `PdfCapability.status` describes the **engine**. No false "Available" labels were found.

**Weaker or potentially misleading spots:**
1. The Quick Start shows 7 steps with numbers and no status, so a user can't tell which steps work. Only "Upload" and "Configure" are UI-ready locally (`PDF_WORKFLOW_STEPS`).
2. The header "Batch Processing" action and the "View History" link look like working destinations but open "Coming soon" pages.
3. The section status for Overview and Workspace (`ui-ready`) is not shown anywhere on the Overview. That is fine, but it should not be mistaken for engine status if it is shown later.

**Recommended model for Task 5:** Keep the existing 6-state registry; do not add another model. Add one derived helper per surface:
- `capabilityStatus` comes from the registry.
- `stepStatus` comes from `PDF_WORKFLOW_STEPS[].availability`.
- `destinationStatus` is `"working"` only when the target route's section status is `ui-ready` or `available`, and `"planned"` otherwise. Links to planned sections then carry a visible "Planned" tag.

---

## 9. Quick Start Workflow Audit

| Target step | Overview (`QUICK_START_STEPS`) | Workspace (`PDF_WORKFLOW_STEPS`) | Real functionality |
|---|---|---|---|
| 1 Upload File | "Upload file" | `upload` (ui-ready) | Local browser intake and validation only. No server upload. |
| 2 Select Target Format | "Select format" | Part of `configure` | Selector lists registry formats with their real (planned) status |
| 3 Configure Settings | "Configure settings" | `configure` (ui-ready) | Settings shell. Most rows are planned. |
| 4 Apply Guidelines (Optional) | "Add guidelines" (optional) | `guidelines` (optional, ui-ready) | Neutral notice. Skipped by default in `nextWorkflowStep`. |
| 5 Process | "Process" | none | Not implemented |
| 6 Validate | "Validate" | `validate` (planned) | Not implemented |
| 7 Download | "Download" | `export` (planned) | Not implemented |

The Workspace also has a **Preview** step (planned) that the Quick Start does not show.

**Verified:**
- No processing progress.
- No success messages.
- No download links.
- No action that looks enabled but is unavailable.
- Guidelines step is optional in both lists.
- "Completed" is intentionally absent from `PdfWorkflowStepState`.

**Gaps for Task 6:**
- There are **two step lists that drift**. They have different counts (7 vs 6), labels ("Add guidelines" vs "Apply Guidelines (Optional)"), and boundaries (Process and Preview).
- Derive the Overview Quick Start from `PDF_WORKFLOW_STEPS`, or the reverse. Then show each step's availability using the existing `PdfCapabilityStatusIndicator` / `PdfStatusIndicator`.
- Rename the step to "Apply Guidelines (Optional)".

**Dependencies:** A server upload API, a processing engine and an output store are all needed before steps 5–7 can work. Those are out of Phase 2 scope.

---

## 10. Recent Activity Audit

| Required data | Exists? |
|---|---|
| Conversion history / job records / processing status records | **No.** There is no PDF job type, table or API. `app/api/jobs/run` drains generic background jobs (`lib/background-jobs`) and has no PDF handler. |
| File metadata / output references / download info | No (Workspace files live only in browser memory and are not persisted) |
| Timestamps, status filtering, pagination | No |

**Current behaviour:** The panel renders `PdfFeedbackState kind="no-data"` ("Nothing here yet") and a **View History** link to `/pdf/history`, which is itself a "Coming soon" page. It shows **no sample, mock or hard-coded rows**. The test "shows honest empty states without fabricated activity or metrics" covers this.

**Classification:** Not Implemented (an honest empty state).

**Task 7 guidance:**
- Switch to the existing preset `kind="no-history"` ("No conversion history").
- Mark View History as Planned, or hide it until History has content.
- Define the row shape (filename, conversion type, date, status, output availability, View Details) as a **type only**, so a future backend can plug in.
- Prepare loading and error states with `PdfFeedbackState kind="loading" | "error"` for when data exists.
- Do not build a history backend in Phase 2.

---

## 11. Profiles & Optional Guidelines Audit

| Item | Types / components | Data source | Status |
|---|---|---|---|
| Standard Profile | `PDF_DEFAULT_PROFILES` (`pdf-status-model.ts`), `STANDARD_PROFILE` (`pdf-workspace-config.ts`) | Static | Available as a default |
| Saved conversion presets / company profiles | `PdfProfileKind` = standard, custom, company, last-used; `PdfProfileSelector` | None (no persistence) | Planned |
| Guidelines Summary | `PdfGuidelinesSummary`, which accepts a `GuidelineContext` | Always `null` on the Overview | UI Only |
| Guideline status / review status | `deriveGuidelineState` with 8 states; `PDF_GUIDELINE_STATES` | Contracts in `lib/guidelines/guideline-contracts.ts` | Logic ready, no data |
| Selected profile | `resolveSettingsProfile` | Derived | Works locally |

**Duplication:** `PdfSavedProfilesPanel` hard-codes its own "Standard settings" copy instead of reading `PDF_DEFAULT_PROFILES` and the `no-profiles` preset. The Overview and Workspace label the same default differently ("Standard settings" vs "Standard Profile").

**Guidelines rule verification:**
- **Without guidelines:** the Overview shows a neutral notice and the options "Continue without guidelines / Use the standard default settings / Add guidelines later". There is no mandatory upload, no required profile and no error. ✅
- The neutral copy on the Overview is `OPTIONAL_GUIDELINES_MESSAGE.overview`: *"Company guidelines are optional. Standard **conversion** settings will be used."* The canonical wording is *"Company guidelines are optional. Standard settings will be used."* The `workspace` variant uses the canonical wording. This is a minor copy variance.
- **With guidelines:** the contracts separate *uploaded → pending-review → applied → verification-pending → verified*. `"verified"` requires a `compliant` or `compliant-with-exceptions` verdict from `assessGuidelineCompliance`. An upload alone never becomes "applied" or "verified". ✅
- No fabricated profiles, verification results or compliance scores are rendered. ✅

**Task 8 guidance:**
- Drive the Saved Profiles panel from `PDF_DEFAULT_PROFILES` and use one label, "Standard Profile".
- Use the canonical optional-guidelines message on both surfaces.
- Keep the `GuidelineContext` prop as the integration point.
- Do not add persistence.

---

## 12. Data Sources & API Dependencies

| Section | Required data | Current source | Existing API | Classification |
|---|---|---|---|---|
| Header | Title, subtitle, actions | `getPdfHeader` | — | Already Available |
| Categories / Formats / Availability | Capabilities, formats, statuses | `pdf-capabilities.ts` | — | Already Available (static, by design) |
| Quick Start | Workflow steps and their availability | Local constant (duplicate) | — | Needs Frontend Integration (use `PDF_WORKFLOW_STEPS`) |
| Guidelines Summary | `GuidelineContext` for the user or org | `null` | None | Requires Future Backend |
| Saved Profiles | Profile list | Hard-coded copy | None | Needs Frontend Integration (`PDF_DEFAULT_PROFILES`); persistence requires Future Backend |
| Processing Information | Active job | None | None | Requires Future Backend |
| Recent Activity | Job history | None | None (`/api/jobs/run` is unrelated) | Requires Future Backend |
| Help | Static guidance | Static | — | Already Available |

There are no loading or error states for data today because nothing is fetched. The route has no `loading.tsx` or `error.tsx`. The shared `PdfFeedbackState` already provides `loading`, `error` and `network-failure` for when data arrives.

---

## 13. Enterprise UI/UX Findings

Based on code review of the light-theme tokens (`bg-card`, `text-muted-foreground`, `border`). Rendered checks were not run.

- **Hierarchy:** One h1, six h2 sections and labelled h3 cards. The order is logical, with one exception: Quick Start (a workflow aid) appears **before** the categories, while the brief prioritises actions, then capabilities, then formats, then Quick Start.
- **Density:** There are 9 cards across 3 grids, plus 5 identical "Not yet available to run" footers. The repetition dilutes the signal.
- **Status indicators:** Icon plus text throughout, with no colour-only status. Good.
- **Typography:** Consistent `text-base` for h2 and `text-sm` for h3. Fine.
- **Empty states:** Honest and specific, but they use different patterns: Recent Activity uses `PdfFeedbackState`, Saved Profiles uses inline text, and Processing uses a custom block.
- **Navigation consistency:** Internal links lead to "Coming soon" pages without a visible Planned marker (see §8).
- **No redesign needed.** The components are sound. Make the targeted fixes in §19.

---

## 14. Responsive & Accessibility Findings

**Tests actually run:**
- `vitest` PDF suite: 70 tests passed, including SSR checks for a single h1, breadcrumb `aria-current`, disabled actions described by a visible hint, and correct links.
- `pnpm typecheck`: passed.
- Ad-hoc server render of `PdfOverview` to extract the heading outline and links (temporary test file, deleted afterwards).

**Not run:** browser rendering at 1920, 1440, 1280, 1024, 768, 430, 390 and 320 px; axe or automated contrast checks; keyboard walkthrough. All of these were blocked because `GET /modules/publishing/conversion-name/pdf` returns **307 → /login**, and no audit credentials or harness were permitted.

**From code:**

| Area | Finding | Status |
|---|---|---|
| Grids | Categories: 1 → `md:2` → `xl:3` columns. Formats: 1 → `lg:3`. Setup panels: 1 → `md:2` → `xl:3`. Quick Start: 2 → `sm:4` → `lg:7`. | Code OK. The Quick Start 7-column layout at `lg` (1024 px, inside the app shell) risks cramped labels. Not Verified. |
| Header actions | Wrap, full width below `sm` | Code OK |
| Semantics | `section` / `article` / `role="group"` with `aria-labelledby`; `ol` for steps; `ul` for chips | Good |
| Keyboard / focus | Links and buttons come from shared shadcn primitives with visible focus rings | Inherited. Not Verified. |
| Status accessibility | Text labels present; decorative icons are `aria-hidden` | Good |
| Disabled nav items | `role="link" aria-disabled="true"` spans | Acceptable. Screen readers announce them as disabled links. |
| Touch targets | Header buttons use `min-h-9` (36 px). That meets the WCAG 2.2 AA 24 px minimum but is below 44 px. | Pass (AA) |
| Contrast | `text-muted-foreground` on `bg-muted/40` and `/50` panels | Not Verified |

Full WCAG 2.2 AA conformance is **not claimed**.

---

## 15. Component Reuse Map

| Existing file / component | Current purpose | Proposed improvement | Future task |
|---|---|---|---|
| `PageHeader` + `getPdfHeader` + `PdfHeaderActions` | Header | Add Open Workspace as the primary action; mark planned destinations; align metadata | Task 2 |
| `PdfCategoryCard` | Category card | Section-level availability note; keep the `unsupported` label visible; deduplicate the "To:" formats; rename JATS | Task 3 |
| `pdf-capabilities.ts` | Registry | Add a format table (extensions, MIME, direction); derive `PDF_SOURCE_EXTENSIONS` from it | Task 4 |
| `PdfFormatPanel` | Format chips | Render as a compact format × direction matrix from the registry | Task 4 |
| `PdfAvailabilityLegend` + `PdfCapabilityStatusIndicator` | Status legend and pill | Reuse for steps and destinations; no new status component | Task 5 |
| `PdfQuickStart` | Steps | Derive from `PDF_WORKFLOW_STEPS`; show per-step status | Task 6 |
| `PdfRecentActivityPanel` + `PdfFeedbackState` | Empty state | Use the `no-history` preset; define the row type; prepare loading and error states | Task 7 |
| `PdfSavedProfilesPanel` | Profiles | Read `PDF_DEFAULT_PROFILES`; use the `no-profiles` preset | Task 8 |
| `PdfGuidelinesSummary` + `OPTIONAL_GUIDELINES_MESSAGE` | Guidelines | Use canonical copy; keep the context prop | Task 8 |
| `PdfProcessingInfoPanel` | Placeholder | Merge with Quick Start or keep it minimal (see §17) | Tasks 6 / 9 |
| `PdfSection`, `PdfPanel` | Containers | Retain unchanged | — |
| `PdfSectionNavigation`, `PdfModuleLayout` | Shell | Retain unchanged; rendered QA in Task 9 | Task 9 |

**Missing components genuinely needed later:** a format matrix view (Task 4, from `PdfFormatPanel`) and an activity row/table (Task 7, once data exists). No new UI library is needed.

---

## 16. Missing Functionality Matrix

| Feature | Frontend | Data source | Functionality | Improvement required |
|---|---|---|---|---|
| Header actions | Present | Static config | Partially working | Workspace action, planned markers (Task 2) |
| Conversion categories | Present | Registry | UI Only | Less repetition, naming (Task 3) |
| Format matrix | Partial (chips) | Registry | UI Only | Extensions and MIME types, matrix view, one source (Task 4) |
| Capability status | Present | Registry | Accurate | Extend to steps and destinations (Task 5) |
| Quick Start | Present | Duplicate constant | Partial | Single source, step status (Task 6) |
| Recent Activity | Empty state | None | Not Implemented | Preset, row type, states (Task 7); backend later |
| Saved Profiles | Static | Hard-coded | UI Only | Registry-driven (Task 8); persistence later |
| Guidelines Summary | Present | `null` | UI Only | Canonical copy (Task 8); data later |
| Processing Information | Placeholder | None | Not Implemented | Consolidate (Task 6 / 9) |
| Help | Present | Static | Complete | — |
| PDF conversion engine | — | — | **Blocked** (out of scope) | Future phase |
| Server upload API | — | — | **Blocked** (out of scope) | Future phase |

---

## 17. Duplicate Component Analysis

| Duplication | Locations | Recommendation |
|---|---|---|
| Workflow steps | `QUICK_START_STEPS` (`pdf-overview.tsx`) vs `PDF_WORKFLOW_STEPS` (`pdf-workspace-config.ts`) | Consolidate on `PDF_WORKFLOW_STEPS` (Task 6) |
| Accepted formats | `PDF_SOURCE_EXTENSIONS` and the unsupported-file message vs `PDF_CAPABILITIES` input formats | Derive from the registry (Task 4) |
| Standard profile | `PDF_DEFAULT_PROFILES`, `STANDARD_PROFILE`, and hard-coded copy in `PdfSavedProfilesPanel` | One source, one label (Task 8) |
| Optional-guidelines copy | `OPTIONAL_GUIDELINES_MESSAGE.overview` vs `.workspace` | One canonical string (Task 8) |
| Empty-state patterns | `PdfFeedbackState` vs inline text vs a custom block | Use `PdfFeedbackState` presets (Task 7 / 8 / 9) |
| "Not yet available" notice | 5 identical card footers | One section-level notice (Task 3) |
| Processing status | Quick Start Process/Validate/Download steps vs the Processing Information panel | Fold into the Quick Start statuses (Task 6) |

---

## 18. Technical Risks

| # | Risk | Severity | Resolution |
|---|---|---|---|
| R1 | Rendered, responsive and contrast QA not repeatable without auth access | High | Task 9: run `agent-browser` with a test account at all 8 widths, plus an axe pass |
| R2 | No PDF engine or server upload; users may expect conversion | High (product) / out of scope | Keep honest statuses (Task 5); engine in a later phase |
| R3 | No history or job data source | Medium | Task 7: honest empty state plus type contract only |
| R4 | Workflow step lists drift (7 vs 6, different labels) | Medium | Task 6 |
| R5 | Accepted extensions drift from the registry | Medium | Task 4 |
| R6 | Links to planned pages (Batch Processing, View History) look like working features | Medium | Tasks 2 / 5 |
| R7 | No saved-profile persistence | Medium | Task 8 (UI only); backend later |
| R8 | Metadata description differs from the visible subtitle | Low | Task 2 |
| R9 | Optional-guidelines copy variant | Low | Task 8 |
| R10 | Quick Start 7-column layout at `lg` may be cramped | Low (Not Verified) | Task 6 / 9 |
| R11 | Changing shared files (`pdf-capabilities.ts`, `pdf-workspace-config.ts`, `PdfFeedbackState`) also affects the Workspace | Medium (regression) | Keep the existing tests green and extend them when sources are consolidated |
| R12 | No route-level `loading.tsx` / `error.tsx` | Low (static today) | Add only when data fetching is introduced (Task 7) |

No Critical issues: nothing is broken, misleading about engine support, or forces the user to provide guidelines.

---

## 19. Phase 2 Task 2–9 Implementation Mapping

Every task below changes existing files only. No new routes, APIs, tables or engines.

### Task 2 — Dashboard Header & Actions
- **Files:** `pdf-header-config.ts`, `pdf-header-actions.tsx`, `[submodule]/page.tsx` (`generateMetadata`)
- **Behaviour:** Add **Open Workspace** (primary, link). Upload Files stays disabled with its reason (secondary). Batch Processing either carries a visible "Planned" tag or is hidden on the Overview. Metadata description matches the subtitle.
- **Dependencies:** none.
- **Scope:** Header only. No uploader.
- **Acceptance:** Every enabled action opens a real route. Planned destinations are labelled. `pdf-header.test.ts` is extended and passes.

### Task 3 — Conversion Category Cards
- **Files:** `pdf-overview.tsx` (`PdfCategoryCard`), `pdf-capabilities.ts` (labels only)
- **Behaviour:** One section-level availability notice instead of 5 footers. Keep a visible label for `unsupported` chips. Deduplicate formats in "To:". Rename to "PDF to JATS XML".
- **Acceptance:** All 37 capabilities are still listed. Statuses are unchanged. No Start link while nothing is runnable.

### Task 4 — Supported Format Matrix
- **Files:** `pdf-capabilities.ts`, `pdf-workspace-config.ts`, `pdf-overview.tsx` (`PdfFormatPanel`)
- **Behaviour:** Add a format table (label, extensions, MIME types). Derive `PDF_SOURCE_EXTENSIONS` and the unsupported-file message from it. Render a format × direction matrix with status.
- **Acceptance:** One source for formats. Workspace file validation is unchanged (tests pass). The matrix is readable on mobile, either stacked or scrollable with a caption.

### Task 5 — Capability Availability Indicators
- **Files:** `pdf-capabilities.ts`, `pdf-sections.ts`, `pdf-capability-status.tsx`
- **Behaviour:** Reuse the 6-state model. Add derived helpers for step status and destination status. Mark links to planned sections.
- **Acceptance:** No surface shows "available" without an engine. The existing test "never marks a capability available…" still passes, and new tests cover the destination status.

### Task 6 — Quick Start Workflow
- **Files:** `pdf-overview.tsx` (`PdfQuickStart`), `pdf-workspace-config.ts`
- **Behaviour:** Derive the steps from `PDF_WORKFLOW_STEPS` (add a Process step there if it is kept). Show per-step status. Use the label "Apply Guidelines (Optional)". Fold the Processing Information content into the planned steps.
- **Dependencies:** Task 5 helpers.
- **Acceptance:** One step list. Guidelines are optional and skipped by default. No progress, success or download UI.

### Task 7 — Recent Activity Section
- **Files:** `pdf-overview-panels.tsx` (`PdfRecentActivityPanel`), a types-only addition to `pdf-status-model.ts`
- **Behaviour:** Use the `no-history` preset. Add a `PdfActivityRecord` type. Prepare loading and error rendering. Mark or hide View History while History is planned.
- **Acceptance:** No sample rows. Empty, loading and error states exist and are tested.

### Task 8 — Profiles & Guidelines Summary
- **Files:** `pdf-overview-panels.tsx`, `pdf-guidelines-components.tsx`, `pdf-status-model.ts`
- **Behaviour:** The Saved Profiles panel reads `PDF_DEFAULT_PROFILES` and uses the `no-profiles` preset. One label, "Standard Profile". Canonical optional-guidelines message on both surfaces.
- **Acceptance:** The guideline state for a null context is still "not-provided" and neutral. No compliance claim without a verdict. The existing guideline tests pass.

### Task 9 — Overview UX & Testing
- **Files:** `pdf-overview.tsx` (section order), tests
- **Behaviour:** Apply the section order from §20. Rendered QA at 1920, 1440, 1280, 1024, 768, 430, 390 and 320 px with an authenticated session. Keyboard walkthrough. Axe and contrast checks.
- **Acceptance:** No horizontal overflow, a single h1, focus visible everywhere, and documented test evidence. Covers risks R1, R10 and R11.

---

## 20. Final Audit Conclusions

**Recommended Overview order** (combining sections, no new cards):

1. **Header:** title, subtitle, Open Workspace (primary), planned actions labelled
2. **Conversion categories:** 5 cards with one availability notice
3. **Supported formats:** matrix plus availability legend
4. **Quick Start:** steps with their real status, absorbing Processing Information
5. **Recent activity:** honest empty state
6. **Profiles & optional guidelines:** two panels
7. **Help & format guidance**

No KPI cards or charts are recommended, because no real metrics exist.

**Acceptance checklist:**

| # | Criterion | Result |
|---|---|---|
| 1 | Overview source code inspected | ✅ |
| 2 | Phase 1 foundation verified | ✅ in code and tests. Rendered QA carried over to Task 9. |
| 3 | Overview sections documented | ✅ §4 |
| 4 | Header actions audited | ✅ §5 |
| 5 | Five categories reviewed | ✅ §6 |
| 6 | Format information checked | ✅ §7 |
| 7 | Capability availability verified against functionality | ✅ §8 |
| 8 | Quick Start audited | ✅ §9 |
| 9 | Recent Activity source confirmed missing | ✅ §10 |
| 10 | Saved Profiles evaluated | ✅ §11 |
| 11 | Optional guidelines verified | ✅ §11 |
| 12 | Data dependencies documented | ✅ §12 |
| 13 | UI/UX findings recorded | ✅ §13 |
| 14 | Responsive and accessibility findings recorded | ✅ §14 (rendered checks Not Verified, reason stated) |
| 15 | Component reuse mapped | ✅ §15 |
| 16 | Duplicates identified | ✅ §17 |
| 17 | Missing functionality classified | ✅ §16 |
| 18 | Risks documented | ✅ §18 |
| 19 | Tasks 2–9 instructions | ✅ §19 |
| 20 | No production source modified | ✅ Only this document was added |
| 21 | Evidence-based report | ✅ |

**Permanent Muenot requirement, confirmed:** Company guidelines are optional. Without them, the Standard Profile applies and nothing is blocked. With them, the contracts require application, conflict review and an evidenced compliance verdict before "verified" can be shown.

Task 2 has **not** been started.
