# P4-T10 — Unsupported instruction review

Date: 2026-10-30. Global task 55. Status: implementation_complete.

## Existing capability → improvement

- `lib/epub/guidelines-contract.ts`
- `lib/epub/guideline-review-store.ts`
- `components/publishing/conversion/epub/epub-guideline-review.tsx`

Unsupported operator/value/configuration instructions remain visible production gates with supported-alternative guidance. Reviewers can record proposed, accepted or rejected deviations with reason and written-client source evidence when material. To use a changed requirement, create and approve a compatible revision; an exception alone cannot make unsupported output pass.

## Acceptance and evidence

Review tests prove text-only consent is insufficient, unsupported/manual checks retain uncertainty and safety cannot be waived. UI keeps decisions separate from the compliance checklist and release authorization.

The [Phase 4 checkpoint](phase-04-checkpoint.md) records exact regression/build and browser verification. Original prompts/order/source hash are unchanged in `roadmap.json`. All new persistence uses authenticated tenant/project scope. No live database migration, production malware scan, external message, licensed converter, EPUBCheck/Ace result or native screen-reader result is claimed.
