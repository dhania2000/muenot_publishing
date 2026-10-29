# P3-T01 Client project creation and job ID

30 October 2026 · global task 31 · **complete at the bounded intake scope below**.

## Requirements and behavior

Foundation requirement mapping: WF-01–02, DATA-02, AUTH-01–03.

Existing createEpubIntake remains the sole project writer. Tenant/actor/request uniqueness and immutable source/configuration fingerprints prevent duplicate projects. Creation now appends project_received in the same transaction as private files, source associations and inspection evidence. The receipt distinguishes project ID from an unstarted processing job; initial state remains held. The event table definition is shared with the existing workbench.

## Existing service to improvement map

- `lib/epub/intake.ts`
- `lib/epub/project-events.ts`
- `lib/epub/workbench-store.ts`
- `test/publishing/epub-intake-store.test.ts`

Identity, private storage, shared uploader, conversion project writer, UI primitives and the secret-authenticated scheduler are extended rather than copied. No second execution queue, login system or public publication storage is introduced.

## Verification and limitations

Initial receipt audit, duplicate retry, tenant/actor isolation, quota and transaction rollback passed. No actual processing job ID or conversion success is invented.

See [batch 4 report](batch-04-report.md) for exact full-suite/build results, schema/deployment gates and screenshot evidence. Earlier Task 30 native screen-reader verification remains partial; this task does not close it.
