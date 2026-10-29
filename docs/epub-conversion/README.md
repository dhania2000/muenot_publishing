# EPUB conversion implementation tracker

This directory tracks the 300 sequential tasks supplied in `Muenot_EPUB_300_Tasks_Download.docx`. The source SHA-256, original task text and all 300 task IDs are preserved in [roadmap.json](roadmap.json). Its task order is authoritative. A completed specification is not an implemented conversion engine.

The current evidence baseline is commit `0cf661d69040185aeb5ffd73d23700a80d9f4f76`, inspected 29 October 2026. The documents under [2026-10-29](2026-10-29/) supersede conflicting findings in the older P1-T01–T03 reports at this directory's root. Those older reports remain historical evidence. Their missing-roadmap blocker B1 is resolved by the supplied DOCX and the imported catalogue; their provisional workstreams are not the task numbering authority.

## Delivery batches

Each batch contains ten consecutive global task numbers, even across a phase boundary. Batch 1 is P1-T01–P1-T10; batch 2 is P1-T11–P2-T05. Record evidence and commit/push after each completed batch. Never mark a task complete because a route exists or because a later task is planned.

| Batch | Global numbers | Task range | Evidence |
| --- | --- | --- | --- |
| 1 | 1–10 | P1-T01–P1-T10 | [Batch 1 report](2026-10-29/batch-01-report.md) |
| 2 | 11–20 | P1-T11–P2-T05 | Pending |
| 3–30 | 21–300 | Exact task order in roadmap.json | Pending |

Phase 1 is documentation only, as the supplied prompts require. No runtime, database, dependency or production setting is changed by that phase. Frontend improvements begin in Phase 2. Current EPUB screens remain placeholders until their corresponding implementation tasks are completed.

## Shared rules

- Source-specific guidelines are optional at submission. Absent guidelines mean the standard profile and guideline compliance “not applicable”. Supplied applicable rules require review, application and verification as separate states.
- Use the existing conversion URLs and shared storage/job infrastructure; do not create another navigation tree or copy Alt Text's domain tables.
- Treat standards support, engine availability, test evidence, reader compatibility and deployment readiness as separate facts.
- Do not expose uploaded publications to public URLs, execute imported scripts, remove DRM or invent licensing/tool availability.
- Each task document identifies actual source paths, proposed improvements, requirement IDs, verification and unresolved dependencies. Acceptance describes the task's deliverable, not completion of later phases.
