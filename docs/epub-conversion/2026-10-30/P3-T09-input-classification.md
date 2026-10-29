# P3-T09 Automatic input classification

30 October 2026 · global task 39 · **complete at the bounded intake scope below**.

## Requirements and behavior

Foundation requirement mapping: NFR-06, DATA-04, WF-02.

Classification persists server-derived format/MIME/package observations and routes uncertain input to review. Small PDFs up to 5 MiB reuse the bounded non-rendering PDF parser for observed native text, likely scanned-page and mixed-content hints, page counts and limitations. Larger/ambiguous/limited PDFs remain review-required. XML vocabulary remains unverified rather than guessed. DOCX/package structure and image signatures are inspected; image decode and accessibility are not inferred. EPUB package version 3.0 is explicitly not represented as proof of EPUB specification 3.3 conformance.

## Existing service to improvement map

- `lib/epub/source-classification.ts`
- `lib/epub/source-inspection.ts`
- `lib/epub/package-inspection.ts`
- `test/publishing/epub-source-classification.test.ts`
- `test/publishing/fixtures/epub-pdf.ts`

Identity, private storage, shared uploader, conversion project writer, UI primitives and the secret-authenticated scheduler are extended rather than copied. No second execution queue, login system or public publication storage is introduced.

## Verification and limitations

Valid native-text PDF, blank/ambiguous and corrupt PDF, large-source fallback, mislabeled media, damaged/missing package content and EPUB package-version fixtures passed. All machine classifications retain pending security and review. No OCR, source conversion, malware scan or universal subtype recognition is claimed.

See [batch 4 report](batch-04-report.md) for exact full-suite/build results, schema/deployment gates and screenshot evidence. Earlier Task 30 native screen-reader verification remains partial; this task does not close it.
