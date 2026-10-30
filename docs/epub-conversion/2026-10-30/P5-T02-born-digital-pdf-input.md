# P5-T02 — Born-digital PDF ingestion

Date: 2026-10-30. Global task 62. Status: implementation complete at the bounded source-import scope.

## Reuse and delivered behavior

- `lib/alt-text/pdf-package.ts`
- `lib/epub/input-layout.ts`

Reuse the existing PDF content-stream reader. Its optional text-run facts now include observed font resource/BaseFont and glyph count alongside approximate boxes, size, MCID, artifact and source order. The EPUB model keeps page references, image occurrences, existing figure alternatives and page geometry. Column/footnote indicators are candidates; content-stream order and approximate widths are not asserted as verified reading order or exact glyph metrics.

## Acceptance and evidence

Actual generated PDF reference text, Helvetica/font size/glyph count, page positions and a footnote candidate are compared. Existing shared PDF/Alt Text regression also passes.

See [Phase 5 completion](phase-05-completion.md) for exact full regression, deployment-package smoke verification, browser coverage and remaining operational gates. Source/normalized-model status is separate from conversion, standards/accessibility conformance and release. No live database migration or malware verdict was fabricated; model/SQL fixtures do not represent a live MySQL deployment.
