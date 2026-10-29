# P2-T11 Source vs output preview

30 October 2026 · global task 26 · status: **complete**.

## Scope and requirements

Requirement mapping: NFR-06–07, DATA-04; see the versioned P1 foundation specifications. This is a Phase 2 interface/integration deliverable, not evidence that the EPUB engine or production deployment exists.

The preview compares authorized stored plain-text snapshots by chapter/page resource key, with side-by-side/source/output modes and 100–200% text zoom. Byte hashes must match uploaded, security-cleared files. Output snapshots are restricted to the latest output of the active project revision. Differences and absent counterparts are explicit; imported markup is displayed as text. No public source URL or imported script execution is introduced.

## Existing service to improvement mapping

- `components/publishing/conversion/epub/epub-project-panels.tsx`
- `lib/epub/workbench-store.ts`
- `database/migrations/2026-10-30-epub-workbench.sql`

Identity/session and tenant context reuse `lib/auth.ts` and `lib/tenant-scope.ts`; private files reuse `app_files`, and execution reads reuse `lib/background-jobs.ts`. UI reuses `components/ui/` and `components/enterprise/data-state.tsx`. Added workbench child records extend the conversion aggregate instead of copying Alt Text or creating another queue/storage system.

## Verification and acceptance

SQL-boundary tests cover clean/hash-bound preview selection and active-revision/latest-output constraints. Synthetic browser snapshots show escaped script text, changed content, zoom and responsive comparison. Actual snapshot extraction, raster page previews and full reading-system fidelity are future adapters, not verified by this UI task.

See [batch evidence](batch-03-report.md) for full regression counts, deployment limits and screenshot inventory. Acceptance status is complete at the stated scope. No production database, source publication, paid provider or deployment was accessed.
