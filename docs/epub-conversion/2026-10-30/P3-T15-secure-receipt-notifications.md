# P3-T15 — Secure intake receipt and notices

Date: 2026-10-30. Global task 45/300. Status: implementation complete for the bounded intake deliverable.

## Audit and reuse

The existing mail transport is extended with optional strict configuration, cancellation and idempotency options; existing auth callers retain their behavior. Domain receipt state uses the same project audit and queue, with no email addresses in job payloads. New receipt API is authenticated, same-origin for writes, rate-limited and private/no-store.

Existing page/service → improvement evidence:

- `lib/mailer.ts`
- `lib/epub/submission-record.ts`
- `lib/epub/receipt-notices.ts`
- `lib/epub/receipt-notification.ts`
- `app/api/conversion/epub/notices/route.ts`
- `components/publishing/conversion/epub/epub-receipt-notices.tsx`
- `lib/background-jobs.ts`

## Requirements and decisions

- **P3-T15-RECEIPT**: durable owner-only receipt includes project ID, submitted revision/assets, UTC submission time and next steps. Current portal status is joined live alongside original submitted status.
- **P3-T15-PRIVATE**: no manuscript attachment, upload token, provider credential or public manuscript URL is sent. Email contains only receipt metadata and source count; the signed-in portal holds the manifest. Audit contains references and outcomes.
- **P3-T15-REUSE**: optional email uses existing lib/mailer.ts and shared queue, enabled only by EPUB_RECEIPT_EMAIL_ENABLED=true with existing mail configuration. Missing configuration is explicit and never falls back to logging EPUB receipt contents.
- **P3-T15-RETRY**: portal read is idempotent; replay is capped at ten receipt attempts and audited. Outbound retries freeze the same envelope and provider key, verify current owner and lease, reject changed recipients/senders, and require review after 23 hours instead of risking an expired provider deduplication window. Failed queue status is visible; no live send is claimed.

## Executed evidence

- `test/publishing/epub-receipt-notices.test.ts`
- `test/publishing/epub-receipt-notification.test.ts`
- `test/publishing/epub-mail-transport.test.ts`
- `test/publishing/epub-job-contracts.test.ts`
- `test/publishing/epub-intake-store.test.ts`

The phase completion report records the measured full-suite/build results and browser evidence. SQL-model tests exercise actual domain/queue functions, rollback and identity boundaries; they are not a live MySQL deployment. Browser tests mount actual components with explicit synthetic API responses, not production uploads or messages.

## Contract, accessibility and remaining gates

All routes reuse the existing EPUB project namespace, authenticated tenant scope and private source storage. Labels, keyboard controls, status messages and compatibility gates are present; native screen-reader verification remains the separate P2-T15 open gate. No conversion worker, malware verdict, validator pass, price/contract acceptance or reader certification is inferred. The additive phase migration has not been applied to a live database. Optional outbound email and a real scheduler still need deployment configuration and operational verification.

See [Phase 3 completion](phase-03-completion.md) for exact totals, standards references, screenshots and integration limits.
