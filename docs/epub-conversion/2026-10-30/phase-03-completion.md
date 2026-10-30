# Phase 3 — project intake completion

Date: 2026-10-30. Original global tasks 31–45 / P3-T01–P3-T15.

The latest user instruction replaces ten-task batches with phase delivery: verify and push each phase, then continue to the next phase automatically. Historical batch reports remain unchanged. The 300 original IDs, titles, prompts, order and source document SHA-256 are preserved in `roadmap.json`.

## Delivered scope

P3-T01–P3-T10 were delivered in `5623d352d7699ecfe29c8fa4b45ffe882b219e32`; see [batch 4](batch-04-report.md). This closure adds the remaining five tasks:

| Task | Implementation evidence | Acceptance at this checkpoint |
| --- | --- | --- |
| P3-T11 | [Version/layout policy](P3-T11-version-layout-policy.md) | Stable default, server capability gate, explicit compatibility acknowledgements, blocked unsupported combinations |
| P3-T12 | [Reader/accessibility requirements](P3-T12-reader-accessibility-requirements.md) | Validated requirements persisted and mapped to explicit not-run preflight/QA checks |
| P3-T13 | [Requested schedule/service](P3-T13-requested-schedule-service-level.md) | Timezone-correct nonbinding requests; no unauthorized SLA or queue-priority grant |
| P3-T14 | [Immutable review/preflight](P3-T14-immutable-review-preflight.md) | Atomic revision snapshot and idempotent metadata request on existing durable queue |
| P3-T15 | [Secure receipts/notices](P3-T15-secure-receipt-notifications.md) | Scoped portal receipts, audited replay and optional retryable existing mail transport integration |

All fifteen Phase 3 implementation deliverables are complete at intake scope. Overall roadmap: **44 complete** (15 specification, 29 implementation), **1 verification partial**, **255 pending**. P2-T15/global 30 remains verification partial for native screen-reader and remaining state coverage; this phase does not relabel it.

## Runtime and persistence contracts

The existing `EpubDraft` schema remains version 1 with optional bounded compatibility acknowledgements, reader requirements and service request fields. Legacy plans retain defaults. Existing settings and intake writers enforce the same compatibility policy.

Two additive domain tables, defined in `lib/epub/submission-contract.ts` and mirrored in `database/migrations/2026-10-30-epub-phase03-submission.sql`, store immutable revision snapshots and private receipt state. The existing project events, source/blob store, users and `platform_background_jobs` are reused. No live migration was applied.

`epub.preflight` has only `{projectId, revision, stage:'preflight'}`; `epub.receipt_notice` has only `{noticeId, deliveryAttempt}`. Queue payloads cannot choose recipients, tenants, source bytes or provider configuration. Metadata preflight uses tenant/authority/lease checks, verifies manifest bindings and records blocked or superseded assessments. It does not invoke conversion, mark source scans clean, run validators or charge credits. A completed queue execution can correctly contain a blocked assessment.

Initial project/source writes, snapshot, metadata request and receipt are one transaction. Optional configured email enqueue is in that same transaction. An outbox failure rolls back intake. Repeated submission and repeated preflight for the same revision cannot create duplicate metadata processing requests. Changed revisions get new snapshots; previous immutable summaries keep their original assessment and check count.

Receipt reads/writes are authenticated and recipient/tenant scoped. The API is private/no-store, rate-limited and same-origin for writes. Notices join current project status while retaining original submitted status. Read is idempotent; replay is audited and capped at ten receipt attempts. Audit records reference IDs/outcomes, not manuscripts or mail bodies.

## Standards and capability policy

The planning gate was verified against W3C publications on 2026-10-30: [EPUB 3.3 Recommendation, 13 January 2026](https://www.w3.org/TR/2026/REC-epub-33-20260113/) and [EPUB 3.4 Candidate Recommendation Draft, 28 October 2026](https://www.w3.org/TR/2026/CRD-epub-34-20261028/). These are pinned references, not claims that all readers or this installation support every feature.

`EPUB_EXPERIMENTAL_34_PLANNING_ENABLED=true` enables candidate planning only; default is off. Acknowledgement records awareness of feature-loss/reader limitations and is not approval, validator success or certification.

Requested dates use an IANA timezone and actual civil-day boundaries, including DST and nonexistent civil dates. Capacity/contract entitlement remains unverified and requests nonbinding. Expedited requests keep server queue priority 5. Selecting secure-link delivery does not create a delivery adapter.

Optional outbound email uses existing `lib/mailer.ts`, with `EPUB_RECEIPT_EMAIL_ENABLED=true` plus existing mail configuration. It defaults off. Strict EPUB calls reject missing configuration without logging private receipt content. The original auth mail behavior is preserved. Portal receipt delivery remains available independently.

Each outbound attempt freezes its envelope before sending, with a stable provider idempotency key, current-owner checks, cancellation and lease-guarded settlement. Recipient/sender changes require review. Retry after 23 hours requires review instead of assuming indefinite duplicate suppression; the provider documents a [24-hour idempotency window and identical payload requirement](https://resend.com/changelog/idempotency-keys). The portal distinguishes failed job delivery and missing configuration. No live provider send or operational scheduler was exercised.

## Executed verification

- Full regression: **1,683 passed, 0 failed, 3 existing opt-in skips**, 169 files (166 passed, 3 skipped). Existing exploratory `test/alt-text/zz-explore.test.ts` is excluded as in prior checkpoints.
- TypeScript no-emit and Next webpack production/standalone preparation passed.
- Domain tests cover timezone boundaries, malformed/forged payloads, current authority, stale revisions, source/checksum changes, lease loss, rollback, one request per saved revision, receipt isolation/replay, no-content logging, stable retry envelopes and provider error redaction.
- SQL-model tests run actual domain/queue code against transactional models; they are not a live MySQL integration proof.
- Browser verification mounted actual components with clearly marked synthetic server responses. It verified candidate target disabled by default; legacy-incompatible options; legacy submission disabled before compatibility acknowledgement and enabled after; Hindi primary language, additional languages, Devanagari and NVDA choices; requested date/timezone and expedited request retained in review; private receipt read status; immutable summary; and execution-completed/assessment-blocked distinction.
- Browser verification found and fixed date input retention across wizard steps. No source bytes were stored in the browser draft; source re-selection was required after reload.

External evidence retained outside Git: `work/epub-phase03-final-tests.log`, `work/epub-phase03-final-build.log`, `work/epub-phase03-final-tsc.log`, `outputs/epub-phase03-preflight.png`, `outputs/epub-phase03-review.png`. Screenshots are synthetic local UI evidence, not live delivery or production scan results.

## Remaining integration gates

No EPUB conversion worker, trusted source malware verdict, EPUBCheck/Ace pass, final delivery artifact, production database migration, live notification delivery, scheduler cadence or native screen-reader result is claimed. These remain explicit later implementation/deployment gates. Missing client guidelines still mean Standard Profile; supplied notes are not approved rules. Phase 4 implements the optional client guideline lifecycle next.
