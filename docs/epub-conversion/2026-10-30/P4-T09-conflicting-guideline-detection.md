# P4-T09 — Conflicting guideline detection

Date: 2026-10-30. Global task 54. Status: implementation_complete.

## Existing capability → improvement

- `lib/epub/guidelines-contract.ts`
- `lib/epub/guideline-profile-store.ts`
- `components/publishing/conversion/epub/epub-guideline-review.tsx`

Applicability-aware comparisons detect incompatible equalities, min/max bounds and required/forbidden pairs. Duplicate instructions preserve their source references. Company/book comparisons include the exact pinned versions. Contradictions reject approval or expose blocking context; input values that have not been applied are also explicit.

## Acceptance and evidence

Contract/profile tests exercise overlaps, contradictory publisher values, mandatory book restrictions and draft-vs-approved override behavior. The project review shows conflicts and a reviewed compatible-revision recommendation.

The [Phase 4 checkpoint](phase-04-checkpoint.md) records exact regression/build and browser verification. Original prompts/order/source hash are unchanged in `roadmap.json`. All new persistence uses authenticated tenant/project scope. No live database migration, production malware scan, external message, licensed converter, EPUBCheck/Ace result or native screen-reader result is claimed.
