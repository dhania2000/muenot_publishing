# P6-T14 — Human review queue for low-confidence material

Date: 2026-10-30. Global task 89. Status: bounded implementation complete.

## Existing service → improvement

- `lib/epub/input-review-ddl.ts`
- `lib/epub/input-review-store.ts`
- `lib/epub/content-review.ts`
- `components/publishing/conversion/epub/epub-content-preflight.tsx`
- `components/publishing/conversion/epub/epub-input-review.tsx`

Existing project assignment, Assigned to me worklist, source panel and project audit events → source correction worklist with location/confidence/owner/evidence. One additive append-only conversion_input_reviews table stores a bounded model snapshot and action hash linked to exact original request/SHA/parent version. Active assigned/owner staff or admin authority is required; read-only owners cannot write. CAS rejects concurrent edits and stale source/project/security state. Text, page transcription, heading, language/direction, reading order, caption and reference corrections persist as new versions; original source evidence is unchanged. Content edits clear earlier sign-offs. Unsafe bytes/schema failure cannot be waived.

## Executed acceptance and boundaries

Actual SQL-model tests execute versioned correction/CAS, unchanged original evidence, model/action/chain tamper checks, permission/security/revision/owner failures, atomic audit rollback and private model download. Actual-component SSR tests cover read-only controls, escaped untrusted labels and privacy-safe error rendering. These are not live MySQL or browser-interaction tests.

See [Phase 6 completion](phase-06-completion.md) for API/data contracts, exact regression results and outstanding live/native verification. This checkpoint does not assert production EPUB readiness, source/reader fidelity, accessibility conformance or live deployment.
