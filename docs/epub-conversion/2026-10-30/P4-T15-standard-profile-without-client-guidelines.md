# P4-T15 — Default profile when no guidelines

Date: 2026-10-30. Global task 60. Status: verification_partial.

## Existing capability → improvement

- `lib/epub/guideline-selection.ts`
- `lib/epub/guidelines-contract.ts`
- `lib/epub/guideline-attachments.ts`
- `lib/epub/intake.ts`

Standard Profile 2026.10.30.1 is pinned server-side on new submissions. No guidelines remains valid with client compliance not applicable. Later attachments use the same private storage/quota and project revision writer; existing history stays intact and supplied instructions require review. Default planning still has standards, security and output QA gates.

## Acceptance and evidence

Implementation is present and no-guideline intake/regression passes. Acceptance is VERIFICATION PARTIAL: the requested actual end-to-end no-file EPUB conversion cannot run before the real converter exists. Follow the original later converter tasks and close this gate with an actual generated artifact; do not substitute synthetic ZIP checker fixtures.

The [Phase 4 checkpoint](phase-04-checkpoint.md) records exact regression/build and browser verification. Original prompts/order/source hash are unchanged in `roadmap.json`. All new persistence uses authenticated tenant/project scope. No live database migration, production malware scan, external message, licensed converter, EPUBCheck/Ace result or native screen-reader result is claimed.
