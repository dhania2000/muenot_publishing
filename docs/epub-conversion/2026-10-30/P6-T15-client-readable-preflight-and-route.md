# P6-T15 — Preflight report and recommended conversion route

Date: 2026-10-30. Global task 90. Status: bounded implementation complete.

## Existing service → improvement

- `lib/epub/content-preflight.ts`
- `lib/epub/input-review-store.ts`
- `lib/epub/selection-policy.ts`
- `components/publishing/conversion/epub/epub-content-preflight.tsx`

Existing compatibility caveats/current project plan and source evidence → client-readable source complexity, OCR/page needs, operator effort, requested versus recommended version/layout/profile, limitations and exception/correction history. Machine-readable original and current reviewed model/preflight exports are separate private downloads. EPUB 3.3 planning is the baseline; source-sensitive layouts remain layout_review_required, experimental/legacy/enhanced selections retain existing caveats and acknowledgement gates. No unsupported route is auto-approved, converted or released. Optional client guidelines continue through the existing independent snapshot/output rule checks; source analysis cannot mark supplied mandatory rules passed.

## Executed acceptance and boundaries

Compatibility fixture explicitly keeps experimental/fixed plans unapproved; report fields and private-download headers are verified in actual domain/API fixtures. Full test/build totals and operational limits are in the phase checkpoint.

See [Phase 6 completion](phase-06-completion.md) for API/data contracts, exact regression results and outstanding live/native verification. This checkpoint does not assert production EPUB readiness, source/reader fidelity, accessibility conformance or live deployment.
