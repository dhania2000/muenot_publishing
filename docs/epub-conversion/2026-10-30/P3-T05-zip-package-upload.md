# P3-T05 Folder and ZIP package upload

30 October 2026 · global task 35 · **complete at the bounded intake scope below**.

## Requirements and behavior

Foundation requirement mapping: NFR-02, NFR-06, DATA-04.

ZIP is the supported folder-hierarchy intake mechanism for this task; no native folder picker is claimed. Existing ZIP directory/inflate helpers are reused and hardened at the EPUB boundary with path depth/collision/traversal checks, local/central consistency, symlink/special-file rejection, CRC checks, nested-archive/script rejection and bounded decompression. Relative paths and member hashes persist in the safe manifest; original bytes are not extracted to disk. EPUB mimetype/container/root package and IDML designmap are checked.

## Existing service to improvement map

- `lib/epub/package-inspection.ts`
- `lib/epub/source-inspection.ts`
- `lib/epub/intake-plan.ts`
- `test/publishing/epub-source-inspection.test.ts`

Identity, private storage, shared uploader, conversion project writer, UI primitives and the secret-authenticated scheduler are extended rather than copied. No second execution queue, login system or public publication storage is introduced.

## Verification and limitations

Traversal, repeated separators, duplicate names, excessive depth, nested archives, symlinks, local-header mismatch, corruption and expansion abuse fixtures passed. Rejected inputs retain tenant/actor/hash/code quarantine evidence without retaining their unsafe bytes or original text. Accepted packages still require downstream security and source-adapter review; relative references are preserved, not rewritten or rendered.

See [batch 4 report](batch-04-report.md) for exact full-suite/build results, schema/deployment gates and screenshot evidence. Earlier Task 30 native screen-reader verification remains partial; this task does not close it.
