# P6-T02 — Corruption and missing dependencies

Date: 2026-10-30. Global task 77. Status: bounded implementation complete.

## Existing service → improvement

- `lib/epub/source-inspection.ts`
- `lib/epub/package-inspection.ts`
- `lib/epub/input-normalization.ts`
- `lib/epub/content-preflight.ts`

Existing safe ZIP/XML/media readers → deterministic content-review diagnostics. Archive/CRC/path/size checks, encrypted/protected sources, malformed markup, unsafe links/images, damaged/unsupported media and missing fonts/assets retain their exact adapter finding/location. Dependency resolution uses already-inspected local sources only. Source-replacement, human-correction, configuration and downstream-validation classes separate repair strategies. Corrupt/unsafe/missing bytes and supplied-schema failures cannot be waived by a review action.

## Executed acceptance and boundaries

Existing archive/source/image/TIFF/XSD/EPUB/media fixture matrices plus new invalid XML/dependency analysis and denied human-waiver tests; no invented repair or silently successful empty model.

See [Phase 6 completion](phase-06-completion.md) for API/data contracts, exact regression results and outstanding live/native verification. This checkpoint does not assert production EPUB readiness, source/reader fidelity, accessibility conformance or live deployment.
