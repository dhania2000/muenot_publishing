# P4-T11 — Guidelines version control and approval

Date: 2026-10-30. Global task 56. Status: implementation_complete.

## Existing capability → improvement

- `lib/epub/guideline-profile-store.ts`
- `lib/epub/guideline-ddl.ts`
- `lib/epub/submission-record.ts`

Profile payloads and extraction runs are versioned; approval freezes reviewer, effective date, source SHA/excerpt/confidence and human interpretation. CAS prevents stale updates, future-effective versions cannot be selected, archives retain old reproducible versions, restore creates a new draft. Saved project/preflight snapshots retain exact references rather than following catalogue head.

## Acceptance and evidence

SQL-model tests cover stale edits, future effect, archival/restore, source proof and stable prior snapshot hash after approval of a newer version. Browser verifies date retention through adding a rule and explicit draft-save then approval. Live MySQL migration remains unperformed.

The [Phase 4 checkpoint](phase-04-checkpoint.md) records exact regression/build and browser verification. Original prompts/order/source hash are unchanged in `roadmap.json`. All new persistence uses authenticated tenant/project scope. No live database migration, production malware scan, external message, licensed converter, EPUBCheck/Ace result or native screen-reader result is claimed.
