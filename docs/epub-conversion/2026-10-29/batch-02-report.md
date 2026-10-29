# EPUB batch 2 progress report

Historical checkpoint 46831e5 · global tasks 11–20 · **9 complete, 1 frontend partial at that checkpoint**. The remaining P2-T05 intake dependency was subsequently closed; see [batch 2 closure evidence](P2-T05-intake-integration.md). Current total: 20 complete, 280 pending. The report below preserves the earlier progress evidence.

| Task | Evidence | Status |
| --- | --- | --- |
| P1-T11 | [Workflow chart and gates](P1-T11-workflow.md) | Specification complete |
| P1-T12 | [Conformance baseline](P1-T12-conformance.md) | Specification complete |
| P1-T13 | [Nonfunctional targets](P1-T13-nonfunctional.md) | Specification complete; performance targets explicitly proposed |
| P1-T14 | [Risks and dependencies](P1-T14-risk-register.md) | Specification complete |
| P1-T15 | [Master engineering specification](P1-T15-master-specification.md), [285-task coverage](roadmap-coverage.json) | Engineering specification complete; business/production sign-off remains separate |
| P2-T01 | [Design-system reuse](P2-T01-design-reuse.md) | Complete |
| P2-T02 | [Landing page](P2-T02-landing.md) | Frontend complete |
| P2-T03 | [Capabilities and requirements](P2-T03-capabilities.md) | Frontend complete |
| P2-T04 | [Format selectors](P2-T04-format-selection.md) | Frontend complete |
| P2-T05 | [Wizard and unmet prerequisite](P2-T05-wizard-status.md) | **Frontend partial**; coherent server-side project submission not implemented |

## Result

The existing EPUB overview now shows eight honest capability profiles, source/layout guidance, workflow and planning/inquiry actions. Existing workspace supports bounded source-name selection, book details, compatible version/layout/rendition/profile settings, optional guideline notes and review. Save plan restores metadata in the same authenticated user's browser tab. Requirements links reuse registered EPUB pages. PDF and unrelated service branches remain intact.

No file bytes are uploaded or persisted by the planner, and no job, charge, server project or converted output is created. Secure project/source intake and an EPUB execution handler are absent from the audited repository; a disabled, explained Submit project control preserves that boundary. Resume P2-T05 after those contracts exist; it remains pending end-to-end acceptance.

## Verification

- Full application suite: **1,566 passed, 0 failed, 3 existing opt-in skips**, 150 files.
- Publishing suite: **184 passed**, including seven new EPUB model/rendering tests.
- TypeScript noEmit, production webpack build and standalone packaging passed.
- Browser tested actual React components: required-source validation, fixture file selection without content reading/upload, title, keyboard progression/focus, legacy disabled choices, optional blank guidelines, coherent review, save/reload, and unavailable submission.
- Desktop/mobile screenshots saved outside the repository; 390px viewport had no horizontal document overflow. Local component preview is not production deployment or a real authenticated database smoke test.
- All 300 original task IDs/prompts remain in order. All 285 implementation-task IDs map to the 14 foundation documents; no foundation document is orphaned. Documentation links and whitespace checks passed.

Overall roadmap state: **19 complete, 1 frontend partial, 280 not started**. No live MySQL, paid provider, production hosting, EPUBCheck/Ace or reading-system certification was exercised.
