# P4-T04 — Client-specific publishing profile

Date: 2026-10-30. Global task 49. Status: implementation_complete.

## Existing capability → improvement

- `lib/epub/guideline-profile-store.ts`
- `components/publishing/conversion/epub/epub-guideline-library.tsx`
- `components/publishing/conversion/epub/epub-guideline-selection.tsx`

Named company profiles and project-scoped book overrides have separate authority. Company approval requires an administrator; approved sharing with staff is explicit. Book approval requires an authorized production reviewer. Selection is an exact id/version stored per project, never a mutable tenant default. Catalogue search respects owner/staff/tenant access. Identity and scope cannot be repurposed in place.

## Acceptance and evidence

SQL-model tests pin Client A and Client B independently, deny wrong tenant/private staff access, and retain old approved versions after revision. Browser verification with synthetic Client A and Client D demonstrates independent writer selections and explicit settings application.

The [Phase 4 checkpoint](phase-04-checkpoint.md) records exact regression/build and browser verification. Original prompts/order/source hash are unchanged in `roadmap.json`. All new persistence uses authenticated tenant/project scope. No live database migration, production malware scan, external message, licensed converter, EPUBCheck/Ace result or native screen-reader result is claimed.
