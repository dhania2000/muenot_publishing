# P2-T15 Responsive and accessible UI regression

30 October 2026 · global task 30 · status: **verification_partial**.

## Scope and requirements

Requirement mapping: NFR-03, NFR-07; see the versioned P1 foundation specifications. This is a Phase 2 interface/integration deliverable, not evidence that the EPUB engine or production deployment exists.

Desktop/tablet/mobile checks cover the worklist and canonical panels. Fixes include explicit vertical tab/content layout, heading focus on project open, kept-mounted draft panels, retained worklist data during debounced filtering, contained horizontal tab scrolling and long-content wrapping. Shared primitives and other service behavior are preserved.

## Existing service to improvement mapping

- `components/publishing/conversion/epub/epub-workbench.tsx`
- `components/publishing/conversion/epub/epub-configuration.tsx`
- `components/publishing/conversion/epub/epub-project-panels.tsx`
- `test/publishing/epub-workbench-ui.test.ts`

Identity/session and tenant context reuse `lib/auth.ts` and `lib/tenant-scope.ts`; private files reuse `app_files`, and execution reads reuse `lib/background-jobs.ts`. UI reuses `components/ui/` and `components/enterprise/data-state.tsx`. Added workbench child records extend the conversion aggregate instead of copying Alt Text or creating another queue/storage system.

## Verification and acceptance

Keyboard tabs/ArrowRight/Enter, accessible names, focus and live status checks passed in a local component fixture. 1280px desktop, 768px tablet and 390px mobile geometry showed no page-level horizontal overflow in the tested states. Native NVDA/Narrator testing was not performed: no active reader session was available. This task remains verification_partial until native screen-reader coverage and remaining state coverage are recorded.

See [batch evidence](batch-03-report.md) for full regression counts, deployment limits and screenshot inventory. Acceptance status is verification_partial at the stated scope. No production database, source publication, paid provider or deployment was accessed.
