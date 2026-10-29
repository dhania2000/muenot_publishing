# P1-T02 Existing pages to EPUB improvement mapping

Version 2.0 · 29 October 2026 · depends on P1-T01 · documentation only.

This mapping verifies the current P1-T01 audit against repository code. REUSE preserves a component contract, EXTEND adds compatible behavior, INTEGRATE wraps an existing service, CREATE requires new domain behavior, and NOT APPLICABLE excludes unrelated business logic. Owners below are proposed component responsibilities, not claims that staff have been assigned.

| Requirement | Existing page or service and exact path | Decision | Scoped improvement and owner | Dependency or risk |
| --- | --- | --- | --- | --- |
| MAP-01 Navigation | `lib/conversion-modules.ts`; `components/publishing/conversion/conversion-nav.tsx` | REUSE | Existing EPUB root/tabs, shared conversion links; frontend | Preserve ten EPUB slugs and metadata |
| MAP-02 EPUB landing | `app/(workspace)/modules/publishing/conversion-name/[submodule]/page.tsx`; `components/publishing/conversion/pdf/pdf-overview-panels.tsx` | EXTEND | Replace only EPUB placeholder with honest service overview; frontend | All engines currently unavailable |
| MAP-03 Workspace | `components/publishing/conversion/pdf/pdf-module-layout.tsx`; `pdf-content.tsx`; `pdf-workspace.tsx` | EXTEND | Reuse responsive regions/header patterns; add EPUB composition without changing PDF defaults | Generic-looking PDF props still encode PDF settings |
| MAP-04 Intake | `components/publishing/conversion/pdf/pdf-file-components.tsx`; `lib/alt-text/document-upload.ts`; `lib/settings/uploads.ts` | EXTEND | Separate EPUB upload validator through the storage facade; intake | Do not globally allow HTML/scripts; no source-to-EPUB adapter yet |
| MAP-05 Layout/CSS/TOC/media/metadata | Existing EPUB internal route in `app/(workspace)/modules/publishing/conversion-name/[submodule]/[page]/page.tsx`; `pdf-settings-components.tsx` | CREATE domain controls / REUSE primitives | Typed EPUB profile and editors in existing pages; EPUB frontend | Persisted revision and validated content model required |
| MAP-06 Jobs/history | `lib/background-jobs.ts`; shared pages in `lib/conversion-modules.ts`; `components/publishing/alt-text/batch-progress-dashboard.tsx` | INTEGRATE | One shared Conversion Jobs/History experience; jobs owner | New conversion aggregate, not a second executor |
| MAP-07 Guidelines | `lib/guidelines/guideline-contracts.ts`; `contract.ts`; Alt Text `client-guideline-profile-store.ts` | EXTEND | Canonical shared rule adapter and immutable job binding; guidelines owner | Reconcile duplicated contracts; no automatic global client selection |
| MAP-08 Parsing | `lib/alt-text/document-validation.ts`; `ooxml-zip-rewrite.ts`; `docx-context.ts`; `pdf-context.ts` | INTEGRATE | Bounded common archive/XML primitives behind EPUB adapter; ingestion owner | OOXML ZIP output is not automatically an OCF EPUB writer |
| MAP-09 OCR/alternative text | `lib/alt-text/ocr-service.ts`; `math-engine.ts`; `generate.ts`; `document-review-route.ts` | INTEGRATE | Request optional evidence through authorized service contracts; content owner | Existing image IDs/approvals belong to Alt Text; no implicit cross-service access or billing |
| MAP-10 Build/validate/preview | `components/publishing/conversion/pdf/pdf-preview-components.tsx`; `pdf-processing-components.tsx` | CREATE engines / REUSE UI chrome | EPUB package builder, validators and sandboxed reader; engine owner | Tool installation, pinning, licensing and reader fixtures pending |
| MAP-11 Files/delivery | `lib/storage/index.ts`; `file-metadata.ts`; `file-scanning.ts`; `lib/platform-schema.ts` | EXTEND | Authorized output-version download using existing blobs/files; delivery owner | Missing generic storage route; scan status alone is insufficient |
| MAP-12 Auth | `lib/auth.ts`; `lib/permission-store.ts`; `lib/api-auth.ts` | EXTEND | Enforce explicit EPUB actions and project scope at server boundary; security owner | Current all-scope implementation cannot satisfy reviewer separation |
| MAP-13 Identity/core infrastructure | `lib/platform-schema.ts`; `lib/db.ts`; `lib/tenant-scope.ts` | REUSE | Existing users, sessions, transaction pool and trusted tenant scope; platform owner | Match existing key types; fail closed without authenticated tenant |
| MAP-14 Unrelated services | PDF specialized branch in the two conversion routes; XML/HTML registry entries | NOT APPLICABLE to EPUB runtime changes | Preserve other service behavior and regression tests | No promise that existing XML/HTML labels imply implemented converters |

## Integration decisions

CREATE is justified only for behavior absent from the inventory: EPUB content model, source adapters, package construction, validation tool adapters, sandboxed reader, conversion aggregate and controlled delivery. They attach to existing routes, storage and queue. Proposed backend API names are deferred to P1-T09 so this inventory does not create a competing contract.

The current code now has named Alt Text client policies and richer OCR/QA evidence; the old P1-T02 “no guideline backend” observation needs qualification. These services still cannot be called publisher guideline compliance without an EPUB adapter and output checks. The missing-roadmap blocker in the historical documents is resolved by roadmap.json.

## Acceptance

MAP-01–MAP-14 cover every current EPUB tab and the shared services it needs, identify owners and dependencies, and cite actual source paths checked in repository-evidence.json. Static review found no need for duplicate navigation, users, file bytes or execution queue. Requirement mapping acceptance is met; integrations are proposed, not implemented. No runtime change. Change log: reconciled the prior mapping with the supplied 300-task order and current audit.
