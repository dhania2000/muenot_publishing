# P3-T08 File signature, checksum and duplicates

30 October 2026 · global task 38 · **complete at the bounded intake scope below**.

## Requirements and behavior

Foundation requirement mapping: NFR-06–07, NFR-11, DATA-04.

Canonical listed extensions, inspected MIME and cryptographic byte hashes govern source classification. Exact duplicates within one newly submitted project share one private file record/blob but retain distinct source aliases, purposes, ordinals and inspection evidence. The private receipt explains which source has identical bytes. Request idempotency prevents repeated project/source creation. No cross-tenant hash search or duplicate oracle is exposed.

## Existing service to improvement map

- `lib/epub/source-inspection.ts`
- `lib/epub/intake.ts`
- `lib/epub/workbench-store.ts`
- `components/publishing/conversion/epub/epub-workbench.tsx`
- `test/publishing/epub-intake-store.test.ts`

Identity, private storage, shared uploader, conversion project writer, UI primitives and the secret-authenticated scheduler are extended rather than copied. No second execution queue, login system or public publication storage is introduced.

## Verification and limitations

Signature/MIME/hash mismatch and duplicate-byte alias tests passed. Each source checksum is rechecked before storage/deduplication. Deduplication is intentionally project-local; it does not reuse another client’s private assets or claim whole-tenant storage deduplication. Quota reservations conservatively count declared transfer sizes.

See [batch 4 report](batch-04-report.md) for exact full-suite/build results, schema/deployment gates and screenshot evidence. Earlier Task 30 native screen-reader verification remains partial; this task does not close it.
