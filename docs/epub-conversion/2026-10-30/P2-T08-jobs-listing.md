# P2-T08 Conversion jobs listing

30 October 2026 · global task 23 · status: **complete**.

## Scope and requirements

Requirement mapping: NFR-03, NFR-07, DATA-01; see the versioned P1 foundation specifications. This is a Phase 2 interface/integration deliverable, not evidence that the EPUB engine or production deployment exists.

The existing EPUB history route contains a bounded project worklist with owner/profile/source count/state/received time, explicit unconfigured SLA, title search, status filters, scopes, 20-row pages and visible-list JSON export. Desktop tables become mobile cards. Existing queue records appear in the project timeline; an intake is not represented as an execution job. No bulk mutation is permitted in this scope.

## Existing service to improvement mapping

- `app/(workspace)/modules/publishing/conversion-name/[submodule]/[page]/page.tsx`
- `components/publishing/conversion/epub/epub-workbench.tsx`
- `lib/epub/workbench-contract.ts`
- `lib/epub/workbench-store.ts`

Identity/session and tenant context reuse `lib/auth.ts` and `lib/tenant-scope.ts`; private files reuse `app_files`, and execution reads reuse `lib/background-jobs.ts`. UI reuses `components/ui/` and `components/enterprise/data-state.tsx`. Added workbench child records extend the conversion aggregate instead of copying Alt Text or creating another queue/storage system.

## Verification and acceptance

List filters are bounded and parameterized; employees cannot request the organization worklist. A 25-project browser fixture passed next/previous paging and search. Long unbroken titles were checked at mobile width. No production-scale query benchmark is claimed.

See [batch evidence](batch-03-report.md) for full regression counts, deployment limits and screenshot inventory. Acceptance status is complete at the stated scope. No production database, source publication, paid provider or deployment was accessed.
