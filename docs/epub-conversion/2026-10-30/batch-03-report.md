# EPUB batch 3 checkpoint: global tasks 21–30

30 October 2026 · P2-T06–P2-T15 · baseline bce2fa8cc100b51e7fc8f726d71fb6427ad436a7.

Tasks 21–29 are complete at their Phase 2 interface/integration scope. Task 30 is **verification_partial**: responsive/keyboard/accessibility-tree checks and fixes are implemented, but native screen-reader testing and exhaustive state coverage remain open. Overall tracker: **29 complete (15 specification, 14 implementation), 1 verification partial, 270 not started**. This is a ten-task checkpoint, not a claim that every acceptance gate passed.

## Delivered behavior

Grouped configuration now round-trips through private held intake and immutable edits. Existing EPUB routes share scoped worklists, a canonical project workspace, actual-record timeline, safe text comparison, stored quality reports, versioned feedback/decisions and administrator assignment/templates. Unavailable worker, validators and delivery actions stay explicit. No conversion or conformance result is fabricated.

Each P2-T06–T15 report in this folder maps exact implementation files, foundation requirement IDs, tests and limitations. The original 300 task IDs/prompts/order/source SHA remain unchanged in ../roadmap.json.

## Persistence and authorization

The additive migration `database/migrations/2026-10-30-epub-workbench.sql` mirrors the nine WORKBENCH_DDL definitions in `lib/epub/workbench-store.ts`: revisions, events, comments, decisions, assignments, output versions, QA runs, preview snapshots and setting presets. Existing conversion projects/assets, users, private file records and platform jobs are reused. Output/report/preview tables are contracts for future workers; the browser cannot insert fabricated execution evidence.

Every query is tenant-bound. Owner/assigned-operator/admin project access is checked on reads and writes; staff lists and assignment/template publication are admin-only. Mutation body caps, same-origin checks, strict parsing, private no-store responses and per-instance rate limits protect API boundaries. Optimistic revisions and transactional append-only audits protect concurrent writers. Operational audits contain references rather than copies of comment/source content. Shared templates exclude private book metadata.

Current admin-only internal-review records are separate from owner acceptance, require an independent author and current matching evidence, and cannot release files. Fine-grained reviewer/lead/publisher membership remains a release gate from P1-T04, not satisfied by the existing broad permission-store. No production release/download capability is enabled.

## Verification

- Full existing suite: **1,612 passed, 0 failed, 3 existing opt-in skips**, 156 files. Includes Alt Text and other existing Publishing service regressions.
- TypeScript: passed. Production Next webpack build and standalone preparation: passed.
- New tests cover bounded/default/dependent configuration, legacy fingerprint retries, actor/tenant isolation, literal scoped filters, canonical reads, immutable revisions and rollback, comments/anchors, stale approvals/reports, independent review, owner acceptance, assignment conflicts and sanitized templates. SQL tests use an in-memory transaction boundary model, not a live MySQL instance.
- Browser verification uses real repository components with clearly labelled synthetic project/artifact fixtures and mocked network responses. Search/paging, configuration revision save, feedback, assignment, refresh/deep links, safe plain-text differences, report severity filtering, issue discussion, keyboard tabs and draft protection were exercised. Fixture refresh persistence is sessionStorage-only evidence for UI hydration; server durability is covered separately by store contracts, not claimed as live-DB proof.
- Tested viewports: desktop 1280×720, tablet 768×1024, mobile 390×844. No page-level horizontal overflow in inspected worklist/comparison/report states. Tab rows scroll within their own container. This is not an exhaustive assistive-technology or every-browser certification.

Screenshots are user artifacts outside Git, under this chat's outputs directory:

- `epub-batch03-held-state.png`: no quality report/pass inferred for held intake.
- `epub-batch03-desktop-preview.png`: desktop workspace.
- `epub-batch03-tablet-preview.png`: synthetic source/output comparison at 200% text zoom.
- `epub-batch03-mobile-reports.png`: mobile report/preview layout; synthetic content only.

Findings fixed: horizontal tab/content placement, opening focus, debounced-list unmount losing detail state, draft preservation during tab changes, source/output revision selection and normalized active/history titles. Native screen-reader testing remains open: no active NVDA/Narrator session was available. Do not substitute accessibility-tree inspection for a native screen-reader pass.

## Deployment and remaining gates

No migration was applied and no production database/Hostinger smoke or deployment was performed. Runtime idempotent schema initialization follows the existing intake pattern; deployment must verify DDL privileges, MySQL JSON/auto-increment/index behavior, rollback and tenant filtering against real infrastructure. Rollback application code without dropping stored workbench evidence; do not delete rows or tables as a rollback shortcut.

EPUB conversion, malware scanning, actual EPUBCheck/Ace execution, output snapshot generation, reader/raster fidelity, released downloads, real retries/SLA and high-volume query benchmarks remain future integrations. Current projects remain held, with pending-security source files and no execution job or billing. Before closing Task 30, record native screen-reader keyboard/announcement behavior, additional loading/error/validation states and follow-up fixes. Later phases must preserve these outstanding gates rather than counting them as verified.
