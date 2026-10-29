# P3-T06 Chunked and resumable upload

30 October 2026 · global task 36 · **complete at the bounded intake scope below**.

## Requirements and behavior

Foundation requirement mapping: NFR-02, NFR-05, NFR-07, NFR-11, DATA-04.

Authenticated staging uses 1 MiB checksum-verified chunks, 25 MiB/file, 10 sources/100 MiB/project, a 100 MiB/20-session tenant reservation ceiling and 24-hour resume expiry. Tokens are random, stored hashed on the server and bound to tenant plus owner; they are sent in a header, never a URL. Sealing verifies the entire source hash and inspection. The existing project endpoint accepts completed session references and consumes staging chunks atomically with project/source/audit creation, using the same writer and tenant quota lock. Retries restore the existing receipt.

## Existing service to improvement map

- `lib/epub/upload-contract.ts`
- `lib/epub/upload-store.ts`
- `app/api/conversion/epub/uploads/route.ts`
- `app/api/conversion/epub/uploads/[uploadId]/route.ts`
- `app/api/conversion/epub/projects/route.ts`
- `test/publishing/epub-resumable-upload.test.ts`
- `test/publishing/epub-upload-route.test.ts`

Identity, private storage, shared uploader, conversion project writer, UI primitives and the secret-authenticated scheduler are extended rather than copied. No second execution queue, login system or public publication storage is introduced.

## Verification and limitations

Missing-chunk resume, idempotent chunk retry, corruption, index/size limits, owner/tenant/token denial, expiry, quota/reservation limits, incomplete sources, atomic consumption/rollback and duplicate submission tests passed. Two buffered upload mutations and one project submission per process bound heavy request concurrency. These are contract/transaction-model tests, not a live MySQL/Hostinger proof.

See [batch 4 report](batch-04-report.md) for exact full-suite/build results, schema/deployment gates and screenshot evidence. Earlier Task 30 native screen-reader verification remains partial; this task does not close it.
