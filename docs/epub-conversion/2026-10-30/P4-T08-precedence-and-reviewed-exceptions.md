# P4-T08 — Rules precedence and exceptions

Date: 2026-10-30. Global task 53. Status: implementation_complete.

## Existing capability → improvement

- `lib/epub/guidelines-contract.ts`
- `lib/guidelines/contract.ts`
- `lib/epub/guideline-review-store.ts`

Reuse shared precedence policy: platform safety and EPUB constraints cannot be waived, company MUST rules cannot silently yield to book preference, and approved book preference overrides carry their reason and conditional status. Written consent references an actual clean project document/extraction/segment and is reviewer-attested. A recorded exception never changes an unmet rule into a pass.

## Acceptance and evidence

Contract and review tests reject mandatory conflicts, missing written sign-off, cross/replaced source identities and non-overridable safety/structure exceptions. Existing unresolved results remain unresolved after accepted client sign-off.

The [Phase 4 checkpoint](phase-04-checkpoint.md) records exact regression/build and browser verification. Original prompts/order/source hash are unchanged in `roadmap.json`. All new persistence uses authenticated tenant/project scope. No live database migration, production malware scan, external message, licensed converter, EPUBCheck/Ace result or native screen-reader result is claimed.
