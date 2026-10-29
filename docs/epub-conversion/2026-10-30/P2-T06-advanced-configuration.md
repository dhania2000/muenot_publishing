# P2-T06 Advanced EPUB configuration panels

30 October 2026 · global task 21 · status: **complete**.

## Scope and requirements

Requirement mapping: WF-01, DATA-05; see the versioned P1 foundation specifications. This is a Phase 2 interface/integration deliverable, not evidence that the EPUB engine or production deployment exists.

The existing planner now uses grouped metadata, typography, media, accessibility and compatibility tabs alongside version/layout controls. Defaults normalize legacy drafts. Dependency errors block submission/save without silently changing settings. Held-project edits create immutable revisions with optimistic concurrency. Default configuration preserves existing intake fingerprints.

## Existing service to improvement mapping

- `components/publishing/conversion/epub/epub-configuration.tsx`
- `components/publishing/conversion/epub/epub-planner.tsx`
- `lib/epub/configuration.ts`
- `lib/epub/intake-plan.ts`
- `lib/epub/intake.ts`

Identity/session and tenant context reuse `lib/auth.ts` and `lib/tenant-scope.ts`; private files reuse `app_files`, and execution reads reuse `lib/background-jobs.ts`. UI reuses `components/ui/` and `components/enterprise/data-state.tsx`. Added workbench child records extend the conversion aggregate instead of copying Alt Text or creating another queue/storage system.

## Verification and acceptance

Contract tests cover bounds/dependencies/defaults; transaction tests cover saved revisions, rollback, stale edits and normalized title consistency. Intake retry tests cover legacy/default configuration equivalence. Browser metadata editing and revision update passed.

See [batch evidence](batch-03-report.md) for full regression counts, deployment limits and screenshot inventory. Acceptance status is complete at the stated scope. No production database, source publication, paid provider or deployment was accessed.
