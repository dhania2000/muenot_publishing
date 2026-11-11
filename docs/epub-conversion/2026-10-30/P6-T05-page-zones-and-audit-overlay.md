# P6-T05 — Page segmentation and layout analysis

Date: 2026-10-30. Global task 80. Status: bounded implementation complete.

## Existing service → improvement

- `lib/epub/content-preflight.ts`
- `lib/epub/input-layout.ts`
- `components/publishing/conversion/epub/epub-content-preflight.tsx`

Existing source boxes/page anchors → bounded header/footer/page-number/left/right/spanning/figure/footnote candidates. PDF image boxes are derived from the actual image transformation and page box, while OCR coordinates remain explicitly normalized. The existing Sources panel displays a labelled schematic SVG overlay and equivalent ordered text/source locators. It is not a rendered source-page image and does not imply precise rotated/cropped glyph geometry or learned layout recognition.

## Executed acceptance and boundaries

Multi-column/footer/floating-figure fixture retains all blocks, their boxes and source mapping. Production build and actual-component server-render tests pass; interactive overlay/pixel alignment against a live page remains unverified.

See [Phase 6 completion](phase-06-completion.md) for API/data contracts, exact regression results and outstanding live/native verification. This checkpoint does not assert production EPUB readiness, source/reader fidelity, accessibility conformance or live deployment.
