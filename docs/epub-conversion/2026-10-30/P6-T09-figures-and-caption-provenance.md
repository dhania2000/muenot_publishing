# P6-T09 — Images figures and captions association

Date: 2026-10-30. Global task 84. Status: bounded implementation complete.

## Existing service → improvement

- `lib/epub/input-layout.ts`
- `lib/epub/input-markup.ts`
- `lib/epub/content-preflight.ts`
- `lib/epub/content-review.ts`

Existing media occurrence/assets → figure source page/box/asset path/SHA/author alternative, a unique candidate caption/label or explicit open issue. Orphan captions and absent/ambiguous associations remain review work. Reviewer selects an existing caption or attests intentional uncaptioned treatment; source association is versioned. Contextual alt/rights review remains a separate gate using existing Alt Text capabilities, with no invented approved description.

## Executed acceptance and boundaries

Figure/caption/orphan fixture confirms every reference image has a source-provenance record plus association or issue; shared PDF/PPTX/image extraction regression remains intact. The candidate association is not presented as automatically verified.

See [Phase 6 completion](phase-06-completion.md) for API/data contracts, exact regression results and outstanding live/native verification. This checkpoint does not assert production EPUB readiness, source/reader fidelity, accessibility conformance or live deployment.
