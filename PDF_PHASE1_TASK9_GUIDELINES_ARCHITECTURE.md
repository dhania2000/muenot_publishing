# PDF Phase 1 — Task 9: Optional Client Guidelines Architecture

## Permanent rule
Client guidelines are **optional**. When guidelines are supplied and apply to the job, the output **must comply** with them.
- **Scenario A (no guidelines):** the Standard Profile is used, nothing is blocked, and Company Guidelines compliance is "Not applicable".
- **Scenario B (guidelines supplied):** the job keeps a reference to the exact profile version. Requirements are reviewed, applied and verified as separate steps. The job is called compliant only when there is evidence.

## Audit (before this task)
- Task 8 added guideline types in `pdf-status-model.ts`. That file used one status union that mixed rule, application and verification states.
- Task 8 also added components in `pdf-guidelines-components.tsx`, a `PdfGuidelineState` summary and a priority list in `pdf-workspace-config.ts`, and an Overview summary with its own small item shape.
- No guideline storage, parser, routes or engine exist. None were added in this task.

## Files
| File | Change |
|---|---|
| `lib/guidelines/guideline-contracts.ts` | New. Service-independent contracts: documents, versioned profiles, rules, mappings, conflicts, exceptions, compliance results, priority levels, verification layers, and the four status models |
| `components/publishing/conversion/pdf/pdf-guideline-categories.ts` | New. PDF requirement category registry (6 groups) |
| `pdf-status-model.ts` | The guideline section now re-exports the shared contracts under PDF aliases. The mixed status union is removed |
| `pdf-workspace-config.ts` | `PDF_GUIDELINE_PRIORITY` now comes from the shared levels. New `deriveGuidelineState(context)` |
| `pdf-guidelines-components.tsx` | Rebuilt on the contracts. Adds the optional notice, rule-mapping summary, conflict and exception panel, and a three-layer verification summary |
| `pdf-workspace.tsx`, `pdf-workspace-panels.tsx` | Accept an optional `guidelineContext`. This is where Phase 6 plugs in |
| `pdf-overview-panels.tsx` | `PdfGuidelinesSummary` takes a `GuidelineContext` instead of its own item shape |
| `test/publishing/pdf-guidelines.test.ts` | New. 12 tests. The Overview test was updated to the new contract |

## Decisions
1. **Four separate status models:** document, rule, application and verification. "Uploaded" never means "Applied", and "Applied" shows as "Applied, not verified".
2. **`GuidelineContext | null` is the single input.** `null` means Scenario A. `hasGuidelines()` is the only check, so no screen invents its own rule.
3. **Compliance is aggregated, never computed.** `assessGuidelineCompliance` only reads recorded results:
   - **Compliant:** every applicable mandatory rule has a pass with evidence.
   - **Compliant with approved exceptions:** some of those rules are covered by an approved exception instead.
   - **Review required:** there are open conflicts, undetermined rules, or a pass without evidence.
   - **Failed:** any mandatory rule failed.
   - **Not verified:** anything else, including a job with no mandatory rules.
4. **Priority order:** Job > Company > Preset > Standard. Security and mandatory technical requirements can never be overridden. `GuidelineResolutionOutcome` is the contract a future resolver must return. Conflicts, ambiguity and unsupported rules are reported, never silently resolved.
5. **Versioning:** `GuidelineVersionRef` pins a job to an exact version. Missing versions show "Not recorded" and are never invented.
6. **Mappings:** `manual-review` and `not-applicable` are valid outcomes. Not every guideline paragraph becomes a setting.
7. **Reuse:** the profile selector stays the shared `PdfProfileSelector`. Editorial and Accessibility can import `lib/guidelines` directly and keep their own category registries.

## Not implemented (Phase 6)
Guideline upload, storage and parsing; rule extraction and interpretation; setting mapping; conflict detection; enforcement; and verification engines.

## Validation
- `vitest run test/publishing`: 141 passed, 2 failed. Both failures (`alt-text-upload` 201 metadata, and `pdf-section-navigation` "only Overview ui-ready") also fail on clean `main`.
- `tsc --noEmit`: no errors in the changed files.
