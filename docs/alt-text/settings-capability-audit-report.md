# Alt Text Settings — capability audit and missing workflow

Date: 2026-10-29. Explicit user follow-up after Task 24 and before Task 25.

All eight sections were checked against the actual backend and then opened in the browser using the real Settings component with clearly labelled synthetic responses. No production settings were changed.

| Section | Finding and result |
| --- | --- |
| General | Classification uncertainty already exists as categorical evidence and manual review. Register it and describe it accurately; no numeric confidence is invented. Model availability remains a separate requirement. |
| OCR & Text | Recognition, English/Hindi packs and mathematical runtime already have real readiness checks. Preserve `Not configured` and policy-disabled states rather than claiming every deployment can recognize text. |
| Mathematics | Local bounded syntax/KaTeX and Presentation MathML workflows already exist. Register syntax/human verification and replace obsolete Task 8/9 wording. Remove the unused formula-verification settings switch; actual validation remains in equation review and shared processing. Recognition remains separately gated on runtime readiness, with accuracy subject to human review. |
| Graphs & Charts | Existing governed chart structure, reviewed OCR axes/legends and confirmed printed values remain registered. Correct outdated dependency wording. Native datasets and pixel digitization remain unsupported. |
| Scientific Diagrams | Existing source-bound structure/domain/flowchart/table/map/mixed workflows remain registered. Candidates and expert review retain their distinctions. |
| Descriptions | Existing standard/advanced generation stays governed by the same model, settings and review services. Optional client policy is now consumed here. |
| Quality & Review | Register actual advanced QA. Replace hardcoded `Planned (Task 21)` / `Not yet implemented` with backend-driven status for the four existing OCR/math/chart/science checks. Available means the check can run, not that findings have passed. |
| Client Guidelines | Previously missing. Implement an optional named client policy as the tenant default, using the existing revisioned settings row and Save/Discard controls. No separate table, upload dependency or project-specific policy is claimed. |

## Client policy behavior

An authorized settings manager can save a client name, exact required/flagged literal terms and a detailed-description preference. The combined rule limit is 10; literal length is 80 characters; unsupported fields, forged versions, broken Unicode, controls and contradictory literal lists are rejected. Rules are declarative, never executable regex or custom instructions. Source evidence, notation, decorative purpose and mandatory approval take priority.

Rules are disabled by default. The one named policy applies as a tenant default to new generation/QA, so it should be disabled when processing another client's work. Existing approvals are preserved. Project/document-specific selection and file-based policy import are not provided by this workflow.

The existing tenant-row transaction preserves policy on ordinary settings writes, increments its version only when policy content changes and rejects stale revision writes. Generation receives bounded rule data, records the exact policy/version in its existing saved evidence and emits review warnings without inventing missing facts. Failed settings reads stop generation before claim/charge. Current advanced QA consumes the policy and includes its version in the source fingerprint. QA version `advanced-quality.v2` adds NFC literal comparison and explicitly exempts decorative descriptions from client description rules. No QA result approves a description.

Settings PATCH now reads a bounded byte stream rather than trusting Content-Length. Permissions, tenant scope, existing revision conflict handling and field-only audit logging remain in force.

## Verification

- 26 additional regression tests: contract limits/Unicode, optional defaults, tenant-scoped persistence, preservation/versioning/concurrent conflict, permissions/stream limits, model/runtime status distinctions, generation warnings/provenance and QA fingerprint/decorative handling.
- Full Alt Text suite: **1,324 passed, 0 failed, 3 skipped** in 130 files, excluding the existing exploratory file. TypeScript and final production webpack/standalone preparation passed.
- Browser: all eight sections contain no stale implementation placeholder; QA shows all four active checks. Real client-policy controls accept Hindi/English literals, show unsaved changes, save to the synthetic fixture and display the new version. Mobile content width equals viewport width (390 px), with no horizontal overflow. Desktop/mobile screenshots are in `outputs/` outside the repository.
- No live MySQL tenant, authenticated production workflow, external AI provider, native Office or Hostinger deployment was tested. Registration does not establish scientific accuracy or deployment readiness.
