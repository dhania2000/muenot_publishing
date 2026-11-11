# P6-T01 — Technical preflight readiness

Date: 2026-10-30. Global task 76. Status: bounded implementation complete.

## Existing service → improvement

- `lib/epub/input-store.ts`
- `lib/epub/content-preflight.ts`
- `lib/epub/input-contract.ts`
- `components/publishing/conversion/epub/epub-preflight-options.tsx`

Existing durable input inspection → normalized source preflight under the same extraction job. Configure page-count budget, OCR priority threshold, geometric review and reviewed page overrides. Supported-format/corruption/extraction outcomes reuse the actual adapters; source authority, exact manifest/security and active-owner checks precede use. Each diagnostic has severity, blocking state, source location, remediation, ownership and repair class. “Extracted for review” is distinct from production readiness; no source path returns productionReady=true.

## Executed acceptance and boundaries

Bounded policy/unknown-field tests, real source inspection regression, active-owner/security/store tests, valid versus unreadable extraction and dependency-only CSS.

See [Phase 6 completion](phase-06-completion.md) for API/data contracts, exact regression results and outstanding live/native verification. This checkpoint does not assert production EPUB readiness, source/reader fidelity, accessibility conformance or live deployment.
