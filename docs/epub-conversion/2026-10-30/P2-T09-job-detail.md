# P2-T09 Job detail workspace

30 October 2026 · global task 24 · status: **complete**.

## Scope and requirements

Requirement mapping: AUTH-01–05, WF-09; see the versioned P1 foundation specifications. This is a Phase 2 interface/integration deliverable, not evidence that the EPUB engine or production deployment exists.

One authorized canonical project response drives overview/settings/timeline/preview/reports/feedback/operations panels. Deep links preserve project and panel. The existing conversion route tree and shared tabs are reused. Owner, assigned operator and tenant admin are the current supported access scopes; an unrelated same-tenant actor receives 404. Server checks remain authoritative over hidden UI actions.

## Existing service to improvement mapping

- `app/api/conversion/epub/projects/[projectId]/route.ts`
- `components/publishing/conversion/epub/epub-workbench.tsx`
- `lib/epub/workbench-store.ts`

Identity/session and tenant context reuse `lib/auth.ts` and `lib/tenant-scope.ts`; private files reuse `app_files`, and execution reads reuse `lib/background-jobs.ts`. UI reuses `components/ui/` and `components/enterprise/data-state.tsx`. Added workbench child records extend the conversion aggregate instead of copying Alt Text or creating another queue/storage system.

## Verification and acceptance

API authentication/origin/body/rate/error checks and role/tenant tests passed. Browser refresh restored canonical project/panel. Settings and feedback drafts survive panel switches and transient refresh errors; switching worklists/projects is guarded while drafts exist.

See [batch evidence](batch-03-report.md) for full regression counts, deployment limits and screenshot inventory. Acceptance status is complete at the stated scope. No production database, source publication, paid provider or deployment was accessed.
