# P2-T05 Secure intake integration and batch 2 closure

29 October 2026 · supersedes the partial status recorded at checkpoint 46831e5.

The guided wizard now submits a coherent private intake project rather than only saving a local plan. The backend addition is necessary to satisfy P2-T05's explicit submission requirement: the repository had no existing conversion intake contract to integrate. This implements the smallest intake foundation; EPUB transformation, malware scanning and publication processing are still separate future tasks.

## Existing service to improvement mapping

| Existing component or service | Scoped extension |
| --- | --- |
| `components/publishing/conversion/epub/epub-planner.tsx` | Rights confirmation, multipart submit, retained request reference, error/retry state, private held receipt and explicit new-plan reset |
| `lib/epub/intake-plan.ts` | Reused bounded compatible plan validation; browser source metadata is replaced by facts from actual upload parts |
| `lib/storage/index.ts`; app_files/app_file_blobs | New transaction-compatible pending/private storage helper; no separate EPUB blob system; existing uploadFile behavior untouched |
| `lib/auth.ts`; `lib/tenant-scope.ts` | Trusted authenticated owner/tenant; no request-supplied identity authority; listing is owner-only even for admins |
| `lib/db.ts` | One transaction for project, source bytes, file metadata and associations; rollback on any failed write |
| P1-T09/P1-T10 proposed conversion aggregate | Additive conversion_projects and conversion_project_assets; existing file/user/queue tables reused |

New API: `app/api/conversion/epub/projects/route.ts` POST/GET. New bounded intake service: `lib/epub/intake.ts`. Additive migration: `database/migrations/2026-10-29-epub-project-intake.sql`, mirrored by idempotent runtime initialization. No migration was applied, and no live database was accessed in this session.

## Behavior and limits

- Source files are uploaded only after explicit Submit project for intake, with source-rights confirmation. The attestation time and authenticated creator are recorded. Notes remain optional and unreviewed.
- One request permits up to 10 files, 25 MiB per file and 100 MiB total; streamed multipart bytes have a 101 MiB ceiling. Format/signature safety-floor checks reject executable and clearly mismatched bytes. Full parser, archive and malware verdicts remain pending.
- Same-origin POST, authenticated tenant/owner, private no-store responses, unknown-field rejection, per-instance request rate limiting and one buffered intake at a time constrain the boundary. Distributed/shared-host capacity still needs deployment measurement.
- Sources use existing tenant-prefixed storage with restricted classification, octet-stream content type and pending scan status. No public URL or source download route is created. Project status is held with SECURITY_AND_ENGINE_PENDING; there is no transition to processing in this integration.
- Tenant/service/actor/request uniqueness and a canonical plan/source-byte fingerprint prevent duplicate projects/bytes on retries. Same key with changed payload conflicts. A tenant transaction lock serializes this intake's quota and request writes; legacy upload paths do not share that lock, so no claim of global cross-service quota atomicity is made.
- All sources, metadata and project associations commit together. A failed write leaves no partial project or orphaned source bytes in the transaction. No background processing job, AI reservation or charge is created.
- Browser-tab drafts retain metadata and the request reference, never source bytes/handles. Reload requires file reselection and renewed rights confirmation. Successful receipt locks that form; Start a new project plan explicitly creates a new submission reference. Clearing a browser plan never deletes a submitted project.

## Verification

Full suite: **1,580 passed, 0 failed, 3 existing opt-in skips** across 152 files. TypeScript and production webpack/standalone build passed. Fourteen new API/transaction cases cover authentication, origin, rate/body limits, actual source facts, unknown authority, unsafe bytes, private responses, concurrent duplicate submissions, changed fingerprints, tenant/owner isolation, rollback, quota and upload-slot release.

SQL boundary tests use an in-memory serialized transaction model with the real pending-file helper. They do not constitute live MySQL tests. Browser verification uses actual planner components with explicitly labelled mocked submission responses: source selection, rights gate, held receipt, post-submit form lock, explicit new-project reset, mobile layout and safe restoration passed. Screenshots remain outside the repository.

Acceptance is met for coherent held-project intake, idempotent retry and honest no-processing behavior. **P2-T05 is complete at this scope.** This does not certify real-world malware safety or EPUB output. Before production rollout, verify the migration/transaction behavior and blob packet limits against the hosting database, canonical-origin behavior behind its proxy, configured quota and actual upload receipt. No deployment or paid-provider operation was performed.
