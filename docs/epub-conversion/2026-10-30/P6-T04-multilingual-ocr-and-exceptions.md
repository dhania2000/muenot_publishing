# P6-T04 — Multilingual OCR and handwriting exceptions

Date: 2026-10-30. Global task 79. Status: bounded implementation complete.

## Existing service → improvement

- `lib/epub/input-layout.ts`
- `lib/alt-text/ocr-engine.ts`
- `lib/epub/content-preflight.ts`
- `lib/epub/content-review.ts`

Existing local English/Hindi/bilingual engine → OCR engine/profile/language/confidence and unreviewed correction evidence in the source model. Low confidence changes priority, never the mandatory source comparison. Original text and coordinates persist; reviewer text/transcription corrections create new versions. Handwriting, mathematical signs and cells remain explicit uncertain material. RTL script is detected without pretending the installed English/Hindi profiles recognize Arabic/Hebrew handwriting; that path requires reviewed native text/manual transcription.

## Executed acceptance and boundaries

Real local scanned/mixed-PDF OCR regression, existing multilingual OCR pipeline, Hindi/English/RTL source-codepoint and inherited direction fixture, low-confidence/manual correction tests. No RTL OCR or handwriting recognition accuracy claim.

See [Phase 6 completion](phase-06-completion.md) for API/data contracts, exact regression results and outstanding live/native verification. This checkpoint does not assert production EPUB readiness, source/reader fidelity, accessibility conformance or live deployment.
