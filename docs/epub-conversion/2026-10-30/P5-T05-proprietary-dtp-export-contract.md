# P5-T05 — QuarkXPress and proprietary DTP adapters

Date: 2026-10-30. Global task 65. Status: implementation complete at the bounded source-import scope.

## Reuse and delivered behavior

- `lib/epub/input-normalization.ts`
- `lib/epub/source-inspection.ts`
- `lib/epub/input-contract.ts`

Native QuarkXPress/INDD availability is truthfully unavailable. Intake rejects those native binaries with supported export instructions; the adapter contract can also describe the actionable failure. Authorized IDML, EPUB, structured HTML/XML or PDF plus linked assets, original page order and font rights is the supported handoff. The common model preserves source identity, dependencies, loss findings and reviewer ownership for fidelity reconciliation; no vendor licence or tool is inferred.

## Acceptance and evidence

Each DOC/RTF/PPT/XLS/QXP/QXD/INDD alternative is exercised as a documented blocked result; native DTP intake explicitly returns export guidance.

See [Phase 5 completion](phase-05-completion.md) for exact full regression, deployment-package smoke verification, browser coverage and remaining operational gates. Source/normalized-model status is separate from conversion, standards/accessibility conformance and release. No live database migration or malware verdict was fabricated; model/SQL fixtures do not represent a live MySQL deployment.
