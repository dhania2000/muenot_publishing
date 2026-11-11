# P6-T10 — Footnotes citations and cross-references

Date: 2026-10-30. Global task 85. Status: bounded implementation complete.

## Existing service → improvement

- `lib/epub/input-office.ts`
- `lib/epub/input-markup.ts`
- `lib/epub/content-preflight.ts`
- `lib/epub/content-review.ts`

Existing links/original IDs/Word note IDs → scoped target graph and note backlinks. EPUB/package part paths and same-project source references are resolved locally; duplicate or missing targets remain explicit. DOCX bookmarks are retained as anchors. No remote link is fetched or silently treated as a verified internal reference. A reviewer can select an existing same-source target in a new source-model version.

## Executed acceptance and boundaries

Real structured HTML link/note/duplicate/missing-target fixture, same-project cross-source target fixture, existing DOCX foot/endnote source tests and reference-correction validation. Source-order/backlink evidence is not an output-reader navigation pass.

See [Phase 6 completion](phase-06-completion.md) for API/data contracts, exact regression results and outstanding live/native verification. This checkpoint does not assert production EPUB readiness, source/reader fidelity, accessibility conformance or live deployment.
