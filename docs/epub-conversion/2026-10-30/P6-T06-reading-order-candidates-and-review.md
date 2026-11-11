# P6-T06 — Reading order and column detection

Date: 2026-10-30. Global task 81. Status: bounded implementation complete.

## Existing service → improvement

- `lib/epub/content-preflight.ts`
- `lib/epub/content-review.ts`
- `components/publishing/conversion/epub/epub-content-preflight.tsx`

Existing ordered source nodes and IDML frame facts → separate proposed reading sequence with confidence/review gates. Geometric columns and floating/spanning regions are candidates, never an authoritative reorder. Reviewer Move up/down controls submit a complete direct-block permutation. The server rejects omissions, duplicates and foreign blocks; original order and excluded source evidence remain stored. Human order is recorded in a new model version. Source frame cycles and unclear linked order retain blocking/reconciliation findings.

## Executed acceptance and boundaries

Cross-column/floating-figure and complete-permutation tests verify source order is retained, candidates are reviewable and duplicate/deleted block requests fail. Existing IDML frame-chain/cycle fixture remains in full regression.

See [Phase 6 completion](phase-06-completion.md) for API/data contracts, exact regression results and outstanding live/native verification. This checkpoint does not assert production EPUB readiness, source/reader fidelity, accessibility conformance or live deployment.
