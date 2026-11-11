# P6-T13 — AI-assisted extraction with confidence

Date: 2026-10-30. Global task 88. Status: bounded implementation complete.

## Existing service → improvement

- `lib/epub/content-ai.ts`
- `lib/epub/input-review-store.ts`
- `lib/ai/assistant-store.ts`
- `components/publishing/conversion/epub/epub-content-preflight.tsx`

Existing tenant AI settings/catalog/provider/outbound guard/credit reservation-ledger → optional selected-excerpt structural hints only. Explicit reviewer consent, deployment privacy approval, organisation source-data policy, allowed model and credits are required before transmission. No automatic call or fallback occurs. Up to five server-selected non-editorial leaf excerpts (800 characters each, <=4000 total) can be scoped; the UI currently selects one. Model JSON must match an existing source/node and exact observed quote, then stores only typed suggestions, evidence hash, model/provider, consent and prompt version/hash. Source bytes/text and human decisions remain authoritative; every hint requires human review regardless of reported confidence. Source context/security/version is rechecked before publishing proposals.

## Executed acceptance and boundaries

Executed mocked-provider contract tests cover consent/kill switches/privacy/source policy, scoped contact redaction, model exclusion, malformed/fabricated evidence, low confidence, metering and failure/no fallback. SQL-model tests bind proposals to saved source version and refuse publish after a revision change. No real provider call, customer source transmission or credit charge was made in verification.

See [Phase 6 completion](phase-06-completion.md) for API/data contracts, exact regression results and outstanding live/native verification. This checkpoint does not assert production EPUB readiness, source/reader fidelity, accessibility conformance or live deployment.
