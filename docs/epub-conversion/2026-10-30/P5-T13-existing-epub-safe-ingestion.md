# P5-T13 — Existing EPUB 2 and 3 ingestion

Date: 2026-10-30. Global task 73. Status: implementation complete at the bounded source-import scope.

## Reuse and delivered behavior

- `lib/epub/input-epub.ts`
- `lib/epub/package-inspection.ts`
- `lib/alt-text/ooxml-zip-rewrite.ts`

Inspect required first stored mimetype, container/root package, OPF manifest/spine, XHTML resources, navigation/NCX and metadata. Relative resources are hashed and mapped in spine order; missing/unsafe references remain findings. Encryption/rights packages are refused; no DRM or protected font removal is attempted. Reuse the existing lossless ZIP writer for an unchanged-source round trip and re-inspect exact resource identities. This is source package preservation, not EPUB conversion or output conformance.

## Acceptance and evidence

Actual synthetic EPUB package bytes retain spine/resource identities and report their source round-trip proof. Protected/malformed packages and missing references are tested. The fixture is not presented as a certified EPUB or converter-generated book.

See [Phase 5 completion](phase-05-completion.md) for exact full regression, deployment-package smoke verification, browser coverage and remaining operational gates. Source/normalized-model status is separate from conversion, standards/accessibility conformance and release. No live database migration or malware verdict was fabricated; model/SQL fixtures do not represent a live MySQL deployment.
