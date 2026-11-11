# P6-T03 — Scanned versus text-based detection

Date: 2026-10-30. Global task 78. Status: bounded implementation complete.

## Existing service → improvement

- `lib/epub/input-layout.ts`
- `lib/epub/content-preflight.ts`
- `components/publishing/conversion/epub/epub-preflight-options.tsx`

Existing PDF text/image occurrence reader → per-page text_based, hybrid, image_only or empty_or_unsupported facts and document classification. Native pages retain native extraction; image-only pages route to selected OCR or explicit transcription. A reviewed per-source/page native/OCR/manual override requires a reason and valid same-project PDF/page. Forced OCR retains superseded native runs as excluded source evidence instead of publishing both. Native override cannot manufacture a missing text layer. Hybrid coverage remains an open source-comparison issue.

## Executed acceptance and boundaries

Actual mixed two-page PDF fixture proves native text is not OCRed, the scanned page yields real local recognized text with page provenance, and route classifications are retained. Empty/manual-page and override policy fixtures cover actionable exceptions.

See [Phase 6 completion](phase-06-completion.md) for API/data contracts, exact regression results and outstanding live/native verification. This checkpoint does not assert production EPUB readiness, source/reader fidelity, accessibility conformance or live deployment.
