# P3-T14 — Submission review and preflight trigger

Date: 2026-10-30. Global task 44/300. Status: implementation complete for the bounded intake deliverable.

## Audit and reuse

The sole existing intake writer and workbench revision mutation are reused. A new epub.preflight handler runs on the existing durable queue; there is no parallel conversion queue. An older held intake can explicitly request preflight for its current saved revision.

Existing page/service → improvement evidence:

- `lib/epub/submission-contract.ts`
- `lib/epub/submission-record.ts`
- `lib/epub/preflight-job.ts`
- `lib/background-jobs.ts`
- `lib/epub/intake.ts`
- `lib/epub/workbench-store.ts`
- `components/publishing/conversion/epub/epub-submission-summary.tsx`
- `components/publishing/conversion/epub/epub-project-panels.tsx`

## Requirements and decisions

- **P3-T14-SNAPSHOT**: canonical, SHA-256-bound submission records source identities, exact settings, compatibility caveats, validation plan, service assessment and pricing limitations.
- **P3-T14-ATOMIC**: source/project writes, immutable submission, one shared-queue preflight request and receipt are committed in the same transaction. A notification enqueue failure rolls everything back.
- **P3-T14-IDEMPOTENT**: one preflight per saved project revision; repeats return its recorded request. A settings revision requires a new snapshot. Older snapshots are retained.
- **P3-T14-EXECUTE**: tenant, owner/assignee authority, source checksums and current worker lease are checked. Cancellation, stale revisions or tampered bindings cannot publish a success. Missing scans/engine produce blocked or superseded assessment; completed execution does not mean conversion passed.

## Executed evidence

- `test/publishing/epub-intake-store.test.ts`
- `test/publishing/epub-workbench-store.test.ts`
- `test/publishing/epub-preflight-job.test.ts`
- `test/publishing/epub-job-contracts.test.ts`

The phase completion report records the measured full-suite/build results and browser evidence. SQL-model tests exercise actual domain/queue functions, rollback and identity boundaries; they are not a live MySQL deployment. Browser tests mount actual components with explicit synthetic API responses, not production uploads or messages.

## Contract, accessibility and remaining gates

All routes reuse the existing EPUB project namespace, authenticated tenant scope and private source storage. Labels, keyboard controls, status messages and compatibility gates are present; native screen-reader verification remains the separate P2-T15 open gate. No conversion worker, malware verdict, validator pass, price/contract acceptance or reader certification is inferred. The additive phase migration has not been applied to a live database. Optional outbound email and a real scheduler still need deployment configuration and operational verification.

See [Phase 3 completion](phase-03-completion.md) for exact totals, standards references, screenshots and integration limits.
