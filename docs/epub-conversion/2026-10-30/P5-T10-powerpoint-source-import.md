# P5-T10 — PPTX source ingestion

Date: 2026-10-30. Global task 70. Status: implementation complete at the bounded source-import scope.

## Reuse and delivered behavior

- `lib/alt-text/pptx-package.ts`
- `lib/epub/input-layout.ts`

Reuse the existing PPTX parser for actual slide order, text shapes, titles, image occurrences, author alternatives, geometry and optional presenter notes. Table text/spans are retained with reading-order review. Shape-tree/z order is not claimed as accessible reading order; unsupported master/background/graphic features are reported. Requested fixed/reconstructed treatment is recorded independently of later editorial/owner approval.

## Acceptance and evidence

An actual OOXML presentation fixture contains title/body/image/private notes. Source text/image dimensions are retained, default notes stay excluded and explicit review notes remain editorial-only.

See [Phase 5 completion](phase-05-completion.md) for exact full regression, deployment-package smoke verification, browser coverage and remaining operational gates. Source/normalized-model status is separate from conversion, standards/accessibility conformance and release. No live database migration or malware verdict was fabricated; model/SQL fixtures do not represent a live MySQL deployment.
