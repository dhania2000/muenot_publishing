# P2-T07 Client project dashboard

30 October 2026 · global task 22 · status: **complete**.

## Scope and requirements

Requirement mapping: AUTH-01–03, NFR-07; see the versioned P1 foundation specifications. This is a Phase 2 interface/integration deliverable, not evidence that the EPUB engine or production deployment exists.

The existing EPUB overview embeds the compact workbench using shared cards, loading/error/empty patterns and actor-specific SWR cache keys. Counts derive from the selected own/assigned/admin worklist before search/status filtering. Pending acceptance and report attention are stored-output/report queries; latest processing jobs reuse platform_background_jobs. Delivery remains disabled with an explicit reason.

## Existing service to improvement mapping

- `components/publishing/conversion/epub/epub-overview.tsx`
- `components/publishing/conversion/epub/epub-workbench.tsx`
- `lib/epub/workbench-store.ts`

Identity/session and tenant context reuse `lib/auth.ts` and `lib/tenant-scope.ts`; private files reuse `app_files`, and execution reads reuse `lib/background-jobs.ts`. UI reuses `components/ui/` and `components/enterprise/data-state.tsx`. Added workbench child records extend the conversion aggregate instead of copying Alt Text or creating another queue/storage system.

## Verification and acceptance

Tenant/owner/assignment tests and literal-search/metrics tests passed. Local browser fixture displays genuine empty engine states and synthetic report metrics distinctly. No live-database metric reconciliation was performed.

See [batch evidence](batch-03-report.md) for full regression counts, deployment limits and screenshot inventory. Acceptance status is complete at the stated scope. No production database, source publication, paid provider or deployment was accessed.
