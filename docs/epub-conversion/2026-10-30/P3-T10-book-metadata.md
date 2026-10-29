# P3-T10 Book, publisher and ISBN details

30 October 2026 · global task 40 · **complete at the bounded intake scope below**.

## Requirements and behavior

Foundation requirement mapping: DATA-05, WF-01.

Common metadata fields now include title, subtitle, author, publisher, imprint, series, ISBN, edition and language while reusing the grouped configuration form. Title/language are required for every current planning profile; other fields are optional. Supplied ISBN-10/13 values require a valid checksum; checksum validation never verifies assignment or rights. International text round-trips, optional values normalize without changing the legacy default configuration fingerprint, and epubPackageMetadata provides a precise future package-builder contract.

## Existing service to improvement map

- `lib/epub/book-metadata.ts`
- `lib/epub/configuration.ts`
- `lib/epub/intake-plan.ts`
- `components/publishing/conversion/epub/epub-book-metadata.tsx`
- `components/publishing/conversion/epub/epub-configuration.tsx`
- `test/publishing/epub-book-metadata.test.ts`

Identity, private storage, shared uploader, conversion project writer, UI primitives and the secret-authenticated scheduler are extended rather than copied. No second execution queue, login system or public publication storage is introduced.

## Verification and limitations

ISBN positive/negative/default-shape/Unicode/mapping tests passed. Browser invalid ISBN blocked progression; valid ISBN and Hindi title/subtitle/language persisted into the next configuration step. No EPUB package was generated. Mandatory metadata for future retailer-specific profiles remains a later integration gate.

See [batch 4 report](batch-04-report.md) for exact full-suite/build results, schema/deployment gates and screenshot evidence. Earlier Task 30 native screen-reader verification remains partial; this task does not close it.
