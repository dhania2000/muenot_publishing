# P2-T13 Client comments and approvals UI

30 October 2026 · global task 28 · status: **complete**.

## Scope and requirements

Requirement mapping: AUTH-04, AUTH-07–08, WF-05–09; see the versioned P1 foundation specifications. This is a Phase 2 interface/integration deliverable, not evidence that the EPUB engine or production deployment exists.

Comments are append-only, threaded, revision-bound and project/chapter/issue anchored. Version changes preserve old feedback. Decisions append actor/revision/output ID/SHA and reason; they cannot overwrite earlier approval records. Owner acceptance requires current security-cleared output, latest matching passed EPUBCheck/Ace reports and independent review. A later change request supersedes prior approval. Internal review currently uses the existing admin role plus author separation and explicit manual-review confirmation; it is not an editorial release grant.

## Existing service to improvement mapping

- `app/api/conversion/epub/projects/[projectId]/route.ts`
- `components/publishing/conversion/epub/epub-project-panels.tsx`
- `lib/epub/workbench-store.ts`

Identity/session and tenant context reuse `lib/auth.ts` and `lib/tenant-scope.ts`; private files reuse `app_files`, and execution reads reuse `lib/background-jobs.ts`. UI reuses `components/ui/` and `components/enterprise/data-state.tsx`. Added workbench child records extend the conversion aggregate instead of copying Alt Text or creating another queue/storage system.

## Verification and acceptance

Transaction tests cover threads/revisions/audit, forged anchors, author self-review, owner-only acceptance, stale QA and superseded approvals. Browser saved project feedback and synthetic issue feedback passed. Dedicated reviewer/lead/publisher grants remain a future authorization dependency before production release; no release transition or output download is enabled here.

See [batch evidence](batch-03-report.md) for full regression counts, deployment limits and screenshot inventory. Acceptance status is complete at the stated scope. No production database, source publication, paid provider or deployment was accessed.
