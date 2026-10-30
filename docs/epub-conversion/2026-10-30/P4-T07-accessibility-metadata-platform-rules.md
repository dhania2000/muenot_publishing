# P4-T07 — Accessibility, metadata and platform rules

Date: 2026-10-30. Global task 52. Status: implementation_complete.

## Existing capability → improvement

- `lib/epub/guideline-output-checks.ts`
- `lib/epub/guideline-review-store.ts`

Metadata/language/publisher/identifier and accessibility-metadata rules inspect actual package values. Reading order, target reader testing and exact standards revision remain manual/unknown where an installed validator cannot establish them. Methods and observed results distinguish passed, failed, conditional, not applicable, not run and unable to test.

## Acceptance and evidence

Output tests demonstrate real metadata defects and deliberate uncertainty for exact revision/platform rendering. Server-only checks reject browser-supplied automatic results. Client-required settings must align with the saved plan before output assessment.

The [Phase 4 checkpoint](phase-04-checkpoint.md) records exact regression/build and browser verification. Original prompts/order/source hash are unchanged in `roadmap.json`. All new persistence uses authenticated tenant/project scope. No live database migration, production malware scan, external message, licensed converter, EPUBCheck/Ace result or native screen-reader result is claimed.
