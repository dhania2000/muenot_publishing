# PDF Phase 1 — Task 6: Overview Page

## Summary
The PDF Overview (`/modules/publishing/conversion-name/pdf`) now renders a real dashboard inside the shared
`PdfSectionPage`, so the header, breadcrumbs, navigation and layout are unchanged. All content comes from a
typed capability registry. No metric, activity or profile data is invented.

## Files
| File | Change |
|---|---|
| `components/publishing/conversion/pdf/pdf-capabilities.ts` | New. 5 categories, 36 capabilities, a 6-state status model, format derivation |
| `components/publishing/conversion/pdf/pdf-capability-status.tsx` | New. Status shown as icon + text, never color alone |
| `components/publishing/conversion/pdf/pdf-overview.tsx` | New. Quick Start, category cards, format panels, availability legend, composition |
| `components/publishing/conversion/pdf/pdf-overview-panels.tsx` | New. Guidelines summary, saved profiles, processing info, recent activity, help |
| `app/(workspace)/modules/publishing/conversion-name/[submodule]/page.tsx` | Passes `<PdfOverview>` as children of `PdfSectionPage` |
| `components/publishing/conversion/pdf/pdf-sections.ts` | Overview status changed from `planned` to `ui-ready` |
| `test/publishing/pdf-overview.test.ts` | New. 10 tests |
| `test/publishing/pdf-section-navigation.test.ts` | Invariant updated: only Overview is `ui-ready` |

## Status decisions (evidence from Task 1/2 audits)
- **Available: 0.** No PDF uploader, conversion route or engine is exposed in this module.
- **Planned: 34.** Text collection and image extraction engines exist elsewhere (Alt Text). They stay Planned,
  with the note "engine exists in another module". OCR is noted as detection only. PDF/A, PDF/UA and PDF/X are
  noted as "conformance never claimed".
- **Unsupported: 2.** SVG output (blocked by upload and preview security rules) and PDF Forms (rejected by the validator).
- Supported formats are derived from the capabilities. A format takes the best status of any capability that
  uses it, so a format can never look more available than the capabilities behind it.

## Actions
- Buttons only link to registered routes: Open Workspace and View History. Guidelines has no route, so it is not linked.
- The per-category "Start" link appears only when at least one capability in the category is Available. Today
  every card shows "Not yet available to run".
- The header actions from Task 4 are not repeated in the page body.

## Guidelines and profiles
- Scenario A is shown: "Guidelines: Not Provided" with neutral, non-blocking copy. In Quick Start, step 4 is marked Optional.
- Scenario B is ready: `PdfGuidelinesSummary` accepts `guidelines[]` (name, company, version, format,
  review status, profile). It never claims compliance.
- Standard settings are always presented as valid. "No saved profiles yet" is shown because no profile store exists.

## Validation
- `vitest run test/publishing`: 119 passed, 1 failed. The failure is
  `alt-text-upload.test.ts > returns 201 with safe metadata`, which also fails on clean `main`. It is not caused by this task.
- `tsc --noEmit`: no errors in the changed files.
- No browser check: the route requires sign-in (307). The rendered markup is checked by the tests instead.
