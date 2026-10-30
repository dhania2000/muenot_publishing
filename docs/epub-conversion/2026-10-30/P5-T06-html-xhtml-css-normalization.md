# P5-T06 — HTML XHTML CSS ingestion

Date: 2026-10-30. Global task 66. Status: implementation complete at the bounded source-import scope.

## Reuse and delivered behavior

- `lib/epub/input-markup.ts`
- `lib/epub/input-common.ts`

Well-formed XHTML and a bounded HTML void-element normalization retain headings, ordered child content, inline whitespace/classes/styles, links, IDs, images and relative dependencies. Malformed source gets a corrected-XHTML alternative. Executable/namespaced active elements, encoded dangerous schemes, external resource requests, entities and ambiguous/active CSS are rejected or blocked. CSS is a dependency, never evaluated. No import performs HTTP or filesystem resource fetches.

## Acceptance and evidence

Actual HTML/XHTML/CSS fixture text tests inline A-space-B preservation, IDs/classes, script/event/namespaced injection, encoded javascript links, remote CSS/image dependencies, malformed markup and safe CSS.

See [Phase 5 completion](phase-05-completion.md) for exact full regression, deployment-package smoke verification, browser coverage and remaining operational gates. Source/normalized-model status is separate from conversion, standards/accessibility conformance and release. No live database migration or malware verdict was fabricated; model/SQL fixtures do not represent a live MySQL deployment.
