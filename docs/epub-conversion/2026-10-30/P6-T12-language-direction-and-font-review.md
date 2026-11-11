# P6-T12 — Language direction and typography analysis

Date: 2026-10-30. Global task 87. Status: bounded implementation complete.

## Existing service → improvement

- `lib/epub/content-preflight.ts`
- `lib/epub/content-review.ts`
- `components/publishing/conversion/epub/epub-content-preflight.tsx`

Existing Unicode text/style/language facts → per-block script counts, inherited declared language/direction/font facts, mixed bidi and vertical-style observations. Undeclared script may suggest an und-Script tag, not falsely identify a language from an alphabet. Reviewer supplies BCP 47 tag and direction using normal controls. Actual font glyph coverage, punctuation shaping, vertical layout and reader rendering remain unverified source/reader checks; text codepoints are never reversed or normalized away.

## Executed acceptance and boundaries

Mixed English/Devanagari/Arabic punctuation fixture retains exact codepoints and inherited ar/rtl; Arabic script alone does not claim Arabic language recognition. Invalid Unicode remains blocked. No font-coverage or RTL-OCR pass is fabricated.

See [Phase 6 completion](phase-06-completion.md) for API/data contracts, exact regression results and outstanding live/native verification. This checkpoint does not assert production EPUB readiness, source/reader fidelity, accessibility conformance or live deployment.
