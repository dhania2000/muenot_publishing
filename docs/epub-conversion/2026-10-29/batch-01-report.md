# EPUB batch 1 completion report

29 October 2026 · global tasks 1–10 of 300 · documentation/specification batch.

The supplied plan explicitly makes Phase 1 documentation only. This batch completes P1-T01–P1-T10 as specifications. It does not implement or deploy EPUB conversion, remove the Coming soon screen, apply schema migrations, install validators or claim reader/accessibility conformance.

## Completed tasks

| Task | Deliverable | Requirement IDs | Acceptance evidence |
| --- | --- | --- | --- |
| P1-T01 | [Current repository audit](P1-T01-existing-system-audit.md) | AUD-01–14 | Actual routes, packages, services, schemas, permissions and risks separated from proposals |
| P1-T02 | [Improvement mapping](P1-T02-improvement-mapping.md) | MAP-01–14 | Existing page/component/service mapped to reuse/extension/integration/new work, ownership and dependency |
| P1-T03 | [Service scope](P1-T03-service-scope.md) | SCP-01–10 | Target tiers, supported-versus-conditional boundaries, exclusions and fallbacks |
| P1-T04 | [Roles and permissions](P1-T04-role-permissions.md) | ROL-01–12; AUTH-01–10 | Action matrix, independent decisions, tenant scope and negative cases specified; current grant limitations disclosed |
| P1-T05 | [Version compatibility](P1-T05-version-compatibility.md) | VER-01–10 | All seven requested versions, profile policies, validation and feature-loss fixture criteria |
| P1-T06 | [Layout and renditions](P1-T06-layout-renditions.md) | LAY-01–10 | Reflow/fixed/spread/mixed/multiple/roll/direction profiles with named test-book designs and fallbacks |
| P1-T07 | [Source and output matrix](P1-T07-source-output-matrix.md) | SRC-01–13 | Every requested input, reverse routes, adapter/tool dependency, fidelity and review boundary |
| P1-T08 | [Content categories](P1-T08-content-categories.md) | CAT-01–14 | All requested categories with sample-source designs, exception handling and QA criteria |
| P1-T09 | [Reusable architecture](P1-T09-reusable-architecture.md) | ARC-01–14 | Existing/new boundaries, architecture diagram, proposed interfaces and processing isolation |
| P1-T10 | [Data model](P1-T10-data-model.md) | DATA-01–18 | Additive aggregates, integrity/privacy engineering review, immutable versions, retention and rollback plan |

## Verification

- Imported exactly 300 unique sequential task IDs, 20 phases and 15 tasks per phase. All six original prompt sections were retained for each task in roadmap.json.
- Source DOCX SHA-256: `bc52ba4dd650ba6febc96bdb2ff327c36802ac8b04ac6e95deac17a1af54f0d5`.
- Verified 55 cited repository file paths and recorded their hashes at baseline `0cf661d69040185aeb5ffd73d23700a80d9f4f76` in [repository-evidence.json](repository-evidence.json).
- Existing Publishing regression suite: **177 tests passed in 13 files, 0 failed**. This verifies current tested Publishing behavior, not implementation of the future EPUB fixture requirements.
- Documentation link/task-order checks and Git whitespace checks passed. Batch diff contains only files under docs/epub-conversion; no runtime, dependency, schema, production setting or existing service changed.
- Standards status and official tool references were inspected on 29 October 2026. EPUB 3.3 and Accessibility 1.1 are the baseline; the currently published 3.4/Accessibility 1.2 candidate profiles remain separately gated.

The previous baseline's full application suite (1,559 passes, 3 opt-in skips) and production build were already verified for commit 0cf661d. They were not rerun or represented as new EPUB-engine evidence for this documentation-only batch.

## Remaining work

**10 specifications complete; 290 tasks pending.** Next is P1-T11 Workflow states and approval gates. Batch 2 covers P1-T11–P2-T05. Runtime implementation begins with the scoped Phase 2 work, following the remaining Phase 1 specifications.

Live MySQL compatibility, authoritative fine-grained grants, malware tooling, EPUB package/adapter engines, EPUBCheck/Ace provisioning, lawful proprietary tool entitlements, reader/assistive tests and deployment verification remain future dependencies. Nothing in this report resolves those by assertion.
