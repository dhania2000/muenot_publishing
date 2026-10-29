# P2-T10 Processing timeline and status interface

30 October 2026 · global task 25 · status: **complete**.

## Scope and requirements

Requirement mapping: WF-02–04, WF-09; see the versioned P1 foundation specifications. This is a Phase 2 interface/integration deliverable, not evidence that the EPUB engine or production deployment exists.

The timeline displays upload/preflight/extraction/build/validation/QA/delivery from persisted project and platform job records. Polling runs every 15 seconds while visible, with focus revalidation. Attempts and actual job status are text, with no synthesized completion percentage. A held intake shows upload receipt, blocked preflight and unstarted downstream stages.

## Existing service to improvement mapping

- `components/publishing/conversion/epub/epub-project-panels.tsx`
- `lib/epub/workbench-contract.ts`
- `lib/epub/workbench-store.ts`
- `lib/background-jobs.ts`

Identity/session and tenant context reuse `lib/auth.ts` and `lib/tenant-scope.ts`; private files reuse `app_files`, and execution reads reuse `lib/background-jobs.ts`. UI reuses `components/ui/` and `components/enterprise/data-state.tsx`. Added workbench child records extend the conversion aggregate instead of copying Alt Text or creating another queue/storage system.

## Verification and acceptance

Timeline contract tests cover held, failed/cancelled and retried records without invented success. Browser empty-state and refresh checks passed. Actual EPUB execution events remain unavailable until a worker is implemented.

See [batch evidence](batch-03-report.md) for full regression counts, deployment limits and screenshot inventory. Acceptance status is complete at the stated scope. No production database, source publication, paid provider or deployment was accessed.
