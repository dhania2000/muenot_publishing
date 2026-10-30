# P4-T05 — Requirement categories and severity

Date: 2026-10-30. Global task 50. Status: implementation_complete.

## Existing capability → improvement

- `lib/epub/guidelines-contract.ts`
- `lib/guidelines/contract.ts`

Twenty-two supported rule keys normalize category, stable ID, MUST/SHOULD/PREFERENCE, operator, scalar expected value, source reference, applicable versions/layouts/source formats, owner, stage and method. Unknown object fields, arbitrary paths and forged approval fields are rejected. Sources distinguish manual interpretation from exact document/extraction/segment references.

## Acceptance and evidence

Contract tests cover strict bounds, registry routing, applicability and precedence. Every stored rule has a stage and accountable role; a manual rule cannot be converted into an automated pass by browser input.

The [Phase 4 checkpoint](phase-04-checkpoint.md) records exact regression/build and browser verification. Original prompts/order/source hash are unchanged in `roadmap.json`. All new persistence uses authenticated tenant/project scope. No live database migration, production malware scan, external message, licensed converter, EPUBCheck/Ace result or native screen-reader result is claimed.
