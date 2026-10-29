# P2-T12 Quality report and issue viewer

30 October 2026 · global task 27 · status: **complete**.

## Scope and requirements

Requirement mapping: WF-06, AUTH-07; see the versioned P1 foundation specifications. This is a Phase 2 interface/integration deliverable, not evidence that the EPUB engine or production deployment exists.

The report viewer presents stored tool/version/status/hash, automated/manual findings, severity, owner, location, resolution labels, search/assessment filters, 50-item pages and JSON export. Discuss correction opens version/issue-anchored feedback. Stale hashes remain visible and disable correction actions. Empty reports never imply a pass, certification or completed validator run.

## Existing service to improvement mapping

- `components/publishing/conversion/epub/epub-project-panels.tsx`
- `lib/epub/workbench-store.ts`
- `lib/epub/workbench-contract.ts`

Identity/session and tenant context reuse `lib/auth.ts` and `lib/tenant-scope.ts`; private files reuse `app_files`, and execution reads reuse `lib/background-jobs.ts`. UI reuses `components/ui/` and `components/enterprise/data-state.tsx`. Added workbench child records extend the conversion aggregate instead of copying Alt Text or creating another queue/storage system.

## Verification and acceptance

Tests reject stale/failed/missing latest QA evidence for approvals and validate issue anchors. Browser synthetic error filtering and issue-to-feedback navigation passed. Actual EPUBCheck/Ace execution is not implemented or claimed.

See [batch evidence](batch-03-report.md) for full regression counts, deployment limits and screenshot inventory. Acceptance status is complete at the stated scope. No production database, source publication, paid provider or deployment was accessed.
