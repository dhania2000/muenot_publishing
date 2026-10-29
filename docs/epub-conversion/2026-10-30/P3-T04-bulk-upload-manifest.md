# P3-T04 Bulk multi-file upload

30 October 2026 · global task 34 · **complete at the bounded intake scope below**.

## Requirements and behavior

Foundation requirement mapping: DATA-04, WF-01, NFR-02.

Each source has an explicit main/supplement/cover/reference purpose. Actual names/kinds/sizes replace browser-restored file facts. One canonical source manifest and SHA-256 are committed with the initial audit. Receipts label every file as received/security pending and identify duplicate aliases. Multipart failures report each rejected file and untouched peer as not uploaded. A user can replace one selected file and retry. The atomic policy intentionally admits no partial production project.

## Existing service to improvement map

- `lib/epub/intake-plan.ts`
- `lib/epub/intake.ts`
- `components/publishing/conversion/epub/epub-planner.tsx`
- `test/publishing/epub-source-inspection.test.ts`
- `test/publishing/epub-intake-store.test.ts`

Identity, private storage, shared uploader, conversion project writer, UI primitives and the secret-authenticated scheduler are extended rather than copied. No second execution queue, login system or public publication storage is introduced.

## Verification and limitations

Bulk validation results, purpose preservation, audit manifest digest and duplicate-byte associations passed. Browser source-purpose selection passed. Resumable staging reports actual received bytes and per-file state; percentages never represent EPUB conversion progress.

See [batch 4 report](batch-04-report.md) for exact full-suite/build results, schema/deployment gates and screenshot evidence. Earlier Task 30 native screen-reader verification remains partial; this task does not close it.
