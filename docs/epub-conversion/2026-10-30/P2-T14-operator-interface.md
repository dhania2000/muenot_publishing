# P2-T14 Operator and administrator production interface

30 October 2026 · global task 29 · status: **complete**.

## Scope and requirements

Requirement mapping: ROL-11, AUTH-03, WF-09; see the versioned P1 foundation specifications. This is a Phase 2 interface/integration deliverable, not evidence that the EPUB engine or production deployment exists.

Staff reuse the own/assigned/admin worklist and canonical operations panel. Administrators assign an active same-tenant operator using expected prior assignment, with an audit event. Shared configuration templates are bounded, immutable and admin-published; publishing strips private book identifiers, description, publisher and rights. Applying a template preserves current source type and book metadata, validates compatibility and requires an explicit save. Blocked/failed/in-review filters and stored report/job panels support triage.

## Existing service to improvement mapping

- `components/publishing/conversion/epub/epub-workbench.tsx`
- `app/api/conversion/epub/presets/route.ts`
- `lib/epub/workbench-store.ts`
- `lib/epub/workbench-contract.ts`

Identity/session and tenant context reuse `lib/auth.ts` and `lib/tenant-scope.ts`; private files reuse `app_files`, and execution reads reuse `lib/background-jobs.ts`. UI reuses `components/ui/` and `components/enterprise/data-state.tsx`. Added workbench child records extend the conversion aggregate instead of copying Alt Text or creating another queue/storage system.

## Verification and acceptance

Role/foreign-user/stale-assignment/template-sanitization tests passed. Browser administrator assignment saved and survived fixture refresh; owner mode hid assignment controls. Retry is explicitly unavailable because no EPUB worker/handler exists. No SLA policy, queue throughput or real retry is claimed.

See [batch evidence](batch-03-report.md) for full regression counts, deployment limits and screenshot inventory. Acceptance status is complete at the stated scope. No production database, source publication, paid provider or deployment was accessed.
