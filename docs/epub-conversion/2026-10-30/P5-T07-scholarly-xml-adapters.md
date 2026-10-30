# P5-T07 — XML JATS BITS NLM DocBook ingestion

Date: 2026-10-30. Global task 67. Status: implementation complete at the bounded source-import scope.

## Reuse and delivered behavior

- `lib/epub/input-markup.ts`
- `lib/epub/input-schema.ts`

JATS/NLM/BITS/DocBook-shaped XML maps journal/book sections, titles, paragraphs, references, tables, graphics, source formulas and metadata to ordered nodes. Bounded vocabulary structure checks are distinct from XSD conformance. Full declared schema validation is available only against an explicitly supplied self-contained XSD; absent schemas stay unverified. DTDs/entities are disabled, unknown structures are retained with actionable XPath-like source locators and original tag/namespace facts.

## Acceptance and evidence

Article/book fixtures preserve semantic titles/text/references/math and unmapped exceptions; XXE is blocked. Real XSD success and failure are independently tested and never imply official publisher or EPUB schema authority.

See [Phase 5 completion](phase-05-completion.md) for exact full regression, deployment-package smoke verification, browser coverage and remaining operational gates. Source/normalized-model status is separate from conversion, standards/accessibility conformance and release. No live database migration or malware verdict was fabricated; model/SQL fixtures do not represent a live MySQL deployment.
