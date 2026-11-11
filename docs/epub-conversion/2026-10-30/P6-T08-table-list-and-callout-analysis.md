# P6-T08 — Tables lists and sidebars detection

Date: 2026-10-30. Global task 83. Status: bounded implementation complete.

## Existing service → improvement

- `lib/epub/input-markup.ts`
- `lib/epub/input-tables.ts`
- `lib/epub/content-preflight.ts`

Existing table/list/note nodes → retained cell spans, explicit header/scope/headers metadata, selected workbook header rows/merge maps, list marker/start/indent/levels and nested callout relationships. Complex/unassigned header associations require review. Markdown source markers/indentation remain observed facts; inferred indentation is not a universal list nesting standard. Source raw formulas remain unexecuted and unrelated worksheet values stay excluded.

## Executed acceptance and boundaries

Real multirow/merged-header XLSX and structured HTML multirow colspan/scope, nested lists and aside fixture. The analyzer retains node relationships and issues rather than claiming generated accessible tables are already validated.

See [Phase 6 completion](phase-06-completion.md) for API/data contracts, exact regression results and outstanding live/native verification. This checkpoint does not assert production EPUB readiness, source/reader fidelity, accessibility conformance or live deployment.
