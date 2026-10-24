# PDF Conversion — Phase 2 Task 3: Category Cards

## Changes
- `pdf-capabilities.ts`
  - Categories now carry `order` (1–5) and `formatAxis` (`output` / `input` / `pdf`), with spec descriptions and icons (FileText, BookOpen, Images, FilePlus, SlidersHorizontal).
  - Format labels standardized: `Markdown` → `MD`, `JATS` → `JATS XML`; PDF/A, PDF/UA, PDF/X list their profile as output.
  - Advanced PDF reordered (OCR, Searchable, Merge … Reorder, Forms, PDF/A, PDF/UA, PDF/X). PDF to Images notes now separate page rasterization, vector conversion and embedded-image extraction.
  - New helpers: `categoryFormats()` and `summarizeCategoryAvailability()`. A category counts as runnable only when at least one of its capabilities is `available`.
- `pdf-overview.tsx` — `PdfCategoryCard` rebuilt:
  - Header with icon, title and description, then a format badge list.
  - Each operation is its own row, showing its format, its own status indicator and an optional note.
  - The first 6 operations show; anything beyond that goes under a native `<details>` "Show all N operations" toggle, so the 13-item Advanced card keeps its height. It works with the keyboard and screen readers and has no JS state.
  - The footer shows the status-count summary and a derived availability sentence. "Open Workspace" appears only for runnable categories, so right now no card shows a run or convert action.
- Section copy says client guidelines are optional for every category.

## Validation
- `vitest` pdf-overview + pdf-header: 32/32 pass. There are 6 new Task 3 tests: order, 36-operation coverage, labels, format axis, runnable derivation, disclosure and no run actions.
- `tsc --noEmit`: no errors in touched files.
- Browser check not done: the route needs a signed-in session in the preview sandbox.
