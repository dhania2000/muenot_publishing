# P5-T11 — XLSX CSV table data ingestion

Date: 2026-10-30. Global task 71. Status: implementation complete at the bounded source-import scope.

## Reuse and delivered behavior

- `lib/epub/input-tables.ts`
- `components/publishing/conversion/epub/epub-input-review.tsx`

Only explicit source/sheet/range/header selections produce table cells; default inspection exposes sheet names/dimensions without publishing workbook values. CSV handles quoted delimiters/newlines and keeps formula-looking content literal. ExcelJS is reused behind archive/cell/coordinate limits, macros/external-link rejection and safe selection. Formula/cached results are not executed or trusted. Merge masters/geometry and multirow header intent remain traceable for semantic QA.

## Acceptance and evidence

Real XLSX fixtures test selected versus unrelated/private cells, formula suppression, multirow merged headers and excessive sparse coordinates. CSV fixtures include quoted commas/semicolons and literal =1+1; raw workbook content outside selection is absent from publication nodes.

See [Phase 5 completion](phase-05-completion.md) for exact full regression, deployment-package smoke verification, browser coverage and remaining operational gates. Source/normalized-model status is separate from conversion, standards/accessibility conformance and release. No live database migration or malware verdict was fabricated; model/SQL fixtures do not represent a live MySQL deployment.
