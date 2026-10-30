# P5-T01 — Office document formats

Date: 2026-10-30. Global task 61. Status: implementation complete at the bounded source-import scope.

## Reuse and delivered behavior

- `lib/epub/input-office.ts`
- `lib/epub/input-common.ts`

DOCX uses the existing safe ZIP/OOXML checks and a bounded ordered XML walker. Heading/style names, inline run/font facts, list IDs/levels, table spans, images, note references, foot/endnotes and OMML source are retained. Tracked deletions are excluded and insertions flagged. DOCX/ODT comments are excluded by default; explicitly requested comments become editorial-only notes, including inline ODT annotations. ODT headings, tables, lists, math and images are retained under its stated subset. DOC/RTF have an actionable authorized-export alternative because no licensed legacy adapter is installed.

## Acceptance and evidence

Real DOCX/ODT fixture bytes cover headings, lists, spans, notes, OMML, comments, inline ODT privacy and unsupported legacy exports.

See [Phase 5 completion](phase-05-completion.md) for exact full regression, deployment-package smoke verification, browser coverage and remaining operational gates. Source/normalized-model status is separate from conversion, standards/accessibility conformance and release. No live database migration or malware verdict was fabricated; model/SQL fixtures do not represent a live MySQL deployment.
