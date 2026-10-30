# P4-T13 — Automatic compliance checklist

Date: 2026-10-30. Global task 58. Status: implementation_complete.

## Existing capability → improvement

- `lib/epub/guidelines-contract.ts`
- `lib/epub/guideline-review-store.ts`
- `components/publishing/conversion/epub/epub-guideline-review.tsx`

Generate applicable checks from exact approved rules and target plan. Distinguish settings applied from output verified. Evidence selection matches project revision, requirements hash, output ID and actual output SHA. Append-only monotonic record order selects the latest result without timestamp/UUID ambiguity; history remains available. Empty checklists do not invent verified client compliance.

## Acceptance and evidence

Review tests prevent stale revision, modified bytes, wrong output and client-authored automatic pass. Current evidence is recomputed without deleting history. The browser shows applied settings with not-run checks and disabled validation when no output exists.

The [Phase 4 checkpoint](phase-04-checkpoint.md) records exact regression/build and browser verification. Original prompts/order/source hash are unchanged in `roadmap.json`. All new persistence uses authenticated tenant/project scope. No live database migration, production malware scan, external message, licensed converter, EPUBCheck/Ace result or native screen-reader result is claimed.
