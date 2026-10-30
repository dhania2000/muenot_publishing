# P5-T03 — Scanned and image-only PDF

Date: 2026-10-30. Global task 63. Status: implementation complete at the bounded source-import scope.

## Reuse and delivered behavior

- `lib/epub/input-layout.ts`
- `lib/alt-text/pdf-page-renderer.ts`
- `lib/alt-text/ocr-engine.ts`

Image-only pages route through the existing local PDF renderer and pinned Tesseract language modes when explicitly requested. Default is OCR off. At most five scanned pages per bounded request are rendered/recognized; additional pages remain visible work. Source SHA/page location, normalized displayed-page coordinates, language, confidence and unreviewed correction status are retained. OCR output always has a blocking human-correction gate and never becomes an accessibility claim.

## Acceptance and evidence

A real scanned PDF built from the existing sentence fixture is rendered and recognized by the actual installed local engine. Recognized text and normalized coordinates are asserted; native-text and no-OCR paths are separate. Existing multilingual engine/pipeline tests remain in regression.

See [Phase 5 completion](phase-05-completion.md) for exact full regression, deployment-package smoke verification, browser coverage and remaining operational gates. Source/normalized-model status is separate from conversion, standards/accessibility conformance and release. No live database migration or malware verdict was fabricated; model/SQL fixtures do not represent a live MySQL deployment.
