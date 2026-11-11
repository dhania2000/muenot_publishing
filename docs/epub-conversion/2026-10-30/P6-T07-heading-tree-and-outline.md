# P6-T07 — Chapter heading and hierarchy extraction

Date: 2026-10-30. Global task 82. Status: bounded implementation complete.

## Existing service → improvement

- `lib/epub/content-preflight.ts`
- `lib/epub/content-review.ts`
- `lib/epub/input-markup.ts`
- `lib/epub/input-office.ts`

Existing explicit heading/style nodes → stable source-mapped outline with levels, parent references and candidate front/body/back matter. Skipped levels/no outline become correction issues. Large-font/chapter-pattern prose is a suggestion only; explicit reviewer heading levels become a new semantic model version. Existing DOCX style extraction, HTML/XML original IDs and bookmarks are reused rather than a separate chapter parser.

## Executed acceptance and boundaries

Source heading fixture verifies Preface/body/References grouping, parent linkage and skipped-level detection. Review parser validates 1–6 and source scope; ordinary text remains unverified until compared. This is source outline analysis, not built EPUB navigation.

See [Phase 6 completion](phase-06-completion.md) for API/data contracts, exact regression results and outstanding live/native verification. This checkpoint does not assert production EPUB readiness, source/reader fidelity, accessibility conformance or live deployment.
