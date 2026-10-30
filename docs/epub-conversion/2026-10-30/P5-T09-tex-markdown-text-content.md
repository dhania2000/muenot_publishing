# P5-T09 — LaTeX Markdown plain text ingestion

Date: 2026-10-30. Global task 69. Status: implementation complete at the bounded source-import scope.

## Reuse and delivered behavior

- `lib/epub/input-markup.ts`

UTF-8 plain text and Markdown headings/lists/code fences become source-referenced blocks. Nonexecuted TeX sections, prose, equations and tabular sources are separated; equation source and original command remain alongside the model. Shell/file I/O, dynamic primitives and unsafe commands are rejected. Unknown/complex macros stay literal with a blocking expert-mapping alternative. No TeX process or untrusted macro expansion runs.

## Acceptance and evidence

Plain text, Markdown structure, section/equation TeX, a retained complex macro and unsafe write18 source are exercised. Semantic math verification is an explicit downstream gate.

See [Phase 5 completion](phase-05-completion.md) for exact full regression, deployment-package smoke verification, browser coverage and remaining operational gates. Source/normalized-model status is separate from conversion, standards/accessibility conformance and release. No live database migration or malware verdict was fabricated; model/SQL fixtures do not represent a live MySQL deployment.
