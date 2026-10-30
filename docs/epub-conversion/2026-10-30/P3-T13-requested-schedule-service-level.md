# P3-T13 — Timeline, priority and service level capture

Date: 2026-10-30. Global task 43/300. Status: implementation complete for the bounded intake deliverable.

## Audit and reuse

The saved wizard and workbench now carry a structured service request instead of implying an SLA from project creation. A browser-discovered date input event issue was fixed so a requested date survives navigation into review. Snapshot assessments remain fixed while current service assessment may evolve.

Existing page/service → improvement evidence:

- `lib/epub/service-request.ts`
- `components/publishing/conversion/epub/epub-service-request.tsx`
- `lib/epub/intake-plan.ts`
- `lib/epub/submission-record.ts`

## Requirements and decisions

- **P3-T13-CAPTURE**: optional requested civil date, IANA timezone, expedited-review request, contract reference, delivery channel and bounded notes.
- **P3-T13-TIME**: compute the actual UTC end of the selected civil date, including DST; distinguish passed requests and nonexistent civil dates.
- **P3-T13-AUTHORITY**: capacity and contract entitlement remain unverified. Requested handling never grants queue priority: both metadata and receipt jobs use server priority 5. Secure-link selection is a request, not a delivery adapter.

## Executed evidence

- `test/publishing/epub-submission-policy.test.ts`
- `test/publishing/epub-intake-store.test.ts`

The phase completion report records the measured full-suite/build results and browser evidence. SQL-model tests exercise actual domain/queue functions, rollback and identity boundaries; they are not a live MySQL deployment. Browser tests mount actual components with explicit synthetic API responses, not production uploads or messages.

## Contract, accessibility and remaining gates

All routes reuse the existing EPUB project namespace, authenticated tenant scope and private source storage. Labels, keyboard controls, status messages and compatibility gates are present; native screen-reader verification remains the separate P2-T15 open gate. No conversion worker, malware verdict, validator pass, price/contract acceptance or reader certification is inferred. The additive phase migration has not been applied to a live database. Optional outbound email and a real scheduler still need deployment configuration and operational verification.

See [Phase 3 completion](phase-03-completion.md) for exact totals, standards references, screenshots and integration limits.
