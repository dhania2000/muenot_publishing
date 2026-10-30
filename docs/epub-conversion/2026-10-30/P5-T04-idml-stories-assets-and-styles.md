# P5-T04 — Adobe InDesign IDML integration

Date: 2026-10-30. Global task 64. Status: implementation complete at the bounded source-import scope.

## Reuse and delivered behavior

- `lib/epub/input-layout.ts`
- `lib/epub/package-inspection.ts`

Safe IDML inspection follows design-map stories/spreads/resources. Story content and paragraph/character styles, frame IDs/next/previous links, transforms and candidate story order remain traceable. Frame cycles, absent stories/spreads/styles/fonts and linked assets are explicit findings. Font embedding rights and licensed visual comparison remain unverified. Native INDD is not guessed or decoded.

## Acceptance and evidence

Synthetic real IDML packages retain story text/style/frame chains and report missing linked images, font dependencies and a cycle with no silent production readiness.

See [Phase 5 completion](phase-05-completion.md) for exact full regression, deployment-package smoke verification, browser coverage and remaining operational gates. Source/normalized-model status is separate from conversion, standards/accessibility conformance and release. No live database migration or malware verdict was fabricated; model/SQL fixtures do not represent a live MySQL deployment.
