# P4-T06 — EPUB structure, CSS, fonts and image rules

Date: 2026-10-30. Global task 51. Status: implementation_complete.

## Existing capability → improvement

- `lib/epub/guidelines-contract.ts`
- `lib/epub/guideline-output-checks.ts`

Known configurable values map through existing validated EPUB settings. Combined incompatible choices remain blocked. Bounded output ZIP/XHTML/OPF inspection checks heading jumps, CSS active/remote content and image alternatives/intrinsic width. Font licensing, visual fidelity and unsupported CSS/render assumptions require output-bound human evidence.

## Acceptance and evidence

Synthetic actual EPUB archive bytes produce both passes and defects. Unsafe archives, escaped/ambiguous CSS, unsupported operators and unavailable rendering never become compliant. This subset checker is not EPUBCheck or an accessibility conformance certificate.

The [Phase 4 checkpoint](phase-04-checkpoint.md) records exact regression/build and browser verification. Original prompts/order/source hash are unchanged in `roadmap.json`. All new persistence uses authenticated tenant/project scope. No live database migration, production malware scan, external message, licensed converter, EPUBCheck/Ace result or native screen-reader result is claimed.
