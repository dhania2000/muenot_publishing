# P5-T15 — Unified input normalization and dependency report

Date: 2026-10-30. Global task 75. Status: implementation complete at the bounded source-import scope.

## Reuse and delivered behavior

- `lib/epub/input-contract.ts`
- `lib/epub/input-normalization.ts`
- `lib/epub/input-store.ts`
- `lib/epub/input-ddl.ts`
- `app/api/conversion/epub/projects/[projectId]/inputs/route.ts`
- `components/publishing/conversion/epub/epub-input-review.tsx`

Common model 2026.10.30.1 carries source SHA/name, ordered typed nodes, exact locators, assets/rights/dependencies, bounded losses/owners and observed metadata. Container text is an aggregate; ordered children are authoritative and must not be rendered twice. Existing private file storage/project revisions/events/queue are reused. An immutable source/options manifest request has idempotent replay, actor/owner/tenant/lease/cancel/current-security checks and append-only historical evidence. Current-revision timeline/dashboard jobs resolve the reference-only payload through the domain request. Private JSON export provides the complete model and source-to-node map; the UI exposes selected ranges, mappings, XSD status, codec/duration and worksheet names.

## Acceptance and evidence

All active adapter families have real fixture/model coverage or a documented actionable failure. SQL-model tests execute real TXT and real XSD normalization through the durable request handler, rollback, replay, manifest tampering, source/scan/access changes, inactive actors/owners, lease loss and supersession. API tests cover identity/origin/rate/body/query/private-download boundaries. No source inspection creates an EPUB output or charge.

See [Phase 5 completion](phase-05-completion.md) for exact full regression, deployment-package smoke verification, browser coverage and remaining operational gates. Source/normalized-model status is separate from conversion, standards/accessibility conformance and release. No live database migration or malware verdict was fabricated; model/SQL fixtures do not represent a live MySQL deployment.
