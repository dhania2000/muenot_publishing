# EPUB conversion implementation tracker

This directory tracks the 300 sequential tasks supplied in `Muenot_EPUB_300_Tasks_Download.docx`. The source SHA-256, original task text and all 300 task IDs are preserved in [roadmap.json](roadmap.json). Its task order is authoritative. A completed specification is not an implemented conversion engine.

The initial audit baseline is commit `0cf661d69040185aeb5ffd73d23700a80d9f4f76`, inspected 29 October 2026. Later task reports record subsequent implementation changes. The documents under [2026-10-29](2026-10-29/) supersede conflicting findings in the older P1-T01–T03 reports at this directory's root. Those older reports remain historical evidence. Their missing-roadmap blocker B1 is resolved by the supplied DOCX and the imported catalogue; their provisional workstreams are not the task numbering authority.

## Delivery batches

Each batch contains ten consecutive global task numbers, even across a phase boundary. Batch 1 is P1-T01–P1-T10; batch 2 is P1-T11–P2-T05. Record evidence and commit/push each batch checkpoint; if a prerequisite prevents acceptance, record that task as partial rather than reporting a completed batch. Never mark a task complete because a route exists or because a later task is planned.

| Batch | Global numbers | Task range | Evidence |
| --- | --- | --- | --- |
| 1 | 1–10 | P1-T01–P1-T10 | [Batch 1 report](2026-10-29/batch-01-report.md) |
| 2 | 11–20 | P1-T11–P2-T05 | [Checkpoint report](2026-10-29/batch-02-report.md) and [intake closure](2026-10-29/P2-T05-intake-integration.md): complete |
| 3 | 21–30 | P2-T06–P2-T15 | [Batch 3 checkpoint](2026-10-30/batch-03-report.md): 9 complete, Task 30 verification partial |
| 4–30 | 31–300 | Exact task order in roadmap.json | Pending |

Phase 1 is documentation only, as the supplied prompts require. No runtime, database, dependency or production setting is changed by that phase. Phase 2 provides the EPUB overview, requirements pages, selectors, saved wizard and private held-project submission. Sources remain pending security review; no conversion job or charge is created. The workbench now includes scoped dashboards, configuration revisions, safe stored preview/report views, feedback/decisions and administrator assignment/templates. Overall: 29 complete, 1 verification partial, 270 not started. Task 30 needs native screen-reader and remaining state verification. Live database/hosting verification and the actual EPUB engine remain future gates.

## Shared rules

- Source-specific guidelines are optional at submission. Absent guidelines mean the standard profile and guideline compliance “not applicable”. Supplied applicable rules require review, application and verification as separate states.
- Use the existing conversion URLs and shared storage/job infrastructure; do not create another navigation tree or copy Alt Text's domain tables.
- Treat standards support, engine availability, test evidence, reader compatibility and deployment readiness as separate facts.
- Do not expose uploaded publications to public URLs, execute imported scripts, remove DRM or invent licensing/tool availability.
- Each task document identifies actual source paths, proposed improvements, requirement IDs, verification and unresolved dependencies. Acceptance describes the task's deliverable, not completion of later phases.
