# P3-T12 — Accessibility, language and reader requirements

Date: 2026-10-30. Global task 42/300. Status: implementation complete for the bounded intake deliverable.

## Audit and reuse

The existing grouped accessibility configuration is extended by optional reader requirements. Old plans retain defaults. Validation plans are stored in immutable submissions and exposed separately from actual run results.

Existing page/service → improvement evidence:

- `lib/epub/reader-requirements.ts`
- `lib/epub/intake-plan.ts`
- `components/publishing/conversion/epub/epub-reader-requirements.tsx`
- `lib/epub/submission-record.ts`
- `lib/epub/preflight-job.ts`

## Requirements and decisions

- **P3-T12-CAPTURE**: validate WCAG target, language tags, scripts, reading systems, assistive technology, media and bounded access needs.
- **P3-T12-MAP**: selections generate responsible preflight/QA/delivery entries with method, severity and stable IDs.
- **P3-T12-EVIDENCE**: every new check begins not_run. Language, scripts, media and AT choices are stored in the submitted revision and cannot manufacture a validation pass.

## Executed evidence

- `test/publishing/epub-submission-policy.test.ts`
- `test/publishing/epub-preflight-job.test.ts`

The phase completion report records the measured full-suite/build results and browser evidence. SQL-model tests exercise actual domain/queue functions, rollback and identity boundaries; they are not a live MySQL deployment. Browser tests mount actual components with explicit synthetic API responses, not production uploads or messages.

## Contract, accessibility and remaining gates

All routes reuse the existing EPUB project namespace, authenticated tenant scope and private source storage. Labels, keyboard controls, status messages and compatibility gates are present; native screen-reader verification remains the separate P2-T15 open gate. No conversion worker, malware verdict, validator pass, price/contract acceptance or reader certification is inferred. The additive phase migration has not been applied to a live database. Optional outbound email and a real scheduler still need deployment configuration and operational verification.

See [Phase 3 completion](phase-03-completion.md) for exact totals, standards references, screenshots and integration limits.
