# P4-T12 — Rule-to-workflow mapping

Date: 2026-10-30. Global task 57. Status: implementation_complete.

## Existing capability → improvement

- `lib/epub/guidelines-contract.ts`
- `lib/epub/guideline-documents.ts`
- `lib/epub/guideline-review-store.ts`
- `lib/background-jobs.ts`

Every registry rule routes to a named existing stage and accountable owner. Extraction uses the existing durable job engine and shared project events; automated findings also write conversion_qa_runs for the existing workbench report surface. Project revision mutation and app_files storage are reused. There is no parallel conversion/release engine or unbound rule state.

## Acceptance and evidence

Registry completeness tests and review/worker SQL models verify stage/owner/method plus shared QA/events writes. An extraction worker finishing with pending source review does not imply production readiness.

The [Phase 4 checkpoint](phase-04-checkpoint.md) records exact regression/build and browser verification. Original prompts/order/source hash are unchanged in `roadmap.json`. All new persistence uses authenticated tenant/project scope. No live database migration, production malware scan, external message, licensed converter, EPUBCheck/Ace result or native screen-reader result is claimed.
