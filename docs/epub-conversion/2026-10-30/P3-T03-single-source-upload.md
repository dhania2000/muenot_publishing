# P3-T03 Single-file upload

30 October 2026 · global task 33 · **complete at the bounded intake scope below**.

## Requirements and behavior

Foundation requirement mapping: NFR-02, NFR-06–07, DATA-04.

The shared file chooser feeds private staged or existing multipart intake. Content is inspected independently of filename: PDF/OOXML structural checks reuse the existing Alt Text validator; image magic, UTF-8 text, XML structure and active-content floors reject obvious mismatches. Detected MIME, SHA-256, conservative classification and pending-security state persist per source. Storage remains restricted octet-stream with no public source URL.

## Existing service to improvement map

- `lib/epub/source-inspection.ts`
- `lib/epub/intake.ts`
- `components/publishing/conversion/epub/epub-planner.tsx`
- `test/publishing/epub-source-inspection.test.ts`

Identity, private storage, shared uploader, conversion project writer, UI primitives and the secret-authenticated scheduler are extended rather than copied. No second execution queue, login system or public publication storage is introduced.

## Verification and limitations

Real PDF and OOXML fixtures, spoofed images, MIME mismatch, malformed XML/UTF-8 and active text rejection passed. Signature/structural checks are not a malware or full image-decoder verdict. Sources remain held for the security/engine gates; no claim that all malicious files can be recognized is made.

See [batch 4 report](batch-04-report.md) for exact full-suite/build results, schema/deployment gates and screenshot evidence. Earlier Task 30 native screen-reader verification remains partial; this task does not close it.
