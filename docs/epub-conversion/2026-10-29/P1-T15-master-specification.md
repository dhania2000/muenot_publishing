# P1-T15 Master functional specification and engineering review

Version 1.0 · 29 October 2026 · consolidates P1-T01–P1-T14. This is engineering specification sign-off only. No business approver, customer, independent accessibility assessor or production operator has signed a release by this document.

## Functional baseline

Existing Publishing navigation and shared UI/storage/jobs/auth remain the foundation (P1-T01/02). EPUB 3.3 reflowable is the first target, with optional per-work client guidelines and explicit unavailable/conditional capability states (P1-T03/05). New action/project grants are required before multi-role external use (P1-T04). Layout, source and category matrices define suitability and loss handling (P1-T06/07/08). Boundaries/interfaces and an additive aggregate preserve current services (P1-T09/10). Version-bound workflow/QA/delivery gates prevent silent shortcuts (P1-T11/12). Proposed capacity targets and actual dependency risks stay visible (P1-T13/14).

## User journeys and acceptance

| ID | Journey | Required result and foundation |
| --- | --- | --- |
| MASTER-01 | Submit ordinary book without guidelines | Standard profile; no guideline error; authorized source intake and coherent request fingerprint; SCP-01/10, SRC-01, WF-01 |
| MASTER-02 | Two publishers/writers use different clients | Independent immutable selections, assigned access and no global active client; ROL-01–12, ARC-07, DATA-03/06 |
| MASTER-03 | Unsafe/unsupported source | Actionable hold, no simulated conversion or provider charge; SRC-01–13, WF-02/03, NFR-06 |
| MASTER-04 | Produce and revise an output | Preserve original and prior revisions; stale workers/reports cannot overwrite approvals; ARC-12/14, DATA-08–15, WF-04–08 |
| MASTER-05 | Release a publication | Exact-hash structural, accessibility, client and rights evidence; permitted recipient and immutable delivery; A11Y-01–10, WF-08 |
| MASTER-06 | Recover from outage | Idempotent stage recovery, visible errors and no lost released artifact; NFR-05/09–12, RISK-08/10 |

The architecture diagram and interface contract are in P1-T09; entity relationships and migration rollback are in P1-T10; state chart and negative transition matrix are in P1-T11. Their diagrams are normative design proposals for later implementation, not deployed topology.

## Consistency and coverage review

[roadmap-coverage.json](roadmap-coverage.json) maps each of the remaining 285 actual task IDs to foundation documents and requirement families. The mapping is planning traceability, not a claim that future acceptance tests pass. All 14 foundation documents have requirement IDs, existing-file mapping, task acceptance and unresolved dependencies; all 285 task IDs have a foundation owner. Existing historical P1-T03 provisional workstreams do not override the imported roadmap.

Reviewed invariants: source extension never implies available adapter; layout preference never guarantees a reader; model/validator installation never proves accuracy/conformance; no guidelines never fails intake; mandatory supplied rules never silently disappear; admin does not impersonate client approval; tenant default does not authorize anonymous work; file metadata labels do not prove encryption/scanning/retention; a retry never changes released bytes. No contradiction remains between these invariants and the proposed scope, roles, data or workflow.

## Open decisions and sign-off boundaries

| Decision | Owner | Gate |
| --- | --- | --- |
| Exact reader/device acceptance list and licensed fixture corpus | QA/content lead | Before claiming reader/layout support |
| Fine-grained grants and client/publisher membership | Authorization/product owner | Before client-facing submit/approve/download |
| Tool versions/licenses, host isolation and scheduler capacity | Operations/security | Before conversion execution |
| Retention durations, backup verification and privacy/legal review | Operations/organization owner | Before purge or production release |
| Publisher/retailer obligations and accessibility claim reviewer | Publisher/QA owner | Before release metadata/claims |

Engineering sign-off outcome: specification package accepted for staged implementation with the recorded gates; no orphan roadmap task or untracked requirement family. Business/release sign-off is explicitly pending the listed evidence and accountable people. Phase 2 may build honest frontend interactions; it cannot claim backend submission/processing before those contracts exist. No runtime/schema/production setting changed by Phase 1. Change log: consolidated the master baseline and formalized review/decision boundaries.
