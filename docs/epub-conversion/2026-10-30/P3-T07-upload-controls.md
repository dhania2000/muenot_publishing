# P3-T07 Upload pause, resume and cancel controls

30 October 2026 · global task 37 · **complete at the bounded intake scope below**.

## Requirements and behavior

Foundation requirement mapping: NFR-05, NFR-11–12, WF-09.

The planner uses EpubUploadClient with actual per-file received bytes, pause and cancel controls, safe same-file reselection after reload and missing-chunk resume. Only bounded metadata/session tokens are cached per actor browser-tab scope; bytes and File handles are never saved. Pause aborts the pending network request and synchronizes server status. Cancellation deletes unsubmitted temporary chunks and cannot delete a consumed publication. Sealing/cancel races recheck server state before final submission.

## Existing service to improvement map

- `lib/epub/upload-client.ts`
- `components/publishing/conversion/epub/epub-planner.tsx`
- `lib/epub/upload-store.ts`
- `app/api/jobs/run/route.ts`
- `test/publishing/epub-upload-client.test.ts`

Identity, private storage, shared uploader, conversion project writer, UI primitives and the secret-authenticated scheduler are extended rather than copied. No second execution queue, login system or public publication storage is introduced.

## Verification and limitations

Server pause/resume/cancel and client missing-chunk/stop-race tests passed. Browser held a chunk response after server receipt, paused, then resumed to a held-project receipt. Expired bytes are reaped on new staging and by the existing CRON_SECRET-authenticated job runner, in bounded tenant batches. Actual scheduler deployment/cadence remains unverified; uploadCleanup unavailable must be monitored. No production purge or publication deletion was executed.

See [batch 4 report](batch-04-report.md) for exact full-suite/build results, schema/deployment gates and screenshot evidence. Earlier Task 30 native screen-reader verification remains partial; this task does not close it.
