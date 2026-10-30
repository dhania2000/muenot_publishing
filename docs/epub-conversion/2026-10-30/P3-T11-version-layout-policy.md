# P3-T11 — EPUB version and layout selection

Date: 2026-10-30. Global task 41/300. Status: implementation complete for the bounded intake deliverable.

## Audit and reuse

The existing configuration selectors and project writer now share one compatibility policy. Actor-scoped capability fetches fail closed. Legacy incompatible options are disabled; source/security and reader QA remain separate gates.

Existing page/service → improvement evidence:

- `lib/epub/selection-policy.ts`
- `lib/epub/planning-capabilities.ts`
- `app/api/conversion/epub/capabilities/route.ts`
- `components/publishing/conversion/epub/epub-compatibility.tsx`
- `lib/epub/intake.ts`
- `lib/epub/workbench-store.ts`

## Requirements and decisions

- **P3-T11-DEFAULT**: EPUB 3.3 remains the default target; existing source/layout/version constraints are enforced again by the writer.
- **P3-T11-GATE**: 3.4 candidate planning is disabled unless EPUB_EXPERIMENTAL_34_PLANNING_ENABLED=true. This flag enables planning only, never an engine or conformance claim.
- **P3-T11-ACKS**: bounded named acknowledgements record legacy feature-loss and special reader/layout caveats. Unknown acknowledgements are rejected; saved settings and intake reject missing review. Acknowledgement is not expert approval.

## Executed evidence

- `test/publishing/epub-submission-policy.test.ts`

The phase completion report records the measured full-suite/build results and browser evidence. SQL-model tests exercise actual domain/queue functions, rollback and identity boundaries; they are not a live MySQL deployment. Browser tests mount actual components with explicit synthetic API responses, not production uploads or messages.

## Contract, accessibility and remaining gates

All routes reuse the existing EPUB project namespace, authenticated tenant scope and private source storage. Labels, keyboard controls, status messages and compatibility gates are present; native screen-reader verification remains the separate P2-T15 open gate. No conversion worker, malware verdict, validator pass, price/contract acceptance or reader certification is inferred. The additive phase migration has not been applied to a live database. Optional outbound email and a real scheduler still need deployment configuration and operational verification.

See [Phase 3 completion](phase-03-completion.md) for exact totals, standards references, screenshots and integration limits.
