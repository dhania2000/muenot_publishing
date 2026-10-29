# Task 23 — Targeted security audit and remediation

Date: 2026-10-29. Branch: `feat/phase3-task08-math-ocr`.

This pass covers the Advanced Accessibility entry points, private sources, evidence/review stores, workers, provider boundaries, credits and downloads introduced or reused through Task 22. Verification used synthetic data and local fixtures. No production probing, deployment or real client secrets were used.

## Findings and fixes

| ID | Severity / classification | Root cause | Remediation and regression evidence |
| --- | --- | --- | --- |
| SEC-01 | Critical upstream package advisories | Next.js 16.3.8 fell inside published affected ranges. Whether a particular advisory is exploitable depends on application configuration; no live exploit was attempted. | Pin Next.js 16.4.3. Final webpack/standalone build and the complete suite pass. Existing image optimization remains disabled. |
| SEC-02 | High upstream package advisory | PDF.js 5.7.284 was inside an affected range. This application uses the server rendering API rather than the PDF.js viewer; viewer-scripting exploitability was not demonstrated. | Pin PDF.js 6.4.299, align the application and PDF.js to one native canvas 1.0.13 instance, use loading-task teardown required by PDF.js 6 and bump page-render execution policy to `pdfjs6-canvas1-source-dpi-v3`. All 20 real PDF rendering/OCR tests pass. |
| SEC-03 | High authorization defect | The shared gate checked that Export existed but discarded its record scope. Some download paths consequently applied only View scope. | Preserve actual Export scope on the server actor. Single-image exports, QA report sources and advanced chart data enforce it alongside View. Document downloads intersect the existing document-owner rule with Export. Batch TXT/CSV/JSON/XLSX filters compute the true intersection, including `created_by AND reviewer_id` when the two scopes differ. Matrix tests cover 150 combinations; HTTP tests deny an otherwise visible foreign-owned asset. |
| SEC-04 | High authorization defect | Document review decisions and chart-label verification accepted broad capability hints without enforcing the actual Approve and Update record scopes for the selected image. | Carry actual action scopes from the existing permission store. Document decisions check View, Update and Approve against the locked image before reading version text or writing a decision. Chart label reviews enforce Approve on the current source and recheck before persistence. Review detail now applies image View and computes truthful per-image Edit/Review flags. Tests cover missing scope, foreign creator, reviewer assignment, mismatched audit actor, revoked permission and a second tenant. |
| SEC-05 | High source-authorization defect | Legacy region/OCR/math/advanced reads checked asset/occurrence linkage but did not consistently repeat current document eligibility before returning cached evidence. | Reuse the existing document-context/source resolver before raw evidence access and recognition. Current tenant, document owner, scan, occurrence, ambiguity and source eligibility remain server decisions. Two synthetic tenants exercise allowed own sources and guessed foreign asset/occurrence IDs; revoked-document tests cover saved reads and new region/OCR/math operations. Private bytes and provider calls are not reached on denial. |
| SEC-06 | Medium resource-control defect | Several JSON routes buffered `req.text()` before checking character length. Missing/false Content-Length and multibyte input could exceed intended byte budgets. | Reuse the existing bounded stream reader for OCR, regions, batch creation, document generation, document image changes, context requests and shared review bodies. Stop/cancel the stream before parsing beyond the cap. Context requests accept only an occurrence identity. Tests exercise a misleading Content-Length, streamed overflow, Hindi byte expansion and malformed JSON. |
| SEC-07 | Moderate upstream package advisory / maintenance | ExcelJS 4.4.0 brought an affected UUID dependency. The inspected ExcelJS path uses v4, whereas the advisory concerns other UUID APIs; application exploitation was not established. | Retain ExcelJS and scope its UUID override to patched CommonJS-compatible 11.1.1. A real XLSX extended-icon-formatting round trip executes that UUID path and preserves Unicode and a literal formula-looking string. No ExcelJS downgrade or force fix was used. |
| SEC-08 | Privacy hardening | Credit-settlement logs emitted arbitrary exception messages, which are unnecessary for operational diagnosis. | Log exception class metadata instead. New tests verify that exception messages are excluded. Relevant source/export/review denials use existing structured server logs with tenant/user/asset/action/code only, not OCR text, file names, URLs, provider responses or credentials. Existing version/job/export audits remain in use. |

## Package evidence

The initial production dependency audit reported four affected package entries: one critical, one high and two moderate. The final full dependency audit reports **0 known vulnerabilities** across all reported severities. This is the package registry's advisory result, not a claim that the application has no possible vulnerabilities.

Primary advisory references:

- [Next.js image optimization advisory](https://github.com/advisories/GHSA-2464-fhr4-w9xw): fixed package line starts at 16.4.1; installed pin is 16.4.3.
- [Next.js Server Actions advisory](https://github.com/advisories/GHSA-p3m5-59mp-jv5r) and [typed-array cache advisory](https://github.com/advisories/GHSA-673q-mjm6-r5xr): the selected Next.js pin is outside their reported affected range.
- [PDF.js advisory](https://github.com/advisories/GHSA-hq66-cqwq-w95j): patched range starts at 6.2.108; installed pin is 6.4.299.
- [UUID advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq): the scoped 11.1.1 pin is a published patched release.

Package metadata confirms that the PDF.js pin supports Node >=22.13.0; the application's existing Node minimum already matches. Native canvas is deliberately deduplicated between PDF.js and the app. Loading two native canvas versions produced a Windows native crash during verification; version alignment removed that crash. The subsequent PDF.js teardown API change was repaired without weakening timeout, worker cleanup or image limits.

## Tenant, roles and data boundaries

- HTTP actors still come from the existing session/module/tenant and Publishing permissions. Client tenant IDs, actor IDs, models, source hashes and fabricated processing progress are not trusted.
- Evidence, reviews, versions, jobs and credits keep existing tenant predicates. Source-specific analysis records also bind exact asset, occurrence, region, version and source fingerprint. Task 22's worker checks, child receipts and fenced checkpoints remain intact.
- View and Export are intersected rather than treating either as a substitute. Update does not imply Approve. Document review applies all required image scopes under its existing row locks.
- The tests use isolated synthetic tenant identities and query-boundary assertions. They do not replace a live multi-tenant database concurrency/security test.
- Batch ownership, asset ownership/reviewer assignment and document ownership retain their existing meanings. No new authentication system, permission taxonomy or queue was introduced.

## Upload, document and model controls reviewed

Existing image upload code checks supported MIME/magic bytes, byte budgets, safe display names and complete image structure. OCR/region/model paths validate source dimensions and coordinate frames before decoding/cropping. Existing scan gates and private tenant storage remain mandatory.

Document validation retains bounded ZIP central-directory inspection: 5,000 entries, 250 MiB total uncompressed bytes, entry ratio 200, XML part limit 4 MiB, aggregate XML budget 32 MiB and 2,000 relationship parts. Path traversal, unsupported compression, macros/active content, external relationships and disallowed DTD/entity declarations remain rejected by existing validation/extraction code and regression fixtures. PDF parsing/rendering retains page/resource limits, a 25-million-pixel rendering budget, side limits, timeouts, XFA/font restrictions, bounded private input and in-memory rasters.

Mathematical recognition retains the pinned model lock, file hashes, safetensors, local-only loading, disabled remote model code, offline/telemetry flags, CPU execution, thread/resource budgets and bounded subprocess input/output. The subprocess receives a deliberately limited environment rather than the API/database credential environment. Tesseract language packs retain explicit local provenance/hash checks and bounded worker instances. This is application-level isolation: it is not an OS sandbox or network firewall.

No recognition model or external AI provider was added. Provider keys stay server-side, model entitlement/governance remains authoritative, and selected provider work uses the existing reservation/settlement/replay lifecycle. Existing duplicate-settlement, rollback, foreign-tenant/user and paid-result recovery tests pass.

## Untrusted text and markup

Image text, OCR, document paragraphs, notes, labels, scientific/model output and optional guideline data remain bounded evidence with source separation. They cannot alter actor scope, tenant predicates, provider entitlement, operation identity or the ledger. The code does not turn recognition text into a shell command, SQL statement, tool invocation or file path.

Existing math validation rejects unsafe commands, excessive nesting/size and external/HTML constructs, then rebuilds allowed presentation MathML rather than trusting arbitrary markup. React renders literal labels and review text. Existing CSV/XLSX literal-value handling and injection fixtures pass. The new XLSX compatibility test also verifies that a formula-looking string remains a string after a real package round trip. Active client guidelines remain unavailable; no optional uploaded policy can override server permissions or pricing.

## Downloads, audit and retention

Original/derived downloads retain authentication, tenant/owner checks, safe filename construction, private/no-store caching and nosniff headers. Sources are streamed through authenticated endpoints; this implementation does not create permanent public signed URLs or expose raw storage keys. Signed-URL expiry testing is therefore not applicable to a new URL mechanism here.

Analysis/job events, immutable review/approval versions, export records and metadata-only denial logs reuse existing stores/logging. No new audit database or sensitive-payload logging was added. Original storage metadata retains its existing retention policy fields. There is no newly implemented evidence-specific TTL/purge, secure-deletion guarantee or permanent audit-retention promise. Temporary raster/crop handling and existing finally cleanup remain in use; cleanup after an OS/process crash and tenant retention administration still require operational review.

## Checks actually run

- Complete Alt Text suite after the final patches: **1,275 passed, 0 failed, 3 skipped**, 1,278 total in 123 files (120 passing files, three existing skipped files); existing exploratory file excluded.
- **33 additional tests** compared with Task 22. The action-scope test additionally evaluates 150 permission/owner combinations.
- Two synthetic tenant/source scenarios; cached/new recognition denial after document revocation; foreign asset/occurrence guesses; scoped export and reviewer checks; locked decision authorization; bounded stream cancellation and multibyte byte limits; literal/untrusted text; safe audit metadata; settlement logging; real XLSX compatibility.
- All **20 real PDF rendering/page OCR tests** pass after the package/API update, including English/Hindi/mixed fixtures, source preservation, rotation, CropBox/UserUnit geometry and pixel/DPI limits. Earlier weak recognizer accuracy is unchanged and is not promoted into a security or accuracy certification.
- Existing malformed upload/archive/XML, unsafe math, private image/download, source/context binding, provider-governance, credit, cancellation and recovery tests remain in the passing suite.
- TypeScript passed. Final Next.js 16.4.3 production webpack build and standalone preparation passed.
- Final read-only npm audit reports zero known advisories. Install scripts were not executed during the targeted dependency installation.

## Remaining operational verification and Task 24 dependencies

No authenticated production tenant, live MySQL race/permission exercise, paid provider or Hostinger/Linux native runtime was available. The original host's native/GLIBC constraints still require a deployment smoke test for Next/SWC and canvas; a local Windows build does not certify that host. No production deployment was performed.

The pass is a targeted code review and fixture regression exercise, not an independent penetration test or compliance certification. Operational rate limiting, OS process/network isolation, backup deletion and tenant retention policy need verification in the actual hosting environment. No additional confirmed critical/high issue remains unaddressed in this pass, and the registry audit is clear; those statements are limited to the inspected code and checks above.

Task 24 can proceed with the corrected source, review and export permissions and the patched PDF renderer. It must still inspect actual document insertion/export capabilities and reviewed-output correctness; this security pass does not assume exporters or live DOCX context extraction are fully implemented.
