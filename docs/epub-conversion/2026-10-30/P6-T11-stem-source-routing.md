# P6-T11 — Math chemical and symbol detection

Date: 2026-10-30. Global task 86. Status: bounded implementation complete.

## Existing service → improvement

- `lib/epub/input-markup.ts`
- `lib/epub/input-office.ts`
- `lib/epub/content-preflight.ts`

Existing MathML/OMML/TeX equation sources → source-mapped expert review candidates, original notation/command/numbered label references and confidence. Chemical arrows/reaction/symbol patterns remain heuristic candidates. Undecodable replacement characters have a separate source-correction issue. No equation is solved, turned silently into an image or claimed semantically correct; accessible STEM conversion belongs to later work.

## Executed acceptance and boundaries

Scientific TeX equation with source label, reaction arrow and replacement character fixture, plus existing MathML/OMML source preservation. Source command remains available to expert review.

See [Phase 6 completion](phase-06-completion.md) for API/data contracts, exact regression results and outstanding live/native verification. This checkpoint does not assert production EPUB readiness, source/reader fidelity, accessibility conformance or live deployment.
