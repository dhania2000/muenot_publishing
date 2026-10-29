# P1-T01 Existing website and repository audit

Version 2.0 · 29 October 2026 · baseline `0cf661d` · documentation only.

The repository provides the EPUB navigation and shared Publishing infrastructure, but no EPUB conversion engine or EPUB-specific API. The supplied screenshot is consistent with the route implementation's “Coming soon” state. Production authentication, database contents and hosting configuration were not accessed in this audit.

## Evidence and improvement mapping

| ID | Current evidence path | Verified finding | Improvement and accountable component |
| --- | --- | --- | --- |
| AUD-01 | `lib/conversion-modules.ts` | EPUB root and ten internal pages are registered | Conversion frontend: implement their content in place; preserve slugs |
| AUD-02 | `app/(workspace)/modules/publishing/conversion-name/[submodule]/page.tsx`; `app/(workspace)/modules/publishing/conversion-name/[submodule]/[page]/page.tsx` | Only PDF has specialized rendering; EPUB, XML and HTML use PlannedPage | EPUB frontend: add an EPUB branch when Phase 2 requires it; no extra top-level routes |
| AUD-03 | `components/publishing/conversion/pdf/pdf-workspace.tsx`; `pdf-workspace-config.ts` | PDF workspace offers local UI; preview/validation/export remain planned | Shared conversion UI: reuse patterns without presenting a local file as uploaded or converted |
| AUD-04 | `lib/alt-text/document-extraction.ts`; `pdf-extractor.ts`; `pptx-extractor.ts`; `docx-context.ts` | PDF/PPTX image extraction and bounded source-context helpers exist; DOCX image extraction returns unsupported | Source adapter owner: reuse bounded parsing pieces, not a claim of whole-book conversion |
| AUD-05 | `lib/alt-text/ocr-engine.ts`; `pdf-page-ocr-pipeline.ts`; `math-engine.ts`; `models/math/model-lock.json` | OCR and model readiness gates exist; math needs provisioned Python/model assets | Content intelligence: keep readiness and accuracy review gates; no guaranteed math recognition |
| AUD-06 | `lib/storage/index.ts`; `file-metadata.ts`; `keys.ts`; `lib/platform-schema.ts` | Tenant-keyed MySQL blobs and app_files metadata exist | Storage owner: reuse bytes/metadata, add conversion authorization and output delivery binding |
| AUD-07 | `lib/storage/index.ts`; `file-scanning.ts`; `lib/settings/uploads.ts` | Upload storage writes scan_status=clean; it is not an antivirus integration. Returned generic storage URL has no corresponding route in app/api | Security owner: enforce bounded EPUB intake and real configured scan policy; do not treat a clean field as evidence of a malware scan |
| AUD-08 | `lib/background-jobs.ts`; `app/api/jobs/run/route.ts`; `lib/job-retry-policy.ts` | Durable queue, transaction enqueue, leases, heartbeat, retry/cancellation and cron-secret gate exist; no EPUB handler | Jobs owner: add a bounded EPUB handler to existing queue; verify the self-hosted scheduler separately |
| AUD-09 | `lib/auth.ts`; `lib/api-auth.ts`; `lib/permission-store.ts` | Sessions have admin/employee roles; feature gate authenticates only; getScope grants all and only manage_settings is admin-only | Authorization owner: implement explicit conversion grants before external clients or reviewer separation are advertised |
| AUD-10 | `lib/tenant-scope.ts`; `lib/tenant-context.ts`; `test/publishing/session-tenant-scope.test.ts` | Async request/job scoping exists, with a fallback tenant 1 | Conversion gate: require a verified session or explicit job tenant; never accept a request tenant ID as authority |
| AUD-11 | `lib/guidelines/contract.ts`; `guideline-contracts.ts`; `components/publishing/conversion/pdf/pdf-guidelines-model.ts` | Two overlapping shared declarative contracts exist; neither is a persistent EPUB enforcement engine | Guidelines owner: reconcile vocabulary and use an explicit EPUB adapter; optional intake remains neutral |
| AUD-12 | `lib/alt-text/client-guideline-profile-store.ts`; `client-guideline-profiles.ts`; `generate.ts` | Multiple named Alt Text profiles now exist with per-work immutable selection | Guidelines owner: reuse the version/selection pattern; literal Alt Text rules do not implement publisher EPUB policy |
| AUD-13 | `package.json`; `next.config.mjs`; `scripts/prepare-standalone.mjs` | Next 16.4.3 webpack/standalone, React 19, TypeScript 5.7.3, Node >=22.13.0; PDF/XML/OCR packages exist | Operations: retain build and trace assets; EPUBCheck, Ace, Java and a reader are not installed dependencies |
| AUD-14 | `lib/platform-schema.ts`; `lib/alt-text/store.ts`; `database/migrations/` | Core users/files/jobs exist; only domain-specific Alt Text projects, not generic conversion projects | Data owner: design one shared conversion aggregate; no duplicate identity, blob or execution-queue tables |

The repository README describes an earlier ERP extraction. Runtime code and current package versions take precedence over its older counts and dependency statements. No ERP installation was audited or modified.

## Reproducible inspection

Read both dynamic conversion pages with literal bracket paths; inspect the EPUB registry; enumerate app/api and dependency entries; search lib/database migrations for EPUB/conversion schema and job handlers. The resulting [repository evidence](repository-evidence.json) records inspected file hashes and route counts. Existing tests provide code-level evidence, not proof of production configuration.

## Acceptance and gaps

AUD-01–AUD-14 are mapped to actual files and distinguish present behavior from proposals. Documentation acceptance is met. Missing EPUB engine, real fine-grained conversion grants, malware tooling, generic delivery route, live database and reader testing remain explicit dependencies. No runtime behavior or schema changed. Privacy review found no need to copy customer publications, secrets or environment values into the report. Change log: refreshed the October 25 audit and corrected outdated auth, math, dependency and client-guideline findings.
